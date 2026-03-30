import { listAssistantOrders, markAssistantOrderDelivered } from "../_lib/assistant.js";
import { getBearerToken, readJsonBody, requireMethod, sendError, sendJson } from "../_lib/http.js";

export default async function handler(req, res) {
  if (!requireMethod(req, res, ["GET", "POST"])) return;

  const sessionToken = getBearerToken(req);
  if (!sessionToken) {
    sendError(res, 401, "Sessao do auxiliar nao encontrada.");
    return;
  }

  try {
    if (req.method === "GET") {
      const data = await listAssistantOrders(sessionToken);
      sendJson(res, 200, { ok: true, ...data });
      return;
    }

    const body = await readJsonBody(req);
    if (body.action !== "delivered") {
      sendError(res, 400, "Acao invalida.");
      return;
    }

    const result = await markAssistantOrderDelivered(sessionToken, body.orderId);
    sendJson(res, 200, { ok: true, ...result });
  } catch (error) {
    sendError(res, 400, error.message || "Nao foi possivel concluir esta acao.");
  }
}
