import { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { Icon } from "../components/Icon";
import { UploadProgressOverlay } from "../components/UploadProgressOverlay";
import { useAppContext } from "../context/AppContext";
import { formatDate } from "../utils/format";

function formatRemainingTime(remainingMs) {
  const safeMs = Math.max(0, Number(remainingMs || 0));
  const totalSeconds = Math.floor(safeMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function getDefaultTitle(file) {
  return file?.name || "";
}

export function DriveUploadPage() {
  const { sessionId = "" } = useParams();
  const { actions } = useAppContext();
  const [session, setSession] = useState(null);
  const [sessionAssets, setSessionAssets] = useState([]);
  const [accessCode, setAccessCode] = useState("");
  const [accessCodeHash, setAccessCodeHash] = useState("");
  const [isUnlocked, setIsUnlocked] = useState(false);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [feedbackType, setFeedbackType] = useState("success");
  const [selectedFiles, setSelectedFiles] = useState([]);
  const [form, setForm] = useState({ title: "", notes: "" });
  const [uploadProgress, setUploadProgress] = useState({ active: false, total: 0, completed: 0, currentName: "" });
  const cameraInputRef = useRef(null);
  const fileInputRef = useRef(null);

  const remainingTimeLabel = useMemo(() => formatRemainingTime(session?.remainingMs || 0), [session]);
  const sessionStorageKey = `acms-drive-upload:${sessionId}`;

  useEffect(() => {
    if (!feedback) return undefined;
    const timer = window.setTimeout(() => setFeedback(""), 4000);
    return () => window.clearTimeout(timer);
  }, [feedback]);

  useEffect(() => {
    let cancelled = false;

    async function loadSession() {
      setLoading(true);
      try {
        const nextSession = await actions.getDriveUploadSession(sessionId);
        if (cancelled) return;
        setSession(nextSession);
        const unlocked = actions.isDriveUploadSessionUnlocked(sessionId, nextSession);
        if (unlocked) {
          const storedHash = localStorage.getItem(sessionStorageKey) || "";
          setAccessCodeHash(storedHash);
          setIsUnlocked(true);
        } else {
          setIsUnlocked(false);
          setAccessCodeHash("");
        }
      } catch (error) {
        if (!cancelled) {
          setFeedbackType("error");
          setFeedback(error?.message || "Nao foi possivel abrir este acesso.");
          setSession(null);
          setIsUnlocked(false);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    loadSession();
    return () => {
      cancelled = true;
    };
  }, [actions, sessionId, sessionStorageKey]);

  useEffect(() => {
    if (!isUnlocked || !sessionId) return undefined;

    let cancelled = false;

    async function loadAssets() {
      try {
        const nextAssets = await actions.listSessionAssets(sessionId);
        if (!cancelled) {
          setSessionAssets(nextAssets);
        }
      } catch (error) {
        if (!cancelled) {
          setFeedbackType("error");
          setFeedback(error?.message || "Nao foi possivel carregar os arquivos desta sessao.");
        }
      }
    }

    loadAssets();
    const timer = window.setInterval(loadAssets, 15000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [actions, isUnlocked, sessionId]);

  useEffect(() => {
    if (!isUnlocked || !sessionId || !accessCodeHash) return undefined;

    const timer = window.setInterval(async () => {
      try {
        await actions.touchDriveUploadSession(sessionId, accessCodeHash);
        const nextSession = await actions.getDriveUploadSession(sessionId);
        setSession(nextSession);
      } catch (error) {
        setFeedbackType("error");
        setFeedback(error?.message || "Este acesso temporario expirou.");
        actions.lockDriveUploadSession(sessionId);
        setIsUnlocked(false);
        setAccessCodeHash("");
      }
    }, 120000);

    return () => window.clearInterval(timer);
  }, [accessCodeHash, actions, isUnlocked, sessionId]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setSession((current) => {
        if (!current) return current;
        const expiresAt = new Date(current.expiresAt || 0).getTime();
        if (Number.isNaN(expiresAt)) return current;
        return {
          ...current,
          remainingMs: Math.max(0, expiresAt - Date.now()),
          isExpired: expiresAt <= Date.now() || current.status !== "ATIVA"
        };
      });
    }, 1000);
    return () => window.clearInterval(timer);
  }, []);

  function showSuccess(message) {
    setFeedbackType("success");
    setFeedback(message);
  }

  function showError(error) {
    setFeedbackType("error");
    setFeedback(error?.message || "Nao foi possivel concluir esta acao.");
  }

  function handleFileChosen(files) {
    if (!files?.length) return;
    setSelectedFiles(files);
    setForm((current) => ({
      ...current,
      title: files.length === 1 ? current.title || getDefaultTitle(files[0]) : ""
    }));
  }

  async function refreshSessionState() {
    const nextSession = await actions.getDriveUploadSession(sessionId);
    setSession(nextSession);
    return nextSession;
  }

  async function refreshSessionAssets() {
    const nextAssets = await actions.listSessionAssets(sessionId);
    setSessionAssets(nextAssets);
    return nextAssets;
  }

  async function handleUnlock(event) {
    event.preventDefault();
    try {
      const unlockedSession = await actions.validateDriveUploadSession(sessionId, accessCode);
      setSession(unlockedSession);
      setAccessCodeHash(unlockedSession.accessCodeHash || "");
      setIsUnlocked(true);
      setAccessCode("");
      await refreshSessionAssets();
      showSuccess("Acesso liberado. Agora voce pode enviar arquivos para esta pasta.");
    } catch (error) {
      showError(error);
    }
  }

  async function handleUpload(event) {
    event.preventDefault();
    if (!selectedFiles.length) {
      showError(new Error("Selecione ao menos um arquivo."));
      return;
    }
    setUploading(true);
    setUploadProgress({
      active: true,
      total: selectedFiles.length,
      completed: 0,
      currentName: selectedFiles[0]?.name || ""
    });
    try {
      for (const [index, file] of selectedFiles.entries()) {
        setUploadProgress({
          active: true,
          total: selectedFiles.length,
          completed: index,
          currentName: file.name || getDefaultTitle(file)
        });
        await actions.uploadFileAssetToSession({
          sessionId,
          accessCodeHash,
          file,
          title: selectedFiles.length === 1 ? form.title || getDefaultTitle(file) : getDefaultTitle(file),
          notes: form.notes
        });
        setUploadProgress({
          active: true,
          total: selectedFiles.length,
          completed: index + 1,
          currentName: file.name || getDefaultTitle(file)
        });
      }
      setSelectedFiles([]);
      setForm({ title: "", notes: "" });
      await refreshSessionState();
      await refreshSessionAssets();
      showSuccess(selectedFiles.length > 1 ? "Arquivos enviados com sucesso." : "Arquivo enviado com sucesso.");
    } catch (error) {
      showError(error);
    } finally {
      setUploading(false);
      setUploadProgress({ active: false, total: 0, completed: 0, currentName: "" });
    }
  }

  async function handleRename(asset) {
    const nextTitle = window.prompt("Novo nome do arquivo", asset.title || "");
    if (nextTitle === null) return;
    try {
      await actions.renameSessionAsset(asset.id, sessionId, accessCodeHash, nextTitle);
      await refreshSessionState();
      await refreshSessionAssets();
      showSuccess("Arquivo renomeado.");
    } catch (error) {
      showError(error);
    }
  }

  async function handleDelete(asset) {
    if (!window.confirm("Apagar este arquivo desta sessao?")) return;
    try {
      await actions.deleteSessionAsset(asset.id, sessionId, accessCodeHash);
      await refreshSessionState();
      await refreshSessionAssets();
      showSuccess("Arquivo apagado da sessao.");
    } catch (error) {
      showError(error);
    }
  }

  if (loading) {
    return <div className="screen-center">Carregando acesso temporario...</div>;
  }

  if (!session) {
    return (
      <div className="drive-upload-shell">
        <section className="drive-upload-panel">
          <h1>Acesso temporario indisponivel</h1>
          <p>Este link nao foi encontrado ou ja foi encerrado pela tesouraria.</p>
        </section>
      </div>
    );
  }

  if (session.status !== "ATIVA" || session.isExpired) {
    return (
      <div className="drive-upload-shell">
        <section className="drive-upload-panel">
          <span className="drive-upload-badge is-danger">Sessao encerrada</span>
          <h1>Este QR de envio expirou</h1>
          <p>Solicite um novo QR temporario para a pasta {session.folderName}.</p>
        </section>
      </div>
    );
  }

  return (
    <div className="drive-upload-shell">
      <UploadProgressOverlay progress={uploadProgress} />

      {feedback ? (
        <div className={`files-toast ${feedbackType === "error" ? "is-error" : "is-success"}`}>
          <div>
            <strong>{feedbackType === "error" ? "Nao foi possivel concluir" : "Tudo certo"}</strong>
            <p>{feedback}</p>
          </div>
          <button type="button" className="files-toast-close" onClick={() => setFeedback("")}>
            <Icon name="close" size={18} />
          </button>
        </div>
      ) : null}

      <section className="drive-upload-panel">
        <div className="drive-upload-header">
          <span className="drive-upload-badge">Upload temporario</span>
          <h1>{session.folderName}</h1>
          <p>Use este acesso temporario para enviar imagem ou PDF diretamente para esta pasta do meu drive.</p>
        </div>

        <div className="drive-upload-meta">
          <div>
            <span>Pasta destino</span>
            <strong>{session.folderPath || session.folderName}</strong>
          </div>
          <div>
            <span>Tempo restante</span>
            <strong>{remainingTimeLabel}</strong>
          </div>
          <div>
            <span>Atualizado em</span>
            <strong>{formatDate(session.lastActiveAt)}</strong>
          </div>
        </div>

        {!isUnlocked ? (
          <div className="drive-upload-gate-backdrop">
            <form className="drive-upload-gate" onSubmit={handleUnlock}>
              <div className="drive-upload-gate-icon">
                <Icon name="lock" size={28} />
              </div>
              <h2>Digite o codigo de acesso</h2>
              <p>O QR abre esta sessao, mas o codigo curto ainda e obrigatorio para liberar o envio.</p>
              <label className="field">
                <span>Codigo de 6 numeros</span>
                <input
                  type="password"
                  inputMode="numeric"
                  maxLength={6}
                  value={accessCode}
                  onChange={(event) => setAccessCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
                  placeholder="000000"
                  autoFocus
                />
              </label>
              <button type="submit" className="button-primary">
                Liberar envio
              </button>
            </form>
          </div>
        ) : (
          <>
            <input
              ref={cameraInputRef}
              className="sr-only-input"
              type="file"
              accept="image/*"
              capture="environment"
              onChange={(event) => handleFileChosen(Array.from(event.target.files || []))}
            />
            <input
              ref={fileInputRef}
              className="sr-only-input"
              type="file"
              accept="image/*,application/pdf"
              multiple
              onChange={(event) => handleFileChosen(Array.from(event.target.files || []))}
            />

            <form className="drive-upload-form" onSubmit={handleUpload}>
              <div className="drive-upload-actions">
                <button type="button" className="button-primary" onClick={() => cameraInputRef.current?.click()}>
                  <Icon name="camera" size={18} />
                  <span>Tirar foto</span>
                </button>
                <button type="button" className="button-ghost" onClick={() => fileInputRef.current?.click()}>
                  <Icon name="upload" size={18} />
                  <span>Escolher arquivos</span>
                </button>
              </div>

              {selectedFiles.length ? (
                <div className="drive-upload-selected">
                  <strong>{selectedFiles.length > 1 ? `${selectedFiles.length} arquivos prontos` : "Arquivo pronto"}</strong>
                  <ul className="files-selected-file-list">
                    {selectedFiles.map((file) => (
                      <li key={`${file.name}-${file.size}`}>{file.name}</li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {selectedFiles.length === 1 ? (
                <label className="field">
                  <span>Nome do arquivo</span>
                  <input
                    type="text"
                    value={form.title}
                    onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))}
                    placeholder="Nome para salvar"
                  />
                </label>
              ) : null}

              <label className="field">
                <span>Observacao</span>
                <textarea
                  rows={3}
                  value={form.notes}
                  onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))}
                  placeholder="Opcional. Fica salva junto com o arquivo."
                />
              </label>

              <button type="submit" className="button-primary" disabled={uploading}>
                {uploading ? "Enviando..." : "Enviar para esta pasta"}
              </button>
            </form>

            <div className="drive-upload-session-files">
              <div className="files-section-title">
                <h3>Arquivos enviados nesta sessao</h3>
                <p>So aparecem os arquivos enviados por este acesso temporario.</p>
              </div>

              {sessionAssets.length ? (
                <div className="drive-upload-asset-list">
                  {sessionAssets.map((asset) => (
                    <article key={asset.id} className="drive-upload-asset-card">
                      <div className="drive-upload-asset-copy">
                        <div className="files-folder-icon">
                          <Icon name={asset.fileType === "image" ? "image" : "fileText"} size={18} />
                        </div>
                        <div>
                          <strong>{asset.title}</strong>
                          <p>{asset.notes || "Arquivo enviado por acesso temporario."}</p>
                          <span>{formatDate(asset.createdAt)}</span>
                        </div>
                      </div>
                      <div className="drive-upload-asset-actions">
                        <button type="button" className="button-ghost" onClick={() => handleRename(asset)}>
                          Renomear
                        </button>
                        <button type="button" className="button-ghost danger-text" onClick={() => handleDelete(asset)}>
                          Apagar
                        </button>
                      </div>
                    </article>
                  ))}
                </div>
              ) : (
                <div className="files-empty-state">
                  <Icon name="upload" size={28} />
                  <strong>Nenhum arquivo nesta sessao</strong>
                  <p>Envie uma foto, nota ou PDF para preencher esta pasta rapidamente.</p>
                </div>
              )}
            </div>
          </>
        )}
      </section>
    </div>
  );
}
