import { getDriveUploadSessionPublicState } from "../_lib/driveUpload.js";
import { requireMethod, sendError, sendJson } from "../_lib/http.js";

export default async function handler(req, res) {
  if (!requireMethod(req, res, "GET")) return;

  try {
    const sessionId = String(req.query.sessionId || "");
    const session = await getDriveUploadSessionPublicState(sessionId);
    sendJson(res, 200, { ok: true, session });
  } catch (error) {
    sendError(res, 400, error.message || "Nao foi possivel carregar esta sessao.");
  }
}
