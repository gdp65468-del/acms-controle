import fs from "node:fs/promises";
import crypto from "node:crypto";

function getCloudinaryConfig() {
  const cloudName = process.env.CLOUDINARY_CLOUD_NAME || process.env.VITE_CLOUDINARY_CLOUD_NAME;
  const apiKey = process.env.CLOUDINARY_API_KEY;
  const apiSecret = process.env.CLOUDINARY_API_SECRET;

  if (!cloudName || !apiKey || !apiSecret) {
    throw new Error("Configure CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY e CLOUDINARY_API_SECRET.");
  }

  return { cloudName, apiKey, apiSecret };
}

function signUploadParams(folder, timestamp, apiSecret) {
  const signatureBase = `folder=${folder}&timestamp=${timestamp}${apiSecret}`;
  return crypto.createHash("sha1").update(signatureBase).digest("hex");
}

export async function uploadFileToCloudinary(file, folder) {
  const { cloudName, apiKey, apiSecret } = getCloudinaryConfig();
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = signUploadParams(folder, timestamp, apiSecret);
  const fileBuffer = await fs.readFile(file.filepath);
  const formData = new FormData();

  formData.append("file", new Blob([fileBuffer], { type: file.mimetype || "application/octet-stream" }), file.originalFilename || "arquivo");
  formData.append("folder", folder);
  formData.append("timestamp", String(timestamp));
  formData.append("api_key", apiKey);
  formData.append("signature", signature);

  const response = await fetch(`https://api.cloudinary.com/v1_1/${cloudName}/auto/upload`, {
    method: "POST",
    body: formData
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(body || "Nao foi possivel enviar o arquivo ao Cloudinary.");
  }

  return response.json();
}
