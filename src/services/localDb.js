import {
  mockAdvances,
  mockAuthorizations,
  mockAuxiliaryUser,
  mockCurrentUser,
  mockFileAssets,
  mockFileFolders,
  mockHistory,
  mockUsers
} from "../data/mockData";
import { computeAdvanceStatus, computeDueDate } from "../utils/format";

const STORAGE_KEY = "acms-local-db";
const ASSISTANT_PORTAL_ID = "principal";
const ASSISTANT_MAX_PIN_ATTEMPTS = 4;
const DRIVE_UPLOAD_SESSION_TIMEOUT_MINUTES = 30;
const DEFAULT_PUBLIC_ADVANCE_ACCESS_CODE = "777";
const FINAL_ADVANCE_STATUSES = new Set(["PRESTADO", "JUSTIFICADO"]);

function clone(data) {
  return JSON.parse(JSON.stringify(data));
}

function createSeed() {
  return {
    users: clone(mockUsers),
    advances: clone(mockAdvances),
    authorizations: clone(mockAuthorizations),
    history: clone(mockHistory),
    fileFolders: clone(mockFileFolders),
    fileAssets: clone(mockFileAssets),
    driveUploadSessions: [],
    assistantAccess: {
      assistantId: mockAuxiliaryUser.id,
      assistantName: mockAuxiliaryUser.nome,
      failedAttempts: 0,
      isBlocked: false,
      blockedAt: "",
      updatedAt: new Date().toISOString()
    },
    publicAdvanceSettings: {
      accessCode: DEFAULT_PUBLIC_ADVANCE_ACCESS_CODE,
      updatedAt: new Date().toISOString()
    },
    session: {
      currentUser: clone(mockCurrentUser),
      assistantUser: clone(mockAuxiliaryUser)
    }
  };
}

function readStore() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    const seed = createSeed();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(seed));
    return seed;
  }
  const parsed = JSON.parse(raw);
  parsed.users ||= [];
  parsed.advances ||= [];
  parsed.authorizations ||= [];
  parsed.history ||= [];
  parsed.fileFolders ||= clone(mockFileFolders);
  parsed.fileAssets ||= clone(mockFileAssets);
  parsed.driveUploadSessions ||= [];
  parsed.assistantAccess ||= {
    assistantId: parsed.session?.assistantUser?.id || mockAuxiliaryUser.id,
    assistantName: parsed.session?.assistantUser?.nome || mockAuxiliaryUser.nome,
    failedAttempts: 0,
    isBlocked: false,
    blockedAt: "",
    updatedAt: new Date().toISOString()
  };
  parsed.publicAdvanceSettings ||= {
    accessCode: DEFAULT_PUBLIC_ADVANCE_ACCESS_CODE,
    updatedAt: new Date().toISOString()
  };
  parsed.fileFolders = parsed.fileFolders.map((item) => ({
    parentId: "",
    deletedAt: "",
    ...item
  }));
  parsed.fileAssets = parsed.fileAssets.map((item) => ({
    folderId: "",
    digitized: false,
    digitizedAt: "",
    deletedAt: "",
    ...item
  }));
  parsed.session ||= {
    currentUser: clone(mockCurrentUser),
    assistantUser: clone(mockAuxiliaryUser)
  };
  if (parsed.session.assistantUser) {
    parsed.session.assistantUser.accessToken ||= ASSISTANT_PORTAL_ID;
  }
  parsed.users = parsed.users.map((item) =>
    item.role === "assistant" ? { ...item, accessToken: item.accessToken || ASSISTANT_PORTAL_ID } : item
  );
  return parsed;
}

function writeStore(store) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
}

