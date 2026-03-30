import { touchDriveUploadSessionPublic } from "../_lib/driveUpload.js";
import { getBearerToken, readJsonBody, requireMethod, sendError, sendJson } from "../_lib/http.js";

export default async function handler(req, res) {
  if (!requireMethod(req, res, "POST")) return;

  const sessionToken = getBearerToken(req);
  if (!sessionToken) {
    sendError(res, 401, "Sessao de upload nao encontrada.");
    return;
  }

  try {
    const body = await readJsonBody(req);
    const result = await touchDriveUploadSessionPublic(sessionToken, body.sessionId);
    sendJson(res, 200, { ok: true, ...result });
  } catch (error) {
    sendError(res, 400, error.message || "Nao foi possivel renovar esta sessao.");
  }
}
