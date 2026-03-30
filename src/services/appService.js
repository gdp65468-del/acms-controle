import { onAuthStateChanged, signInWithPopup, signOut } from "firebase/auth";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch
} from "firebase/firestore";
import { getDownloadURL, ref, uploadBytes } from "firebase/storage";
import { auth, db, firebaseEnabled, googleProvider, storage } from "../firebase";
import { cloudinaryEnabled, cloudinaryUploadPreset, getCloudinaryUploadUrl } from "../cloudinary";
import { localDb } from "./localDb";
import { computeAdvanceStatus, computeDueDate } from "../utils/format";
import { getFileAssetType, prepareFileForUpload } from "../utils/fileAssets";

const COLLECTIONS = {
  users: "usuarios",
  advances: "adiantamentos",
  history: "historico_eventos",
  authorizations: "autorizacoes_repasse",
  assistantAccess: "acesso_auxiliar",
  fileFolders: "pastas_arquivos",
  fileAssets: "arquivos"
};

const ASSISTANT_PORTAL_ID = "principal";
const ASSISTANT_MAX_PIN_ATTEMPTS = 4;

async function saveHistory(advanceId, type, message) {
  await addDoc(collection(db, COLLECTIONS.history), {
    advanceId,
    type,
    message,
    createdAt: serverTimestamp()
  });
}

function mapAdvance(id, data) {
  const record = { id, ...data };
  return {
    ...record,
    status: computeAdvanceStatus(record)
  };
}

function getAssistantPin(assistantUser) {
  return String(assistantUser?.pin || "1234");
}

function normalizeAssistantPin(pin) {
  return String(pin || "").replace(/\D/g, "").slice(0, 4);
}

async function hashPin(pin) {
  const value = String(pin || "");
  if (!value) return "";
  const encoded = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", encoded);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function getAssistantAccessToken() {
  return ASSISTANT_PORTAL_ID;
}

function getAssistantPortalLink() {
  return typeof window !== "undefined" ? `${window.location.origin}/auxiliar` : "/auxiliar";
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

function buildAssistantPortalRecord(assistantUser, pinHash, overrides = {}) {
  return {
    assistantId: assistantUser.id,
    assistantName: assistantUser.nome,
    pinHash,
    failedAttempts: 0,
    isBlocked: false,
    blockedAt: "",
    updatedAt: new Date().toISOString(),
    ...overrides
  };
}

function buildAssistantPortalResponse(assistantUser, accessData = {}) {
  const assistantLink = getAssistantPortalLink();
  const assistantPin = getAssistantPin(assistantUser);
  const failedAttempts = Number(accessData.failedAttempts || 0);
  const isBlocked = Boolean(accessData.isBlocked);

  return {
    assistantLink,
    assistantPin,
    assistantAccessToken: getAssistantAccessToken(assistantUser),
    failedAttempts,
    isBlocked,
    blockedAt: accessData.blockedAt || "",
    updatedAt: accessData.updatedAt || "",
    statusLabel: isBlocked ? "Bloqueado por tentativas" : "Ativo",
    shareMessage: buildAssistantShareMessage({
      assistantName: assistantUser.nome,
      assistantLink,
      assistantPin
    })
  };
}

async function registerAssistantFailedAttemptInFirebase(assistantUser, accessToken) {
  const accessRef = doc(db, COLLECTIONS.assistantAccess, accessToken);
  const accessSnapshot = await getDoc(accessRef);
  if (!accessSnapshot.exists()) {
    throw new Error("Acesso do auxiliar nao encontrado. Solicite um novo PIN a tesouraria.");
  }

  const currentData = accessSnapshot.data();
  if (currentData.isBlocked) {
    throw new Error("Acesso bloqueado. Solicite um novo PIN a tesouraria.");
  }

  const failedAttempts = Number(currentData.failedAttempts || 0) + 1;
  const isBlocked = failedAttempts >= ASSISTANT_MAX_PIN_ATTEMPTS;
  const payload = {
    failedAttempts,
    isBlocked,
    blockedAt: isBlocked ? new Date().toISOString() : ""
  };

  await updateDoc(accessRef, payload);

  if (isBlocked) {
    throw new Error("Acesso bloqueado apos 4 tentativas. Solicite um novo PIN a tesouraria.");
  }

  const remainingAttempts = ASSISTANT_MAX_PIN_ATTEMPTS - failedAttempts;
  throw new Error(`PIN invalido. Restam ${remainingAttempts} tentativa(s).`);
}

function buildAssistantPublicOrder(authorization, advance = null) {
  return {
    authorizationId: authorization.id,
    advanceId: authorization.advanceId,
    memberName: authorization.memberName,
    amount: Number(authorization.amount || 0),
    description: authorization.description || "",
    createdAt: authorization.createdAt || new Date().toISOString(),
    status: authorization.status || "AUTORIZADO",
    audioUrl: authorization.audioUrl || "",
    audioName: authorization.audioName || "",
    deliveredAt: authorization.deliveredAt || "",
    advanceDescription: authorization.advanceDescription || advance?.descricao || "",
    prazoDias: Number(authorization.prazoDias || advance?.prazoDias || 0),
    dataLimite: authorization.dataLimite || advance?.dataLimite || "",
    assistantAccessToken: authorization.assistantAccessToken || ""
  };
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Nao foi possivel preparar o audio para envio."));
    reader.readAsDataURL(file);
  });
}

function mapFileFolder(id, data) {
  return { id, parentId: "", deletedAt: "", ...data };
}

function mapFileAsset(id, data) {
  return { id, digitized: false, digitizedAt: "", deletedAt: "", ...data };
}

