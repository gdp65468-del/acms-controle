import { getAdminDb, Timestamp } from "../_lib/firebaseAdmin.js";
import { requireTreasurer } from "../_lib/auth.js";
import {
  getPublicAdvanceSettings,
  getUnlockedPublicAdvanceData,
  savePublicAdvanceSettings,
  unlockPublicAdvanceLink
} from "../_lib/publicAdvances.js";
import { getBearerToken, readJsonBody, requireMethod, sendError, sendJson } from "../_lib/http.js";

function computeServerAdvanceStatus(advance) {
  const total = Number(advance.totalComprovado || 0);
  const value = Number(advance.valor || 0);
  if (total >= value && value > 0) return "PRESTADO";
  if (String(advance.justificativa || "").trim()) return "JUSTIFICADO";
  const dueDate = typeof advance.dataLimite?.toDate === "function"
    ? advance.dataLimite.toDate()
    : new Date(advance.dataLimite || 0);
  return !Number.isNaN(dueDate.getTime()) && dueDate < new Date() ? "ATRASADO" : "PENDENTE";
}

function canTrashAdvance(advance) {
  return !advance.deletedAt
    && !advance.lancadoAcms
    && ["PENDENTE", "ATRASADO"].includes(computeServerAdvanceStatus(advance));
}

async function handleTrashAdvances(req, res) {
  const actor = await requireTreasurer(req);
  const adminDb = getAdminDb();
  const body = await readJsonBody(req);
  const advanceIds = [...new Set((Array.isArray(body.advanceIds) ? body.advanceIds : [body.advanceId]).map((id) => String(id || "").trim()).filter(Boolean))].slice(0, 100);

  if (!advanceIds.length) {
    sendError(res, 400, "Adiantamento nao informado.");
    return;
  }

  const snapshots = await Promise.all(advanceIds.map((id) => adminDb.collection("adiantamentos").doc(id).get()));
  const batch = adminDb.batch();
  const trashed = [];
  const rejected = [];
  const now = new Date().toISOString();
  snapshots.forEach((snapshot, index) => {
    const id = advanceIds[index];
    if (!snapshot.exists) {
      rejected.push({ id, reason: "Adiantamento nao encontrado." });
      return;
    }
    const advance = snapshot.data() || {};
    if (!canTrashAdvance(advance)) {
      rejected.push({ id, reason: "Registro prestado, justificado, ja lancado no ACMS ou ja enviado para a lixeira." });
      return;
    }
    const advanceRef = adminDb.collection("adiantamentos").doc(id);
    batch.update(advanceRef, {
      deletedAt: now,
      deletedBy: actor.uid,
      deletedByName: actor.profile?.nome || actor.email || "Tesouraria",
      deletedReason: "Movido para a lixeira pela tesouraria."
    });
    const historyRef = adminDb.collection("historico_eventos").doc();
    batch.set(historyRef, {
      advanceId: id,
      type: "ADIANTAMENTO_ENVIADO_LIXEIRA",
      message: "Adiantamento movido para a lixeira pela tesouraria.",
      createdAt: Timestamp.now(),
      createdBy: actor.uid
    });
    trashed.push(id);
  });
  if (trashed.length) await batch.commit();
  sendJson(res, 200, { ok: true, trashed, rejected });
}

async function handleRestoreAdvances(req, res) {
  const actor = await requireTreasurer(req);
  const adminDb = getAdminDb();
  const body = await readJsonBody(req);
  const advanceIds = [...new Set((Array.isArray(body.advanceIds) ? body.advanceIds : [body.advanceId]).map((id) => String(id || "").trim()).filter(Boolean))].slice(0, 100);
  if (!advanceIds.length) {
    sendError(res, 400, "Adiantamento nao informado.");
    return;
  }
  const batch = adminDb.batch();
  const restored = [];
  const rejected = [];
  const snapshots = await Promise.all(advanceIds.map((id) => adminDb.collection("adiantamentos").doc(id).get()));
  snapshots.forEach((snapshot, index) => {
    const id = advanceIds[index];
    if (!snapshot.exists) {
      rejected.push({ id, reason: "Adiantamento nao encontrado." });
      return;
    }
    if (!snapshot.data()?.deletedAt) {
      rejected.push({ id, reason: "Este adiantamento nao esta na lixeira." });
      return;
    }
    batch.update(snapshot.ref, {
      deletedAt: "",
      deletedBy: "",
      deletedByName: "",
      deletedReason: ""
    });
    const historyRef = adminDb.collection("historico_eventos").doc();
    batch.set(historyRef, {
      advanceId: id,
      type: "ADIANTAMENTO_RESTAURADO",
      message: "Adiantamento restaurado pela tesouraria.",
      createdAt: Timestamp.now(),
      createdBy: actor.uid
    });
    restored.push(id);
  });
  if (restored.length) await batch.commit();
  sendJson(res, 200, { ok: true, restored, rejected });
}

export default async function handler(req, res) {
  if (!requireMethod(req, res, ["GET", "POST"])) return;

  try {
    if (req.method === "GET") {
      const mode = String(req.query?.mode || "").trim();

      if (mode === "settings") {
        await requireTreasurer(req);
        const settings = await getPublicAdvanceSettings();
        sendJson(res, 200, { ok: true, settings });
        return;
      }

      if (mode === "public") {
        const token = String(req.query?.token || "");
        const sessionToken = getBearerToken(req);
        if (!sessionToken) {
          sendError(res, 401, "Digite o codigo de acesso para abrir este link.");
          return;
        }

        const result = await getUnlockedPublicAdvanceData(token, sessionToken);
        sendJson(res, 200, { ok: true, ...result });
        return;
      }

      sendError(res, 400, "Operacao de consulta nao reconhecida.");
      return;
    }

    const body = await readJsonBody(req);
    const action = String(body.action || "").trim();

    if (action === "delete" || action === "trash" || action === "bulkTrash") {
      await handleTrashAdvances(req, res);
      return;
    }

    if (action === "restore" || action === "bulkRestore") {
      await handleRestoreAdvances(req, res);
      return;
    }

    if (action === "settings") {
      await requireTreasurer(req);
      const settings = await savePublicAdvanceSettings(body.accessCode);
      sendJson(res, 200, { ok: true, settings });
      return;
    }

    if (action === "unlock") {
      const result = await unlockPublicAdvanceLink(body.token, body.accessCode);
      sendJson(res, 200, { ok: true, ...result });
      return;
    }

    sendError(res, 400, "Operacao nao reconhecida.");
  } catch (error) {
    sendError(res, 400, error.message || "Nao foi possivel concluir a operacao de adiantamento.");
  }
}
