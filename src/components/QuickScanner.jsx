import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { captureScannerFrame } from "../utils/fileAssets";
import { getFocusPoint, requestScannerFocus, updateScannerCameraConstraints } from "../utils/scannerFocus";
import { captureWithNativeCamera, isNativeAndroidApp } from "../utils/nativeCamera";
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
  const nativeCamera = isNativeAndroidApp();
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
  const [flashSupported, setFlashSupported] = useState(false);
  const [flashOn, setFlashOn] = useState(false);
  const [focusSupported, setFocusSupported] = useState(false);
  const [focusPulse, setFocusPulse] = useState(false);
  const [focusPoint, setFocusPoint] = useState({ x: 0.5, y: 0.5 });
  const focusRequestRef = useRef(null);
  const [zoomRange, setZoomRange] = useState(null);
  const [zoomValue, setZoomValue] = useState(null);
  const focusResetTimerRef = useRef(null);
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
    setFlashOn(false);
    setFocusSupported(false);
    focusRequestRef.current = null;
    setFocusPulse(false);
    setTorchSupported(false);
    setFlashSupported(false);
    setZoomRange(null);
    setZoomValue(null);
    if (focusResetTimerRef.current) {
      window.clearTimeout(focusResetTimerRef.current);
      focusResetTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (stage !== "camera") {
      stopCamera();
      return undefined;
    }
    if (nativeCamera) {
      setCameraError("");
      setDevices([]);
      setTorchSupported(false);
      setFlashSupported(false);
      setFocusSupported(false);
      setZoomRange(null);
      setZoomValue(null);
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
        if (cancelled) return;
        const track = stream.getVideoTracks()[0];
        try {
          const capabilities = track?.getCapabilities?.() || {};
          const focusModes = Array.isArray(capabilities.focusMode) ? capabilities.focusMode : [];
          const zoom = capabilities.zoom;
          const nextZoomRange = zoom && Number.isFinite(zoom.min) && Number.isFinite(zoom.max) && zoom.max > zoom.min
            ? { min: zoom.min, max: zoom.max, step: Number.isFinite(zoom.step) && zoom.step > 0 ? zoom.step : 0.1 }
            : null;
          setTorchSupported(capabilities.torch === true || Array.isArray(capabilities.torch));
          setFocusSupported(focusModes.includes("continuous") || focusModes.includes("single-shot"));
          let initialZoom = nextZoomRange ? Number(track.getSettings?.().zoom) || 1 : null;
          // Recibos costumam ser fotografados de perto. A lente 1x é a mais
          // adequada para essa distância e evita começar em uma teleobjetiva.
          if (nextZoomRange && nextZoomRange.min <= 1 && nextZoomRange.max >= 1 && Math.abs(initialZoom - 1) >= nextZoomRange.step / 2) {
            await updateScannerCameraConstraints(track, { zoom: 1 }).catch(() => {});
            initialZoom = Number(track.getSettings?.().zoom) || 1;
          }
          setZoomRange(nextZoomRange);
          setZoomValue(initialZoom);
          if (capabilities.torch === true || Array.isArray(capabilities.torch)) {
            await track.applyConstraints({ advanced: [{ torch: false }] }).catch(() => {});
          }
          if (focusModes.includes("continuous")) {
            await requestScannerFocus(track).catch(() => {});
          }
          if (typeof ImageCapture !== "undefined" && track) {
            const photoCapabilities = await new ImageCapture(track).getPhotoCapabilities().catch(() => null);
            const fillLightModes = photoCapabilities?.fillLightMode || [];
            if (!cancelled) setFlashSupported(fillLightModes.includes("flash"));
          }
        } catch {
          setTorchSupported(false);
          setFlashSupported(false);
          setFocusSupported(false);
          setZoomRange(null);
          setZoomValue(null);
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
  }, [deviceId, nativeCamera, stage, stopCamera]);

  useEffect(() => () => {
    if (lastPhotoUrlRef.current) URL.revokeObjectURL(lastPhotoUrlRef.current);
  }, []);

  useEffect(() => {
    const bodyOverflow = document.body.style.overflow;
    const htmlOverscroll = document.documentElement.style.overscrollBehavior;
    document.body.style.overflow = "hidden";
    document.documentElement.style.overscrollBehavior = "none";
    return () => {
      document.body.style.overflow = bodyOverflow;
      document.documentElement.style.overscrollBehavior = htmlOverscroll;
    };
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
    if (busy || focusRequestRef.current || stage !== "camera" || review) return;
    setBusy(true);
    setNotice("");
    let pendingPhoto = null;
    try {
      const captureId = createCaptureId();
      const file = nativeCamera
        ? await captureWithNativeCamera(captureId)
        : await captureScannerFrame(videoRef.current, captureId, {
          track: streamRef.current?.getVideoTracks()[0],
          flash: flashOn
        });
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

  async function focusAt(event) {
    const track = streamRef.current?.getVideoTracks()[0];
    if (!track || review || busy || focusRequestRef.current) return;
    const video = videoRef.current;
    const rect = video.getBoundingClientRect();
    const { display, sensor } = getFocusPoint(rect, video.videoWidth, video.videoHeight,
      event?.detail ? event.clientX : rect.left + rect.width / 2,
      event?.detail ? event.clientY : rect.top + rect.height / 2);
    const request = {};
    focusRequestRef.current = request;
    const isCurrent = () => focusRequestRef.current === request && streamRef.current?.getVideoTracks()[0] === track;
    const release = () => {
      if (!isCurrent()) return;
      focusRequestRef.current = null;
      setFocusPulse(false);
    };
    // A stuck device request must not indefinitely disable capture.
    focusResetTimerRef.current = window.setTimeout(release, 3000);
    try {
      const result = await requestScannerFocus(track, sensor, navigator.mediaDevices.getSupportedConstraints?.() || {});
      if (!isCurrent()) return;
      if (!result.supported) {
        setNotice("Esta camera nao permite ajustar o foco pelo site. Afaste um pouco o celular e mantenha o recibo bem iluminado.");
        release();
        return;
      }
      setFocusPoint(result.pointRequested ? display : { x: 0.5, y: 0.5 });
      setFocusPulse(true);
      setNotice(result.pointRequested ? "Foco solicitado neste ponto. Mantenha o celular parado." : "Foco automatico solicitado. Esta camera nao permite escolher o ponto; aguarde o texto ficar nitido.");
      window.clearTimeout(focusResetTimerRef.current);
      // Settling allowance, not confirmation that the physical lens has focused.
      focusResetTimerRef.current = window.setTimeout(release, 800);
    } catch {
      if (isCurrent()) setNotice("Nao foi possivel ajustar o foco. Afaste um pouco o celular e tente novamente.");
      release();
    }
  }

  async function toggleTorch() {
    if (focusRequestRef.current || busy || review) return;
    const track = streamRef.current?.getVideoTracks()[0];
    if (!track) return;
    const capabilities = track.getCapabilities?.() || {};
    const hasTorch = capabilities.torch === true || Array.isArray(capabilities.torch);
    try {
      if (hasTorch) {
        const next = !torchOn;
        await updateScannerCameraConstraints(track, { torch: next });
        setTorchOn(next);
        setFlashOn(false);
        return;
      }
      if (flashSupported) {
        setFlashOn((value) => !value);
        setNotice(flashOn ? "Flash desativado." : "Flash sera usado na proxima foto.");
        return;
      }
      throw new Error("unsupported-light");
    } catch {
      if (flashSupported) {
        setFlashOn((value) => !value);
        setNotice(flashOn ? "Flash desativado." : "Flash sera usado na proxima foto.");
      } else {
        setNotice("O navegador nao liberou a lanterna ou o flash desta camera.");
      }
    }
  }

  function clampZoom(value) {
    if (!zoomRange) return value;
    const clamped = Math.min(zoomRange.max, Math.max(zoomRange.min, value));
    const steps = Math.round((clamped - zoomRange.min) / zoomRange.step);
    return Number((zoomRange.min + steps * zoomRange.step).toFixed(2));
  }

  async function setCameraZoom(target) {
    if (focusRequestRef.current || busy || review) return;
    const track = streamRef.current?.getVideoTracks()[0];
    if (!track || !zoomRange) {
      setNotice("Esta camera nao disponibilizou zoom para o navegador.");
      return;
    }
    const value = clampZoom(target);
    try {
      await updateScannerCameraConstraints(track, { zoom: value });
      setZoomValue(value);
    } catch {
      setNotice("Nao foi possivel mudar a lente/zoom desta camera.");
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
              {!nativeCamera && zoomRange ? (
                <div className="quick-scanner-zoom" aria-label="Zoom da camera">
                  <button
                    type="button"
                    className={Math.abs((zoomValue || 1) - 1) < zoomRange.step / 2 ? "is-active" : ""}
                    onClick={() => void setCameraZoom(1)}
                    disabled={zoomRange.min > 1 || zoomRange.max < 1}
                    aria-label="Usar zoom 1x"
                  >1x</button>
                  <button
                    type="button"
                    className={Math.abs((zoomValue || 1) - 2) < zoomRange.step / 2 ? "is-active" : ""}
                    onClick={() => void setCameraZoom(2)}
                    disabled={zoomRange.min > 2 || zoomRange.max < 2}
                    aria-label="Usar zoom 2x"
                  >2x</button>
                </div>
              ) : null}
              {!nativeCamera ? <button
                type="button"
                className={`quick-scanner-torch${torchOn || flashOn ? " is-active" : ""}`}
                onClick={toggleTorch}
                aria-label={torchOn ? "Desligar lanterna" : "Ligar lanterna"}
                aria-pressed={torchOn || flashOn}
                title={torchSupported ? "Ligar lanterna do celular" : flashSupported ? "Usar flash na proxima foto" : "Tentar ligar lanterna ou flash"}
              >
                <span aria-hidden="true">{torchOn || flashOn ? "⚡" : "🔦"}</span>
              </button> : null}
              {/* Torch control stays visible on devices whose browser hides the capability flag. */}
              {false && (
                <button type="button" onClick={toggleTorch} aria-label={torchOn ? "Desligar lanterna" : "Ligar lanterna"}>
                  {torchOn ? "⚡" : "♧"}
                </button>
              )}
              {!nativeCamera && devices.length > 1 ? <button type="button" onClick={switchCamera} disabled={busy || Boolean(review)} aria-label="Trocar camera">⟳</button> : null}
              <button type="button" className="quick-scanner-finish" onClick={finish}>Finalizar</button>
            </div>
          </header>

          <main
            className={`quick-scanner-viewfinder${focusPulse ? " is-focusing" : ""}`}
            onClick={(event) => {
              if (!nativeCamera) void focusAt(event);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                if (!nativeCamera) void focusAt();
              }
            }}
            role={nativeCamera ? undefined : "button"}
            tabIndex={nativeCamera ? undefined : 0}
            aria-label={nativeCamera ? "Camera nativa do Android" : focusSupported ? "Toque no texto do recibo para solicitar foco" : "Previa da camera"}
          >
            {nativeCamera ? <div className="quick-scanner-native-camera">
              <span aria-hidden="true">📷</span>
              <strong>Câmera nativa do celular</strong>
              <p>Toque no botão para abrir a câmera Samsung. Use as lentes, o foco por toque e a lanterna do próprio celular.</p>
            </div> : <video ref={videoRef} autoPlay muted playsInline aria-label="Previa ao vivo da camera" />}
            {cameraError ? <div className="quick-scanner-camera-error">{cameraError}</div> : null}
            {!nativeCamera ? <><div className="quick-scanner-guides" aria-hidden="true"><i /><i /><i /><i /></div>
              <span className="quick-scanner-focus-point" aria-hidden="true" style={{ left: `${focusPoint.x * 100}%`, top: `${focusPoint.y * 100}%` }} /></> : null}
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
            {zoomRange && zoomValue >= 1.75 ? <p className="quick-scanner-document-tip">2x: afaste o celular. Para recibos próximos, use 1x.</p> : null}
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
                disabled={busy || focusPulse || Boolean(review) || Boolean(cameraError) || !queueReady}
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
