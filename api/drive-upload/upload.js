import { uploadDriveUploadAsset } from "../_lib/driveUpload.js";
import { getBearerToken, requireMethod, sendError, sendJson } from "../_lib/http.js";
import { getSingleField, getSingleFile, multipartConfig, parseMultipartForm } from "../_lib/multipart.js";

export const config = multipartConfig;

export default async function handler(req, res) {
  if (!requireMethod(req, res, "POST")) return;

  const sessionToken = getBearerToken(req);
  if (!sessionToken) {
    sendError(res, 401, "Sessao de upload nao encontrada.");
    return;
  }

  try {
    const { fields, files } = await parseMultipartForm(req);
    const file = getSingleFile(files, "file");
    if (!file) {
      sendError(res, 400, "Selecione um arquivo.");
      return;
    }

    const sessionId = getSingleField(fields, "sessionId");
    const title = getSingleField(fields, "title");
    const notes = getSingleField(fields, "notes");
    const asset = await uploadDriveUploadAsset(sessionToken, sessionId, file, { title, notes });

    sendJson(res, 200, { ok: true, asset });
  } catch (error) {
    sendError(res, 400, error.message || "Nao foi possivel enviar o arquivo.");
  }
}
