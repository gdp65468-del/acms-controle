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
  writeBatch,
  Timestamp
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
  driveUploadSessions: "sessoes_upload_drive",
  fileFolders: "pastas_arquivos",
  fileAssets: "arquivos"
};

const ASSISTANT_PORTAL_ID = "principal";
const ASSISTANT_MAX_PIN_ATTEMPTS = 4;
const DRIVE_UPLOAD_SESSION_TIMEOUT_MINUTES = 30;
const DEFAULT_PUBLIC_ADVANCE_ACCESS_CODE = "777";

function isFirebasePublicContext() {
  return firebaseEnabled && !auth?.currentUser;
}

function getAssistantSessionStorageKey(token = ASSISTANT_PORTAL_ID) {
  return `acms-assistant-unlocked:${token}`;
}

function getPublicAdvanceSessionStorageKey(token = "") {
  return `acms-public-advance-unlocked:${token}`;
}

function shouldUseAssistantPortalApi(token = ASSISTANT_PORTAL_ID) {
  return String(token || ASSISTANT_PORTAL_ID) === ASSISTANT_PORTAL_ID;
}

function getDriveUploadSessionStorageKey(sessionId) {
  return `acms-drive-upload:${sessionId}`;
}

async function parseApiResponse(response) {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.ok === false) {
    throw new Error(payload.message || "Nao foi possivel concluir esta acao.");
  }
  return payload;
}

async function apiRequest(path, { method = "GET", body, headers = {}, isFormData = false } = {}) {
  const requestHeaders = { ...headers };
  let requestBody = body;
  if (body && !isFormData) {
    requestHeaders["Content-Type"] = "application/json";
    requestBody = JSON.stringify(body);
  }
  const response = await fetch(path, {
    method,
    headers: requestHeaders,
    body: requestBody,
    cache: "no-store"
  });
  return parseApiResponse(response);
}

function readStoredJson(key) {
  try {
    const value = localStorage.getItem(key);
    return value ? JSON.parse(value) : null;
  } catch {
    return null;
  }
}

async function getTreasurerAuthHeaders() {
  if (!auth?.currentUser) {
    throw new Error("Sessao da tesouraria nao encontrada.");
  }
  const idToken = await auth.currentUser.getIdToken();
  return {
    Authorization: `Bearer ${idToken}`
  };
}

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
  return String(assistantUser?.pin || "");
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

function addMinutes(dateLike, minutes = DRIVE_UPLOAD_SESSION_TIMEOUT_MINUTES) {
  const baseDate =
    typeof dateLike?.toDate === "function" ? dateLike.toDate() : new Date(dateLike || Date.now());
  return new Date(baseDate.getTime() + minutes * 60 * 1000);
}

function toDateValue(value) {
  if (!value) return null;
  if (typeof value?.toDate === "function") return value.toDate();
  const nextDate = new Date(value);
  return Number.isNaN(nextDate.getTime()) ? null : nextDate;
}

function isDriveUploadSessionExpired(session) {
  if (!session) return true;
  if (String(session.status || "") !== "ATIVA") return true;
  const expiresAt = toDateValue(session.expiresAt);
  if (!expiresAt) return true;
  return expiresAt.getTime() <= Date.now();
}

function getDriveUploadSessionLink(sessionId) {
  return typeof window !== "undefined" ? `${window.location.origin}/drive-upload/${sessionId}` : `/drive-upload/${sessionId}`;
}

function generateDriveUploadAccessCode() {
  const random = crypto.getRandomValues(new Uint32Array(1))[0] % 1000000;
  return String(random).padStart(6, "0");
}

function buildDriveUploadSessionResponse(session, accessCode = "") {
  const expiresAt = toDateValue(session.expiresAt);
  const remainingMs = expiresAt ? Math.max(0, expiresAt.getTime() - Date.now()) : 0;
  return {
    id: session.id,
    folderId: session.folderId || "",
    folderName: session.folderName || "Pasta sem nome",
    folderPath: session.folderPath || "",
    createdBy: session.createdBy || "",
    status: session.status || "ATIVA",
    createdAt: session.createdAt || "",
    lastActiveAt: session.lastActiveAt || "",
    expiresAt: session.expiresAt || "",
    accessCodeHash: session.accessCodeHash || "",
    accessCode,
    accessLink: getDriveUploadSessionLink(session.id),
    isExpired: isDriveUploadSessionExpired(session),
    remainingMs
  };
}

