const $ = (selector) => document.querySelector(selector);

const cameraVideo = $("#cameraVideo");
const imagePreview = $("#imagePreview");
const cameraEmpty = $("#cameraEmpty");
const stageTitle = $("#stageTitle");
const stageDescription = $("#stageDescription");
const startCameraButton = $("#startCameraButton");
const captureButton = $("#captureButton");
const galleryButton = $("#galleryButton");
const fileInput = $("#fileInput");
const cameraControls = $("#cameraControls");
const selectedActions = $("#selectedActions");
const analyzeButton = $("#analyzeButton");
const retakeButton = $("#retakeButton");
const newAnalysisButton = $("#newAnalysisButton");
const statusMessage = $("#statusMessage");
const resultsSection = $("#resultsSection");
const cameraLive = $("#cameraLive");
const previewLabel = $("#previewLabel");
const toast = $("#toast");
const aboutDialog = $("#aboutDialog");

const mobileQuery = window.matchMedia("(max-width: 760px)");
let stream = null;
let selectedFile = null;
let selectedObjectUrl = null;
let toastTimeout = null;

function isMobileLayout() {
  return mobileQuery.matches;
}

function setStatus(message = "", type = "") {
  statusMessage.textContent = message;
  statusMessage.className = `status-message ${type}`.trim();
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add("is-visible");
  window.clearTimeout(toastTimeout);
  toastTimeout = window.setTimeout(() => toast.classList.remove("is-visible"), 3200);
}

function stopCamera() {
  if (stream) {
    stream.getTracks().forEach((track) => track.stop());
    stream = null;
  }
  cameraVideo.srcObject = null;
  cameraVideo.classList.remove("is-visible");
  cameraLive.classList.remove("is-visible");
  captureButton.hidden = true;
  startCameraButton.hidden = !isMobileLayout();
}

function clearObjectUrl() {
  if (selectedObjectUrl) {
    URL.revokeObjectURL(selectedObjectUrl);
    selectedObjectUrl = null;
  }
}

function resetStage() {
  stopCamera();
  clearObjectUrl();
  selectedFile = null;
  imagePreview.removeAttribute("src");
  imagePreview.classList.remove("is-visible");
  cameraEmpty.hidden = false;
  stageTitle.textContent = "Pratinjau gambar";
  stageDescription.textContent = isMobileLayout()
    ? "Aktifkan kamera atau pilih gambar dari perangkat."
    : "Pilih gambar dari perangkat untuk memulai.";
  cameraControls.hidden = false;
  selectedActions.hidden = true;
  galleryButton.hidden = false;
  startCameraButton.hidden = !isMobileLayout();
  previewLabel.classList.remove("is-visible");
  resultsSection.hidden = true;
  setStatus("");
  analyzeButton.disabled = false;
  analyzeButton.innerHTML = '<span>Analisis Gambar</span><svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M5 12h14m-6-6 6 6-6 6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
}

async function startCamera() {
  if (!isMobileLayout()) return;
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    setStatus("Browser ini tidak mendukung kamera langsung. Silakan pilih gambar dari galeri.", "error");
    return;
  }
  stopCamera();
  setStatus("");
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 960 } }
    });
    cameraVideo.srcObject = stream;
    cameraVideo.classList.add("is-visible");
    cameraEmpty.hidden = true;
    imagePreview.classList.remove("is-visible");
    cameraLive.classList.add("is-visible");
    previewLabel.classList.remove("is-visible");
    startCameraButton.hidden = true;
    captureButton.hidden = false;
    galleryButton.hidden = false;
    selectedActions.hidden = true;
    cameraControls.hidden = false;
    await cameraVideo.play();
  } catch (error) {
    let message = "Kamera tidak dapat dibuka. Periksa izin kamera atau pilih gambar dari galeri.";
    if (error && error.name === "NotAllowedError") message = "Izin kamera ditolak. Izinkan akses kamera di browser atau pilih gambar dari galeri.";
    if (error && error.name === "NotFoundError") message = "Kamera tidak ditemukan pada perangkat ini. Silakan pilih gambar dari galeri.";
    setStatus(message, "error");
  }
}

function showSelectedImage(file) {
  if (!file) return;
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
    setStatus("Format tidak didukung. Gunakan JPG, PNG, atau WebP.", "error");
    return;
  }
  if (file.size > 10 * 1024 * 1024) {
    setStatus("Ukuran gambar maksimal 10 MB. Pilih gambar yang lebih kecil.", "error");
    return;
  }

  stopCamera();
  clearObjectUrl();
  selectedFile = file;
  selectedObjectUrl = URL.createObjectURL(file);
  imagePreview.src = selectedObjectUrl;
  imagePreview.classList.add("is-visible");
  cameraEmpty.hidden = true;
  cameraLive.classList.remove("is-visible");
  previewLabel.classList.add("is-visible");
  cameraControls.hidden = true;
  selectedActions.hidden = false;
  setStatus(`Gambar siap dianalisis · ${(file.size / (1024 * 1024)).toFixed(2)} MB`);
  resultsSection.hidden = true;
}

