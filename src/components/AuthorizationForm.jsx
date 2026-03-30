import { useEffect, useState } from "react";
import { AudioRecorder } from "./AudioRecorder";

export function AuthorizationForm({ advance, assistantUser, existingAuthorization, onSave, onResend, onDelete }) {
  const [description, setDescription] = useState("");
  const [audioFile, setAudioFile] = useState(null);
  const [feedback, setFeedback] = useState("");

  useEffect(() => {
    setDescription(existingAuthorization?.description || "");
    setAudioFile(null);
  }, [existingAuthorization?.id, existingAuthorization?.description]);

  async function handleSubmit(event) {
    event.preventDefault();
    setFeedback("");
    try {
      await onSave({
        authorizationId: existingAuthorization?.id || "",
        advanceId: advance.id,
        assistantId: assistantUser.id,
        assistantName: assistantUser.nome,
        memberName: advance.usuarioNome,
        amount: advance.valor,
        description,
        audioFile,
        existingAuthorization,
        advanceDescription: advance.descricao,
        prazoDias: advance.prazoDias,
        dataLimite: advance.dataLimite
      });
      setDescription("");
      setAudioFile(null);
      setFeedback("Autorizacao de repasse enviada com sucesso.");
    } catch (error) {
      setFeedback(error.message);
    }
  }

  async function handleResend() {
    setFeedback("");
    try {
      await onResend({
        authorizationId: existingAuthorization?.id || "",
        advanceId: advance.id,
        assistantId: assistantUser.id,
        assistantName: assistantUser.nome,
        memberName: advance.usuarioNome,
        amount: advance.valor,
        description,
        audioFile,
        existingAuthorization,
        advanceDescription: advance.descricao,
        prazoDias: advance.prazoDias,
        dataLimite: advance.dataLimite
      });
      setAudioFile(null);
      setFeedback("Repasse reenviado com sucesso.");
    } catch (error) {
      setFeedback(error.message);
    }
  }

  async function handleDelete() {
    if (!existingAuthorization) return;
    const confirmed = window.confirm("Excluir este repasse do auxiliar?");
    if (!confirmed) return;
    setFeedback("");
    try {
      await onDelete(existingAuthorization);
      setDescription("");
      setAudioFile(null);
      setFeedback("Repasse excluido com sucesso.");
    } catch (error) {
      setFeedback(error.message);
    }
  }

  return (
    <form className="panel form-grid compact section-panel" onSubmit={handleSubmit}>
      <div className="panel-heading">
        <div>
          <h3>{existingAuthorization ? "Editar autorizacao de repasse" : "Enviar autorizacao de repasse"}</h3>
          <p>
            {existingAuthorization
              ? "Atualize a observacao, reenvie ao auxiliar ou exclua esta autorizacao."
              : "Envie uma instrucao simples para o tesoureiro auxiliar."}
          </p>
        </div>
      </div>

      <label className="full-span">
        Observacao rapida
        <textarea
          rows="3"
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          placeholder="Ex.: entregar antes do culto de sabado"
        />
      </label>

      <label className="audio-upload">
        Anexar audio
        <input type="file" accept="audio/*" onChange={(event) => setAudioFile(event.target.files?.[0] || null)} />
      </label>

      <div className="full-span">
        <AudioRecorder onAudioReady={setAudioFile} />
        {audioFile ? <p className="helper-text">Audio pronto: {audioFile.name}</p> : null}
        {!audioFile && existingAuthorization?.audioName ? (
          <p className="helper-text">Audio atual: {existingAuthorization.audioName}</p>
        ) : null}
      </div>

      {feedback ? <p className="helper-text full-span">{feedback}</p> : null}

      <div className="full-span actions-row">
        <button className="button-primary" type="submit">
          {existingAuthorization ? "Salvar alteracoes da autorizacao" : "Enviar autorizacao de repasse"}
        </button>
        {existingAuthorization ? (
          <>
            <button className="button-ghost" type="button" onClick={handleResend}>
              Reenviar ao auxiliar
            </button>
            <button className="button-danger" type="button" onClick={handleDelete}>
              Excluir repasse
            </button>
          </>
        ) : null}
      </div>
    </form>
  );
}
