import { requireTreasurer } from "../_lib/auth.js";
import { getPublicAdvanceSettings, savePublicAdvanceSettings } from "../_lib/publicAdvances.js";
import { readJsonBody, requireMethod, sendError, sendJson } from "../_lib/http.js";

export default async function handler(req, res) {
  if (!requireMethod(req, res, ["GET", "POST"])) return;

  try {
    await requireTreasurer(req);

    if (req.method === "GET") {
      const settings = await getPublicAdvanceSettings();
      sendJson(res, 200, { ok: true, settings });
      return;
    }

    const body = await readJsonBody(req);
    const settings = await savePublicAdvanceSettings(body.accessCode);
    sendJson(res, 200, { ok: true, settings });
  } catch (error) {
    sendError(res, 400, error.message || "Nao foi possivel salvar o codigo do link publico.");
  }
}
