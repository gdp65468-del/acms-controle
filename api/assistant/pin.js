import { requireTreasurer } from "../_lib/auth.js";
import { readJsonBody, requireMethod, sendError, sendJson } from "../_lib/http.js";
import { saveAssistantPortalPin } from "../_lib/assistant.js";

export default async function handler(req, res) {
  if (!requireMethod(req, res, "POST")) return;

  try {
    await requireTreasurer(req);
    const body = await readJsonBody(req);
    const result = await saveAssistantPortalPin({
      assistantId: body.assistantId,
      assistantName: body.assistantName,
      pin: body.pin
    });
    sendJson(res, 200, { ok: true, assistant: result });
  } catch (error) {
    sendError(res, 400, error.message || "Nao foi possivel salvar o PIN do auxiliar.");
  }
}
