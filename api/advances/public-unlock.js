import { unlockPublicAdvanceLink } from "../_lib/publicAdvances.js";
import { readJsonBody, requireMethod, sendError, sendJson } from "../_lib/http.js";

export default async function handler(req, res) {
  if (!requireMethod(req, res, "POST")) return;

  try {
    const body = await readJsonBody(req);
    const result = await unlockPublicAdvanceLink(body.token, body.accessCode);
    sendJson(res, 200, { ok: true, ...result });
  } catch (error) {
    sendError(res, 400, error.message || "Nao foi possivel validar o codigo do link publico.");
  }
}
