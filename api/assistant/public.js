import { getAssistantPortalPublicState } from "../_lib/assistant.js";
import { requireMethod, sendError, sendJson } from "../_lib/http.js";

export default async function handler(req, res) {
  if (!requireMethod(req, res, "GET")) return;

  try {
    const portal = await getAssistantPortalPublicState();
    sendJson(res, 200, { ok: true, portal });
  } catch (error) {
    sendError(res, 500, error.message || "Nao foi possivel carregar o portal do auxiliar.");
  }
}
