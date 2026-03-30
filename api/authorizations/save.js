import { Timestamp, getAdminDb } from "../_lib/firebaseAdmin.js";
import { requireTreasurer } from "../_lib/auth.js";
import { uploadFileToCloudinary } from "../_lib/cloudinary.js";
import { sendError, sendJson } from "../_lib/http.js";
import { getSingleField, getSingleFile, multipartConfig, parseMultipartForm } from "../_lib/multipart.js";

export const config = multipartConfig;

function toIso(value) {
  if (!value) return "";
  if (typeof value.toDate === "function") return value.toDate().toISOString();
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}

function buildAssistantPublicOrder(data = {}) {
  return {
    authorizationId: data.id || "",
    advanceId: data.advanceId || "",
    memberName: data.memberName || "",
    amount: Number(data.amount || 0),
    description: data.description || "",
    createdAt: toIso(data.createdAt),
    status: data.status || "AUTORIZADO",
    audioUrl: data.audioUrl || "",
    audioName: data.audioName || "",
    deliveredAt: data.deliveredAt || "",
    advanceDescription: data.advanceDescription || "",
    prazoDias: Number(data.prazoDias || 0),
    dataLimite: data.dataLimite || "",
    assistantAccessToken: data.assistantAccessToken || "principal"
  };
}

function mapAuthorization(id, data = {}) {
  return {
    id,
    ...data,
    createdAt: toIso(data.createdAt)
  };
}

async function saveHistory(adminDb, advanceId, type, message) {
  await adminDb.collection("historico_eventos").add({
    advanceId,
    type,
    message,
    createdAt: Timestamp.now()
  });
}

function toNumberField(value) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    sendError(res, 405, "Metodo nao permitido.");
    return;
  }

  try {
    await requireTreasurer(req);
    const adminDb = getAdminDb();
    const { fields, files } = await parseMultipartForm(req);

    const authorizationId = String(getSingleField(fields, "authorizationId") || "");
    const advanceId = String(getSingleField(fields, "advanceId") || "");
    const assistantId = String(getSingleField(fields, "assistantId") || "");
    const assistantName = String(getSingleField(fields, "assistantName") || "");
    const memberName = String(getSingleField(fields, "memberName") || "");
    const amount = toNumberField(getSingleField(fields, "amount"));
    const description = String(getSingleField(fields, "description") || "").trim();
    const advanceDescription = String(getSingleField(fields, "advanceDescription") || "");
    const prazoDias = toNumberField(getSingleField(fields, "prazoDias"));
    const dataLimite = String(getSingleField(fields, "dataLimite") || "");
    const resent = String(getSingleField(fields, "resent") || "") === "true";
    const audioFile = getSingleFile(files, "audioFile");

    if (!advanceId) {
      sendError(res, 400, "Adiantamento nao encontrado.");
      return;
    }

    if (!assistantId) {
      sendError(res, 400, "Tesoureiro auxiliar nao configurado.");
      return;
    }

    const assistantAccessToken = "principal";
    const authorizations = adminDb.collection("autorizacoes_repasse");
    const authorizationRef = authorizationId ? authorizations.doc(authorizationId) : authorizations.doc();
    const existingSnapshot = authorizationId ? await authorizationRef.get() : null;
    const existingData = existingSnapshot?.exists ? existingSnapshot.data() || {} : {};

    let audioUrl = existingData.audioUrl || "";
    let audioName = existingData.audioName || "";

    if (audioFile) {
      const upload = await uploadFileToCloudinary(audioFile, `acms-controle/assistant-audios/${advanceId}`);
      audioUrl = upload.secure_url || "";
      audioName = audioFile.originalFilename || audioFile.newFilename || "audio.webm";
    }

    const now = Timestamp.now();
    const record = {
      advanceId,
      assistantId,
      assistantName,
      memberName,
      amount,
      description,
      audioUrl,
      audioName,
      createdAt: existingData.createdAt || now,
      status: "AUTORIZADO",
      deliveredAt: "",
      advanceDescription,
      prazoDias,
      dataLimite,
      assistantAccessToken
    };

    await authorizationRef.set(record, { merge: true });
    await adminDb
      .collection("acesso_auxiliar")
      .doc(assistantAccessToken)
      .collection("ordens")
      .doc(authorizationRef.id)
      .set(buildAssistantPublicOrder({ id: authorizationRef.id, ...record }));

    await saveHistory(
      adminDb,
      advanceId,
      authorizationId ? (resent ? "REPASSE_REENVIADO" : "REPASSE_ATUALIZADO") : "REPASSE_AUTORIZADO",
      authorizationId
        ? resent
          ? "Repasse reenviado para o tesoureiro auxiliar."
          : "Repasse atualizado para o tesoureiro auxiliar."
        : "Repasse autorizado para o tesoureiro auxiliar."
    );

    sendJson(res, 200, {
      ok: true,
      authorization: mapAuthorization(authorizationRef.id, record)
    });
  } catch (error) {
    sendError(res, 400, error.message || "Nao foi possivel salvar a autorizacao de repasse.");
  }
}
