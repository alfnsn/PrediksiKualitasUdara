import io
from pathlib import Path
from typing import Any

import cv2
import numpy as np
import torch
import torch.nn as nn
from fastapi import FastAPI, File, HTTPException, UploadFile
from PIL import Image, ImageOps, UnidentifiedImageError
from torchvision import models, transforms
from torchvision.transforms import InterpolationMode

CHECKPOINT_PATH = Path(__file__).resolve().parent / "resnet50_conv4x_conv5x_best.pth"

CLASS_NAMES = ["0-50", "51-100", "101-150", "151-200", "201-300", "301-600"]
NUM_CLASSES = len(CLASS_NAMES)
IMG_SIZE = 224
DEVICE = torch.device("cuda" if torch.cuda.is_available() else "cpu")

app = FastAPI(
    title="PM25Vision AQI Classification API",
    description="API prediksi kategori AQI berbasis citra menggunakan ResNet50.",
    version="1.0.0",
)


# -------------------- PREPROCESSING --------------------
def load_image_corrected(image: Image.Image) -> Image.Image:
    return ImageOps.exif_transpose(image).convert("RGB")


def apply_gray_world(image: Image.Image) -> Image.Image:
    rgb = np.asarray(image.convert("RGB"), dtype=np.float32)
    channel_means = np.maximum(rgb.mean(axis=(0, 1)), 1.0)
    overall_mean = float(channel_means.mean())
    corrected = rgb * (overall_mean / channel_means)
    return Image.fromarray(np.clip(corrected, 0, 255).astype(np.uint8))


def apply_denoise(image: Image.Image) -> Image.Image:
    image_bgr = cv2.cvtColor(np.asarray(image.convert("RGB")), cv2.COLOR_RGB2BGR)
    denoised = cv2.fastNlMeansDenoisingColored(
        image_bgr, None, h=6, hColor=6,
        templateWindowSize=7, searchWindowSize=21
    )
    return Image.fromarray(cv2.cvtColor(denoised, cv2.COLOR_BGR2RGB))


def apply_unsharp_mask(image: Image.Image) -> Image.Image:
    image_bgr = cv2.cvtColor(np.asarray(image.convert("RGB")), cv2.COLOR_RGB2BGR)
    blurred = cv2.GaussianBlur(image_bgr, (0, 0), sigmaX=1.0)
    sharpened = cv2.addWeighted(image_bgr, 1.3, blurred, -0.3, 0)
    return Image.fromarray(cv2.cvtColor(sharpened, cv2.COLOR_BGR2RGB))


def preprocess_pipeline(image: Image.Image) -> Image.Image:
    image = load_image_corrected(image)
    image = apply_gray_world(image)
    image = apply_denoise(image)
    image = apply_unsharp_mask(image)

    resize_crop = transforms.Compose([
        transforms.Resize(
            232,
            interpolation=InterpolationMode.BILINEAR,
            antialias=True
        ),
        transforms.CenterCrop((IMG_SIZE, IMG_SIZE)),
    ])
    return resize_crop(image)


to_tensor_normalize = transforms.Compose([
    transforms.ToTensor(),
    transforms.Normalize(
        mean=[0.485, 0.456, 0.406],
        std=[0.229, 0.224, 0.225]
    ),
])


# -------------------- MODEL --------------------
def build_resnet50() -> nn.Module:
    model = models.resnet50(weights=None)
    model.fc = nn.Linear(model.fc.in_features, NUM_CLASSES)
    return model


def load_model() -> nn.Module:
    if not CHECKPOINT_PATH.is_file():
        raise FileNotFoundError(
            f"Checkpoint tidak ditemukan: {CHECKPOINT_PATH}"
        )

    try:
        checkpoint = torch.load(
            CHECKPOINT_PATH, map_location=DEVICE, weights_only=True
        )
    except TypeError:
        checkpoint = torch.load(CHECKPOINT_PATH, map_location=DEVICE)

    state_dict = (
        checkpoint["model_state_dict"]
        if isinstance(checkpoint, dict) and "model_state_dict" in checkpoint
        else checkpoint
    )

    model = build_resnet50()
    model.load_state_dict(state_dict)
    model.to(DEVICE)
    model.eval()
    return model


try:
    model = load_model()
    MODEL_LOAD_ERROR = None
except Exception as exc:
    model = None
    MODEL_LOAD_ERROR = str(exc)


# -------------------- API ENDPOINTS --------------------
@app.get("/")
def home() -> dict[str, str]:
    return {
        "message": "PM25Vision AQI Classification API",
        "status": "ready" if model is not None else "model_not_loaded",
        "device": str(DEVICE),
    }


@app.get("/health")
def health() -> dict[str, Any]:
    return {
        "status": "ok" if model is not None else "error",
        "model_loaded": model is not None,
        "device": str(DEVICE),
        "checkpoint": str(CHECKPOINT_PATH),
        "error": MODEL_LOAD_ERROR,
    }


@app.post("/predict")
async def predict(file: UploadFile = File(...)) -> dict[str, Any]:
    if model is None:
        raise HTTPException(
            status_code=500,
            detail=f"Model belum berhasil dimuat: {MODEL_LOAD_ERROR}",
        )

    if not file.content_type or not file.content_type.startswith("image/"):
        raise HTTPException(status_code=400, detail="Unggah file gambar.")

    try:
        contents = await file.read()
        image = Image.open(io.BytesIO(contents))
        image = load_image_corrected(image)
    except (UnidentifiedImageError, OSError, ValueError):
        raise HTTPException(
            status_code=400,
            detail="File tidak dapat dibaca sebagai gambar yang valid.",
        )
    finally:
        await file.close()

    processed = preprocess_pipeline(image)
    input_tensor = to_tensor_normalize(processed).unsqueeze(0).to(DEVICE)

    with torch.no_grad():
        logits = model(input_tensor)
        probabilities = torch.softmax(logits, dim=1)[0]

    top_probs, top_indices = torch.topk(
        probabilities, k=min(3, NUM_CLASSES)
    )

    top_3 = [
        {
            "rank": rank,
            "label": CLASS_NAMES[int(idx)],
            "probability_percent": round(float(prob) * 100, 2),
        }
        for rank, (prob, idx) in enumerate(
            zip(top_probs.cpu().tolist(), top_indices.cpu().tolist()),
            start=1,
        )
    ]

    return {
        "filename": file.filename,
        "predicted_label": top_3[0]["label"],
        "confidence_percent": top_3[0]["probability_percent"],
        "top_3": top_3,
        "image_size_after_preprocessing": [IMG_SIZE, IMG_SIZE],
        "device": str(DEVICE),
    }
