import { getAdminDb } from "./firebaseAdmin.js";
import { createSignedToken, sha256, verifySignedToken } from "./security.js";

const COLLECTIONS = {
  users: "usuarios",
  advances: "adiantamentos",
  settings: "configuracoes"
};

const SETTINGS_ID = "publico_adiantamentos";
const DEFAULT_PUBLIC_ADVANCE_ACCESS_CODE = "777";
const PUBLIC_ADVANCE_SESSION_HOURS = 8;
const FINAL_STATUSES = new Set(["PRESTADO", "JUSTIFICADO"]);

function settingsRef() {
  const adminDb = getAdminDb();
  return adminDb.collection(COLLECTIONS.settings).doc(SETTINGS_ID);
}

function normalizeDateValue(value) {
  if (!value) return null;
  if (typeof value?.toDate === "function") {
    const converted = value.toDate();
    return Number.isNaN(converted.getTime()) ? null : converted;
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function normalizeAccessCode(value) {
  return String(value || "").replace(/\D/g, "").slice(0, 8);
}

function computeAdvanceStatus(advance) {
  const totalComprovado = Number(advance.totalComprovado || 0);
  const totalAdvance = Number(advance.valor || 0);
  const hasJustification = Boolean(String(advance.justificativa || "").trim());
  if (totalComprovado >= totalAdvance && totalAdvance > 0) return "PRESTADO";
  if (hasJustification) return "JUSTIFICADO";
  const dueDate = normalizeDateValue(advance.dataLimite);
  if (dueDate && dueDate < new Date()) return "ATRASADO";
  return "PENDENTE";
}

function toIso(value) {
  const parsed = normalizeDateValue(value);
  return parsed ? parsed.toISOString() : "";
}

function mapAdvance(docSnap) {
  const data = docSnap.data() || {};
  const advance = {
    id: docSnap.id,
    usuarioId: data.usuarioId || "",
    usuarioNome: data.usuarioNome || "",
    valor: Number(data.valor || 0),
    totalComprovado: Number(data.totalComprovado || 0),
    justificativa: data.justificativa || "",
    dataAdiantamento: toIso(data.dataAdiantamento),
    dataLimite: toIso(data.dataLimite),
    prazoDias: Number(data.prazoDias || 0),
    descricao: data.descricao || "",
    publicToken: data.publicToken || ""
  };
  return {
    ...advance,
    status: computeAdvanceStatus(advance)
  };
}

function buildSessionVersion(settings = {}) {
  return sha256(
    [
      String(settings.updatedAt || ""),
      String(settings.accessCodeHash || ""),
      String(settings.accessCode || DEFAULT_PUBLIC_ADVANCE_ACCESS_CODE)
    ]
      .filter(Boolean)
      .join(":")
  ).slice(0, 24);
}

async function readSettings() {
  const snapshot = await settingsRef().get();
  const stored = snapshot.exists ? snapshot.data() || {} : {};
  const accessCode = normalizeAccessCode(stored.accessCode || DEFAULT_PUBLIC_ADVANCE_ACCESS_CODE);
  const accessCodeHash = stored.accessCodeHash || sha256(accessCode);
  const updatedAt = stored.updatedAt || "";

  return {
    accessCode,
    accessCodeHash,
    updatedAt,
    sessionVersion: buildSessionVersion({
      accessCode,
      accessCodeHash,
      updatedAt
    })
  };
}

async function resolvePublicAdvanceData(token) {
  const adminDb = getAdminDb();
  const normalizedToken = String(token || "").trim();
  if (!normalizedToken) {
    throw new Error("Link nao encontrado.");
  }

  const memberSnapshot = await adminDb
    .collection(COLLECTIONS.users)
    .where("role", "==", "member")
    .where("publicToken", "==", normalizedToken)
    .limit(1)
    .get();

  const referenceSnapshot = await adminDb
    .collection(COLLECTIONS.advances)
    .where("publicToken", "==", normalizedToken)
    .limit(1)
    .get();

  const memberDoc = memberSnapshot.empty ? null : memberSnapshot.docs[0];
  const referenceDoc = referenceSnapshot.empty ? null : referenceSnapshot.docs[0];
  const referenceAdvance = referenceDoc ? mapAdvance(referenceDoc) : null;
  const memberId = memberDoc?.id || referenceAdvance?.usuarioId || "";

  if (!memberId) {
    throw new Error("Link nao encontrado.");
  }

  const advancesSnapshot = await adminDb
    .collection(COLLECTIONS.advances)
    .where("usuarioId", "==", memberId)
    .get();

  const advances = advancesSnapshot.docs
    .map(mapAdvance)
    .filter((item) => !FINAL_STATUSES.has(item.status))
    .sort((left, right) => new Date(right.dataAdiantamento || 0).getTime() - new Date(left.dataAdiantamento || 0).getTime());

  return {
    token: normalizedToken,
    memberId,
    memberName: memberDoc?.data()?.nome || referenceAdvance?.usuarioNome || "Responsavel",
    advances
  };
}

export async function getPublicAdvanceSettings() {
  const settings = await readSettings();
  return {
    accessCode: settings.accessCode || DEFAULT_PUBLIC_ADVANCE_ACCESS_CODE,
    updatedAt: settings.updatedAt || "",
    statusLabel: "Ativo",
    sessionVersion: settings.sessionVersion
  };
}

export async function savePublicAdvanceSettings(accessCode) {
  const normalizedCode = normalizeAccessCode(accessCode);
  if (normalizedCode.length < 3) {
    throw new Error("Informe um codigo de pelo menos 3 numeros.");
  }

  const nextSettings = {
    accessCode: normalizedCode,
    accessCodeHash: sha256(normalizedCode),
    updatedAt: new Date().toISOString()
  };

  await settingsRef().set(nextSettings, { merge: true });

  return {
    accessCode: nextSettings.accessCode,
    updatedAt: nextSettings.updatedAt,
    statusLabel: "Ativo",
    sessionVersion: buildSessionVersion(nextSettings)
  };
}

export async function unlockPublicAdvanceLink(token, accessCode) {
  const settings = await readSettings();
  const normalizedCode = normalizeAccessCode(accessCode);

  if (!normalizedCode) {
    throw new Error("Digite o codigo de acesso informado pela tesouraria.");
  }

  if (sha256(normalizedCode) !== String(settings.accessCodeHash || "")) {
    throw new Error("Codigo invalido.");
  }

  const publicData = await resolvePublicAdvanceData(token);
  const sessionToken = createSignedToken({
    type: "advance_public",
    token: publicData.token,
    sessionVersion: settings.sessionVersion,
    exp: Date.now() + PUBLIC_ADVANCE_SESSION_HOURS * 60 * 60 * 1000
  });

  return {
    sessionToken,
    sessionVersion: settings.sessionVersion,
    publicData
  };
}

export async function getUnlockedPublicAdvanceData(token, sessionToken) {
  const normalizedToken = String(token || "").trim();
  const payload = verifySignedToken(sessionToken, "advance_public");
  const settings = await readSettings();

  if (String(payload.token || "") !== normalizedToken) {
    throw new Error("Sessao invalida.");
  }

  if (String(payload.sessionVersion || "") !== String(settings.sessionVersion || "")) {
    throw new Error("Codigo atualizado. Digite o novo codigo para continuar.");
  }

  const publicData = await resolvePublicAdvanceData(normalizedToken);
  return {
    sessionVersion: settings.sessionVersion,
    publicData
  };
}
