import { getAdminDb } from "../_lib/firebaseAdmin.js";
import { requireTreasurer } from "../_lib/auth.js";
import { readJsonBody, requireMethod, sendError, sendJson } from "../_lib/http.js";

export default async function handler(req, res) {
  if (!requireMethod(req, res, "POST")) return;

  try {
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
  } catch (error) {
    sendError(res, 400, error.message || "Nao foi possivel excluir o adiantamento.");
  }
}