function mapDriveUploadSession(id, data) {
  return {
    id,
    status: "ATIVA",
    folderId: "",
    folderName: "",
    folderPath: "",
    accessCodeHash: "",
    createdBy: "",
    createdAt: "",
    lastActiveAt: "",
    expiresAt: "",
    ...data
  };
}

function getAssistantPortalLink() {
  return typeof window !== "undefined" ? `${window.location.origin}/auxiliar` : "/auxiliar";
}

function normalizePublicAdvanceAccessCode(code) {
  return String(code || "").replace(/\D/g, "").slice(0, 8);
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

function mapPublicAssistantPortal(portal = {}) {
  return {
    id: ASSISTANT_PORTAL_ID,
    nome: portal.assistantName || "Tesoureiro auxiliar",
    failedAttempts: 0,
    isBlocked: false,
    blockedAt: "",
    updatedAt: "",
    sessionVersion: portal.sessionVersion || "",
    statusLabel: "PIN necessario"
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

  async getDriveUploadSession(sessionId, { includeSecret = false } = {}) {
    if (!sessionId) {
      throw new Error("Sessao de upload nao encontrada.");
    }

    if (!firebaseEnabled) {
      return localDb.getDriveUploadSession(sessionId, { includeSecret });
    }

    if (isFirebasePublicContext()) {
      const payload = await apiRequest(`/api/drive-upload/session?sessionId=${encodeURIComponent(sessionId)}`);
      return payload.session;
    }

    const sessionRef = doc(db, COLLECTIONS.driveUploadSessions, sessionId);
    const sessionSnapshot = await getDoc(sessionRef);
    if (!sessionSnapshot.exists()) {
      throw new Error("Sessao de upload nao encontrada.");
    }

    const session = mapDriveUploadSession(sessionSnapshot.id, sessionSnapshot.data());
    let accessCode = "";
    if (includeSecret) {
      const secretSnapshot = await getDoc(doc(db, COLLECTIONS.driveUploadSessions, sessionId, "controle", "segredo"));
      accessCode = secretSnapshot.exists() ? String(secretSnapshot.data()?.accessCode || "") : "";
    }

    return buildDriveUploadSessionResponse(session, accessCode);
  },

  async createDriveUploadSession(folder, createdBy, { regenerate = false } = {}) {
    if (!folder?.id) {
      throw new Error("Abra uma pasta antes de gerar o QR.");
    }

    if (!firebaseEnabled) {
      return localDb.createDriveUploadSession(folder, createdBy, { regenerate });
    }

    const existingSessionsSnapshot = await getDocs(
      query(collection(db, COLLECTIONS.driveUploadSessions), where("folderId", "==", String(folder.id)))
    );
    const existingSessions = existingSessionsSnapshot.docs.map((item) => mapDriveUploadSession(item.id, item.data()));
    const activeSession = existingSessions.find((item) => item.status === "ATIVA" && !isDriveUploadSessionExpired(item));

    if (activeSession && !regenerate) {
      return this.getDriveUploadSession(activeSession.id, { includeSecret: true });
    }

    const accessCode = generateDriveUploadAccessCode();
    const accessCodeHash = await hashPin(accessCode);
    const now = new Date();
    const expiresAt = Timestamp.fromDate(addMinutes(now));
    const sessionRef = doc(collection(db, COLLECTIONS.driveUploadSessions));
    const batch = writeBatch(db);

    existingSessions
      .filter((item) => item.status === "ATIVA")
      .forEach((item) => {
        batch.update(doc(db, COLLECTIONS.driveUploadSessions, item.id), { status: "ENCERRADA" });
      });

    batch.set(sessionRef, {
      folderId: String(folder.id),
      folderName: String(folder.name || ""),
      folderPath: String(folder.path || folder.folderPath || folder.name || ""),
      accessCodeHash,
      createdBy: String(createdBy || ""),
      createdAt: Timestamp.fromDate(now),
      lastActiveAt: Timestamp.fromDate(now),
      expiresAt,
      status: "ATIVA"
    });
    batch.set(doc(db, COLLECTIONS.driveUploadSessions, sessionRef.id, "controle", "segredo"), {
      accessCode,
      accessCodeHash,
      createdAt: Timestamp.fromDate(now)
    });
    await batch.commit();

    return buildDriveUploadSessionResponse(
      {
        id: sessionRef.id,
        folderId: String(folder.id),
        folderName: String(folder.name || ""),
        folderPath: String(folder.path || folder.folderPath || folder.name || ""),
        accessCodeHash,
        createdBy: String(createdBy || ""),
        createdAt: Timestamp.fromDate(now),
        lastActiveAt: Timestamp.fromDate(now),
        expiresAt,
        status: "ATIVA"
      },
      accessCode
    );
  },

  async touchDriveUploadSession(sessionId, accessCodeHash) {
    if (!sessionId) {
      throw new Error("Sessao de upload nao encontrada.");
    }

    if (!firebaseEnabled) {
      return localDb.touchDriveUploadSession(sessionId, accessCodeHash);
    }

    if (isFirebasePublicContext()) {
      const storedSession = readStoredJson(getDriveUploadSessionStorageKey(sessionId));
      if (!storedSession?.token) {
        throw new Error("Sessao de upload nao encontrada.");
      }
      const payload = await apiRequest("/api/drive-upload/touch", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${storedSession.token}`
        },
        body: { sessionId }
      });
      localStorage.setItem(
        getDriveUploadSessionStorageKey(sessionId),
        JSON.stringify({
          token: payload.sessionToken,
          expiresAt: payload.session?.expiresAt || ""
        })
      );
      return true;
    }

    const sessionRef = doc(db, COLLECTIONS.driveUploadSessions, sessionId);
    const sessionSnapshot = await getDoc(sessionRef);
    if (!sessionSnapshot.exists()) {
      throw new Error("Sessao de upload nao encontrada.");
    }
    const session = mapDriveUploadSession(sessionSnapshot.id, sessionSnapshot.data());
    if (session.status !== "ATIVA" || isDriveUploadSessionExpired(session)) {
      throw new Error("Este acesso temporario expirou. Gere um novo QR no Meu drive.");
    }
    if (String(session.accessCodeHash || "") !== String(accessCodeHash || "")) {
      throw new Error("Codigo de acesso invalido.");
    }

    await updateDoc(sessionRef, {
      lastActiveAt: Timestamp.now(),
      expiresAt: Timestamp.fromDate(addMinutes(new Date()))
    });
    return true;
  },

  async validateDriveUploadSession(sessionId, accessCode) {
    if (firebaseEnabled && isFirebasePublicContext()) {
      const payload = await apiRequest("/api/drive-upload/unlock", {
        method: "POST",
        body: { sessionId, accessCode }
      });
      localStorage.setItem(
        getDriveUploadSessionStorageKey(sessionId),
        JSON.stringify({
          token: payload.sessionToken,
          expiresAt: payload.session?.expiresAt || ""
        })
      );
      return payload.session;
    }

    const session = await this.getDriveUploadSession(sessionId);
    if (session.status !== "ATIVA" || session.isExpired) {
      throw new Error("Este acesso temporario expirou. Gere um novo QR no Meu drive.");
    }

    const accessCodeHash = await hashPin(String(accessCode || "").trim());
    if (accessCodeHash !== session.accessCodeHash) {
      throw new Error("Codigo de acesso invalido.");
    }

    await this.touchDriveUploadSession(sessionId, accessCodeHash);
    localStorage.setItem(`acms-drive-upload:${sessionId}`, accessCodeHash);
    return {
      ...(await this.getDriveUploadSession(sessionId)),
      accessCodeHash
    };
  },

  isDriveUploadSessionUnlocked(sessionId, session = null) {
    const storageKey = getDriveUploadSessionStorageKey(sessionId);
    if (firebaseEnabled && isFirebasePublicContext()) {
      const storedSession = readStoredJson(storageKey);
      if (!storedSession?.token) return false;
      if (!storedSession.expiresAt) return true;
      const expiresAt = new Date(storedSession.expiresAt);
      if (Number.isNaN(expiresAt.getTime())) return true;
      if (expiresAt.getTime() <= Date.now()) {
        localStorage.removeItem(storageKey);
        return false;
      }
      if (session && (session.status !== "ATIVA" || session.isExpired)) {
        localStorage.removeItem(storageKey);
        return false;
      }
      return true;
    }

    const storedHash = localStorage.getItem(storageKey);
    if (!storedHash) return false;
    if (!session) return true;
    if (session.status !== "ATIVA" || isDriveUploadSessionExpired(session)) return false;
    return storedHash === String(session.accessCodeHash || "");
  },

  lockDriveUploadSession(sessionId) {
    localStorage.removeItem(getDriveUploadSessionStorageKey(sessionId));
  },

  async listSessionAssets(sessionId) {
    if (!sessionId) return [];

    if (!firebaseEnabled) {
      return localDb.listSessionAssets(sessionId);
    }

    if (isFirebasePublicContext()) {
      const storedSession = readStoredJson(getDriveUploadSessionStorageKey(sessionId));
      if (!storedSession?.token) {
        throw new Error("Sessao de upload nao encontrada.");
      }
      const payload = await apiRequest(`/api/drive-upload/assets?sessionId=${encodeURIComponent(sessionId)}`, {
        headers: {
          Authorization: `Bearer ${storedSession.token}`
        }
      });
      return payload.assets || [];
    }

    const snapshot = await getDocs(query(collection(db, COLLECTIONS.fileAssets), where("uploadSessionId", "==", String(sessionId))));
    return sortByDateDesc(snapshot.docs.map((item) => mapFileAsset(item.id, item.data())), "createdAt").filter(
      (item) => !item.deletedAt
    );
  },

  async uploadFileAssetToSession(payload) {
    if (firebaseEnabled && isFirebasePublicContext()) {
      const storedSession = readStoredJson(getDriveUploadSessionStorageKey(payload.sessionId));
      if (!storedSession?.token) {
        throw new Error("Sessao de upload nao encontrada.");
      }

      const fileType = getFileAssetType(payload.file);
      if (!fileType) {
        throw new Error("Envie apenas imagem ou PDF.");
      }

      const preparedFile = await prepareFileForUpload(payload.file);
      const finalTitle = String(payload.title || preparedFile.name || payload.file.name || "").trim();
      if (!finalTitle) {
        throw new Error("Informe um titulo para o arquivo.");
      }

      const formData = new FormData();
      formData.append("sessionId", payload.sessionId);
      formData.append("title", finalTitle);
      formData.append("notes", String(payload.notes || "").trim());
      formData.append("file", preparedFile, preparedFile.name || payload.file.name || "arquivo");

      const response = await fetch("/api/drive-upload/upload", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${storedSession.token}`
        },
        body: formData
      });
      const result = await parseApiResponse(response);
      return result.asset;
    }

    const session = await this.getDriveUploadSession(payload.sessionId);
    if (session.status !== "ATIVA" || session.isExpired) {
      throw new Error("Este acesso temporario expirou. Gere um novo QR no Meu drive.");
    }

    const accessCodeHash = String(payload.accessCodeHash || "");
    if (accessCodeHash !== String(session.accessCodeHash || "")) {
      throw new Error("Codigo de acesso invalido.");
    }

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
      return localDb.uploadFileAssetToSession({
        ...payload,
        accessCodeHash,
        title: finalTitle,
        file: preparedFile
      });
    }

    if (!cloudinaryEnabled) {
      throw new Error("Configure o Cloudinary para enviar arquivos.");
    }

    const folderName = session.folderPath
      ? `acms-controle/${session.folderPath
          .split("/")
          .filter(Boolean)
          .map((segment) => segment.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, ""))
          .join("/")}`
      : "acms-controle/geral";

    const cloudinaryResult = await uploadToCloudinary(preparedFile, folderName);
    const record = {
      folderId: session.folderId,
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
      uploadedBy: `sessao:${payload.sessionId}`,
      createdAt: serverTimestamp(),
      uploadSessionId: payload.sessionId,
      uploadedViaSession: true,
      sessionEditable: true,
      sessionCodeHash: accessCodeHash
    };
    const docRef = await addDoc(collection(db, COLLECTIONS.fileAssets), record);
    await this.touchDriveUploadSession(payload.sessionId, accessCodeHash);
    return { id: docRef.id, ...record };
  },

  async renameSessionAsset(assetId, sessionId, accessCodeHash, title) {
    const normalizedTitle = String(title || "").trim();
    if (!normalizedTitle) {
      throw new Error("Informe o nome do arquivo.");
    }

    if (!firebaseEnabled) {
      return localDb.renameSessionAsset(assetId, sessionId, accessCodeHash, normalizedTitle);
    }

    if (isFirebasePublicContext()) {
      const storedSession = readStoredJson(getDriveUploadSessionStorageKey(sessionId));
      if (!storedSession?.token) {
        throw new Error("Sessao de upload nao encontrada.");
      }
      await apiRequest("/api/drive-upload/assets", {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${storedSession.token}`
        },
        body: {
          sessionId,
          assetId,
          title: normalizedTitle
        }
      });
      return true;
    }

    const assetRef = doc(db, COLLECTIONS.fileAssets, assetId);
    const assetSnapshot = await getDoc(assetRef);
    if (!assetSnapshot.exists()) {
      throw new Error("Arquivo nao encontrado.");
    }
    const asset = mapFileAsset(assetSnapshot.id, assetSnapshot.data());
    if (String(asset.uploadSessionId || "") !== String(sessionId) || asset.deletedAt) {
      throw new Error("Este arquivo nao pertence a esta sessao.");
    }
    if (String(asset.sessionCodeHash || "") !== String(accessCodeHash || "")) {
      throw new Error("Codigo de acesso invalido.");
    }

    await updateDoc(assetRef, { title: normalizedTitle });
    await this.touchDriveUploadSession(sessionId, accessCodeHash);
    return true;
  },

  async deleteSessionAsset(assetId, sessionId, accessCodeHash) {
    if (!firebaseEnabled) {
      return localDb.deleteSessionAsset(assetId, sessionId, accessCodeHash);
    }

    if (isFirebasePublicContext()) {
      const storedSession = readStoredJson(getDriveUploadSessionStorageKey(sessionId));
      if (!storedSession?.token) {
        throw new Error("Sessao de upload nao encontrada.");
      }
      await apiRequest(
        `/api/drive-upload/assets?sessionId=${encodeURIComponent(sessionId)}&assetId=${encodeURIComponent(assetId)}`,
        {
          method: "DELETE",
          headers: {
            Authorization: `Bearer ${storedSession.token}`
          }
        }
      );
      return true;
    }

    const assetRef = doc(db, COLLECTIONS.fileAssets, assetId);
    const assetSnapshot = await getDoc(assetRef);
    if (!assetSnapshot.exists()) {
      throw new Error("Arquivo nao encontrado.");
    }
    const asset = mapFileAsset(assetSnapshot.id, assetSnapshot.data());
    if (String(asset.uploadSessionId || "") !== String(sessionId) || asset.deletedAt) {
      throw new Error("Este arquivo nao pertence a esta sessao.");
    }
    if (String(asset.sessionCodeHash || "") !== String(accessCodeHash || "")) {
      throw new Error("Codigo de acesso invalido.");
    }

    await updateDoc(assetRef, { deletedAt: new Date().toISOString() });
    await this.touchDriveUploadSession(sessionId, accessCodeHash);
    return true;
  },

  async closeDriveUploadSession(sessionId) {
    if (!sessionId) return;

    if (!firebaseEnabled) {
      return localDb.closeDriveUploadSession(sessionId);
    }

    await updateDoc(doc(db, COLLECTIONS.driveUploadSessions, sessionId), { status: "ENCERRADA" });
    localStorage.removeItem(`acms-drive-upload:${sessionId}`);
    return true;
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

    const formData = new FormData();
    formData.append("folderId", String(payload.folderId || ""));
    formData.append("folderPath", String(payload.folderPath || ""));
    formData.append("title", finalTitle);
    formData.append("notes", String(payload.notes || "").trim());
    formData.append("uploadedBy", String(payload.uploadedBy || ""));
    formData.append("file", preparedFile, preparedFile.name || payload.file.name || "arquivo");

    const response = await fetch("/api/files/upload", {
      method: "POST",
      headers: await getTreasurerAuthHeaders(),
      body: formData
    });
    const result = await parseApiResponse(response);
    return result.asset;
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
    const headers = await getTreasurerAuthHeaders();
    const formData = new FormData();
    formData.append("advanceId", String(payload.advanceId || ""));
    formData.append("assistantId", String(payload.assistantId || ""));
    formData.append("assistantName", String(payload.assistantName || ""));
    formData.append("memberName", String(payload.memberName || ""));
    formData.append("amount", String(payload.amount || 0));
    formData.append("description", String(payload.description || ""));
    formData.append("advanceDescription", String(payload.advanceDescription || ""));
    formData.append("prazoDias", String(payload.prazoDias || 0));
    formData.append("dataLimite", String(payload.dataLimite || ""));
    if (payload.audioFile) {
      formData.append("audioFile", payload.audioFile, payload.audioFile.name || "audio.webm");
    }

    const response = await fetch("/api/authorizations", {
      method: "POST",
      headers,
      body: formData,
      cache: "no-store"
    });
    const result = await parseApiResponse(response);
    return result.authorization;
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
    const headers = await getTreasurerAuthHeaders();
    const formData = new FormData();
    formData.append("authorizationId", String(payload.authorizationId || ""));
    formData.append("advanceId", String(payload.advanceId || ""));
    formData.append("assistantId", String(payload.assistantId || ""));
    formData.append("assistantName", String(payload.assistantName || ""));
    formData.append("memberName", String(payload.memberName || ""));
    formData.append("amount", String(payload.amount || 0));
    formData.append("description", String(payload.description || ""));
    formData.append("advanceDescription", String(payload.advanceDescription || ""));
    formData.append("prazoDias", String(payload.prazoDias || 0));
    formData.append("dataLimite", String(payload.dataLimite || ""));
    formData.append("resent", resent ? "true" : "false");
    if (payload.audioFile) {
      formData.append("audioFile", payload.audioFile, payload.audioFile.name || "audio.webm");
    }

    const response = await fetch("/api/authorizations", {
      method: "POST",
      headers,
      body: formData,
      cache: "no-store"
    });
    const result = await parseApiResponse(response);
    return result.authorization;
  },

  async deleteAuthorization(authorizationId) {
    if (!firebaseEnabled) {
      return localDb.deleteAuthorization(authorizationId);
    }
    const headers = await getTreasurerAuthHeaders();
    await apiRequest("/api/authorizations", {
      method: "POST",
      headers,
      body: { authorizationId }
    });
    return true;
  },

  async getAssistantPortalAccess(assistantUser) {
    if (!assistantUser) {
      throw new Error("Cadastre um tesoureiro auxiliar para gerar o acesso.");
    }

    if (!firebaseEnabled) {
      return localDb.getAssistantPortalAccess(assistantUser);
    }

    const assistantDocRef = doc(db, COLLECTIONS.users, assistantUser.id);
    const assistantDocSnapshot = await getDoc(assistantDocRef);
    const latestAssistantUser = assistantDocSnapshot.exists()
      ? { id: assistantDocSnapshot.id, ...assistantDocSnapshot.data() }
      : assistantUser;
    const assistantAccessToken = getAssistantAccessToken(latestAssistantUser);
    const assistantPin = getAssistantPin(latestAssistantUser);
    const accessRef = doc(db, COLLECTIONS.assistantAccess, assistantAccessToken);
    const accessSnapshot = await getDoc(accessRef);
    const existingData = accessSnapshot.exists() ? accessSnapshot.data() : {};
    const assistantPinHash = await hashPin(assistantPin);
    const shouldResyncPin = String(existingData.pinHash || "") !== String(assistantPinHash || "");
    const nextUpdatedAt = shouldResyncPin ? new Date().toISOString() : existingData.updatedAt || new Date().toISOString();
    const pinHash = shouldResyncPin ? assistantPinHash : existingData.pinHash || assistantPinHash;
    await updateDoc(assistantDocRef, { accessToken: assistantAccessToken });
    await setDoc(
      accessRef,
      buildAssistantPortalRecord(latestAssistantUser, pinHash, {
        failedAttempts: shouldResyncPin ? 0 : Number(existingData.failedAttempts || 0),
        isBlocked: shouldResyncPin ? false : Boolean(existingData.isBlocked),
        blockedAt: shouldResyncPin ? "" : existingData.blockedAt || "",
        updatedAt: nextUpdatedAt
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

    return buildAssistantPortalResponse(latestAssistantUser, {
      ...existingData,
      pinHash,
      failedAttempts: shouldResyncPin ? 0 : Number(existingData.failedAttempts || 0),
      isBlocked: shouldResyncPin ? false : Boolean(existingData.isBlocked),
      blockedAt: shouldResyncPin ? "" : existingData.blockedAt || "",
      updatedAt: nextUpdatedAt
    });
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

    const headers = await getTreasurerAuthHeaders();
    const payload = await apiRequest("/api/assistant/pin", {
      method: "POST",
      headers,
      body: {
        assistantId: assistantUser.id,
        assistantName: assistantUser.nome,
        pin: normalizedPin
      }
    });

    localStorage.removeItem(`acms-assistant-unlocked:${assistantAccessToken}`);
    window.dispatchEvent(new CustomEvent("acms-assistant-public-updated"));

    return this.getAssistantPortalAccess({
      ...assistantUser,
      pin: normalizedPin
    });
  },

  async getPublicAdvanceSettings() {
    if (!firebaseEnabled) {
      return localDb.getPublicAdvanceSettings();
    }

    const headers = await getTreasurerAuthHeaders();
    const payload = await apiRequest("/api/advances?mode=settings", {
      headers
    });
    return payload.settings;
  },

  async updatePublicAdvanceSettings(accessCode) {
    const normalizedCode = normalizePublicAdvanceAccessCode(accessCode);
    if (normalizedCode.length < 3) {
      throw new Error("Informe um codigo de pelo menos 3 numeros.");
    }

    if (!firebaseEnabled) {
      return localDb.updatePublicAdvanceSettings(normalizedCode);
    }

    const headers = await getTreasurerAuthHeaders();
    const payload = await apiRequest("/api/advances", {
      method: "POST",
      headers,
      body: {
        action: "settings",
        accessCode: normalizedCode
      }
    });
    window.dispatchEvent(new CustomEvent("acms-public-advance-updated"));
    return payload.settings;
  },

  async unlockPublicAdvance(token, accessCode) {
    const normalizedToken = String(token || "").trim();

    if (!firebaseEnabled) {
      return localDb.unlockPublicAdvance(normalizedToken, accessCode);
    }

    const payload = await apiRequest("/api/advances", {
      method: "POST",
      body: {
        action: "unlock",
        token: normalizedToken,
        accessCode
      }
    });

    localStorage.setItem(
      getPublicAdvanceSessionStorageKey(normalizedToken),
      JSON.stringify({
        token: payload.sessionToken,
        sessionVersion: payload.sessionVersion || ""
      })
    );

    return payload;
  },

  async getPublicAdvanceData(token) {
    const normalizedToken = String(token || "").trim();

    if (!firebaseEnabled) {
      return localDb.getPublicAdvanceData(normalizedToken);
    }

    const storedSession = readStoredJson(getPublicAdvanceSessionStorageKey(normalizedToken));
    if (!storedSession?.token) {
      throw new Error("Digite o codigo de acesso para abrir este link.");
    }

    try {
      return await apiRequest(`/api/advances?mode=public&token=${encodeURIComponent(normalizedToken)}`, {
        headers: {
          Authorization: `Bearer ${storedSession.token}`
        }
      });
    } catch (error) {
      localStorage.removeItem(getPublicAdvanceSessionStorageKey(normalizedToken));
      throw error;
    }
  },

  isPublicAdvanceUnlocked(token = "", sessionVersion = "") {
    const normalizedToken = String(token || "").trim();
    if (!firebaseEnabled) {
      return localDb.isPublicAdvanceUnlocked(normalizedToken, sessionVersion);
    }

    const storedSession = readStoredJson(getPublicAdvanceSessionStorageKey(normalizedToken));
    if (!storedSession?.token) return false;
    if (!sessionVersion) return true;
    if (storedSession.sessionVersion !== String(sessionVersion || "")) {
      localStorage.removeItem(getPublicAdvanceSessionStorageKey(normalizedToken));
      return false;
    }
    return true;
  },

  lockPublicAdvance(token = "") {
    const normalizedToken = String(token || "").trim();
    if (!firebaseEnabled) {
      localDb.lockPublicAdvance(normalizedToken);
      return;
    }
    localStorage.removeItem(getPublicAdvanceSessionStorageKey(normalizedToken));
  },

  async markAuthorizationDelivered(authorization, accessToken = "") {
    if (!firebaseEnabled) {
      return localDb.markAuthorizationDelivered(authorization.id);
    }
    if (isFirebasePublicContext()) {
      const storedSession = readStoredJson(getAssistantSessionStorageKey(accessToken || ASSISTANT_PORTAL_ID));
      if (!storedSession?.token) {
        throw new Error("Sessao do auxiliar nao encontrada.");
      }
      await apiRequest("/api/assistant/orders", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${storedSession.token}`
        },
        body: {
          action: "delivered",
          orderId: authorization.authorizationId || authorization.id
        }
      });
      window.dispatchEvent(new CustomEvent("acms-assistant-public-updated"));
      return true;
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
    await apiRequest("/api/advances", {
      method: "POST",
      headers: await getTreasurerAuthHeaders(),
      body: {
        action: "delete",
        advanceId
      }
    });
  },

  subscribeAssistantAccess(token, callback) {
    if (!firebaseEnabled) {
      return localDb.subscribeAssistantAccess(token, callback);
    }
    const resolvedToken = token || ASSISTANT_PORTAL_ID;
    if (shouldUseAssistantPortalApi(resolvedToken) || isFirebasePublicContext()) {
      let active = true;

      const emit = async () => {
        try {
          const portalPayload = await apiRequest("/api/assistant/public");
          const assistantUser = portalPayload.portal?.configured ? mapPublicAssistantPortal(portalPayload.portal) : null;
          let authorizations = [];
          const storedSession = readStoredJson(getAssistantSessionStorageKey(resolvedToken));
          if (storedSession?.token && assistantUser && !assistantUser.isBlocked) {
            try {
              const ordersPayload = await apiRequest("/api/assistant/orders", {
                headers: {
                  Authorization: `Bearer ${storedSession.token}`
                }
              });
              authorizations = ordersPayload.authorizations || [];
            } catch (error) {
              localStorage.removeItem(getAssistantSessionStorageKey(resolvedToken));
              if (!active) return;
            }
          }

          if (active) {
            callback({
              assistantUser,
              authorizations
            });
          }
        } catch {
          if (active) {
            callback({
              assistantUser: null,
              authorizations: []
            });
          }
        }
      };

      emit();
      const onRefresh = () => emit();
      window.addEventListener("acms-assistant-public-updated", onRefresh);
      const timer = window.setInterval(emit, 15000);
      return () => {
        active = false;
        window.removeEventListener("acms-assistant-public-updated", onRefresh);
        window.clearInterval(timer);
      };
    }
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
    const resolvedToken = token || ASSISTANT_PORTAL_ID;
    if (firebaseEnabled && (shouldUseAssistantPortalApi(resolvedToken) || isFirebasePublicContext())) {
      const payload = await apiRequest("/api/assistant/unlock", {
        method: "POST",
        body: { pin }
      });
      localStorage.setItem(
        getAssistantSessionStorageKey(resolvedToken),
        JSON.stringify({
          token: payload.sessionToken,
          sessionVersion: payload.portal?.sessionVersion || "",
          assistantId: payload.portal?.assistantId || assistantUser.id || ""
        })
      );
      window.dispatchEvent(new CustomEvent("acms-assistant-public-updated"));
      return true;
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
      getAssistantSessionStorageKey(token || assistantUser.accessToken || ASSISTANT_PORTAL_ID),
      String(assistantUser.updatedAt || "ok")
    );
    return true;
  },

  isAssistantUnlocked(token = ASSISTANT_PORTAL_ID, assistantUser = null) {
    if (firebaseEnabled && (shouldUseAssistantPortalApi(token) || isFirebasePublicContext())) {
      if (assistantUser?.isBlocked) return false;
      const storedValue = readStoredJson(getAssistantSessionStorageKey(token));
      if (!storedValue?.token) return false;
      if (!assistantUser?.sessionVersion) return true;
      if (storedValue.sessionVersion !== String(assistantUser.sessionVersion)) {
        localStorage.removeItem(getAssistantSessionStorageKey(token));
        return false;
      }
      return true;
    }
    if (assistantUser?.isBlocked) return false;
    const storedValue = localStorage.getItem(getAssistantSessionStorageKey(token));
    if (!storedValue) return false;
    if (!assistantUser?.updatedAt) return Boolean(storedValue);
    return storedValue === String(assistantUser.updatedAt);
  },

  lockAssistant(token = ASSISTANT_PORTAL_ID) {
    localStorage.removeItem(getAssistantSessionStorageKey(token));
  }
};
