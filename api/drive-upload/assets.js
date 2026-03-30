import {
  deleteDriveUploadAsset,
  listDriveUploadAssets,
  renameDriveUploadAsset
} from "../_lib/driveUpload.js";
import { getBearerToken, readJsonBody, requireMethod, sendError, sendJson } from "../_lib/http.js";

export default async function handler(req, res) {
  if (!requireMethod(req, res, ["GET", "PATCH", "DELETE"])) return;

  const sessionToken = getBearerToken(req);
  if (!sessionToken) {
    sendError(res, 401, "Sessao de upload nao encontrada.");
    return;
  }

  try {
    if (req.method === "GET") {
      const assets = await listDriveUploadAssets(sessionToken, req.query.sessionId);
      sendJson(res, 200, { ok: true, assets });
      return;
    }

    if (req.method === "PATCH") {
      const body = await readJsonBody(req);
      await renameDriveUploadAsset(sessionToken, body.sessionId, body.assetId, body.title);
      sendJson(res, 200, { ok: true });
      return;
    }

    await deleteDriveUploadAsset(sessionToken, req.query.sessionId, req.query.assetId);
    sendJson(res, 200, { ok: true });
  } catch (error) {
    sendError(res, 400, error.message || "Nao foi possivel concluir esta acao.");
  }
}
