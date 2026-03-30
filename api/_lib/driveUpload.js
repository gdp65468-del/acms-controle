import { getAdminDb, Timestamp } from "./firebaseAdmin.js";
import { createSignedToken, sha256, verifySignedToken } from "./security.js";
import { uploadFileToCloudinary } from "./cloudinary.js";

const COLLECTIONS = {
  driveUploadSessions: "sessoes_upload_drive",
  fileAssets: "arquivos"
};
const DRIVE_UPLOAD_MAX_FAILED_UNLOCKS = 5;
const DRIVE_UPLOAD_UNLOCK_COOLDOWN_MINUTES = 5;

function sessionRef(sessionId) {
  const adminDb = getAdminDb();
  return adminDb.collection(COLLECTIONS.driveUploadSessions).doc(String(sessionId || ""));
}

function toIso(value) {
  if (!value) return "";
  if (typeof value.toDate === "function") {
    return value.toDate().toISOString();
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}

function sessionIsExpired(data = {}) {
  const expiresAt = data.expiresAt?.toDate ? data.expiresAt.toDate() : new Date(data.expiresAt || 0);
  return String(data.status || "") !== "ATIVA" || Number.isNaN(expiresAt.getTime()) || expiresAt.getTime() <= Date.now();
}

function sessionResponse(id, data = {}) {
  const expiresAt = data.expiresAt?.toDate ? data.expiresAt.toDate() : new Date(data.expiresAt || 0);
  const remainingMs = Number.isNaN(expiresAt.getTime()) ? 0 : Math.max(0, expiresAt.getTime() - Date.now());
  return {
    id,
    folderId: String(data.folderId || ""),
    folderName: data.folderName || "Pasta sem nome",
    folderPath: data.folderPath || "",
    status: data.status || "ATIVA",
    createdAt: toIso(data.createdAt),
    lastActiveAt: toIso(data.lastActiveAt),
    expiresAt: toIso(data.expiresAt),
    isExpired: sessionIsExpired(data),
    remainingMs
  };
}

function getCooldownDate(data = {}) {
  return data.cooldownUntil?.toDate ? data.cooldownUntil.toDate() : new Date(data.cooldownUntil || 0);
}

function isUnlockCooldownActive(data = {}) {
  const cooldownUntil = getCooldownDate(data);
  return !Number.isNaN(cooldownUntil.getTime()) && cooldownUntil.getTime() > Date.now();
}

function getDriveFolderName(folderPath = "") {
  if (!folderPath) {
    return "acms-controle/geral";
  }
  return `acms-controle/${String(folderPath)
    .split("/")
    .filter(Boolean)
    .map((segment) => segment.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, ""))
    .join("/")}`;
}

function mapAsset(docSnap) {
  const data = docSnap.data() || {};
  return {
    id: docSnap.id,
    folderId: String(data.folderId || ""),
    title: data.title || "",
    originalFileName: data.originalFileName || "",
    fileType: data.fileType || "",
    mimeType: data.mimeType || "",
    secureUrl: data.secureUrl || "",
    thumbnailUrl: data.thumbnailUrl || "",
    notes: data.notes || "",
    digitized: Boolean(data.digitized),
    createdAt: toIso(data.createdAt),
    uploadSessionId: data.uploadSessionId || "",
    uploadedViaSession: Boolean(data.uploadedViaSession),
    sessionEditable: Boolean(data.sessionEditable),
    deletedAt: data.deletedAt || ""
  };
}

export async function getDriveUploadSessionPublicState(sessionId) {
  const snapshot = await sessionRef(sessionId).get();
  if (!snapshot.exists) {
    throw new Error("Sessao de upload nao encontrada.");
  }
  return sessionResponse(snapshot.id, snapshot.data());
}

export async function unlockDriveUploadSession(sessionId, accessCode) {
  const ref = sessionRef(sessionId);
  const snapshot = await ref.get();
  if (!snapshot.exists) {
    throw new Error("Sessao de upload nao encontrada.");
  }

  const data = snapshot.data() || {};
  if (sessionIsExpired(data)) {
    throw new Error("Este acesso temporario expirou. Gere um novo QR no Meu drive.");
  }
  if (isUnlockCooldownActive(data)) {
    throw new Error("Muitas tentativas incorretas. Aguarde 5 minutos para tentar novamente.");
  }

  const accessCodeHash = sha256(String(accessCode || "").trim());
  if (accessCodeHash !== String(data.accessCodeHash || "")) {
    const failedUnlockAttempts = Number(data.failedUnlockAttempts || 0) + 1;
    const shouldCooldown = failedUnlockAttempts >= DRIVE_UPLOAD_MAX_FAILED_UNLOCKS;
    await ref.set(
      {
        failedUnlockAttempts: shouldCooldown ? 0 : failedUnlockAttempts,
        lastFailedUnlockAt: Timestamp.now(),
        cooldownUntil: shouldCooldown
          ? Timestamp.fromDate(new Date(Date.now() + DRIVE_UPLOAD_UNLOCK_COOLDOWN_MINUTES * 60 * 1000))
          : null
      },
      { merge: true }
    );
    if (shouldCooldown) {
      throw new Error("Muitas tentativas incorretas. Aguarde 5 minutos para tentar novamente.");
    }
    throw new Error("Codigo de acesso invalido.");
  }

  const expiresAt = new Date(Date.now() + 30 * 60 * 1000);
  await ref.set(
    {
      lastActiveAt: Timestamp.now(),
      expiresAt: Timestamp.fromDate(expiresAt),
      failedUnlockAttempts: 0,
      lastFailedUnlockAt: null,
      cooldownUntil: null
    },
    { merge: true }
  );

  const sessionToken = createSignedToken({
    type: "drive-upload",
    sessionId: snapshot.id,
    accessCodeHash,
    exp: expiresAt.getTime()
  });

  return {
    session: sessionResponse(snapshot.id, {
      ...data,
      lastActiveAt: Timestamp.now(),
      expiresAt: Timestamp.fromDate(expiresAt)
    }),
    sessionToken
  };
}

export async function verifyDriveUploadSession(sessionToken, expectedSessionId = "") {
  const payload = verifySignedToken(sessionToken, "drive-upload");
  const ref = sessionRef(payload.sessionId);
  const snapshot = await ref.get();
  if (!snapshot.exists) {
    throw new Error("Sessao de upload nao encontrada.");
  }

  const data = snapshot.data() || {};
  if (expectedSessionId && String(expectedSessionId) !== String(snapshot.id)) {
    throw new Error("Sessao invalida.");
  }
  if (sessionIsExpired(data)) {
    throw new Error("Este acesso temporario expirou. Gere um novo QR no Meu drive.");
  }
  if (String(data.accessCodeHash || "") !== String(payload.accessCodeHash || "")) {
    throw new Error("Sessao expirada. Gere um novo QR no Meu drive.");
  }

  return {
    ref,
    session: data,
    sessionId: snapshot.id,
    folderId: String(data.folderId || ""),
    folderPath: String(data.folderPath || "")
  };
}

export async function touchDriveUploadSessionPublic(sessionToken, expectedSessionId = "") {
  const { ref, session, sessionId } = await verifyDriveUploadSession(sessionToken, expectedSessionId);
  const expiresAt = new Date(Date.now() + 30 * 60 * 1000);

  await ref.set(
    {
      lastActiveAt: Timestamp.now(),
      expiresAt: Timestamp.fromDate(expiresAt)
    },
    { merge: true }
  );

  return {
    session: sessionResponse(sessionId, {
      ...session,
      lastActiveAt: Timestamp.now(),
      expiresAt: Timestamp.fromDate(expiresAt)
    }),
    sessionToken: createSignedToken({
      type: "drive-upload",
      sessionId,
      accessCodeHash: session.accessCodeHash || "",
      exp: expiresAt.getTime()
    })
  };
}

export async function listDriveUploadAssets(sessionToken, sessionId) {
  const adminDb = getAdminDb();
  await touchDriveUploadSessionPublic(sessionToken, sessionId);
  const snapshot = await adminDb
    .collection(COLLECTIONS.fileAssets)
    .where("uploadSessionId", "==", String(sessionId || ""))
    .get();

  return snapshot.docs
    .map(mapAsset)
    .filter((item) => !item.deletedAt)
    .sort((left, right) => new Date(right.createdAt || 0).getTime() - new Date(left.createdAt || 0).getTime());
}

export async function uploadDriveUploadAsset(sessionToken, sessionId, file, { title = "", notes = "" } = {}) {
  const adminDb = getAdminDb();
  const { folderId, folderPath } = await verifyDriveUploadSession(sessionToken, sessionId);
  const normalizedTitle = String(title || file.originalFilename || "").trim();
  if (!normalizedTitle) {
    throw new Error("Informe um titulo para o arquivo.");
  }

  const upload = await uploadFileToCloudinary(file, getDriveFolderName(folderPath));
  const fileType = String(file.mimetype || "").startsWith("image/") ? "image" : "pdf";

  const record = {
    folderId,
    title: normalizedTitle,
    originalFileName: file.originalFilename || normalizedTitle,
    fileType,
    mimeType: file.mimetype || "",
    cloudinaryPublicId: upload.public_id || "",
    secureUrl: upload.secure_url || "",
    thumbnailUrl: fileType === "image" ? upload.secure_url || "" : "",
    notes: String(notes || "").trim(),
    digitized: false,
    digitizedAt: "",
    deletedAt: "",
    uploadedBy: `sessao:${sessionId}`,
    createdAt: Timestamp.now(),
    uploadSessionId: sessionId,
    uploadedViaSession: true,
    sessionEditable: true
  };

  const docRef = await adminDb.collection(COLLECTIONS.fileAssets).add(record);
  await touchDriveUploadSessionPublic(sessionToken, sessionId);
  return {
    id: docRef.id,
    ...mapAsset({
      id: docRef.id,
      data: () => record
    })
  };
}

export async function renameDriveUploadAsset(sessionToken, sessionId, assetId, title) {
  const adminDb = getAdminDb();
  await verifyDriveUploadSession(sessionToken, sessionId);
  const normalizedTitle = String(title || "").trim();
  if (!normalizedTitle) {
    throw new Error("Informe o nome do arquivo.");
  }

  const ref = adminDb.collection(COLLECTIONS.fileAssets).doc(String(assetId || ""));
  const snapshot = await ref.get();
  if (!snapshot.exists) {
    throw new Error("Arquivo nao encontrado.");
  }

  const data = snapshot.data() || {};
  if (String(data.uploadSessionId || "") !== String(sessionId) || !data.sessionEditable || data.deletedAt) {
    throw new Error("Este arquivo nao pertence a esta sessao.");
  }

  await ref.set({ title: normalizedTitle }, { merge: true });
  await touchDriveUploadSessionPublic(sessionToken, sessionId);
  return true;
}

export async function deleteDriveUploadAsset(sessionToken, sessionId, assetId) {
  const adminDb = getAdminDb();
  await verifyDriveUploadSession(sessionToken, sessionId);
  const ref = adminDb.collection(COLLECTIONS.fileAssets).doc(String(assetId || ""));
  const snapshot = await ref.get();
  if (!snapshot.exists) {
    throw new Error("Arquivo nao encontrado.");
  }

  const data = snapshot.data() || {};
  if (String(data.uploadSessionId || "") !== String(sessionId) || !data.sessionEditable || data.deletedAt) {
    throw new Error("Este arquivo nao pertence a esta sessao.");
  }

  await ref.set({ deletedAt: new Date().toISOString() }, { merge: true });
  await touchDriveUploadSessionPublic(sessionToken, sessionId);
  return true;
}