function sortByDateDesc(items, field) {
  return [...items].sort((left, right) => {
    const leftRaw = left?.[field];
    const rightRaw = right?.[field];
    const leftValue =
      typeof leftRaw?.toDate === "function" ? leftRaw.toDate().getTime() : new Date(leftRaw || 0).getTime();
    const rightValue =
      typeof rightRaw?.toDate === "function" ? rightRaw.toDate().getTime() : new Date(rightRaw || 0).getTime();
    return rightValue - leftValue;
  });
}

function resolveApprovedTreasurer(users, authUser) {
  if (!authUser) return null;
  const match = users.find(
    (item) =>
      item.role === "treasurer" &&
      (item.id === authUser.uid || String(item.email || "").toLowerCase() === String(authUser.email || "").toLowerCase())
  );
  if (!match) return null;
  return {
    id: authUser.uid,
    nome: match.nome || authUser.displayName || "Tesouraria",
    email: authUser.email,
    role: "treasurer"
  };
}

async function uploadToCloudinary(file, folderName = "") {
  const formData = new FormData();
  formData.append("file", file);
  formData.append("upload_preset", cloudinaryUploadPreset);
  if (folderName) {
    formData.append("folder", folderName);
  }

  const response = await fetch(getCloudinaryUploadUrl(), {
    method: "POST",
    body: formData
  });

  if (!response.ok) {
    throw new Error("Nao foi possivel enviar o arquivo para o Cloudinary.");
  }

  return response.json();
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

async function syncAssistantAccessInFirebase({ assistantUser, authorization, advance }) {
  const accessToken = getAssistantAccessToken(assistantUser);
  const assistantPin = getAssistantPin(assistantUser);
  const pinHash = await hashPin(assistantPin);
  const accessRef = doc(db, COLLECTIONS.assistantAccess, accessToken);
  const accessSnapshot = await getDoc(accessRef);
  const existingData = accessSnapshot.exists() ? accessSnapshot.data() : {};

  await updateDoc(doc(db, COLLECTIONS.users, assistantUser.id), { accessToken });

  await setDoc(
    accessRef,
    buildAssistantPortalRecord(assistantUser, pinHash, {
      failedAttempts: Number(existingData.failedAttempts || 0),
      isBlocked: Boolean(existingData.isBlocked),
      blockedAt: existingData.blockedAt || "",
      updatedAt: existingData.updatedAt || new Date().toISOString()
    }),
    { merge: true }
  );

  await setDoc(
    doc(db, COLLECTIONS.assistantAccess, accessToken, "ordens", authorization.id),
    buildAssistantPublicOrder({ ...authorization, assistantAccessToken: accessToken }, advance)
  );

  return { accessToken, assistantPin };
}

export const appService = {
  isFirebaseEnabled: firebaseEnabled,
  isCloudinaryEnabled: cloudinaryEnabled,

  subscribeAppData(callback) {
    if (!firebaseEnabled) {
      return localDb.subscribe(callback);
    }

    const state = {
      users: [],
      advances: [],
      authorizations: [],
      history: [],
      fileFolders: [],
      fileAssets: [],
      session: { currentUser: null, assistantUser: null }
    };

    const emit = () =>
      callback({
        users: [...state.users],
        advances: [...state.advances],
        authorizations: [...state.authorizations],
        history: [...state.history],
        fileFolders: [...state.fileFolders],
        fileAssets: [...state.fileAssets],
        session: {
          currentUser: state.session.currentUser ? { ...state.session.currentUser } : null,
          assistantUser: state.session.assistantUser ? { ...state.session.assistantUser } : null
        }
      });
    let dataUnsubscribers = [];
    let authenticatedUser = null;

    function clearDataSubscriptions() {
      dataUnsubscribers.forEach((unsubscribe) => unsubscribe());
      dataUnsubscribers = [];
    }

    function resetDataState() {
      state.users = [];
      state.advances = [];
      state.authorizations = [];
      state.history = [];
      state.fileFolders = [];
      state.fileAssets = [];
      state.session.currentUser = null;
      state.session.assistantUser = null;
    }

    function subscribeProtectedData() {
      clearDataSubscriptions();
      Promise.all([
        getDocs(collection(db, COLLECTIONS.users)),
        getDocs(collection(db, COLLECTIONS.advances)),
        getDocs(collection(db, COLLECTIONS.authorizations)),
        getDocs(collection(db, COLLECTIONS.history)),
        getDocs(collection(db, COLLECTIONS.fileFolders)),
        getDocs(collection(db, COLLECTIONS.fileAssets))
      ])
        .then(([usersSnapshot, advancesSnapshot, authorizationsSnapshot, historySnapshot, fileFoldersSnapshot, fileAssetsSnapshot]) => {
          state.users = usersSnapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
          state.session.currentUser = resolveApprovedTreasurer(state.users, authenticatedUser);
          state.session.assistantUser = state.users.find((item) => item.role === "assistant") || null;
          state.advances = sortByDateDesc(
            advancesSnapshot.docs.map((item) => mapAdvance(item.id, item.data())),
            "dataAdiantamento"
          );
          state.authorizations = sortByDateDesc(
            authorizationsSnapshot.docs.map((item) => ({ id: item.id, ...item.data() })),
            "createdAt"
          );
          state.history = sortByDateDesc(
            historySnapshot.docs.map((item) => ({ id: item.id, ...item.data() })),
            "createdAt"
          );
          state.fileFolders = sortByDateDesc(
            fileFoldersSnapshot.docs.map((item) => mapFileFolder(item.id, item.data())),
            "createdAt"
          );
          state.fileAssets = sortByDateDesc(
            fileAssetsSnapshot.docs.map((item) => mapFileAsset(item.id, item.data())),
            "createdAt"
          );
          emit();
        })
        .catch((error) => {
          console.error("Nao foi possivel carregar os dados iniciais do Firestore.", error);
        });

      dataUnsubscribers = [
        onSnapshot(
          collection(db, COLLECTIONS.users),
          (snapshot) => {
            state.users = snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
            state.session.currentUser = resolveApprovedTreasurer(state.users, authenticatedUser);
            state.session.assistantUser = state.users.find((item) => item.role === "assistant") || null;
            emit();
          },
          (error) => console.error("Erro ao ouvir usuarios.", error)
        ),
        onSnapshot(
          collection(db, COLLECTIONS.advances),
          (snapshot) => {
            state.advances = sortByDateDesc(snapshot.docs.map((item) => mapAdvance(item.id, item.data())), "dataAdiantamento");
            emit();
          },
          (error) => console.error("Erro ao ouvir adiantamentos.", error)
        ),
        onSnapshot(
          collection(db, COLLECTIONS.authorizations),
          (snapshot) => {
            state.authorizations = sortByDateDesc(
              snapshot.docs.map((item) => ({ id: item.id, ...item.data() })),
              "createdAt"
            );
            emit();
          },
          (error) => console.error("Erro ao ouvir autorizacoes de repasse.", error)
        ),
        onSnapshot(
          collection(db, COLLECTIONS.history),
          (snapshot) => {
            state.history = sortByDateDesc(snapshot.docs.map((item) => ({ id: item.id, ...item.data() })), "createdAt");
            emit();
          },
          (error) => console.error("Erro ao ouvir historico.", error)
        ),
        onSnapshot(
          collection(db, COLLECTIONS.fileFolders),
          (snapshot) => {
            state.fileFolders = sortByDateDesc(snapshot.docs.map((item) => mapFileFolder(item.id, item.data())), "createdAt");
            emit();
          },
          (error) => console.error("Erro ao ouvir pastas de arquivos.", error)
        ),
        onSnapshot(
          collection(db, COLLECTIONS.fileAssets),
          (snapshot) => {
            state.fileAssets = sortByDateDesc(snapshot.docs.map((item) => mapFileAsset(item.id, item.data())), "createdAt");
            emit();
          },
          (error) => console.error("Erro ao ouvir arquivos.", error)
        )
      ];
    }

    const unsubscribeAuth = onAuthStateChanged(auth, async (user) => {
      authenticatedUser = user;
      state.session.currentUser = null;

      if (user) {
        subscribeProtectedData();
      } else {
        clearDataSubscriptions();
        resetDataState();
        emit();
      }
    });

    return () => {
      unsubscribeAuth();
      clearDataSubscriptions();
    };
  },

  async signInTreasurer() {
    if (!firebaseEnabled) {
      return localDb.signInTreasurer();
    }
    const result = await signInWithPopup(auth, googleProvider);
    const byUid = await getDoc(doc(db, COLLECTIONS.users, result.user.uid));
    if (byUid.exists() && byUid.data()?.role === "treasurer") {
      return result.user;
    }

    if (result.user.email) {
      const byEmail = await getDocs(
        query(collection(db, COLLECTIONS.users), where("email", "==", result.user.email), where("role", "==", "treasurer"))
      );
      if (!byEmail.empty) {
        return result.user;
      }
    }

    await signOut(auth);
    throw new Error("Sua conta Google nao esta aprovada para usar a area da tesouraria.");
  },

  async signOutTreasurer() {
    if (!firebaseEnabled) {
      localDb.signOutTreasurer();
      return;
    }
    await signOut(auth);
  },

  async createMember(payload) {
    if (!firebaseEnabled) {
      return localDb.createMember(payload);
    }

    const normalizedName = String(payload.nome || "").trim();
    if (!normalizedName) {
      throw new Error("Informe o nome da pessoa.");
    }

    const usersSnapshot = await getDocs(collection(db, COLLECTIONS.users));
    const existingMember = usersSnapshot.docs
      .map((item) => ({ id: item.id, ...item.data() }))
      .find((item) => item.role === "member" && String(item.nome || "").toLowerCase() === normalizedName.toLowerCase());

    if (existingMember) {
      return existingMember;
    }

    const record = {
      nome: normalizedName,
      email: payload.email || "",
      role: "member",
      publicToken: crypto.randomUUID(),
      createdAt: serverTimestamp()
    };
    const docRef = await addDoc(collection(db, COLLECTIONS.users), record);
    return { id: docRef.id, ...record };
  },

  async createAssistantProfile(payload) {
    const normalizedName = String(payload.nome || "").trim();
    const normalizedPin = normalizeAssistantPin(payload.pin);

    if (!normalizedName) {
      throw new Error("Informe o nome do tesoureiro auxiliar.");
    }

    if (normalizedPin.length !== 4) {
      throw new Error("Informe um PIN de 4 digitos para o auxiliar.");
    }

    if (!firebaseEnabled) {
      return localDb.createAssistantProfile({ nome: normalizedName, pin: normalizedPin });
    }

    const existingAssistants = await getDocs(query(collection(db, COLLECTIONS.users), where("role", "==", "assistant")));
    let assistantUser = null;

    if (!existingAssistants.empty) {
      const existingAssistant = existingAssistants.docs[0];
      await updateDoc(doc(db, COLLECTIONS.users, existingAssistant.id), {
        nome: normalizedName,
        pin: normalizedPin,
        accessToken: ASSISTANT_PORTAL_ID
      });
      assistantUser = {
        id: existingAssistant.id,
        ...existingAssistant.data(),
        nome: normalizedName,
        pin: normalizedPin,
        accessToken: ASSISTANT_PORTAL_ID
      };
    } else {
      const record = {
        nome: normalizedName,
        email: "",
        role: "assistant",
        pin: normalizedPin,
        accessToken: ASSISTANT_PORTAL_ID,
        createdAt: serverTimestamp()
      };
      const docRef = await addDoc(collection(db, COLLECTIONS.users), record);
      assistantUser = { id: docRef.id, ...record };
    }

    const pinHash = await hashPin(normalizedPin);
    await setDoc(
      doc(db, COLLECTIONS.assistantAccess, ASSISTANT_PORTAL_ID),
      buildAssistantPortalRecord(
        {
          ...assistantUser,
          pin: normalizedPin
        },
        pinHash
      ),
      { merge: true }
    );

    return assistantUser;
  },

  async deleteMember(memberId) {
    if (!firebaseEnabled) {
      return localDb.deleteMember(memberId);
    }

    const memberRef = doc(db, COLLECTIONS.users, memberId);
    const memberSnapshot = await getDoc(memberRef);
    if (!memberSnapshot.exists() || memberSnapshot.data()?.role !== "member") {
      throw new Error("Responsavel nao encontrado.");
    }

    const linkedAdvances = await getDocs(query(collection(db, COLLECTIONS.advances), where("usuarioId", "==", memberId)));
    if (!linkedAdvances.empty) {
      throw new Error("Nao e possivel excluir este responsavel porque ele ja possui adiantamentos vinculados.");
    }

    await deleteDoc(memberRef);
    return { id: memberSnapshot.id, ...memberSnapshot.data() };
  },

  async createAdvance(payload) {
    if (!firebaseEnabled) {
      return localDb.createAdvance(payload);
    }
    const normalizedDate = new Date(payload.dataAdiantamento || new Date().toISOString()).toISOString();
    const blockedSnapshot = payload.existingAdvances.some(
      (item) => item.usuarioId === payload.usuarioId && item.status === "ATRASADO"
    );
    if (blockedSnapshot) {
      throw new Error("Este responsavel ja possui um adiantamento atrasado.");
    }
    let publicToken = payload.publicToken || "";
    if (!publicToken && payload.usuarioId) {
      const userRef = doc(db, COLLECTIONS.users, payload.usuarioId);
      const userSnapshot = await getDoc(userRef);
      if (userSnapshot.exists()) {
        publicToken = userSnapshot.data().publicToken || "";
        if (!publicToken) {
          publicToken = crypto.randomUUID();
          await updateDoc(userRef, { publicToken });
        }
      }
    }
    const record = {
      usuarioId: payload.usuarioId,
      usuarioNome: payload.usuarioNome,
      valor: Number(payload.valor),
      dataAdiantamento: normalizedDate,
      prazoDias: Number(payload.prazoDias),
      dataLimite: computeDueDate(normalizedDate, payload.prazoDias),
      descricao: payload.descricao,
      justificativa: "",
      totalComprovado: 0,
      lancadoAcms: false,
      dataLancamentoAcms: "",
      comprovantes: [],
      createdBy: payload.createdBy,
      publicToken: publicToken || crypto.randomUUID()
    };
    const docRef = await addDoc(collection(db, COLLECTIONS.advances), record);
    await saveHistory(docRef.id, "ADIANTAMENTO_CRIADO", "Adiantamento criado pela tesouraria.");
    return { id: docRef.id, ...record, status: "PENDENTE" };
  },

  async createFileFolder(payload) {
    if (!firebaseEnabled) {
      return localDb.createFileFolder(payload);
    }

    const normalizedName = String(payload.name || "").trim();
    if (!normalizedName) {
      throw new Error("Informe o nome da pasta.");
    }

    const snapshot = await getDocs(collection(db, COLLECTIONS.fileFolders));
    const parentId = String(payload.parentId || "");
    const existingFolder = snapshot.docs
      .map((item) => ({ id: item.id, parentId: "", ...item.data() }))
      .find(
        (item) =>
          String(item.parentId || "") === parentId &&
          String(item.name || "").toLowerCase() === normalizedName.toLowerCase()
      );

    if (existingFolder) {
      return existingFolder;
    }

    const record = {
      name: normalizedName,
      description: String(payload.description || "").trim(),
      parentId,
      deletedAt: "",
      createdBy: payload.createdBy,
      createdAt: serverTimestamp()
    };

    const docRef = await addDoc(collection(db, COLLECTIONS.fileFolders), record);
    return { id: docRef.id, ...record };
  },

  async uploadFileAsset(payload) {
    const fileType = getFileAssetType(payload.file);
    if (!fileType) {
      throw new Error("Envie apenas imagem ou PDF.");
    }

    const preparedFile = await prepareFileForUpload(payload.file);
    const finalTitle = String(payload.title || preparedFile.name || payload.file.name || "").trim();
    if (!finalTitle) {
      throw new Error("Informe um titulo para o arquivo.");
    }

    if (!firebaseEnabled) {
      const secureUrl = await fileToDataUrl(preparedFile);
      return localDb.uploadFileAsset({
        folderId: payload.folderId,
        title: finalTitle,
        originalFileName: payload.file.name,
        fileType,
        mimeType: preparedFile.type,
        secureUrl,
        thumbnailUrl: fileType === "image" ? secureUrl : "",
        notes: String(payload.notes || "").trim(),
        uploadedBy: payload.uploadedBy
      });
    }

    if (!cloudinaryEnabled) {
      throw new Error("Configure o Cloudinary para enviar arquivos.");
    }

    const folderName = payload.folderPath
      ? `acms-controle/${payload.folderPath
          .split("/")
          .filter(Boolean)
          .map((segment) => segment.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, ""))
          .join("/")}`
      : "acms-controle/geral";

    const cloudinaryResult = await uploadToCloudinary(preparedFile, folderName);

    const record = {
      folderId: payload.folderId,
      title: finalTitle,
      originalFileName: payload.file.name,
      fileType,
      mimeType: preparedFile.type,
      cloudinaryPublicId: cloudinaryResult.public_id || "",
      secureUrl: cloudinaryResult.secure_url || "",
      thumbnailUrl: fileType === "image" ? cloudinaryResult.secure_url || "" : "",
      notes: String(payload.notes || "").trim(),
      digitized: false,
      digitizedAt: "",
      deletedAt: "",
      uploadedBy: payload.uploadedBy,
      createdAt: serverTimestamp()
    };

    const docRef = await addDoc(collection(db, COLLECTIONS.fileAssets), record);
    return { id: docRef.id, ...record };
  },

  async renameFileFolder(folderId, name) {
    const normalizedName = String(name || "").trim();
    if (!normalizedName) {
      throw new Error("Informe o nome da pasta.");
    }
    if (!firebaseEnabled) {
      return localDb.renameFileFolder(folderId, normalizedName);
    }
    await updateDoc(doc(db, COLLECTIONS.fileFolders, folderId), { name: normalizedName });
  },

  async renameFileAsset(assetId, title) {
    const normalizedTitle = String(title || "").trim();
    if (!normalizedTitle) {
      throw new Error("Informe o nome do arquivo.");
    }
    if (!firebaseEnabled) {
      return localDb.renameFileAsset(assetId, normalizedTitle);
    }
    await updateDoc(doc(db, COLLECTIONS.fileAssets, assetId), { title: normalizedTitle });
  },

  async moveFileAssets(assetIds, folderId) {
    if (!firebaseEnabled) {
      return localDb.moveFileAssets(assetIds, folderId);
    }
    const batch = writeBatch(db);
    assetIds.forEach((assetId) => {
      batch.update(doc(db, COLLECTIONS.fileAssets, assetId), { folderId: String(folderId || "") });
    });
    await batch.commit();
  },

  async moveFileFolder(folderId, parentId, folders = []) {
    if (!firebaseEnabled) {
      return localDb.moveFileFolder(folderId, parentId);
    }
    if (folderId === parentId) {
      throw new Error("A pasta nao pode ser movida para si mesma.");
    }
    const descendants = getFolderDescendantIds(folders, folderId);
    if (descendants.includes(parentId)) {
      throw new Error("A pasta nao pode ser movida para dentro de uma subpasta dela.");
    }
    await updateDoc(doc(db, COLLECTIONS.fileFolders, folderId), { parentId: String(parentId || "") });
  },

  async trashFileAssets(assetIds) {
    if (!firebaseEnabled) {
      return localDb.trashFileAssets(assetIds);
    }
    const batch = writeBatch(db);
    const deletedAt = new Date().toISOString();
    assetIds.forEach((assetId) => {
      batch.update(doc(db, COLLECTIONS.fileAssets, assetId), { deletedAt });
    });
    await batch.commit();
  },

  async trashFileFolder(folderId, folders = [], assets = []) {
    if (!firebaseEnabled) {
      return localDb.trashFileFolder(folderId);
    }
    const folderIds = [folderId, ...getFolderDescendantIds(folders, folderId)];
    const deletedAt = new Date().toISOString();
    const batch = writeBatch(db);
    folderIds.forEach((id) => {
      batch.update(doc(db, COLLECTIONS.fileFolders, id), { deletedAt });
    });
    assets
      .filter((item) => folderIds.includes(String(item.folderId || "")))
      .forEach((item) => {
        batch.update(doc(db, COLLECTIONS.fileAssets, item.id), { deletedAt });
      });
    await batch.commit();
  },

  async restoreFileAssets(assetIds) {
    if (!firebaseEnabled) {
      return localDb.restoreFileAssets(assetIds);
    }
    const batch = writeBatch(db);
    assetIds.forEach((assetId) => {
      batch.update(doc(db, COLLECTIONS.fileAssets, assetId), { deletedAt: "" });
    });
    await batch.commit();
  },

  async restoreFileFolder(folderId, folders = [], assets = []) {
    if (!firebaseEnabled) {
      return localDb.restoreFileFolder(folderId);
    }
    const folderIds = [folderId, ...getFolderDescendantIds(folders, folderId)];
    const batch = writeBatch(db);
    folderIds.forEach((id) => {
      batch.update(doc(db, COLLECTIONS.fileFolders, id), { deletedAt: "" });
    });
    assets
      .filter((item) => folderIds.includes(String(item.folderId || "")))
      .forEach((item) => {
        batch.update(doc(db, COLLECTIONS.fileAssets, item.id), { deletedAt: "" });
      });
    await batch.commit();
  },

  async deleteFileAssets(assetIds) {
    if (!firebaseEnabled) {
      return localDb.deleteFileAssets(assetIds);
    }
    const batch = writeBatch(db);
    assetIds.forEach((assetId) => {
      batch.delete(doc(db, COLLECTIONS.fileAssets, assetId));
    });
    await batch.commit();
  },

  async deleteFileFolder(folderId, folders = [], assets = []) {
    if (!firebaseEnabled) {
      return localDb.deleteFileFolder(folderId);
    }
    const folderIds = [folderId, ...getFolderDescendantIds(folders, folderId)];
    const batch = writeBatch(db);
    folderIds.forEach((id) => {
      batch.delete(doc(db, COLLECTIONS.fileFolders, id));
    });
    assets
      .filter((item) => folderIds.includes(String(item.folderId || "")))
      .forEach((item) => {
        batch.delete(doc(db, COLLECTIONS.fileAssets, item.id));
      });
    await batch.commit();
  },

  async toggleFileDigitized(assetId, digitized) {
    if (!firebaseEnabled) {
      return localDb.toggleFileDigitized(assetId, digitized);
    }
    await updateDoc(doc(db, COLLECTIONS.fileAssets, assetId), {
      digitized: Boolean(digitized),
      digitizedAt: digitized ? new Date().toISOString() : ""
    });
  },

  async saveSettlement(advance, payload) {
    if (!firebaseEnabled) {
      return localDb.saveSettlement(advance.id, payload);
    }
    const nextRecord = {
      totalComprovado: Number(payload.totalComprovado || 0),
      justificativa: payload.justificativa || "",
      lancadoAcms: Boolean(payload.lancadoAcms),
      dataLancamentoAcms: payload.lancadoAcms ? new Date().toISOString() : ""
    };
    await updateDoc(doc(db, COLLECTIONS.advances, advance.id), nextRecord);
    const status = computeAdvanceStatus({ ...advance, ...nextRecord });
    await saveHistory(
      advance.id,
      "PRESTACAO_REGISTRADA",
      status === "JUSTIFICADO"
        ? "Prestacao registrada com justificativa."
        : "Prestacao registrada com valor informado."
    );
    if (nextRecord.lancadoAcms) {
      await saveHistory(advance.id, "LANCADO_ACMS", "Tesouraria marcou este adiantamento como lancado no ACMS.");
    }
  },

  async createAuthorization(payload) {
    if (!firebaseEnabled) {
      let audioUrl = payload.audioUrl || "";
      let audioName = payload.audioName || "";
      if (payload.audioFile) {
        audioUrl = await fileToDataUrl(payload.audioFile);
        audioName = payload.audioFile.name;
      }
      return localDb.createAuthorization({
        ...payload,
        audioUrl,
        audioName
      });
    }
    const assistantSnapshot = await getDoc(doc(db, COLLECTIONS.users, payload.assistantId));
    if (!assistantSnapshot.exists()) {
      throw new Error("Tesoureiro auxiliar nao encontrado.");
    }
    const assistantUser = { id: assistantSnapshot.id, ...assistantSnapshot.data() };
    let audioUrl = "";
    let audioName = "";
    if (payload.audioFile) {
      const fileRef = ref(storage, `audios/${payload.advanceId}/${Date.now()}-${payload.audioFile.name}`);
      await uploadBytes(fileRef, payload.audioFile);
      audioUrl = await getDownloadURL(fileRef);
      audioName = payload.audioFile.name;
    }
    const record = {
      advanceId: payload.advanceId,
      assistantId: payload.assistantId,
      assistantName: payload.assistantName,
      assistantAccessToken: getAssistantAccessToken(assistantUser),
      memberName: payload.memberName,
      amount: Number(payload.amount),
      description: payload.description,
      createdAt: serverTimestamp(),
      status: "AUTORIZADO",
      audioUrl,
      audioName,
      deliveredAt: "",
      advanceDescription: payload.advanceDescription || "",
      prazoDias: Number(payload.prazoDias || 0),
      dataLimite: payload.dataLimite || ""
    };
    const docRef = await addDoc(collection(db, COLLECTIONS.authorizations), record);
    const advance = {
      descricao: payload.advanceDescription || "",
      prazoDias: Number(payload.prazoDias || 0),
      dataLimite: payload.dataLimite || ""
    };
    const access = await syncAssistantAccessInFirebase({
      assistantUser,
      authorization: { id: docRef.id, ...record, createdAt: new Date().toISOString() },
      advance
    });
    await saveHistory(payload.advanceId, "REPASSE_AUTORIZADO", "Repasse autorizado para o tesoureiro auxiliar.");
    return {
      id: docRef.id,
      ...record,
      assistantAccessToken: access.accessToken,
      assistantPin: access.assistantPin,
      assistantLink: typeof window !== "undefined" ? `${window.location.origin}/auxiliar` : "/auxiliar"
    };
  },

  async updateAuthorization(payload, { resent = false } = {}) {
    if (!firebaseEnabled) {
      let audioUrl = payload.existingAuthorization?.audioUrl || "";
      let audioName = payload.existingAuthorization?.audioName || "";
      if (payload.audioFile) {
        audioUrl = await fileToDataUrl(payload.audioFile);
        audioName = payload.audioFile.name;
      }
      return localDb.updateAuthorization(
        {
          authorizationId: payload.authorizationId,
          description: payload.description,
          audioUrl,
          audioName
        },
        { resent }
      );
    }

    const authorizationRef = doc(db, COLLECTIONS.authorizations, payload.authorizationId);
    const authorizationSnapshot = await getDoc(authorizationRef);
    if (!authorizationSnapshot.exists()) {
      throw new Error("Repasse nao encontrado.");
    }

    const currentAuthorization = { id: authorizationSnapshot.id, ...authorizationSnapshot.data() };
    let audioUrl = currentAuthorization.audioUrl || "";
    let audioName = currentAuthorization.audioName || "";
    if (payload.audioFile) {
      const fileRef = ref(storage, `audios/${currentAuthorization.advanceId}/${Date.now()}-${payload.audioFile.name}`);
      await uploadBytes(fileRef, payload.audioFile);
      audioUrl = await getDownloadURL(fileRef);
      audioName = payload.audioFile.name;
    }

    const nextRecord = {
      description: payload.description || "",
      audioUrl,
      audioName,
      status: "AUTORIZADO",
      deliveredAt: ""
    };

    await updateDoc(authorizationRef, nextRecord);
    const nextAuthorization = { ...currentAuthorization, ...nextRecord };
    const accessToken = currentAuthorization.assistantAccessToken || ASSISTANT_PORTAL_ID;
    await setDoc(
      doc(db, COLLECTIONS.assistantAccess, accessToken, "ordens", currentAuthorization.id),
      buildAssistantPublicOrder(nextAuthorization)
    );
    await saveHistory(
      currentAuthorization.advanceId,
      resent ? "REPASSE_REENVIADO" : "REPASSE_ATUALIZADO",
      resent
        ? "Repasse reenviado para o tesoureiro auxiliar."
        : "Repasse atualizado para o tesoureiro auxiliar."
    );
    return nextAuthorization;
  },

  async deleteAuthorization(authorizationId) {
    if (!firebaseEnabled) {
      return localDb.deleteAuthorization(authorizationId);
    }

    const authorizationRef = doc(db, COLLECTIONS.authorizations, authorizationId);
    const authorizationSnapshot = await getDoc(authorizationRef);
    if (!authorizationSnapshot.exists()) {
      throw new Error("Repasse nao encontrado.");
    }

    const authorization = { id: authorizationSnapshot.id, ...authorizationSnapshot.data() };
    await deleteDoc(authorizationRef);
    const accessToken = authorization.assistantAccessToken || ASSISTANT_PORTAL_ID;
    await deleteDoc(doc(db, COLLECTIONS.assistantAccess, accessToken, "ordens", authorizationId));
    await saveHistory(authorization.advanceId, "REPASSE_EXCLUIDO", "Repasse removido da area do auxiliar.");
    return authorization;
  },

  async getAssistantPortalAccess(assistantUser) {
    if (!assistantUser) {
      throw new Error("Cadastre um tesoureiro auxiliar para gerar o acesso.");
    }

    if (!firebaseEnabled) {
      return localDb.getAssistantPortalAccess(assistantUser);
    }

    const assistantAccessToken = getAssistantAccessToken(assistantUser);
    const assistantPin = getAssistantPin(assistantUser);
    const pinHash = await hashPin(assistantPin);
    const accessRef = doc(db, COLLECTIONS.assistantAccess, assistantAccessToken);
    const accessSnapshot = await getDoc(accessRef);
    const existingData = accessSnapshot.exists() ? accessSnapshot.data() : {};
    await updateDoc(doc(db, COLLECTIONS.users, assistantUser.id), { accessToken: assistantAccessToken });
    await setDoc(
      accessRef,
      buildAssistantPortalRecord(assistantUser, pinHash, {
        failedAttempts: Number(existingData.failedAttempts || 0),
        isBlocked: Boolean(existingData.isBlocked),
        blockedAt: existingData.blockedAt || "",
        updatedAt: existingData.updatedAt || new Date().toISOString()
      }),
      { merge: true }
    );

    const existingAuthorizations = await getDocs(
      query(collection(db, COLLECTIONS.authorizations), where("assistantId", "==", assistantUser.id))
    );
    await Promise.all(
      existingAuthorizations.docs.map((item) => {
        const authorization = { id: item.id, ...item.data(), assistantAccessToken };
        return setDoc(
          doc(db, COLLECTIONS.assistantAccess, assistantAccessToken, "ordens", item.id),
          buildAssistantPublicOrder(authorization)
        );
      })
    );

    return buildAssistantPortalResponse(assistantUser, existingData);
  },

  async updateAssistantPortalPin(assistantUser, nextPin) {
    if (!assistantUser) {
      throw new Error("Cadastre um tesoureiro auxiliar para configurar o acesso.");
    }

    const normalizedPin = normalizeAssistantPin(nextPin);
    if (normalizedPin.length !== 4) {
      throw new Error("Informe um PIN de 4 digitos.");
    }

    const assistantLink = getAssistantPortalLink();
    const assistantAccessToken = getAssistantAccessToken(assistantUser);

    if (!firebaseEnabled) {
      return localDb.updateAssistantPortalPin(assistantUser, normalizedPin);
    }

    const pinHash = await hashPin(normalizedPin);
    await updateDoc(doc(db, COLLECTIONS.users, assistantUser.id), {
      pin: normalizedPin,
      accessToken: assistantAccessToken
    });
    await setDoc(
      doc(db, COLLECTIONS.assistantAccess, assistantAccessToken),
      buildAssistantPortalRecord(
        {
          ...assistantUser,
          pin: normalizedPin
        },
        pinHash
      ),
      { merge: true }
    );

    localStorage.removeItem(`acms-assistant-unlocked:${assistantAccessToken}`);

    return {
      assistantLink,
      assistantPin: normalizedPin,
      assistantAccessToken,
      failedAttempts: 0,
      isBlocked: false,
      blockedAt: "",
      statusLabel: "Ativo",
      shareMessage: buildAssistantShareMessage({
        assistantName: assistantUser.nome,
        assistantLink,
        assistantPin: normalizedPin
      })
    };
  },

  async markAuthorizationDelivered(authorization, accessToken = "") {
    if (!firebaseEnabled) {
      return localDb.markAuthorizationDelivered(authorization.id);
    }
    await updateDoc(doc(db, COLLECTIONS.authorizations, authorization.id), {
      status: "ENTREGUE",
      deliveredAt: new Date().toISOString()
    });
    const resolvedToken = accessToken || authorization.assistantAccessToken || "";
    if (resolvedToken) {
      await updateDoc(doc(db, COLLECTIONS.assistantAccess, resolvedToken, "ordens", authorization.authorizationId || authorization.id), {
        status: "ENTREGUE",
        deliveredAt: new Date().toISOString()
      });
    }
    await saveHistory(
      authorization.advanceId,
      "REPASSE_ENTREGUE",
      "Tesoureiro auxiliar marcou o repasse como entregue."
    );
  },

  async registerTermPrinted(advanceId) {
    if (!firebaseEnabled) {
      return localDb.registerTermPrinted(advanceId);
    }
    await saveHistory(advanceId, "TERMO_IMPRESSO", "Termo de adiantamento gerado/imprimido.");
  },

  async toggleAcmsLaunch(advanceId, launched) {
    if (!firebaseEnabled) {
      return localDb.toggleAcmsLaunch(advanceId, launched);
    }
    await updateDoc(doc(db, COLLECTIONS.advances, advanceId), {
      lancadoAcms: Boolean(launched),
      dataLancamentoAcms: launched ? new Date().toISOString() : ""
    });
    await saveHistory(
      advanceId,
      launched ? "LANCADO_ACMS" : "LANCAMENTO_ACMS_REMOVIDO",
      launched
        ? "Tesouraria marcou este adiantamento como lancado no ACMS."
        : "Tesouraria removeu a marcacao de lancado no ACMS."
    );
  },

  async deleteAdvance(advanceId) {
    if (!firebaseEnabled) {
      return localDb.deleteAdvance(advanceId);
    }
    const batch = writeBatch(db);
    const historySnapshot = await getDocs(query(collection(db, COLLECTIONS.history), where("advanceId", "==", advanceId)));
    historySnapshot.forEach((item) => batch.delete(item.ref));
    const authorizationSnapshot = await getDocs(
      query(collection(db, COLLECTIONS.authorizations), where("advanceId", "==", advanceId))
    );
    authorizationSnapshot.forEach((item) => {
      batch.delete(item.ref);
      const authorization = item.data();
      const accessToken = authorization.assistantAccessToken || ASSISTANT_PORTAL_ID;
      batch.delete(doc(db, COLLECTIONS.assistantAccess, accessToken, "ordens", item.id));
    });
    batch.delete(doc(db, COLLECTIONS.advances, advanceId));
    await batch.commit();
  },

  subscribeAssistantAccess(token, callback) {
    if (!firebaseEnabled) {
      return localDb.subscribeAssistantAccess(token, callback);
    }
    const resolvedToken = token || ASSISTANT_PORTAL_ID;

    const state = { assistantUser: null, authorizations: [] };
    const emit = () =>
      callback({
        assistantUser: state.assistantUser ? { ...state.assistantUser } : null,
        authorizations: [...state.authorizations]
      });

    const accessRef = doc(db, COLLECTIONS.assistantAccess, resolvedToken);
    const ordersRef = collection(db, COLLECTIONS.assistantAccess, resolvedToken, "ordens");
    const unsubAccess = onSnapshot(
      accessRef,
      (snapshot) => {
        state.assistantUser = snapshot.exists()
          ? {
              id: snapshot.id,
              ...snapshot.data(),
              accessToken: resolvedToken,
              statusLabel: snapshot.data()?.isBlocked ? "Bloqueado por tentativas" : "Ativo"
            }
          : null;
        emit();
      },
      () => {
        state.assistantUser = null;
        emit();
      }
    );
    const unsubOrders = onSnapshot(
      ordersRef,
      (snapshot) => {
        state.authorizations = sortByDateDesc(snapshot.docs.map((item) => ({ id: item.id, ...item.data() })), "createdAt");
        emit();
      },
      () => {
        state.authorizations = [];
        emit();
      }
    );
    return () => {
      unsubAccess();
      unsubOrders();
    };
  },

  async unlockAssistant(pin, assistantUser, token = "") {
    if (!assistantUser) {
      throw new Error("Nenhum usuario auxiliar configurado.");
    }
    if (assistantUser.isBlocked) {
      throw new Error("Acesso bloqueado. Solicite um novo PIN a tesouraria.");
    }
    const expectedHash = assistantUser.pinHash || (await hashPin(getAssistantPin(assistantUser)));
    const providedHash = await hashPin(pin);
    if (providedHash !== expectedHash) {
      if (!firebaseEnabled) {
        return localDb.registerAssistantFailedAttempt(token || assistantUser.accessToken || ASSISTANT_PORTAL_ID);
      }
      return registerAssistantFailedAttemptInFirebase(assistantUser, token || assistantUser.accessToken || ASSISTANT_PORTAL_ID);
    }

    localStorage.setItem(
      `acms-assistant-unlocked:${token || assistantUser.accessToken || ASSISTANT_PORTAL_ID}`,
      String(assistantUser.updatedAt || "ok")
    );
    return true;
  },

  isAssistantUnlocked(token = ASSISTANT_PORTAL_ID, assistantUser = null) {
    if (assistantUser?.isBlocked) return false;
    const storedValue = localStorage.getItem(`acms-assistant-unlocked:${token}`);
    if (!storedValue) return false;
    if (!assistantUser?.updatedAt) return Boolean(storedValue);
    return storedValue === String(assistantUser.updatedAt);
  },

  lockAssistant(token = ASSISTANT_PORTAL_ID) {
    localStorage.removeItem(`acms-assistant-unlocked:${token}`);
  }
};
