import { getAdminDb, Timestamp } from "../_lib/firebaseAdmin.js";
import { requireTreasurer } from "../_lib/auth.js";
import { readJsonBody, requireMethod, sendError, sendJson } from "../_lib/http.js";

export default async function handler(req, res) {
  if (!requireMethod(req, res, "POST")) return;

  try {
    await requireTreasurer(req);
    const { authorizationId } = await readJsonBody(req);
    const normalizedId = String(authorizationId || "");
    if (!normalizedId) {
      throw new Error("Repasse nao encontrado.");
    }

    const adminDb = getAdminDb();
    const authorizationRef = adminDb.collection("autorizacoes_repasse").doc(normalizedId);
    const authorizationSnapshot = await authorizationRef.get();
    if (!authorizationSnapshot.exists) {
      throw new Error("Repasse nao encontrado.");
    }

    const authorization = authorizationSnapshot.data() || {};
    const assistantAccessToken = String(authorization.assistantAccessToken || "principal");

    await authorizationRef.delete();
    await adminDb.collection("acesso_auxiliar").doc(assistantAccessToken).collection("ordens").doc(normalizedId).delete();
    await adminDb.collection("historico_eventos").add({
      advanceId: String(authorization.advanceId || ""),
      type: "REPASSE_EXCLUIDO",
      message: "Repasse removido da area do auxiliar.",
      createdAt: Timestamp.now()
    });

    sendJson(res, 200, { ok: true });
  } catch (error) {
    sendError(res, 400, error.message || "Nao foi possivel excluir o repasse.");
  }
}
