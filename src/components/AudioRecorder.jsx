import { useEffect, useRef, useState } from "react";
import { Icon } from "./Icon";
import { VoiceNotePlayer } from "./VoiceNotePlayer";

export function AudioRecorder({ onAudioReady }) {
  const recorderRef = useRef(null);
  const streamRef = useRef(null);
  const chunksRef = useRef([]);
  const [recording, setRecording] = useState(false);
  const [error, setError] = useState("");
  const [elapsed, setElapsed] = useState(0);
  const [previewUrl, setPreviewUrl] = useState("");

  useEffect(() => {
    return () => {
      streamRef.current?.getTracks()?.forEach((track) => track.stop());
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  useEffect(() => {
    if (!recording) return undefined;
    const interval = window.setInterval(() => setElapsed((value) => value + 1), 1000);
    return () => window.clearInterval(interval);
  }, [recording]);

  function formatTimer(totalSeconds) {
    const minutes = String(Math.floor(totalSeconds / 60)).padStart(2, "0");
    const seconds = String(totalSeconds % 60).padStart(2, "0");
    return `${minutes}:${seconds}`;
  }

  async function startRecording() {
    setError("");
    setElapsed(0);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      chunksRef.current = [];
      const mediaRecorder = new MediaRecorder(stream);
      recorderRef.current = mediaRecorder;
      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };
      mediaRecorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: "audio/webm" });
        const file = new File([blob], `instrucao-${Date.now()}.webm`, { type: "audio/webm" });
        if (previewUrl) URL.revokeObjectURL(previewUrl);
        const nextPreview = URL.createObjectURL(blob);
        setPreviewUrl(nextPreview);
        onAudioReady(file);
        stream.getTracks().forEach((track) => track.stop());
      };
      mediaRecorder.start();
      setRecording(true);
    } catch (recordError) {
      setError("Não foi possível acessar o microfone.");
    }
  }

  function stopRecording() {
    recorderRef.current?.stop();
    setRecording(false);
  }

  return (
    <div className="audio-box whatsapp-recorder">
      <div className={`whatsapp-bar ${recording ? "is-recording" : ""}`}>
        <div className="whatsapp-status">
          <span className="record-dot" />
          <strong>{recording ? "Gravando audio" : "Audio de instrucao"}</strong>
          <span>{recording ? formatTimer(elapsed) : "Toque no microfone para gravar"}</span>
        </div>
        {!recording ? (
          <button type="button" className="mic-button" onClick={startRecording} aria-label="Gravar audio">
            <Icon name="mic" size={24} />
          </button>
        ) : (
          <div className="actions-row">
            <button type="button" className="button-ghost" onClick={stopRecording}>
              Enviar
            </button>
          </div>
        )}
      </div>
      {previewUrl ? (
        <div className="audio-preview-bubble">
          <span>Mensagem pronta</span>
          <VoiceNotePlayer src={previewUrl} title="Previa da gravacao" compact />
        </div>
      ) : null}
      {error ? <p className="form-error">{error}</p> : null}
    </div>
  );
}
