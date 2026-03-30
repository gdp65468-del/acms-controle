import { onAuthStateChanged, signInWithPopup, signOut } from "firebase/auth";
import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
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
  fileFolders: "pastas_arquivos",
  fileAssets: "arquivos"
};

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
      memberName: payload.memberName,
      amount: Number(payload.amount),
      description: payload.description,
      createdAt: serverTimestamp(),
      status: "AUTORIZADO",
      audioUrl,
      audioName,
      deliveredAt: ""
    };
    const docRef = await addDoc(collection(db, COLLECTIONS.authorizations), record);
    await saveHistory(payload.advanceId, "REPASSE_AUTORIZADO", "Repasse autorizado para o tesoureiro auxiliar.");
    return { id: docRef.id, ...record };
  },

  async markAuthorizationDelivered(authorization) {
    if (!firebaseEnabled) {
      return localDb.markAuthorizationDelivered(authorization.id);
    }
    await updateDoc(doc(db, COLLECTIONS.authorizations, authorization.id), {
      status: "ENTREGUE",
      deliveredAt: new Date().toISOString()
    });
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
    authorizationSnapshot.forEach((item) => batch.delete(item.ref));
    batch.delete(doc(db, COLLECTIONS.advances, advanceId));
    await batch.commit();
  },

  async unlockAssistant(pin, assistantUser) {
    if (!assistantUser) {
      throw new Error("Nenhum usuario auxiliar configurado.");
    }
    const expectedPin = getAssistantPin(assistantUser);
    if (String(pin) !== expectedPin) {
      throw new Error("PIN invalido.");
    }
    localStorage.setItem("acms-assistant-unlocked", "true");
    return true;
  },

  isAssistantUnlocked() {
    return localStorage.getItem("acms-assistant-unlocked") === "true";
  },

  lockAssistant() {
    localStorage.removeItem("acms-assistant-unlocked");
  }
};
