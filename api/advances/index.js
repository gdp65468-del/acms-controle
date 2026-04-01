import { getAdminDb } from "../_lib/firebaseAdmin.js";
import { requireTreasurer } from "../_lib/auth.js";
import {
  getPublicAdvanceSettings,
  getUnlockedPublicAdvanceData,
  savePublicAdvanceSettings,
  unlockPublicAdvanceLink
} from "../_lib/publicAdvances.js";
import { getBearerToken, readJsonBody, requireMethod, sendError, sendJson } from "../_lib/http.js";

async function handleDeleteAdvance(req, res) {
  await requireTreasurer(req);
  const adminDb = getAdminDb();
  const body = await readJsonBody(req);
  const advanceId = String(body.advanceId || "").trim();

  if (!advanceId) {
    sendError(res, 400, "Adiantamento nao informado.");
    return;
  }

  const advanceRef = adminDb.collection("adiantamentos").doc(advanceId);
  const advanceSnapshot = await advanceRef.get();
  if (!advanceSnapshot.exists) {
    sendError(res, 404, "Adiantamento nao encontrado.");
    return;
  }

  const historySnapshot = await adminDb.collection("historico_eventos").where("advanceId", "==", advanceId).get();
  const authorizationSnapshot = await adminDb.collection("autorizacoes_repasse").where("advanceId", "==", advanceId).get();

  const batch = adminDb.batch();
  historySnapshot.forEach((docSnap) => batch.delete(docSnap.ref));
  authorizationSnapshot.forEach((docSnap) => {
    batch.delete(docSnap.ref);
    const authorization = docSnap.data() || {};
    const accessToken = String(authorization.assistantAccessToken || "principal");
    batch.delete(adminDb.collection("acesso_auxiliar").doc(accessToken).collection("ordens").doc(docSnap.id));
  });
  batch.delete(advanceRef);
  await batch.commit();

  sendJson(res, 200, { ok: true });
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

    if (action === "delete") {
      await handleDeleteAdvance(req, res);
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
