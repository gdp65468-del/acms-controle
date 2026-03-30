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
  return store.users.find((item) => item.role === "assistant" && String(item.accessToken || "") === String(token || ""));
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
    const handler = () => callback(getAssistantAccessSnapshot(readStore(), token));
    window.addEventListener("acms-local-updated", handler);
    callback(getAssistantAccessSnapshot(readStore(), token));
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
      const accessToken = assistantUser?.accessToken || generateId("aux-link");
      if (assistantUser && !assistantUser.accessToken) {
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
        assistantPin: assistantUser?.pin || "1234",
        assistantLink:
          typeof window !== "undefined" ? `${window.location.origin}/auxiliar/${accessToken}` : `/auxiliar/${accessToken}`
      };
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
