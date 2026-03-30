import { getAdminDb, Timestamp } from "./firebaseAdmin.js";
import { createSignedToken, sha256, verifySignedToken } from "./security.js";

const COLLECTIONS = {
  assistantAccess: "acesso_auxiliar",
  authorizations: "autorizacoes_repasse",
  history: "historico_eventos"
};

const ASSISTANT_PORTAL_ID = "principal";
const ASSISTANT_MAX_PIN_ATTEMPTS = 4;
const ASSISTANT_SESSION_HOURS = 8;
const ASSISTANT_PUBLIC_VERSION_SLICE = 24;

function assistantAccessRef() {
  const adminDb = getAdminDb();
  return adminDb.collection(COLLECTIONS.assistantAccess).doc(ASSISTANT_PORTAL_ID);
}

function toIso(value) {
  if (!value) return "";
  if (typeof value.toDate === "function") {
    return value.toDate().toISOString();
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}

function sanitizeAccess(data = {}) {
  const failedAttempts = Number(data.failedAttempts || 0);
  const isBlocked = Boolean(data.isBlocked);
  return {
    configured: Boolean(data.assistantId),
    assistantName: data.assistantName || "Tesoureiro auxiliar",
    failedAttempts,
    remainingAttempts: Math.max(0, ASSISTANT_MAX_PIN_ATTEMPTS - failedAttempts),
    isBlocked,
    blockedAt: data.blockedAt || "",
    updatedAt: data.updatedAt || ""
  };
}

function buildAssistantSessionVersion(data = {}) {
  return sha256(
    [String(data.assistantId || ""), String(data.updatedAt || ""), String(data.pinHash || ""), String(data.blockedAt || "")]
      .filter(Boolean)
      .join(":")
  ).slice(0, ASSISTANT_PUBLIC_VERSION_SLICE);
}

function sanitizePublicAccess(data = {}) {
  return {
    configured: Boolean(data.assistantId),
    assistantName: data.assistantName || "Tesoureiro auxiliar",
    sessionVersion: buildAssistantSessionVersion(data)
  };
}

function mapAuthorization(docSnap) {
  const data = docSnap.data() || {};
  return {
    id: docSnap.id,
    authorizationId: docSnap.id,
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
    assistantId: data.assistantId || "",
    assistantName: data.assistantName || ""
  };
}

export async function getAssistantPortalPublicState() {
  const snapshot = await assistantAccessRef().get();
  if (!snapshot.exists) {
    return {
      configured: false,
      assistantName: "",
      sessionVersion: ""
    };
  }
  return sanitizePublicAccess(snapshot.data());
}

export async function unlockAssistantPortal(pin) {
  const ref = assistantAccessRef();
  const snapshot = await ref.get();
  if (!snapshot.exists) {
    throw new Error("Acesso do auxiliar nao configurado.");
  }

  const data = snapshot.data() || {};
  if (data.isBlocked) {
    throw new Error("Acesso bloqueado. Solicite um novo PIN a tesouraria.");
  }

  const providedHash = sha256(String(pin || "").trim());
  if (providedHash !== String(data.pinHash || "")) {
    const failedAttempts = Number(data.failedAttempts || 0) + 1;
    const isBlocked = failedAttempts >= ASSISTANT_MAX_PIN_ATTEMPTS;
    await ref.set(
      {
        failedAttempts,
        isBlocked,
        blockedAt: isBlocked ? new Date().toISOString() : ""
      },
      { merge: true }
    );

    if (isBlocked) {
      throw new Error("Acesso bloqueado apos 4 tentativas. Solicite um novo PIN a tesouraria.");
    }

    throw new Error("PIN invalido.");
  }

  const token = createSignedToken({
    type: "assistant",
    portalId: ASSISTANT_PORTAL_ID,
    assistantId: data.assistantId || "",
    updatedAt: data.updatedAt || "",
    exp: Date.now() + ASSISTANT_SESSION_HOURS * 60 * 60 * 1000
  });

  return {
    sessionToken: token,
    portal: {
      ...sanitizeAccess(data),
      sessionVersion: buildAssistantSessionVersion(data)
    }
  };
}

export async function verifyAssistantPortalSession(sessionToken) {
  const payload = verifySignedToken(sessionToken, "assistant");
  const snapshot = await assistantAccessRef().get();
  if (!snapshot.exists) {
    throw new Error("Acesso do auxiliar nao configurado.");
  }

  const data = snapshot.data() || {};
  if (data.isBlocked) {
    throw new Error("Acesso bloqueado. Solicite um novo PIN a tesouraria.");
  }
  if (String(payload.assistantId || "") !== String(data.assistantId || "")) {
    throw new Error("Sessao invalida.");
  }
  if (String(payload.updatedAt || "") !== String(data.updatedAt || "")) {
    throw new Error("Sessao expirada. Digite o PIN novamente.");
  }

  return {
    portal: sanitizeAccess(data),
    assistantId: String(data.assistantId || "")
  };
}

export async function listAssistantOrders(sessionToken) {
  const adminDb = getAdminDb();
  const { assistantId, portal } = await verifyAssistantPortalSession(sessionToken);
  const snapshot = await adminDb
    .collection(COLLECTIONS.authorizations)
    .where("assistantId", "==", assistantId)
    .get();

  const authorizations = snapshot.docs
    .map(mapAuthorization)
    .sort((left, right) => new Date(right.createdAt || 0).getTime() - new Date(left.createdAt || 0).getTime());

  return {
    assistantUser: {
      id: ASSISTANT_PORTAL_ID,
      nome: portal.assistantName,
      failedAttempts: portal.failedAttempts,
      isBlocked: portal.isBlocked,
      blockedAt: portal.blockedAt,
      updatedAt: portal.updatedAt,
      sessionVersion: buildAssistantSessionVersion(portal),
      statusLabel: portal.isBlocked ? "Bloqueado por tentativas" : "Ativo"
    },
    authorizations
  };
}

export async function markAssistantOrderDelivered(sessionToken, authorizationId) {
  const adminDb = getAdminDb();
  const { assistantId } = await verifyAssistantPortalSession(sessionToken);
  const authorizationRef = adminDb.collection(COLLECTIONS.authorizations).doc(String(authorizationId || ""));
  const authorizationSnapshot = await authorizationRef.get();
  if (!authorizationSnapshot.exists) {
    throw new Error("Repasse nao encontrado.");
  }

  const authorization = authorizationSnapshot.data() || {};
  if (String(authorization.assistantId || "") !== assistantId) {
    throw new Error("Esta ordem nao pertence a este acesso.");
  }

  const deliveredAt = new Date().toISOString();
  await authorizationRef.set(
    {
      status: "ENTREGUE",
      deliveredAt
    },
    { merge: true }
  );

  await adminDb.collection(COLLECTIONS.history).add({
    advanceId: authorization.advanceId || "",
    type: "REPASSE_ENTREGUE",
    message: "Tesoureiro auxiliar marcou o repasse como entregue.",
    createdAt: Timestamp.now()
  });

  return {
    deliveredAt,
    status: "ENTREGUE"
  };
}