function capturePhoto() {
  if (!stream || !cameraVideo.videoWidth || !cameraVideo.videoHeight) {
    setStatus("Kamera belum siap. Coba tunggu sebentar.", "error");
    return;
  }
  const canvas = document.createElement("canvas");
  canvas.width = cameraVideo.videoWidth;
  canvas.height = cameraVideo.videoHeight;
  const context = canvas.getContext("2d");
  context.drawImage(cameraVideo, 0, 0, canvas.width, canvas.height);
  canvas.toBlob((blob) => {
    if (!blob) {
      setStatus("Foto gagal diambil. Silakan coba lagi.", "error");
      return;
    }
    const file = new File([blob], `aqi-vision-${Date.now()}.jpg`, { type: "image/jpeg" });
    showSelectedImage(file);
  }, "image/jpeg", 0.92);
}

function buildDemoScores() {
  const categories = [
    { label: "Unhealthy", score: 0.7, color: "#e53935" },
    { label: "Moderate", score: 0.48, color: "#f2c500" },
    { label: "Good", score: 0.25, color: "#00a651" },
  ];
  $("#scoreBars").innerHTML = categories.map((item) => `
    <div class="score-row">
      <div class="score-meta"><span>${item.label}</span><strong>${Math.round(item.score * 100)}%</strong></div>
      <div class="score-track"><div class="score-fill" style="width:${item.score * 100}%; background:${item.color}"></div></div>
    </div>
  `).join("");
}

function getAQIColor(category) {
  const colors = {
    "Good": "#00a651",
    "Moderate": "#f2c500",
    "Unhealthy for Sensitive Groups": "#f28c28",
    "Unhealthy": "#e53935",
    "Very Unhealthy": "#8e44ad",
    "Hazardous": "#7e2639"
  };
  return colors[category] || "#68786d";
}

function showDemoResult() {
  if (!selectedFile || !selectedObjectUrl) {
    setStatus("Ambil foto atau pilih gambar terlebih dahulu.", "error");
    return;
  }
  resultsSection.hidden = false;
  $("#predictedCategory").textContent = "Unhealthy";
  $("#predictionNote").textContent = "Estimasi kategori kualitas udara berdasarkan gambar.";
  $("#categoryIndicator").style.background = getAQIColor("Unhealthy");
  $("#originalResultImage").src = selectedObjectUrl;
  $("#heatmapImage").hidden = true;
  $("#heatmapEmpty").hidden = false;
  buildDemoScores();
  setStatus("Gambar berhasil diproses untuk pratinjau antarmuka.");
  resultsSection.scrollIntoView({ behavior: "smooth", block: "start" });
}

startCameraButton.addEventListener("click", startCamera);
captureButton.addEventListener("click", capturePhoto);
galleryButton.addEventListener("click", () => fileInput.click());
fileInput.addEventListener("change", (event) => {
  const file = event.target.files && event.target.files[0];
  if (file) showSelectedImage(file);
  fileInput.value = "";
});
retakeButton.addEventListener("click", () => {
  resetStage();
  if (isMobileLayout()) showToast("Kamu bisa mengambil foto baru atau memilih gambar.");
  else showToast("Pilih gambar lain untuk melanjutkan.");
});
analyzeButton.addEventListener("click", () => {
  analyzeButton.disabled = true;
  analyzeButton.innerHTML = '<span>Menyiapkan simulasi…</span>';
  window.setTimeout(() => {
    showDemoResult();
    analyzeButton.disabled = false;
    analyzeButton.innerHTML = '<span>Analisis Gambar</span><svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M5 12h14m-6-6 6 6-6 6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  }, 450);
});
newAnalysisButton.addEventListener("click", () => {
  resetStage();
  window.scrollTo({ top: 0, behavior: "smooth" });
});
$("#aboutButton").addEventListener("click", () => {
  if (typeof aboutDialog.showModal === "function") aboutDialog.showModal();
  else showToast("AQI Vision adalah prototipe penelitian berbasis gambar.");
});
$("#closeAboutButton").addEventListener("click", () => aboutDialog.close());
$("#dialogDoneButton").addEventListener("click", () => aboutDialog.close());
aboutDialog.addEventListener("click", (event) => {
  if (event.target === aboutDialog) aboutDialog.close();
});

function updateResponsiveControls() {
  if (stream && !isMobileLayout()) stopCamera();
  if (!stream && !selectedFile) {
    startCameraButton.hidden = !isMobileLayout();
    stageDescription.textContent = isMobileLayout()
      ? "Aktifkan kamera atau pilih gambar dari perangkat."
      : "Pilih gambar dari perangkat untuk memulai.";
  }
}
mobileQuery.addEventListener?.("change", updateResponsiveControls);
window.addEventListener("beforeunload", () => {
  stopCamera();
  clearObjectUrl();
});
resetStage();
