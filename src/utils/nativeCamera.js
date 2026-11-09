import { Capacitor } from "@capacitor/core";
import { Camera } from "@capacitor/camera";

export function isNativeAndroidApp() {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === "android" && Capacitor.isPluginAvailable("Camera");
}

export async function captureWithNativeCamera(captureId) {
  const photo = await Camera.takePhoto({
    quality: 95,
    correctOrientation: true,
    saveToGallery: false,
    editable: "no",
    includeMetadata: false
  });
  const source = photo.webPath || (photo.uri ? Capacitor.convertFileSrc(photo.uri) : "");
  if (!source) throw new Error("A camera nativa nao retornou a fotografia.");

  const response = await fetch(source);
  if (!response.ok) throw new Error("Nao foi possivel ler a foto feita pela camera.");
  const blob = await response.blob();
  if (!blob.size) throw new Error("A camera retornou uma fotografia vazia.");

  const timestamp = new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
  return new File([blob], `COMPROVANTE_${timestamp}_${captureId.slice(0, 8)}.jpg`, {
    type: blob.type || "image/jpeg",
    lastModified: Date.now()
  });
}
