const DB_NAME = "acms-scanner-queue";
const STORE_NAME = "captures";
const MAX_UPLOADS = 2;
const METADATA_RETENTION_MS = 24 * 60 * 60 * 1000;
const listeners = new Set();
const activeIds = new Set();
const uploadersByOwner = new Map();
let activeOwner = "";
let pumpScheduled = false;

function openDb() {
  if (!window.indexedDB) {
    return Promise.reject(new Error("Este navegador nao permite guardar capturas pendentes neste dispositivo."));
  }
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        request.result.createObjectStore(STORE_NAME, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("Nao foi possivel abrir a fila local."));
  });
}

async function transact(mode, action) {
  const db = await openDb();
  try {
    return await new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, mode);
      const request = action(transaction.objectStore(STORE_NAME));
      let result;
      request.onsuccess = () => { result = request.result; };
      request.onerror = () => reject(request.error || new Error("Falha na fila local."));
      transaction.onerror = () => reject(transaction.error || new Error("Falha na fila local."));
      transaction.oncomplete = () => resolve(result);
    });
  } finally {
    db.close();
  }
}

async function getAll() {
  return transact("readonly", (store) => store.getAll());
}

async function get(id) {
  return transact("readonly", (store) => store.get(id));
}

async function put(item) {
  await transact("readwrite", (store) => store.put(item));
  listeners.forEach((listener) => listener());
}

async function remove(id) {
  await transact("readwrite", (store) => store.delete(id));
  listeners.forEach((listener) => listener());
}

async function pruneCompletedCaptures(ownerUid) {
  const expiration = Date.now() - METADATA_RETENTION_MS;
  const items = await getAll();
  const expiredIds = items
    .filter((item) => item.ownerUid === ownerUid)
    .filter((item) => ["saved", "replaced"].includes(item.status))
    .filter((item) => new Date(item.savedAt || item.createdAt || 0).getTime() < expiration)
    .map((item) => item.id);

  await Promise.all(expiredIds.map((id) => remove(id)));
}

function schedulePump() {
  if (pumpScheduled) return;
  pumpScheduled = true;
  queueMicrotask(async () => {
    pumpScheduled = false;
    try {
      await pump();
    } catch (error) {
      console.error("Nao foi possivel processar a fila do scanner.", error);
    }
  });
}

async function uploadOne(item, uploader) {
  activeIds.add(item.id);
  try {
    const latest = await get(item.id);
    if (!latest || latest.status !== "queued") return;
    if (!(latest.blob instanceof Blob)) {
      await put({
        ...latest,
        status: "error",
        nextAttemptAt: 0,
        error: "A foto pendente nao esta mais disponivel neste navegador. Fotografe novamente."
      });
      return;
    }
    await put({ ...latest, status: "uploading", attempts: Number(latest.attempts || 0) + 1, error: "" });
    const result = await uploader(latest);
    const current = await get(item.id);
    if (current) {
      await put({
        ...current,
        status: "saved",
        blob: null,
        assetId: result.id,
        savedAt: new Date().toISOString(),
        error: ""
      });
      if (current.replaceAssetId) {
        const previous = await get(current.replaceAssetId);
        if (previous) await put({ ...previous, status: "replaced" });
      }
    }
  } catch (error) {
    const current = await get(item.id);
    if (current) {
      const attempts = Number(current.attempts || 0);
      const retry = attempts < 3 && navigator.onLine;
      const retryDelay = attempts * 2000;
      await put({
        ...current,
        status: retry ? "queued" : "error",
        nextAttemptAt: retry ? Date.now() + retryDelay : 0,
        error: error?.message || "Falha ao enviar. Toque em Reenviar."
      });
      if (retry) window.setTimeout(schedulePump, retryDelay);
    }
  } finally {
    activeIds.delete(item.id);
    schedulePump();
  }
}

async function pump() {
  const uploader = uploadersByOwner.get(activeOwner);
  if (!uploader || !activeOwner || !navigator.onLine) return;
  const items = (await getAll())
    .filter((item) => item.ownerUid === activeOwner && item.status === "queued" && !activeIds.has(item.id))
    .filter((item) => Number(item.nextAttemptAt || 0) <= Date.now())
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  const available = Math.max(0, MAX_UPLOADS - activeIds.size);
  items.slice(0, available).forEach((item) => void uploadOne(item, uploader));
}

export async function startScannerQueue(ownerUid, uploader) {
  activeOwner = ownerUid;
  uploadersByOwner.set(ownerUid, uploader);
  const items = await getAll();
  for (const item of items) {
    if (item.ownerUid === ownerUid && item.status === "uploading" && !activeIds.has(item.id)) {
      await put({ ...item, status: "queued" });
    }
  }
  await pruneCompletedCaptures(ownerUid);
  schedulePump();
}

export function subscribeScannerQueue(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export async function listScannerCaptures(ownerUid, folderId, sessionId = "") {
  return (await getAll())
    .filter((item) => item.ownerUid === ownerUid && item.folderId === folderId)
    .filter((item) => !sessionId || item.sessionId === sessionId || ["queued", "uploading", "error"].includes(item.status))
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
}

export async function enqueueScannerCapture(item) {
  const existing = await get(item.id);
  if (existing) return existing;
  const queuedItem = { ...item, status: "queued", attempts: 0, error: "" };
  await put(queuedItem);
  schedulePump();
  return queuedItem;
}

export async function retryScannerCapture(id, ownerUid) {
  const item = await get(id);
  if (!item || item.ownerUid !== ownerUid || item.status !== "error") return false;
  await put({ ...item, status: "queued", attempts: 0, nextAttemptAt: 0, error: "" });
  schedulePump();
  return true;
}

export async function discardQueuedScannerCapture(id, ownerUid) {
  const item = await get(id);
  if (!item || item.ownerUid !== ownerUid || !["queued", "error"].includes(item.status) || activeIds.has(id)) return false;
  await remove(id);
  return true;
}

window.addEventListener("online", schedulePump);
