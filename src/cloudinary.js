export const cloudinaryCloudName = import.meta.env.VITE_CLOUDINARY_CLOUD_NAME || "";
export const cloudinaryUploadPreset = import.meta.env.VITE_CLOUDINARY_UPLOAD_PRESET || "";
export const cloudinaryEnabled = Boolean(cloudinaryCloudName && cloudinaryUploadPreset);

export function getCloudinaryUploadUrl() {
  return `https://api.cloudinary.com/v1_1/${cloudinaryCloudName}/auto/upload`;
}
