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

function signParams(params, apiSecret) {
  const signatureBase = Object.entries(params)
    .filter(([, value]) => value !== undefined && value !== null && value !== "")
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join("&") + apiSecret;
  return crypto.createHash("sha1").update(signatureBase).digest("hex");
}

export async function uploadFileToCloudinary(file, folder, { publicId = "" } = {}) {
  const { cloudName, apiKey, apiSecret } = getCloudinaryConfig();
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = signParams({ folder, public_id: publicId, timestamp }, apiSecret);
  const fileBuffer = await fs.readFile(file.filepath);
  const formData = new FormData();

  formData.append("file", new Blob([fileBuffer], { type: file.mimetype || "application/octet-stream" }), file.originalFilename || "arquivo");
  formData.append("folder", folder);
  if (publicId) formData.append("public_id", publicId);
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

export async function deleteCloudinaryImage(publicId) {
  if (!publicId) return;
  const { cloudName, apiKey, apiSecret } = getCloudinaryConfig();
  const timestamp = Math.floor(Date.now() / 1000);
  const formData = new FormData();
  formData.append("public_id", publicId);
  formData.append("timestamp", String(timestamp));
  formData.append("api_key", apiKey);
  formData.append("signature", signParams({ public_id: publicId, timestamp }, apiSecret));

  const response = await fetch(`https://api.cloudinary.com/v1_1/${cloudName}/image/destroy`, {
    method: "POST",
    body: formData
  });

  if (!response.ok) {
    throw new Error("Nao foi possivel limpar o arquivo temporario do Cloudinary.");
  }
}
