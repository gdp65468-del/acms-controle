import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { captureScannerFrame } from "../utils/fileAssets";
import {
  discardQueuedScannerCapture,
  enqueueScannerCapture,
  listScannerCaptures,
  retryScannerCapture,
  startScannerQueue,
  subscribeScannerQueue
} from "../services/scannerQueue";

function createCaptureId() {
  if (typeof crypto?.randomUUID === "function") return crypto.randomUUID();
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function QuickScanner({ folderId, folderPath, ownerUid, actions, onClose }) {
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const lastPhotoUrlRef = useRef("");
  const [cameraError, setCameraError] = useState("");
  const [queueReady, setQueueReady] = useState(false);
  const [notice, setNotice] = useState("");
  const [mode, setMode] = useState("continuous");
  const [stage, setStage] = useState("camera");
  const [busy, setBusy] = useState(false);
  const [devices, setDevices] = useState([]);
  const [deviceId, setDeviceId] = useState("");
  const [torchSupported, setTorchSupported] = useState(false);
  const [torchOn, setTorchOn] = useState(false);
  const [review, setReview] = useState(null);
  const [lastPhotoUrl, setLastPhotoUrl] = useState("");
  const [captures, setCaptures] = useState([]);
  const [photographed, setPhotographed] = useState(0);
  const [sessionId, setSessionId] = useState(() => createCaptureId());
  const [redoTargetId, setRedoTargetId] = useState("");

  const uploader = useCallback(
    async (item) => actions.uploadFileAsset({
      file: new File([item.blob], item.fileName, { type: "image/jpeg" }),
      folderId: item.folderId,
      folderPath: item.folderPath,
      title: item.fileName,
      notes: "",
      uploadedBy: ownerUid,
      scannerCaptureId: item.id,
      scannerReplaceAssetId: item.replaceAssetId || ""
    }),
    [actions, ownerUid]
  );

  useEffect(() => {
    let mounted = true;
    const refresh = async () => {
      try {
        const next = await listScannerCaptures(ownerUid, folderId, sessionId);
        if (mounted) setCaptures(next);
      } catch (error) {
        if (mounted) setNotice(error?.message || "Nao foi possivel ler a fila local.");
      }
    };
    startScannerQueue(ownerUid, uploader).then(() => {
      if (mounted) setQueueReady(true);
      return refresh();
    }).catch((error) => {
      if (mounted) setNotice(error?.message || "Nao foi possivel iniciar a fila local.");
    });
    const unsubscribe = subscribeScannerQueue(refresh);
    const onOnline = () => void refresh();
    window.addEventListener("online", onOnline);
    return () => {
      mounted = false;
      unsubscribe();
      window.removeEventListener("online", onOnline);
    };
  }, [folderId, ownerUid, sessionId, uploader]);

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setTorchOn(false);
  }, []);

  useEffect(() => {
    if (stage !== "camera") {
      stopCamera();
      return undefined;
    }
    let cancelled = false;
    async function startCamera() {
      stopCamera();
      setCameraError("");
      if (!navigator.mediaDevices?.getUserMedia) {
        setCameraError("Este navegador nao oferece acesso a camera. Abra o scanner em HTTPS no celular.");
        return;
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: deviceId
            ? { deviceId: { exact: deviceId }, width: { ideal: 1920 }, height: { ideal: 1080 } }
            : { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } }
        });
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => {});
        }
        const track = stream.getVideoTracks()[0];
        try {
          setTorchSupported(Boolean(track?.getCapabilities?.()?.torch));
        } catch {
          setTorchSupported(false);
        }
        try {
          const available = await navigator.mediaDevices.enumerateDevices();
          if (!cancelled) setDevices(available.filter((item) => item.kind === "videoinput"));
        } catch {
          if (!cancelled) setDevices([]);
        }
      } catch (error) {
        if (!cancelled) setCameraError(`Nao foi possivel abrir a camera: ${error?.message || "verifique a permissao"}.`);
      }
    }
    void startCamera();
    return () => {
      cancelled = true;
      stopCamera();
    };
  }, [deviceId, stage, stopCamera]);

  useEffect(() => () => {
    if (lastPhotoUrlRef.current) URL.revokeObjectURL(lastPhotoUrlRef.current);
  }, []);

  const counts = useMemo(() => ({
    saved: captures.filter((item) => item.status === "saved").length,
    uploading: captures.filter((item) => item.status === "uploading").length,
    queued: captures.filter((item) => item.status === "queued").length,
    error: captures.filter((item) => item.status === "error").length
  }), [captures]);
  const sessionCaptures = useMemo(() => captures.filter((item) => item.sessionId === sessionId), [captures, sessionId]);
  const recoveredPending = captures.filter((item) => item.sessionId !== sessionId && ["queued", "uploading", "error"].includes(item.status)).length;
  const lastCapture = sessionCaptures.filter((item) => item.status !== "replaced").at(-1) || null;
  const totalPhotographed = Math.max(photographed, sessionCaptures.length);

  function rememberPhoto(file) {
    if (lastPhotoUrlRef.current) URL.revokeObjectURL(lastPhotoUrlRef.current);
    const url = URL.createObjectURL(file);
    lastPhotoUrlRef.current = url;
    setLastPhotoUrl(url);
    return url;
  }

  async function enqueue(file, captureId, replaceAssetId = "") {
    await enqueueScannerCapture({
      id: captureId,
      sessionId,
      ownerUid,
      folderId,
      folderPath,
      fileName: file.name,
      blob: file,
      replaceAssetId,
      createdAt: new Date().toISOString()
    });
  }

  async function takePhoto() {
    if (busy || stage !== "camera" || review) return;
    setBusy(true);
    setNotice("");
    let pendingPhoto = null;
    try {
      const captureId = createCaptureId();
      const file = await captureScannerFrame(videoRef.current, captureId);
      const photoUrl = rememberPhoto(file);
      pendingPhoto = { file, captureId, photoUrl, replaceAssetId: redoTargetId };
      setPhotographed((value) => value + 1);
      if (mode === "review") {
        setReview(pendingPhoto);
      } else {
        await enqueue(file, captureId, redoTargetId);
        setRedoTargetId("");
      }
    } catch (error) {
      setNotice(error?.message || "Falha ao fotografar.");
      if (pendingPhoto) setReview(pendingPhoto);
    } finally {
      setBusy(false);
    }
  }

  async function continueReview() {
    if (!review || busy) return;
    setBusy(true);
    try {
      await enqueue(review.file, review.captureId, review.replaceAssetId);
      setReview(null);
      setRedoTargetId("");
    } catch (error) {
      setNotice(error?.message || "Nao foi possivel guardar a captura.");
    } finally {
      setBusy(false);
    }
  }

  async function redoLast() {
    if (review) {
      setReview(null);
      setNotice("Foto descartada. Fotografe novamente.");
      return;
    }
    if (!lastCapture) return;
    if (lastCapture.status === "uploading") {
      setNotice("Aguarde o envio desta foto terminar para refazer.");
      return;
    }
    if (lastCapture.status === "saved") {
      setRedoTargetId(lastCapture.assetId || lastCapture.id);
      setNotice("Fotografe novamente. A foto anterior so sera substituida apos o novo envio ser confirmado.");
      return;
    }
    const removed = await discardQueuedScannerCapture(lastCapture.id, ownerUid);
    setNotice(removed ? "Ultima foto descartada. Fotografe novamente." : "Aguarde o envio terminar para refazer.");
  }

  async function toggleTorch() {
    const track = streamRef.current?.getVideoTracks()[0];
    if (!track) return;
    try {
      const next = !torchOn;
      await track.applyConstraints({ advanced: [{ torch: next }] });
      setTorchOn(next);
    } catch {
      setNotice("A lanterna nao esta disponivel nesta camera.");
    }
  }

  function switchCamera() {
    if (devices.length < 2) return;
    const currentId = deviceId || streamRef.current?.getVideoTracks()[0]?.getSettings?.().deviceId;
    const index = devices.findIndex((item) => item.deviceId === currentId);
    setDeviceId(devices[(index + 1) % devices.length].deviceId);
  }

  function finish() {
    if (review) {
      setNotice("Escolha Continuar ou Refazer antes de finalizar.");
      return;
    }
    setStage("summary");
  }

  function newSession() {
    setSessionId(createCaptureId());
    setPhotographed(0);
    setReview(null);
    setRedoTargetId("");
    setNotice("");
    setStage("camera");
  }

  return (
    <div className="quick-scanner" role="dialog" aria-modal="true" aria-label="Scanner Rapido">
      {stage === "camera" ? (
        <div className="quick-scanner-layout">
          <header className="quick-scanner-header">
            <div>
              <strong>Scanner Rápido</strong>
              <span>📁 {folderPath || "Meu drive"}</span>
            </div>
            <div className="quick-scanner-header-actions">
              <button
                type="button"
                className={`quick-scanner-torch${torchOn ? " is-active" : ""}`}
                onClick={toggleTorch}
                aria-label={torchOn ? "Desligar lanterna" : "Ligar lanterna"}
                aria-pressed={torchOn}
                title={torchSupported ? "Ligar lanterna do celular" : "Tentar ligar lanterna (se suportada)"}
              >
                <span aria-hidden="true">{torchOn ? "⚡" : "🔦"}</span>
              </button>
              {/* Torch control stays visible on devices whose browser hides the capability flag. */}
              {false && (
                <button type="button" onClick={toggleTorch} aria-label={torchOn ? "Desligar lanterna" : "Ligar lanterna"}>
                  {torchOn ? "⚡" : "♧"}
                </button>
              )}
              {devices.length > 1 ? <button type="button" onClick={switchCamera} aria-label="Trocar camera">⟳</button> : null}
              <button type="button" className="quick-scanner-finish" onClick={finish}>Finalizar</button>
            </div>
          </header>

          <main className="quick-scanner-viewfinder">
            <video ref={videoRef} autoPlay muted playsInline aria-label="Previa ao vivo da camera" />
            {cameraError ? <div className="quick-scanner-camera-error">{cameraError}</div> : null}
            <div className="quick-scanner-guides" aria-hidden="true"><i /><i /><i /><i /></div>
            {review ? (
              <div className="quick-scanner-review">
                <img src={review.photoUrl} alt="Fotografia para conferencia" />
              </div>
            ) : null}
          </main>

          <div className="quick-scanner-controls">
            <div className="quick-scanner-modes" aria-label="Modo de captura">
              <button type="button" className={mode === "continuous" ? "is-active" : ""} onClick={() => setMode("continuous")}>∞ Contínuo</button>
              <button type="button" className={mode === "review" ? "is-active" : ""} onClick={() => setMode("review")}>☑ Conferência</button>
            </div>
            {review ? <div className="quick-scanner-review-actions">
              <button type="button" onClick={redoLast}>Refazer</button>
              <button type="button" onClick={continueReview} disabled={busy}>Continuar e enviar</button>
            </div> : <div className="quick-scanner-shutter-row">
              <div className="quick-scanner-thumbnail">
                {lastPhotoUrl ? <img src={lastPhotoUrl} alt="Ultima captura" /> : <span>▧</span>}
                <b>{totalPhotographed}</b>
              </div>
              <button
                type="button"
                className="quick-scanner-shutter"
                onClick={takePhoto}
                disabled={busy || Boolean(review) || Boolean(cameraError) || !queueReady}
                aria-label="Fotografar comprovante"
              ><span /></button>
              <button type="button" className="quick-scanner-redo" onClick={redoLast} disabled={!lastCapture}>⟲<small>Refazer</small></button>
            </div>}
            <div className="quick-scanner-progress">
              <span>{totalPhotographed} fotografados · {counts.saved} salvos · {counts.uploading + counts.queued} em envio</span>
              {counts.error ? <span className="is-error">{counts.error} com erro</span> : null}
            </div>
            {notice ? <p className="quick-scanner-notice" role="status">{notice}</p> : null}
            {counts.error ? (
              <button type="button" className="quick-scanner-retry" onClick={() => captures.filter((item) => item.status === "error").forEach((item) => void retryScannerCapture(item.id, ownerUid))}>
                Reenviar falhas
              </button>
            ) : null}
            {recoveredPending ? <p className="quick-scanner-notice" role="status">{recoveredPending} captura(s) pendente(s) de uma sessao anterior tambem estao sendo enviadas.</p> : null}
          </div>
        </div>
      ) : (
        <div className="quick-scanner-summary">
          <div className="quick-scanner-summary-card">
            <div className="quick-scanner-summary-check">{counts.uploading + counts.queued + counts.error ? "…" : "✓"}</div>
            <h1>Sessão finalizada</h1>
            <p>Destino das capturas: <strong>{folderPath || "Meu drive"}</strong>.</p>
            <div className="quick-scanner-summary-stats">
              <div><span>Fotografados</span><strong>{totalPhotographed}</strong></div>
              <div><span>Salvos com sucesso</span><strong>{counts.saved}</strong></div>
              <div><span>Em envio</span><strong>{counts.uploading + counts.queued}</strong></div>
              <div><span>Com erro</span><strong>{counts.error}</strong></div>
            </div>
            {counts.uploading + counts.queued + counts.error > 0 ? (
              <p className="quick-scanner-pending">As fotos pendentes permanecem guardadas neste navegador. Abra o scanner novamente para retomar ou reenviar falhas.</p>
            ) : null}
            {counts.error ? (
              <button type="button" className="quick-scanner-secondary" onClick={() => captures.filter((item) => item.status === "error").forEach((item) => void retryScannerCapture(item.id, ownerUid))}>
                Reenviar falhas
              </button>
            ) : null}
            <button type="button" className="quick-scanner-primary" onClick={onClose}>Ver documentos</button>
            <button type="button" className="quick-scanner-secondary" onClick={newSession}>Nova sessão</button>
            <button type="button" className="quick-scanner-secondary" onClick={onClose}>Fechar</button>
          </div>
        </div>
      )}
    </div>
  );
}
