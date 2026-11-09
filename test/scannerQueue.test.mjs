import assert from "node:assert/strict";
import test from "node:test";

const records = new Map();
let upgraded = false;

function fakeDb() {
  return {
    objectStoreNames: { contains: () => upgraded },
    createObjectStore() {},
    close() {},
    transaction() {
      const transaction = { oncomplete: null, onerror: null, error: null };
      const request = (operation) => {
        const result = {};
        queueMicrotask(() => {
          try {
            result.result = operation();
            result.onsuccess?.({ target: result });
            queueMicrotask(() => transaction.oncomplete?.({ target: transaction }));
          } catch (error) {
            result.error = error;
            result.onerror?.({ target: result });
            transaction.error = error;
            transaction.onerror?.({ target: transaction });
          }
        });
        return result;
      };
      transaction.objectStore = () => ({
        getAll: () => request(() => [...records.values()].map((item) => ({ ...item }))),
        get: (id) => request(() => (records.has(id) ? { ...records.get(id) } : undefined)),
        put: (item) => request(() => {
          records.set(item.id, { ...item });
          return item.id;
        }),
        delete: (id) => request(() => records.delete(id))
      });
      return transaction;
    }
  };
}

globalThis.window = {
  indexedDB: {
    open() {
      const request = {};
      queueMicrotask(() => {
        request.result = fakeDb();
        if (!upgraded) {
          request.onupgradeneeded?.({ target: request });
          upgraded = true;
        }
        request.onsuccess?.({ target: request });
      });
      return request;
    }
  },
  addEventListener() {},
  setTimeout
};
globalThis.indexedDB = globalThis.window.indexedDB;
Object.defineProperty(globalThis, "navigator", { value: { onLine: true }, configurable: true });

const queue = await import("../src/services/scannerQueue.js");

function capture(id, ownerUid, sessionId = "session") {
  return {
    id,
    ownerUid,
    folderId: "folder",
    folderPath: "Pasta",
    sessionId,
    fileName: `${id}.jpg`,
    blob: new Blob(["jpeg"], { type: "image/jpeg" }),
    createdAt: new Date().toISOString()
  };
}

async function waitFor(predicate, timeoutMs = 1500) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Tempo esgotado aguardando a fila.");
}

test("fila limita concorrencia, confirma somente apos upload e evita duplicacao local", async () => {
  let active = 0;
  let maxActive = 0;
  await queue.startScannerQueue("owner-a", async (item) => {
    active += 1;
    maxActive = Math.max(maxActive, active);
    await new Promise((resolve) => setTimeout(resolve, 15));
    active -= 1;
    return { id: `asset-${item.id}` };
  });

  await queue.enqueueScannerCapture(capture("capture-1", "owner-a"));
  await queue.enqueueScannerCapture(capture("capture-1", "owner-a", "other-session"));
  await Promise.all(["capture-2", "capture-3", "capture-4", "capture-5"].map((id) => queue.enqueueScannerCapture(capture(id, "owner-a"))));

  await waitFor(async () => (await queue.listScannerCaptures("owner-a", "folder", "session")).filter((item) => item.status === "saved").length === 5);
  const saved = await queue.listScannerCaptures("owner-a", "folder", "session");
  assert.equal(saved.length, 5);
  assert.ok(maxActive <= 2);
  assert.ok(saved.every((item) => item.blob === null && item.assetId));
});

test("falha fica pendente, reenvio manual reinicia tentativas e respeita o dono", async () => {
  let shouldFail = true;
  await queue.startScannerQueue("owner-b", async (item) => {
    if (shouldFail) {
      shouldFail = false;
      navigator.onLine = false;
      throw new Error("Falha temporaria");
    }
    return { id: `asset-${item.id}` };
  });
  navigator.onLine = true;
  await queue.enqueueScannerCapture(capture("capture-error", "owner-b"));

  await waitFor(async () => (await queue.listScannerCaptures("owner-b", "folder", "session")).some((item) => item.status === "error"));
  assert.equal(await queue.retryScannerCapture("capture-error", "owner-other"), false);

  navigator.onLine = true;
  await queue.startScannerQueue("owner-b", async (item) => ({ id: `asset-${item.id}` }));
  assert.equal(await queue.retryScannerCapture("capture-error", "owner-b"), true);
  await waitFor(async () => (await queue.listScannerCaptures("owner-b", "folder", "session")).some((item) => item.status === "saved"));
});

test("uma nova instancia recupera upload interrompido e confirma a substituicao somente no fim", async () => {
  await queue.startScannerQueue("owner-c", () => new Promise(() => {}));
  await queue.enqueueScannerCapture(capture("capture-recovery", "owner-c", "recovery"));
  await waitFor(async () => (await queue.listScannerCaptures("owner-c", "folder", "recovery")).some((item) => item.status === "uploading"));

  const recoveredQueue = await import(`../src/services/scannerQueue.js?recovery=${Date.now()}`);
  await recoveredQueue.startScannerQueue("owner-c", async (item) => ({ id: `asset-${item.id}` }));
  await waitFor(async () => (await recoveredQueue.listScannerCaptures("owner-c", "folder", "recovery")).some((item) => item.status === "saved"));

  await recoveredQueue.startScannerQueue("owner-d", async (item) => ({ id: `asset-${item.id}` }));
  await recoveredQueue.enqueueScannerCapture(capture("capture-original", "owner-d", "replacement"));
  await waitFor(async () => (await recoveredQueue.listScannerCaptures("owner-d", "folder", "replacement")).some((item) => item.id === "capture-original" && item.status === "saved"));
  await recoveredQueue.enqueueScannerCapture({ ...capture("capture-new", "owner-d", "replacement"), replaceAssetId: "capture-original" });
  await waitFor(async () => {
    const items = await recoveredQueue.listScannerCaptures("owner-d", "folder", "replacement");
    return items.some((item) => item.id === "capture-new" && item.status === "saved") && items.some((item) => item.id === "capture-original" && item.status === "replaced");
  });
});
