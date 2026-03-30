function loadImageFromFile(file) {
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error("Nao foi possivel ler a imagem selecionada."));
    };
    image.src = objectUrl;
  });
}

function canvasToBlob(canvas, type, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) {
        resolve(blob);
        return;
      }
      reject(new Error("Nao foi possivel preparar a imagem para upload."));
    }, type, quality);
  });
}

export function getFileAssetType(file) {
  if (!file) return "";
  if (file.type === "application/pdf") return "pdf";
  if (file.type.startsWith("image/")) return "image";
  return "";
}

export async function prepareFileForUpload(file) {
  const assetType = getFileAssetType(file);
  if (assetType !== "image") {
    return file;
  }

  const maxDimension = 1600;
  const skipCompressionSize = 900 * 1024;
  const canKeepOriginal = file.size <= skipCompressionSize;
  const keepPng = file.type === "image/png";
  const keepOriginalType = keepPng || file.type === "image/jpeg" || file.type === "image/webp";

  if (canKeepOriginal && keepOriginalType) {
    return file;
  }

  if (!["image/jpeg", "image/jpg", "image/png", "image/webp"].includes(file.type)) {
    return file;
  }

  const image = await loadImageFromFile(file);
  const largestDimension = Math.max(image.width, image.height);
  const scale = largestDimension > maxDimension ? maxDimension / largestDimension : 1;
  const targetWidth = Math.max(1, Math.round(image.width * scale));
  const targetHeight = Math.max(1, Math.round(image.height * scale));

  if (scale === 1 && file.size <= skipCompressionSize) {
    return file;
  }

  const canvas = document.createElement("canvas");
  canvas.width = targetWidth;
  canvas.height = targetHeight;
  const context = canvas.getContext("2d");
  if (!context) {
    return file;
  }

  context.drawImage(image, 0, 0, targetWidth, targetHeight);

  const outputType = keepPng ? "image/png" : file.type === "image/webp" ? "image/webp" : "image/jpeg";
  const quality = outputType === "image/png" ? undefined : 0.82;
  const blob = await canvasToBlob(canvas, outputType, quality);

  if (blob.size >= file.size && scale === 1) {
    return file;
  }

  const extension = outputType === "image/png" ? "png" : outputType === "image/webp" ? "webp" : "jpg";
  const nextName = file.name.replace(/\.[^.]+$/, "") + `.${extension}`;

  return new File([blob], nextName, {
    type: outputType,
    lastModified: file.lastModified
  });
}
