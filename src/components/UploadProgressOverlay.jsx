export function UploadProgressOverlay({ progress }) {
  if (!progress?.active) return null;

  const total = Math.max(1, Number(progress.total || 1));
  const completed = Math.min(total, Math.max(0, Number(progress.completed || 0)));
  const percent = Math.round((completed / total) * 100);
  const currentName = progress.currentName || "Preparando arquivo";

  return (
    <div className="upload-progress-overlay" role="status" aria-live="polite">
      <div className="upload-progress-card">
        <div className="upload-progress-topline">
          <strong>Enviando arquivos</strong>
          <span>{percent}%</span>
        </div>
        <div className="upload-progress-bar" aria-hidden="true">
          <span style={{ width: `${percent}%` }} />
        </div>
        <p>
          {completed} de {total} enviado(s). Agora: {currentName}
        </p>
      </div>
    </div>
  );
}
