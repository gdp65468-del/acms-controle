import { useState } from "react";
import { AudioRecorder } from "./AudioRecorder";

export function AuthorizationForm({ advance, assistantUser, onSave }) {
  const [description, setDescription] = useState("");
  const [audioFile, setAudioFile] = useState(null);
  const [feedback, setFeedback] = useState("");
  const [shareData, setShareData] = useState(null);

  async function handleSubmit(event) {
    event.preventDefault();
    setFeedback("");
    try {
      const result = await onSave({
        advanceId: advance.id,
        assistantId: assistantUser.id,
        assistantName: assistantUser.nome,
        memberName: advance.usuarioNome,
        amount: advance.valor,
        description,
        audioFile,
        advanceDescription: advance.descricao,
        prazoDias: advance.prazoDias,
        dataLimite: advance.dataLimite
      });
      setDescription("");
      setAudioFile(null);
      setFeedback("Repasse autorizado com sucesso.");
      setShareData(result || null);
    } catch (error) {
      setFeedback(error.message);
    }
  }

  return (
    <form className="panel form-grid compact section-panel" onSubmit={handleSubmit}>
      <div className="panel-heading">
        <div>
          <h3>Autorizar repasse</h3>
          <p>Envie uma instrucao simples para o tesoureiro auxiliar.</p>
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
      </div>

      {feedback ? <p className="helper-text full-span">{feedback}</p> : null}

      {shareData?.assistantLink ? (
        <div className="callout-box full-span">
          <strong>Link para o auxiliar</strong>
          <p>Envie este link com o PIN para o tesoureiro auxiliar acessar quando precisar.</p>
          <p>
            <strong>Link:</strong> {shareData.assistantLink}
          </p>
          <p>
            <strong>PIN:</strong> {shareData.assistantPin || assistantUser.pin || "1234"}
          </p>
        </div>
      ) : null}

      <div className="full-span actions-row">
        <button className="button-primary" type="submit">
          Autorizar repasse
        </button>
      </div>
    </form>
  );
}
