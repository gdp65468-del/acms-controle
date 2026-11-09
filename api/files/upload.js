import fs from "node:fs/promises";
import { Timestamp, getAdminDb } from "../_lib/firebaseAdmin.js";
import { requireTreasurer } from "../_lib/auth.js";
import { deleteCloudinaryImage, uploadFileToCloudinary } from "../_lib/cloudinary.js";
import { incrementDriveStorage } from "../_lib/driveStorage.js";
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

function sanitizeFileName(value, fallback = "arquivo") {
  const normalized = String(value || "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 180);
  return normalized || fallback;
}

async function isJpegFile(file) {
  const handle = await fs.open(file.filepath, "r");
  try {
    const header = Buffer.alloc(3);
    const { bytesRead } = await handle.read(header, 0, header.length, 0);
    return bytesRead === 3 && header[0] === 0xff && header[1] === 0xd8 && header[2] === 0xff;
  } finally {
    await handle.close();
  }
}

async function resolveFolderPath(adminDb, folderId) {
  if (!folderId) return "";

  const segments = [];
  const visited = new Set();
  let currentFolderId = folderId;
  while (currentFolderId) {
    if (visited.has(currentFolderId) || visited.size >= 40) {
      throw new Error("A estrutura da pasta de destino e invalida.");
    }
    visited.add(currentFolderId);
    const snapshot = await adminDb.collection("pastas_arquivos").doc(currentFolderId).get();
    const folder = snapshot.data() || {};
    if (!snapshot.exists || folder.deletedAt) {
      throw new Error("Pasta de destino indisponivel.");
    }
    segments.unshift(sanitizeFileName(folder.name, "pasta"));
    currentFolderId = String(folder.parentId || "");
  }
  return segments.join("/");
}

function toAssetRecord(data) {
  return {
    id: data.id,
    folderId: String(data.folderId || ""),
    title: data.title || "",
    originalFileName: data.originalFileName || "",
    fileType: data.fileType || "",
    mimeType: data.mimeType || "",
    fileSizeBytes: Number(data.fileSizeBytes || 0),
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

    const title = sanitizeFileName(getSingleField(fields, "title") || file.originalFilename || "", "");
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
    const uploadedBy = treasurer.uid;
    const scannerCaptureId = String(getSingleField(fields, "scannerCaptureId") || "").trim();
    const scannerReplaceAssetId = String(getSingleField(fields, "scannerReplaceAssetId") || "").trim();
    const isScannerUpload = Boolean(scannerCaptureId);

    if (isScannerUpload) {
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(scannerCaptureId)) {
        sendError(res, 400, "Identificador da captura invalido.");
        return;
      }
      if (mimeType !== "image/jpeg") {
        sendError(res, 400, "O scanner aceita imagens JPEG.");
        return;
      }
      if (scannerReplaceAssetId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(scannerReplaceAssetId)) {
        sendError(res, 400, "Identificador da captura original invalido.");
        return;
      }
      if (!file.size || !(await isJpegFile(file))) {
        sendError(res, 400, "A captura do scanner nao contem um JPEG valido.");
        return;
      }
      const existingSnapshot = await adminDb.collection("arquivos").doc(scannerCaptureId).get();
      if (existingSnapshot.exists) {
        const existing = existingSnapshot.data() || {};
        if (existing.scannerOwnerUid !== treasurer.uid || existing.folderId !== folderId) {
          sendError(res, 409, "Esta captura ja pertence a outro envio.");
          return;
        }
        sendJson(res, 200, { ok: true, asset: toAssetRecord({ id: existingSnapshot.id, ...existing }), alreadySaved: true });
        return;
      }
    }

    const trustedFolderPath = isScannerUpload ? await resolveFolderPath(adminDb, folderId) : folderPath;

    const upload = await uploadFileToCloudinary(
      file,
      getFolderName(trustedFolderPath),
      isScannerUpload ? { publicId: `scanner-${treasurer.uid}-${scannerCaptureId}` } : {}
    );
    const fileSizeBytes = Math.max(0, Number(upload.bytes || file.size || 0));

    const record = {
      folderId,
      title,
      originalFileName: sanitizeFileName(file.originalFilename, title),
      fileType,
      mimeType,
      cloudinaryPublicId: upload.public_id || "",
      secureUrl: upload.secure_url || "",
      thumbnailUrl: fileType === "image" ? upload.secure_url || "" : "",
      notes,
      fileSizeBytes,
      digitized: false,
      digitizedAt: "",
      deletedAt: "",
      uploadedBy,
      createdAt: Timestamp.now()
    };

    if (isScannerUpload) {
      record.scannerCaptureId = scannerCaptureId;
      record.scannerOwnerUid = treasurer.uid;
      const assetRef = adminDb.collection("arquivos").doc(scannerCaptureId);
      const statsRef = adminDb.collection("resumos_drive").doc("geral");
      const replacementRef = scannerReplaceAssetId
        ? adminDb.collection("arquivos").doc(scannerReplaceAssetId)
        : null;
      let result;
      try {
        result = await adminDb.runTransaction(async (transaction) => {
          const currentSnapshot = await transaction.get(assetRef);
          if (currentSnapshot.exists) {
            const existing = currentSnapshot.data() || {};
            if (existing.scannerOwnerUid !== treasurer.uid || existing.folderId !== folderId) {
              throw new Error("Esta captura ja pertence a outro envio.");
            }
            return { id: currentSnapshot.id, ...existing };
          }

          const statsSnapshot = await transaction.get(statsRef);
          const replacementSnapshot = replacementRef ? await transaction.get(replacementRef) : null;
          let replacementBytes = 0;
          if (replacementSnapshot) {
            const previous = replacementSnapshot.data() || {};
            if (!replacementSnapshot.exists || previous.deletedAt || previous.folderId !== folderId || previous.scannerOwnerUid !== treasurer.uid) {
              throw new Error("A captura original nao pode ser substituida.");
            }
            replacementBytes = Number(previous.fileSizeBytes || 0);
            transaction.update(replacementRef, { deletedAt: new Date().toISOString(), replacedByCaptureId: scannerCaptureId });
          }

          transaction.create(assetRef, record);
          transaction.set(statsRef, {
            totalBytes: Math.max(0, Number(statsSnapshot.data()?.totalBytes || 0) + fileSizeBytes - replacementBytes),
            updatedAt: Timestamp.now(),
            version: 1
          }, { merge: true });
          return { id: scannerCaptureId, ...record };
        });
      } catch (error) {
        await deleteCloudinaryImage(upload.public_id).catch(() => {});
        throw error;
      }
      sendJson(res, 200, { ok: true, asset: toAssetRecord(result) });
      return;
    }

    const docRef = await adminDb.collection("arquivos").add(record);
    await incrementDriveStorage(adminDb, fileSizeBytes);
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