function generateId(prefix) {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

function ensurePublicToken(store, userId, fallbackToken = "") {
  const user = store.users.find((item) => item.id === userId);
  if (user?.publicToken) {
    return user.publicToken;
  }

  const nextToken = fallbackToken || generateId("publico-pessoa");
  if (user) {
    user.publicToken = nextToken;
  }
  return nextToken;
}

function saveHistory(store, advanceId, type, message) {
  store.history.unshift({
    id: generateId("hist"),
    advanceId,
    type,
    message,
    createdAt: new Date().toISOString()
  });
}

function syncStatuses(store) {
  store.advances = store.advances.map((advance) => ({
    ...advance,
    status: computeAdvanceStatus(advance)
  }));
}

function notify() {
  window.dispatchEvent(new CustomEvent("acms-local-updated"));
}

function getFolderDescendantIds(folders, folderId) {
  const descendants = [];
  const stack = [folderId];
  while (stack.length) {
    const currentId = stack.pop();
    const children = folders.filter((item) => item.parentId === currentId);
    children.forEach((child) => {
      descendants.push(child.id);
      stack.push(child.id);
    });
  }
  return descendants;
}

function getAssistantByToken(store, token) {
  const resolvedToken = String(token || ASSISTANT_PORTAL_ID);
  const assistant = store.users.find((item) => item.role === "assistant" && String(item.accessToken || ASSISTANT_PORTAL_ID) === resolvedToken);
  if (!assistant) return null;
  return {
    ...assistant,
    failedAttempts: Number(store.assistantAccess?.failedAttempts || 0),
    isBlocked: Boolean(store.assistantAccess?.isBlocked),
    blockedAt: store.assistantAccess?.blockedAt || "",
    updatedAt: store.assistantAccess?.updatedAt || "",
    statusLabel: store.assistantAccess?.isBlocked ? "Bloqueado por tentativas" : "Ativo"
  };
}

function getAssistantPortalLink() {
  return typeof window !== "undefined" ? `${window.location.origin}/auxiliar` : "/auxiliar";
}

function getPublicAdvanceSessionStorageKey(token) {
  return `acms-public-advance-unlocked:${token}`;
}

function getPublicAdvanceSettingsSnapshot(store) {
  return {
    accessCode: String(store.publicAdvanceSettings?.accessCode || DEFAULT_PUBLIC_ADVANCE_ACCESS_CODE),
    updatedAt: store.publicAdvanceSettings?.updatedAt || "",
    statusLabel: "Ativo",
    sessionVersion: [
      String(store.publicAdvanceSettings?.accessCode || DEFAULT_PUBLIC_ADVANCE_ACCESS_CODE),
      String(store.publicAdvanceSettings?.updatedAt || "")
    ].join(":")
  };
}

function getPublicAdvanceDataByToken(store, token) {
  const normalizedToken = String(token || "").trim();
  const member = store.users.find((item) => item.role === "member" && item.publicToken === normalizedToken);
  const referenceAdvance = store.advances.find((item) => item.publicToken === normalizedToken);
  const memberId = member?.id || referenceAdvance?.usuarioId || "";

  if (!memberId) {
    throw new Error("Link nao encontrado.");
  }

  const advances = store.advances
    .filter((item) => item.usuarioId === memberId)
    .map((item) => ({ ...item, status: computeAdvanceStatus(item) }))
    .filter((item) => !FINAL_ADVANCE_STATUSES.has(item.status))
    .sort((left, right) => new Date(right.dataAdiantamento || 0).getTime() - new Date(left.dataAdiantamento || 0).getTime());

  return {
    token: normalizedToken,
    memberName: member?.nome || referenceAdvance?.usuarioNome || "Responsavel",
    advances
  };
}

function addMinutes(dateLike, minutes = DRIVE_UPLOAD_SESSION_TIMEOUT_MINUTES) {
  const baseDate = new Date(dateLike || Date.now());
  return new Date(baseDate.getTime() + minutes * 60 * 1000);
}

function getDriveUploadSessionLink(sessionId) {
  return typeof window !== "undefined" ? `${window.location.origin}/drive-upload/${sessionId}` : `/drive-upload/${sessionId}`;
}

function createDriveUploadAccessCode() {
  const random = crypto.getRandomValues(new Uint32Array(1))[0] % 1000000;
  return String(random).padStart(6, "0");
}

async function hashAccessCode(code) {
  const encoded = new TextEncoder().encode(String(code || ""));
  const digest = await crypto.subtle.digest("SHA-256", encoded);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function isDriveUploadSessionExpired(session) {
  if (!session) return true;
  if (String(session.status || "") !== "ATIVA") return true;
  const expiresAt = new Date(session.expiresAt || 0);
  return Number.isNaN(expiresAt.getTime()) || expiresAt.getTime() <= Date.now();
}

function buildDriveUploadSessionResponse(session, accessCode = "") {
  const expiresAt = new Date(session.expiresAt || 0);
  const remainingMs = Number.isNaN(expiresAt.getTime()) ? 0 : Math.max(0, expiresAt.getTime() - Date.now());
  return {
    id: session.id,
    folderId: session.folderId || "",
    folderName: session.folderName || "Pasta sem nome",
    folderPath: session.folderPath || "",
    accessCodeHash: session.accessCodeHash || "",
    accessCode,
    accessLink: getDriveUploadSessionLink(session.id),
    createdBy: session.createdBy || "",
    createdAt: session.createdAt || "",
    lastActiveAt: session.lastActiveAt || "",
    expiresAt: session.expiresAt || "",
    status: session.status || "ATIVA",
    isExpired: isDriveUploadSessionExpired(session),
    remainingMs
  };
}

function getDriveUploadSession(store, sessionId) {
  return store.driveUploadSessions.find((item) => item.id === sessionId) || null;
}

function getActiveDriveUploadSessionForFolder(store, folderId) {
  return store.driveUploadSessions.find(
    (item) => String(item.folderId || "") === String(folderId) && item.status === "ATIVA" && !isDriveUploadSessionExpired(item)
  );
}

function buildAssistantShareMessage({ assistantName, assistantLink, assistantPin }) {
  return [
    "Acesso do Tesoureiro Auxiliar",
    "",
    `Ola, ${assistantName || "tesoureiro auxiliar"}.`,
    "Segue o acesso para acompanhar e confirmar os repasses autorizados da tesouraria.",
    "",
    `Link: ${assistantLink}`,
    `PIN de acesso: ${assistantPin}`,
    "",
    "Orientacoes:",
    "- Abra o link acima no celular ou computador.",
    "- Digite o PIN exatamente como enviado.",
    "- Nao compartilhe este PIN com outras pessoas.",
    "",
    "Se o acesso for bloqueado por tentativas incorretas, solicite um novo PIN a tesouraria."
  ].join("\n");
}

function updateAssistantAccessState(store, overrides = {}) {
  store.assistantAccess = {
    assistantId: store.session.assistantUser?.id || mockAuxiliaryUser.id,
    assistantName: store.session.assistantUser?.nome || mockAuxiliaryUser.nome,
    failedAttempts: 0,
    isBlocked: false,
    blockedAt: "",
    updatedAt: new Date().toISOString(),
    ...store.assistantAccess,
    ...overrides
  };
}

function getAssistantAccessSnapshot(store, token) {
  const assistantUser = getAssistantByToken(store, token) || null;
  if (!assistantUser) {
    return { assistantUser: null, authorizations: [] };
  }

  const authorizations = store.authorizations
    .filter((item) => item.assistantId === assistantUser.id)
    .map((item) => ({
      id: item.id,
      authorizationId: item.id,
      ...item
    }));

  return { assistantUser, authorizations };
}

export const localDb = {
  subscribe(callback) {
    const handler = () => callback(localDb.getSnapshot());
    window.addEventListener("acms-local-updated", handler);
    callback(localDb.getSnapshot());
    return () => window.removeEventListener("acms-local-updated", handler);
  },

  subscribeAssistantAccess(token, callback) {
    const handler = () => callback(getAssistantAccessSnapshot(readStore(), token || ASSISTANT_PORTAL_ID));
    window.addEventListener("acms-local-updated", handler);
    callback(getAssistantAccessSnapshot(readStore(), token || ASSISTANT_PORTAL_ID));
    return () => window.removeEventListener("acms-local-updated", handler);
  },

  getSnapshot() {
    const store = readStore();
    syncStatuses(store);
    writeStore(store);
    return store;
  },

  signInTreasurer() {
    const store = readStore();
    store.session.currentUser = clone(mockCurrentUser);
    writeStore(store);
    notify();
    return store.session.currentUser;
  },

  signOutTreasurer() {
    const store = readStore();
    store.session.currentUser = null;
    writeStore(store);
    notify();
  },

  getAssistantUser() {
    return readStore().session.assistantUser;
  },

  getPublicAdvanceSettings() {
    const store = readStore();
    return getPublicAdvanceSettingsSnapshot(store);
  },

  updatePublicAdvanceSettings(nextCode) {
    const store = readStore();
    const normalizedCode = String(nextCode || "").replace(/\D/g, "").slice(0, 8);
    if (normalizedCode.length < 3) {
      throw new Error("Informe um codigo de pelo menos 3 numeros.");
    }

    store.publicAdvanceSettings = {
      accessCode: normalizedCode,
      updatedAt: new Date().toISOString()
    };

    writeStore(store);
    notify();
    return getPublicAdvanceSettingsSnapshot(store);
  },

  unlockPublicAdvance(token, accessCode) {
    const store = readStore();
    const settings = getPublicAdvanceSettingsSnapshot(store);
    const normalizedCode = String(accessCode || "").replace(/\D/g, "").slice(0, 8);

    if (!normalizedCode) {
      throw new Error("Digite o codigo de acesso informado pela tesouraria.");
    }

    if (normalizedCode !== settings.accessCode) {
      throw new Error("Codigo invalido.");
    }

    const publicData = getPublicAdvanceDataByToken(store, token);
    localStorage.setItem(
      getPublicAdvanceSessionStorageKey(token),
      JSON.stringify({
        token: "local",
        sessionVersion: settings.sessionVersion
      })
    );

    return {
      sessionToken: "local",
      sessionVersion: settings.sessionVersion,
      publicData
    };
  },

  getPublicAdvanceData(token) {
    const store = readStore();
    const settings = getPublicAdvanceSettingsSnapshot(store);
    const storedSession = localStorage.getItem(getPublicAdvanceSessionStorageKey(token));

    if (!storedSession) {
      throw new Error("Digite o codigo de acesso para abrir este link.");
    }

    try {
      const parsed = JSON.parse(storedSession);
      if (parsed.sessionVersion !== settings.sessionVersion) {
        localStorage.removeItem(getPublicAdvanceSessionStorageKey(token));
        throw new Error("Codigo atualizado. Digite o novo codigo para continuar.");
      }
    } catch (error) {
      localStorage.removeItem(getPublicAdvanceSessionStorageKey(token));
      throw error instanceof Error ? error : new Error("Sessao invalida.");
    }

    return {
      sessionVersion: settings.sessionVersion,
      publicData: getPublicAdvanceDataByToken(store, token)
    };
  },

  isPublicAdvanceUnlocked(token, sessionVersion = "") {
    const storedSession = localStorage.getItem(getPublicAdvanceSessionStorageKey(token));
    if (!storedSession) return false;

    try {
      const parsed = JSON.parse(storedSession);
      if (!sessionVersion) return Boolean(parsed.token);
      return String(parsed.sessionVersion || "") === String(sessionVersion || "");
    } catch {
      localStorage.removeItem(getPublicAdvanceSessionStorageKey(token));
      return false;
    }
  },

  lockPublicAdvance(token) {
    localStorage.removeItem(getPublicAdvanceSessionStorageKey(token));
  },

  getAssistantPortalAccess(assistantUser) {
    const store = readStore();
    const targetAssistant =
      assistantUser || store.users.find((item) => item.role === "assistant") || store.session.assistantUser || null;
    if (!targetAssistant) {
      throw new Error("Cadastre um tesoureiro auxiliar para gerar o acesso.");
    }

    const storedAssistant = store.users.find((item) => item.id === targetAssistant.id);
    if (storedAssistant) {
      storedAssistant.accessToken = ASSISTANT_PORTAL_ID;
    }
    if (store.session.assistantUser?.id === targetAssistant.id) {
      store.session.assistantUser.accessToken = ASSISTANT_PORTAL_ID;
    }
    updateAssistantAccessState(store, {
      assistantId: targetAssistant.id,
      assistantName: targetAssistant.nome
    });
    writeStore(store);
    notify();
    return {
      assistantLink: getAssistantPortalLink(),
      assistantPin: targetAssistant.pin || "",
      assistantAccessToken: ASSISTANT_PORTAL_ID,
      failedAttempts: Number(store.assistantAccess.failedAttempts || 0),
      isBlocked: Boolean(store.assistantAccess.isBlocked),
      blockedAt: store.assistantAccess.blockedAt || "",
      statusLabel: store.assistantAccess.isBlocked ? "Bloqueado por tentativas" : "Ativo",
      shareMessage: buildAssistantShareMessage({
        assistantName: targetAssistant.nome,
        assistantLink: getAssistantPortalLink(),
        assistantPin: targetAssistant.pin || ""
      })
    };
  },

  updateAssistantPortalPin(assistantUser, nextPin) {
    const store = readStore();
    const targetAssistant =
      assistantUser || store.users.find((item) => item.role === "assistant") || store.session.assistantUser || null;
    const normalizedPin = String(nextPin || "").replace(/\D/g, "").slice(0, 4);
    if (!targetAssistant) {
      throw new Error("Cadastre um tesoureiro auxiliar para configurar o acesso.");
    }
    if (normalizedPin.length !== 4) {
      throw new Error("Informe um PIN de 4 digitos.");
    }

    const storedAssistant = store.users.find((item) => item.id === targetAssistant.id);
    if (storedAssistant) {
      storedAssistant.pin = normalizedPin;
      storedAssistant.accessToken = ASSISTANT_PORTAL_ID;
    }
    if (store.session.assistantUser?.id === targetAssistant.id) {
      store.session.assistantUser.pin = normalizedPin;
      store.session.assistantUser.accessToken = ASSISTANT_PORTAL_ID;
    }

    updateAssistantAccessState(store, {
      assistantId: targetAssistant.id,
      assistantName: targetAssistant.nome,
      failedAttempts: 0,
      isBlocked: false,
      blockedAt: ""
    });

    writeStore(store);
    localStorage.removeItem(`acms-assistant-unlocked:${ASSISTANT_PORTAL_ID}`);
    notify();
    return {
      assistantLink: getAssistantPortalLink(),
      assistantPin: normalizedPin,
      assistantAccessToken: ASSISTANT_PORTAL_ID,
      failedAttempts: 0,
      isBlocked: false,
      blockedAt: "",
      statusLabel: "Ativo",
      shareMessage: buildAssistantShareMessage({
        assistantName: targetAssistant.nome,
        assistantLink: getAssistantPortalLink(),
        assistantPin: normalizedPin
      })
    };
  },

  registerAssistantFailedAttempt(token) {
    const store = readStore();
    const assistantUser = getAssistantByToken(store, token || ASSISTANT_PORTAL_ID);
    if (!assistantUser) {
      throw new Error("Acesso do auxiliar nao encontrado. Solicite um novo PIN a tesouraria.");
    }
    if (store.assistantAccess.isBlocked) {
      throw new Error("Acesso bloqueado. Solicite um novo PIN a tesouraria.");
    }

    const failedAttempts = Number(store.assistantAccess.failedAttempts || 0) + 1;
    const isBlocked = failedAttempts >= ASSISTANT_MAX_PIN_ATTEMPTS;
    updateAssistantAccessState(store, {
      failedAttempts,
      isBlocked,
      blockedAt: isBlocked ? new Date().toISOString() : ""
    });
    writeStore(store);
    notify();

    if (isBlocked) {
      throw new Error("Acesso bloqueado apos 4 tentativas. Solicite um novo PIN a tesouraria.");
    }

    const remainingAttempts = ASSISTANT_MAX_PIN_ATTEMPTS - failedAttempts;
    throw new Error(`PIN invalido. Restam ${remainingAttempts} tentativa(s).`);
  },

  createMember(payload) {
    const store = readStore();
    const normalizedName = String(payload.nome || "").trim();
    if (!normalizedName) {
      throw new Error("Informe o nome da pessoa.");
    }

    const existingMember = store.users.find(
      (item) => item.role === "member" && item.nome.toLowerCase() === normalizedName.toLowerCase()
    );
    if (existingMember) {
      return existingMember;
    }

    const member = {
      id: generateId("member"),
      nome: normalizedName,
      email: payload.email || "",
      role: "member",
      publicToken: generateId("publico-pessoa")
    };

    store.users.push(member);
    writeStore(store);
    notify();
    return member;
  },

  createAssistantProfile(payload) {
    const store = readStore();
    const normalizedName = String(payload.nome || "").trim();
    const normalizedPin = String(payload.pin || "")
      .replace(/\D/g, "")
      .slice(0, 4);

    if (!normalizedName) {
      throw new Error("Informe o nome do tesoureiro auxiliar.");
    }

    if (normalizedPin.length !== 4) {
      throw new Error("Informe um PIN de 4 digitos para o auxiliar.");
    }

    let assistant = store.users.find((item) => item.role === "assistant") || null;
    if (assistant) {
      assistant.nome = normalizedName;
      assistant.pin = normalizedPin;
      assistant.accessToken = ASSISTANT_PORTAL_ID;
    } else {
      assistant = {
        id: generateId("assistant"),
        nome: normalizedName,
        email: "",
        role: "assistant",
        pin: normalizedPin,
        accessToken: ASSISTANT_PORTAL_ID
      };
      store.users.push(assistant);
    }

    store.session.assistantUser = { ...assistant };
    updateAssistantAccessState(store, {
      assistantId: assistant.id,
      assistantName: assistant.nome,
      failedAttempts: 0,
      isBlocked: false,
      blockedAt: ""
    });
    writeStore(store);
    localStorage.removeItem(`acms-assistant-unlocked:${ASSISTANT_PORTAL_ID}`);
    notify();
    return { ...assistant };
  },

  deleteMember(memberId) {
    const store = readStore();
    const member = store.users.find((item) => item.id === memberId && item.role === "member");
    if (!member) throw new Error("Responsavel nao encontrado.");
    const hasDependencies = store.advances.some((item) => item.usuarioId === memberId);
    if (hasDependencies) {
      throw new Error("Nao e possivel excluir este responsavel porque ele ja possui adiantamentos vinculados.");
    }
    store.users = store.users.filter((item) => item.id !== memberId);
    writeStore(store);
    notify();
    return member;
  },

  createFileFolder(payload) {
    const store = readStore();
    const normalizedName = String(payload.name || "").trim();
    if (!normalizedName) {
      throw new Error("Informe o nome da pasta.");
    }

    const parentId = String(payload.parentId || "");
    const existingFolder = store.fileFolders.find(
      (item) => item.parentId === parentId && item.name.toLowerCase() === normalizedName.toLowerCase()
    );
    if (existingFolder) {
      return existingFolder;
    }

    const folder = {
      id: generateId("folder"),
      name: normalizedName,
      description: String(payload.description || "").trim(),
      parentId,
      deletedAt: "",
      createdBy: payload.createdBy,
      createdAt: new Date().toISOString()
    };

    store.fileFolders.unshift(folder);
    writeStore(store);
    notify();
    return folder;
  },

  async getDriveUploadSession(sessionId, { includeSecret = false } = {}) {
    const store = readStore();
    const session = getDriveUploadSession(store, sessionId);
    if (!session) {
      throw new Error("Sessao de upload nao encontrada.");
    }
    return buildDriveUploadSessionResponse(session, includeSecret ? session.accessCode || "" : "");
  },

  async createDriveUploadSession(folder, createdBy, { regenerate = false } = {}) {
    const store = readStore();
    if (!folder?.id) {
      throw new Error("Abra uma pasta antes de gerar o QR.");
    }

    const activeSession = getActiveDriveUploadSessionForFolder(store, folder.id);
    if (activeSession && !regenerate) {
      return buildDriveUploadSessionResponse(activeSession, activeSession.accessCode || "");
    }

    store.driveUploadSessions = store.driveUploadSessions.map((item) =>
      String(item.folderId || "") === String(folder.id) && item.status === "ATIVA"
        ? { ...item, status: "ENCERRADA" }
        : item
    );

    const accessCode = createDriveUploadAccessCode();
    const accessCodeHash = await hashAccessCode(accessCode);
    const now = new Date().toISOString();
    const session = {
      id: generateId("session"),
      folderId: String(folder.id),
      folderName: String(folder.name || ""),
      folderPath: String(folder.path || folder.folderPath || folder.name || ""),
      accessCode,
      accessCodeHash,
      createdBy: String(createdBy || ""),
      createdAt: now,
      lastActiveAt: now,
      expiresAt: addMinutes(now).toISOString(),
      status: "ATIVA"
    };
    store.driveUploadSessions.unshift(session);
    writeStore(store);
    notify();
    return buildDriveUploadSessionResponse(session, accessCode);
  },

  async touchDriveUploadSession(sessionId, accessCodeHash) {
    const store = readStore();
    const session = getDriveUploadSession(store, sessionId);
    if (!session) {
      throw new Error("Sessao de upload nao encontrada.");
    }
    if (session.status !== "ATIVA" || isDriveUploadSessionExpired(session)) {
      throw new Error("Este acesso temporario expirou. Gere um novo QR no Meu drive.");
    }
    if (String(session.accessCodeHash || "") !== String(accessCodeHash || "")) {
      throw new Error("Codigo de acesso invalido.");
    }
    session.lastActiveAt = new Date().toISOString();
    session.expiresAt = addMinutes(session.lastActiveAt).toISOString();
    writeStore(store);
    notify();
    return true;
  },

  async validateDriveUploadSession(sessionId, accessCode) {
    const store = readStore();
    const session = getDriveUploadSession(store, sessionId);
    if (!session) {
      throw new Error("Sessao de upload nao encontrada.");
    }
    if (session.status !== "ATIVA" || isDriveUploadSessionExpired(session)) {
      throw new Error("Este acesso temporario expirou. Gere um novo QR no Meu drive.");
    }
    const accessCodeHash = await hashAccessCode(accessCode);
    if (accessCodeHash !== session.accessCodeHash) {
      throw new Error("Codigo de acesso invalido.");
    }
    await localDb.touchDriveUploadSession(sessionId, accessCodeHash);
    localStorage.setItem(`acms-drive-upload:${sessionId}`, accessCodeHash);
    return {
      ...buildDriveUploadSessionResponse(session),
      accessCodeHash
    };
  },

  isDriveUploadSessionUnlocked(sessionId, session = null) {
    const storedHash = localStorage.getItem(`acms-drive-upload:${sessionId}`);
    if (!storedHash) return false;
    if (!session) return true;
    if (session.status !== "ATIVA" || isDriveUploadSessionExpired(session)) return false;
    return storedHash === String(session.accessCodeHash || "");
  },

  lockDriveUploadSession(sessionId) {
    localStorage.removeItem(`acms-drive-upload:${sessionId}`);
  },

  listSessionAssets(sessionId) {
    const store = readStore();
    return store.fileAssets
      .filter((item) => String(item.uploadSessionId || "") === String(sessionId) && !item.deletedAt)
      .sort((left, right) => new Date(right.createdAt || 0).getTime() - new Date(left.createdAt || 0).getTime());
  },

  async uploadFileAssetToSession(payload) {
    const store = readStore();
    const session = getDriveUploadSession(store, payload.sessionId);
    if (!session) {
      throw new Error("Sessao de upload nao encontrada.");
    }
    if (session.status !== "ATIVA" || isDriveUploadSessionExpired(session)) {
      throw new Error("Este acesso temporario expirou. Gere um novo QR no Meu drive.");
    }
    if (String(session.accessCodeHash || "") !== String(payload.accessCodeHash || "")) {
      throw new Error("Codigo de acesso invalido.");
    }

    const secureUrl = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ""));
      reader.onerror = () => reject(new Error("Nao foi possivel preparar o arquivo para envio."));
      reader.readAsDataURL(payload.file);
    });

    const asset = {
      id: generateId("asset"),
      folderId: session.folderId,
      title: payload.title,
      originalFileName: payload.file.name,
      fileType: payload.file.type.includes("pdf") ? "pdf" : "image",
      mimeType: payload.file.type || "",
      cloudinaryPublicId: "",
      secureUrl,
      thumbnailUrl: payload.file.type.includes("pdf") ? "" : secureUrl,
      notes: payload.notes || "",
      digitized: false,
      digitizedAt: "",
      deletedAt: "",
      uploadedBy: `sessao:${payload.sessionId}`,
      createdAt: new Date().toISOString(),
      uploadSessionId: payload.sessionId,
      uploadedViaSession: true,
      sessionEditable: true,
      sessionCodeHash: payload.accessCodeHash
    };
    store.fileAssets.unshift(asset);
    session.lastActiveAt = new Date().toISOString();
    session.expiresAt = addMinutes(session.lastActiveAt).toISOString();
    writeStore(store);
    notify();
    return asset;
  },

  async renameSessionAsset(assetId, sessionId, accessCodeHash, title) {
    const store = readStore();
    const asset = store.fileAssets.find((item) => item.id === assetId);
    const session = getDriveUploadSession(store, sessionId);
    if (!asset || !session) {
      throw new Error("Arquivo ou sessao nao encontrados.");
    }
    if (String(asset.uploadSessionId || "") !== String(sessionId) || asset.deletedAt) {
      throw new Error("Este arquivo nao pertence a esta sessao.");
    }
    if (String(asset.sessionCodeHash || "") !== String(accessCodeHash || "")) {
      throw new Error("Codigo de acesso invalido.");
    }
    asset.title = String(title || "").trim();
    if (!asset.title) {
      throw new Error("Informe o nome do arquivo.");
    }
    session.lastActiveAt = new Date().toISOString();
    session.expiresAt = addMinutes(session.lastActiveAt).toISOString();
    writeStore(store);
    notify();
    return asset;
  },

  async deleteSessionAsset(assetId, sessionId, accessCodeHash) {
    const store = readStore();
    const asset = store.fileAssets.find((item) => item.id === assetId);
    const session = getDriveUploadSession(store, sessionId);
    if (!asset || !session) {
      throw new Error("Arquivo ou sessao nao encontrados.");
    }
    if (String(asset.uploadSessionId || "") !== String(sessionId) || asset.deletedAt) {
      throw new Error("Este arquivo nao pertence a esta sessao.");
    }
    if (String(asset.sessionCodeHash || "") !== String(accessCodeHash || "")) {
      throw new Error("Codigo de acesso invalido.");
    }
    asset.deletedAt = new Date().toISOString();
    session.lastActiveAt = new Date().toISOString();
    session.expiresAt = addMinutes(session.lastActiveAt).toISOString();
    writeStore(store);
    notify();
    return true;
  },

  closeDriveUploadSession(sessionId) {
    const store = readStore();
    const session = getDriveUploadSession(store, sessionId);
    if (!session) return false;
    session.status = "ENCERRADA";
    writeStore(store);
    localStorage.removeItem(`acms-drive-upload:${sessionId}`);
    notify();
    return true;
  },

  uploadFileAsset(payload) {
    const store = readStore();
    const folderExists = !payload.folderId || store.fileFolders.some((item) => item.id === payload.folderId);
    if (!folderExists) {
      throw new Error("Selecione uma pasta valida.");
    }

    const asset = {
      id: generateId("asset"),
      folderId: payload.folderId,
      title: payload.title,
      originalFileName: payload.originalFileName,
      fileType: payload.fileType,
      mimeType: payload.mimeType || "",
      cloudinaryPublicId: payload.cloudinaryPublicId || "",
      secureUrl: payload.secureUrl,
      thumbnailUrl: payload.thumbnailUrl || payload.secureUrl,
      notes: payload.notes || "",
      digitized: false,
      digitizedAt: "",
      deletedAt: "",
      uploadedBy: payload.uploadedBy,
      createdAt: new Date().toISOString()
    };

    store.fileAssets.unshift(asset);
    writeStore(store);
    notify();
    return asset;
  },

  renameFileFolder(folderId, name) {
    const store = readStore();
    const folder = store.fileFolders.find((item) => item.id === folderId);
    if (!folder) throw new Error("Pasta nao encontrada.");
    folder.name = String(name || "").trim();
    if (!folder.name) throw new Error("Informe o nome da pasta.");
    writeStore(store);
    notify();
    return folder;
  },

  renameFileAsset(assetId, title) {
    const store = readStore();
    const asset = store.fileAssets.find((item) => item.id === assetId);
    if (!asset) throw new Error("Arquivo nao encontrado.");
    asset.title = String(title || "").trim();
    if (!asset.title) throw new Error("Informe o nome do arquivo.");
    writeStore(store);
    notify();
    return asset;
  },

  moveFileAssets(assetIds, folderId) {
    const store = readStore();
    const destinationExists = !folderId || store.fileFolders.some((item) => item.id === folderId);
    if (!destinationExists) throw new Error("Pasta de destino invalida.");
    store.fileAssets.forEach((item) => {
      if (assetIds.includes(item.id)) {
        item.folderId = folderId;
      }
    });
    writeStore(store);
    notify();
  },

  moveFileFolder(folderId, parentId) {
    const store = readStore();
    const folder = store.fileFolders.find((item) => item.id === folderId);
    if (!folder) throw new Error("Pasta nao encontrada.");
    if (folderId === parentId) throw new Error("A pasta nao pode ser movida para si mesma.");
    const descendants = getFolderDescendantIds(store.fileFolders, folderId);
    if (descendants.includes(parentId)) {
      throw new Error("A pasta nao pode ser movida para dentro de uma subpasta dela.");
    }
    folder.parentId = String(parentId || "");
    writeStore(store);
    notify();
    return folder;
  },

  trashFileAssets(assetIds) {
    const store = readStore();
    const deletedAt = new Date().toISOString();
    store.fileAssets.forEach((item) => {
      if (assetIds.includes(item.id)) {
        item.deletedAt = deletedAt;
      }
    });
    writeStore(store);
    notify();
  },

  trashFileFolder(folderId) {
    const store = readStore();
    const folderIds = [folderId, ...getFolderDescendantIds(store.fileFolders, folderId)];
    const deletedAt = new Date().toISOString();
    store.fileFolders.forEach((item) => {
      if (folderIds.includes(item.id)) {
        item.deletedAt = deletedAt;
      }
    });
    store.fileAssets.forEach((item) => {
      if (folderIds.includes(item.folderId || "")) {
        item.deletedAt = deletedAt;
      }
    });
    writeStore(store);
    notify();
  },

  restoreFileAssets(assetIds) {
    const store = readStore();
    store.fileAssets.forEach((item) => {
      if (assetIds.includes(item.id)) {
        item.deletedAt = "";
      }
    });
    writeStore(store);
    notify();
  },

  restoreFileFolder(folderId) {
    const store = readStore();
    const folderIds = [folderId, ...getFolderDescendantIds(store.fileFolders, folderId)];
    store.fileFolders.forEach((item) => {
      if (folderIds.includes(item.id)) {
        item.deletedAt = "";
      }
    });
    store.fileAssets.forEach((item) => {
      if (folderIds.includes(item.folderId || "")) {
        item.deletedAt = "";
      }
    });
    writeStore(store);
    notify();
  },

  deleteFileAssets(assetIds) {
    const store = readStore();
    store.fileAssets = store.fileAssets.filter((item) => !assetIds.includes(item.id));
    writeStore(store);
    notify();
  },

  deleteFileFolder(folderId) {
    const store = readStore();
    const folderIds = [folderId, ...getFolderDescendantIds(store.fileFolders, folderId)];
    store.fileFolders = store.fileFolders.filter((item) => !folderIds.includes(item.id));
    store.fileAssets = store.fileAssets.filter((item) => !folderIds.includes(String(item.folderId || "")));
    writeStore(store);
    notify();
  },

  toggleFileDigitized(assetId, digitized) {
    const store = readStore();
    const asset = store.fileAssets.find((item) => item.id === assetId);
    if (!asset) throw new Error("Arquivo nao encontrado.");
    asset.digitized = Boolean(digitized);
    asset.digitizedAt = digitized ? new Date().toISOString() : "";
    writeStore(store);
    notify();
    return asset;
  },

  createAdvance(payload) {
    const store = readStore();
    syncStatuses(store);
    const hasBlockedAdvance = store.advances.some(
      (item) => item.usuarioId === payload.usuarioId && item.status === "ATRASADO"
    );
    if (hasBlockedAdvance) {
      throw new Error("Este responsável já possui um adiantamento atrasado.");
    }
    const createdAt = payload.dataAdiantamento || new Date().toISOString();
    const publicToken = ensurePublicToken(store, payload.usuarioId, payload.publicToken);
    const record = {
      id: generateId("ad"),
      usuarioId: payload.usuarioId,
      usuarioNome: payload.usuarioNome,
      valor: Number(payload.valor),
      dataAdiantamento: createdAt,
      prazoDias: Number(payload.prazoDias),
      dataLimite: computeDueDate(createdAt, payload.prazoDias),
      status: "PENDENTE",
      descricao: payload.descricao,
      justificativa: "",
      totalComprovado: 0,
      lancadoAcms: false,
      dataLancamentoAcms: "",
      comprovantes: [],
      createdBy: payload.createdBy,
      publicToken
    };
    store.advances.unshift(record);
    saveHistory(store, record.id, "ADIANTAMENTO_CRIADO", "Adiantamento criado pela tesouraria.");
    writeStore(store);
    notify();
    return record;
  },

  saveSettlement(advanceId, payload) {
    const store = readStore();
    const advance = store.advances.find((item) => item.id === advanceId);
    if (!advance) throw new Error("Adiantamento não encontrado.");

    advance.totalComprovado = Number(payload.totalComprovado || 0);
    advance.justificativa = payload.justificativa || "";
    advance.lancadoAcms = Boolean(payload.lancadoAcms);
    advance.dataLancamentoAcms = payload.lancadoAcms ? new Date().toISOString() : "";
    advance.status = computeAdvanceStatus(advance);

    saveHistory(
      store,
      advanceId,
      "PRESTACAO_REGISTRADA",
      advance.status === "JUSTIFICADO"
        ? "Prestacao registrada com justificativa."
        : "Prestacao registrada com valor informado."
    );
    if (advance.lancadoAcms) {
      saveHistory(store, advanceId, "LANCADO_ACMS", "Tesouraria marcou este adiantamento como lancado no ACMS.");
    }
    writeStore(store);
    notify();
    return advance;
  },

  toggleAcmsLaunch(advanceId, launched) {
    const store = readStore();
    const advance = store.advances.find((item) => item.id === advanceId);
    if (!advance) throw new Error("Adiantamento nao encontrado.");
    advance.lancadoAcms = Boolean(launched);
    advance.dataLancamentoAcms = launched ? new Date().toISOString() : "";
    saveHistory(
      store,
      advanceId,
      launched ? "LANCADO_ACMS" : "LANCAMENTO_ACMS_REMOVIDO",
      launched
        ? "Tesouraria marcou este adiantamento como lancado no ACMS."
        : "Tesouraria removeu a marcacao de lancado no ACMS."
    );
    writeStore(store);
    notify();
    return advance;
  },

  createAuthorization(payload) {
      const store = readStore();
      const assistantUser = store.users.find((item) => item.id === payload.assistantId);
      const accessToken = ASSISTANT_PORTAL_ID;
      if (assistantUser) {
        assistantUser.accessToken = accessToken;
      }
      const authorization = {
        id: generateId("auth"),
        advanceId: payload.advanceId,
        assistantId: payload.assistantId,
        assistantName: payload.assistantName,
        assistantAccessToken: accessToken,
        memberName: payload.memberName,
        amount: Number(payload.amount),
        description: payload.description,
        createdAt: new Date().toISOString(),
        status: "AUTORIZADO",
        audioUrl: payload.audioUrl || "",
        audioName: payload.audioName || "",
        deliveredAt: "",
        advanceDescription: payload.advanceDescription || "",
        prazoDias: Number(payload.prazoDias || 0),
        dataLimite: payload.dataLimite || ""
      };
      store.authorizations.unshift(authorization);
      saveHistory(store, payload.advanceId, "REPASSE_AUTORIZADO", "Repasse autorizado para o tesoureiro auxiliar.");
      writeStore(store);
      notify();
      return {
        ...authorization,
        assistantPin: assistantUser?.pin || "",
        assistantLink: typeof window !== "undefined" ? `${window.location.origin}/auxiliar` : "/auxiliar"
      };
  },

  updateAuthorization(payload, { resent = false } = {}) {
    const store = readStore();
    const authorization = store.authorizations.find((item) => item.id === payload.authorizationId);
    if (!authorization) throw new Error("Repasse nao encontrado.");
    authorization.description = payload.description || "";
    authorization.audioUrl = payload.audioUrl || authorization.audioUrl || "";
    authorization.audioName = payload.audioName || authorization.audioName || "";
    authorization.status = "AUTORIZADO";
    authorization.deliveredAt = "";
    saveHistory(
      store,
      authorization.advanceId,
      resent ? "REPASSE_REENVIADO" : "REPASSE_ATUALIZADO",
      resent
        ? "Repasse reenviado para o tesoureiro auxiliar."
        : "Repasse atualizado para o tesoureiro auxiliar."
    );
    writeStore(store);
    notify();
    return authorization;
  },

  deleteAuthorization(authorizationId) {
    const store = readStore();
    const authorization = store.authorizations.find((item) => item.id === authorizationId);
    if (!authorization) throw new Error("Repasse nao encontrado.");
    store.authorizations = store.authorizations.filter((item) => item.id !== authorizationId);
    saveHistory(store, authorization.advanceId, "REPASSE_EXCLUIDO", "Repasse removido da area do auxiliar.");
    writeStore(store);
    notify();
    return authorization;
  },

  markAuthorizationDelivered(id) {
    const store = readStore();
    const authorization = store.authorizations.find((item) => item.id === id);
    if (!authorization) throw new Error("Autorização não encontrada.");
    authorization.status = "ENTREGUE";
    authorization.deliveredAt = new Date().toISOString();
    saveHistory(
      store,
      authorization.advanceId,
      "REPASSE_ENTREGUE",
      "Tesoureiro auxiliar marcou o repasse como entregue."
    );
    writeStore(store);
    notify();
  },

  registerTermPrinted(advanceId) {
    const store = readStore();
    saveHistory(store, advanceId, "TERMO_IMPRESSO", "Termo de adiantamento gerado/imprimido.");
    writeStore(store);
    notify();
  },

  deleteAdvance(advanceId) {
    const store = readStore();
    const exists = store.advances.some((item) => item.id === advanceId);
    if (!exists) throw new Error("Adiantamento nao encontrado.");
    store.advances = store.advances.filter((item) => item.id !== advanceId);
    store.authorizations = store.authorizations.filter((item) => item.advanceId !== advanceId);
    store.history = store.history.filter((item) => item.advanceId !== advanceId);
    writeStore(store);
    notify();
  }
};
