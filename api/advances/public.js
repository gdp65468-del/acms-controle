import { getBearerToken, requireMethod, sendError, sendJson } from "../_lib/http.js";
import { getUnlockedPublicAdvanceData } from "../_lib/publicAdvances.js";

export default async function handler(req, res) {
  if (!requireMethod(req, res, "GET")) return;

  try {
    const token = String(req.query?.token || "");
    const sessionToken = getBearerToken(req);
    if (!sessionToken) {
      sendError(res, 401, "Digite o codigo de acesso para abrir este link.");
      return;
    }

    const result = await getUnlockedPublicAdvanceData(token, sessionToken);
    sendJson(res, 200, { ok: true, ...result });
  } catch (error) {
    sendError(res, 401, error.message || "Nao foi possivel abrir este link.");
  }
}
