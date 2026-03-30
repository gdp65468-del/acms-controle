import { Timestamp, getAdminDb } from "../_lib/firebaseAdmin.js";
import { requireTreasurer } from "../_lib/auth.js";
import { uploadFileToCloudinary } from "../_lib/cloudinary.js";
import { sendError, sendJson } from "../_lib/http.js";
import { getSingleField, getSingleFile, multipartConfig, parseMultipartForm } from "../_lib/multipart.js";

export const config = multipartConfig;

function getFolderName(folderPath = "") {
  if (!folderPath) {
    return "acms-controle/geral";
  }
  return `acms-controle/${String(folderPath)
    .split("/")
    .filter(Boolean)
    .map((segment) => segment.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, ""))
    .join("/")}`;
}

function toAssetRecord(data) {
  return {
    id: data.id,
    folderId: String(data.folderId || ""),
    title: data.title || "",
    originalFileName: data.originalFileName || "",
    fileType: data.fileType || "",
    mimeType: data.mimeType || "",
    secureUrl: data.secureUrl || "",
    thumbnailUrl: data.thumbnailUrl || "",
    notes: data.notes || "",
    digitized: Boolean(data.digitized),
    digitizedAt: data.digitizedAt || "",
    deletedAt: data.deletedAt || "",
    createdAt: data.createdAt?.toDate ? data.createdAt.toDate().toISOString() : ""
  };
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    sendError(res, 405, "Metodo nao permitido.");
    return;
  }

  try {
    const treasurer = await requireTreasurer(req);
    const adminDb = getAdminDb();
    const { fields, files } = await parseMultipartForm(req);
    const file = getSingleFile(files, "file");
    if (!file) {
      sendError(res, 400, "Selecione um arquivo.");
      return;
    }

    const title = String(getSingleField(fields, "title") || file.originalFilename || "").trim();
    if (!title) {
      sendError(res, 400, "Informe um titulo para o arquivo.");
      return;
    }

    const mimeType = String(file.mimetype || "");
    const fileType = mimeType.startsWith("image/") ? "image" : mimeType === "application/pdf" ? "pdf" : "";
    if (!fileType) {
      sendError(res, 400, "Envie apenas imagem ou PDF.");
      return;
    }

    const folderId = String(getSingleField(fields, "folderId") || "");
    const folderPath = String(getSingleField(fields, "folderPath") || "");
    const notes = String(getSingleField(fields, "notes") || "").trim();
    const uploadedBy = String(getSingleField(fields, "uploadedBy") || treasurer.uid);
    const upload = await uploadFileToCloudinary(file, getFolderName(folderPath));

    const record = {
      folderId,
      title,
      originalFileName: file.originalFilename || title,
      fileType,
      mimeType,
      cloudinaryPublicId: upload.public_id || "",
      secureUrl: upload.secure_url || "",
      thumbnailUrl: fileType === "image" ? upload.secure_url || "" : "",
      notes,
      digitized: false,
      digitizedAt: "",
      deletedAt: "",
      uploadedBy,
      createdAt: Timestamp.now()
    };

    const docRef = await adminDb.collection("arquivos").add(record);
    sendJson(res, 200, {
      ok: true,
      asset: toAssetRecord({
        id: docRef.id,
        ...record
      })
    });
  } catch (error) {
    sendError(res, 400, error.message || "Nao foi possivel enviar o arquivo.");
  }
}
