import { useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "./Icon";

function formatDuration(totalSeconds) {
  const safeValue = Number.isFinite(totalSeconds) ? Math.max(0, Math.floor(totalSeconds)) : 0;
  const minutes = String(Math.floor(safeValue / 60)).padStart(2, "0");
  const seconds = String(safeValue % 60).padStart(2, "0");
  return `${minutes}:${seconds}`;
}

export function VoiceNotePlayer({ src, title = "Nota de voz", compact = false }) {
  const audioRef = useRef(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return undefined;

    function handleLoadedMetadata() {
      setDuration(audio.duration || 0);
    }

    function handleTimeUpdate() {
      setCurrentTime(audio.currentTime || 0);
    }

    function handleEnded() {
      setIsPlaying(false);
      setCurrentTime(0);
    }

    function handlePause() {
      setIsPlaying(false);
    }

    function handlePlay() {
      setIsPlaying(true);
    }

    audio.addEventListener("loadedmetadata", handleLoadedMetadata);
    audio.addEventListener("timeupdate", handleTimeUpdate);
    audio.addEventListener("ended", handleEnded);
    audio.addEventListener("pause", handlePause);
    audio.addEventListener("play", handlePlay);

    return () => {
      audio.removeEventListener("loadedmetadata", handleLoadedMetadata);
      audio.removeEventListener("timeupdate", handleTimeUpdate);
      audio.removeEventListener("ended", handleEnded);
      audio.removeEventListener("pause", handlePause);
      audio.removeEventListener("play", handlePlay);
    };
  }, [src]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.pause();
    audio.currentTime = 0;
    setIsPlaying(false);
    setCurrentTime(0);
    setDuration(0);
  }, [src]);

  const progress = duration ? Math.min(100, (currentTime / duration) * 100) : 0;
  const bars = useMemo(() => [10, 16, 24, 18, 28, 14, 22, 12, 26, 18, 24, 16, 20, 12], []);

  async function togglePlayback() {
    const audio = audioRef.current;
    if (!audio) return;
    if (isPlaying) {
      audio.pause();
      return;
    }
    try {
      await audio.play();
    } catch {
      setIsPlaying(false);
    }
  }

  function seekAudio(event) {
    const audio = audioRef.current;
    if (!audio || !duration) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (event.clientX - bounds.left) / bounds.width));
    audio.currentTime = duration * ratio;
    setCurrentTime(audio.currentTime);
  }

  return (
    <div className={`voice-note ${compact ? "is-compact" : ""}`}>
      <audio ref={audioRef} src={src} preload="metadata">
        Seu navegador nao suporta audio.
      </audio>
      <button type="button" className="voice-note-play" onClick={togglePlayback} aria-label={isPlaying ? "Pausar audio" : "Tocar audio"}>
        <Icon name={isPlaying ? "pause" : "play"} size={20} />
      </button>
      <div className="voice-note-body">
        <div className="voice-note-topline">
          <strong>{title}</strong>
          <span>{isPlaying ? "Reproduzindo" : "Toque para ouvir"}</span>
        </div>
        <button type="button" className="voice-wave" onClick={seekAudio} aria-label="Avancar audio">
          <span className="voice-wave-progress" style={{ width: `${progress}%` }} />
          {bars.map((height, index) => (
            <span key={`${height}-${index}`} className="voice-wave-bar" style={{ height }} />
          ))}
        </button>
        <div className="voice-note-footer">
          <span>{formatDuration(currentTime)}</span>
          <span>{formatDuration(duration)}</span>
        </div>
      </div>
    </div>
  );
}
