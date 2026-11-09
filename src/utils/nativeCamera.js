import { Capacitor, registerPlugin } from "@capacitor/core";
import { Camera } from "@capacitor/camera";

const NativeScannerCamera = registerPlugin("NativeScannerCamera");

export function isNativeAndroidApp() {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === "android" && Capacitor.isPluginAvailable("Camera");
}

export function hasInlineNativeScannerCamera() {
  return Capacitor.isNativePlatform()
    && Capacitor.getPlatform() === "android"
    && Capacitor.isPluginAvailable("NativeScannerCamera");
}

function photoToFile(photo, captureId) {
  const source = photo.webPath || (photo.uri ? Capacitor.convertFileSrc(photo.uri) : "");
  if (!source) throw new Error("A camera nativa nao retornou a fotografia.");

  return fetch(source).then(async (response) => {
    if (!response.ok) throw new Error("Nao foi possivel ler a foto feita pela camera.");
    const blob = await response.blob();
    if (!blob.size) throw new Error("A camera retornou uma fotografia vazia.");
    const timestamp = new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
    return new File([blob], `COMPROVANTE_${timestamp}_${captureId.slice(0, 8)}.jpg`, {
      type: blob.type || photo.mimeType || "image/jpeg",
      lastModified: Date.now()
    });
  });
}

export async function captureWithNativeCamera(captureId) {
  const photo = await Camera.takePhoto({
    quality: 95,
    correctOrientation: true,
    saveToGallery: false,
    editable: "no",
    includeMetadata: false
  });
  return photoToFile(photo, captureId);
}

export function startInlineNativeScannerPreview(bounds) {
  return NativeScannerCamera.startPreview(bounds);
}

export function updateInlineNativeScannerBounds(bounds) {
  return NativeScannerCamera.updatePreviewBounds(bounds);
}

export function setInlineNativeScannerVisible(visible) {
  return NativeScannerCamera.setPreviewVisible({ visible });
}

export function stopInlineNativeScannerPreview() {
  return NativeScannerCamera.stopPreview();
}

export function setInlineNativeScannerTorch(enabled) {
  return NativeScannerCamera.setTorch({ enabled });
}

export function setInlineNativeScannerZoom(ratio) {
  return NativeScannerCamera.setZoom({ ratio });
}

export async function captureWithInlineNativeScanner(captureId) {
  return photoToFile(await NativeScannerCamera.takePhoto(), captureId);
}
