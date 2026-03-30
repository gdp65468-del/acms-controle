import { useEffect, useMemo, useState } from "react";
import { Icon } from "../components/Icon";
import { StatusBadge } from "../components/StatusBadge";
import { VoiceNotePlayer } from "../components/VoiceNotePlayer";
import { useAppContext } from "../context/AppContext";
import { formatCurrency, formatDate } from "../utils/format";

const FONT_SCALE_KEY = "acms-assistant-font-scale";

function PinGate({ assistantUser, onUnlock }) {
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");

  async function handleSubmit(event) {
    event.preventDefault();
    setError("");
    try {
      await onUnlock(pin, assistantUser);
    } catch (unlockError) {
      setError(unlockError.message);
    }
  }

  return (
    <main className="assistant-shell dark-shell">
      <section className="assistant-card large-ui assistant-panel">
        <span className="eyebrow">Area do tesoureiro auxiliar</span>
        <h1>Entrar com PIN</h1>
        <p>Use o PIN de 4 digitos para abrir suas ordens autorizadas.</p>
        <form className="pin-form" onSubmit={handleSubmit}>
          <input
            inputMode="numeric"
            maxLength="4"
            pattern="[0-9]*"
            value={pin}
            onChange={(event) => setPin(event.target.value.replace(/\D/g, ""))}
            placeholder="0000"
          />
          <button className="button-primary" type="submit">
            Entrar
          </button>
        </form>
        {error ? <p className="form-error">{error}</p> : null}
        <p className="helper-text">No modo demonstracao, o PIN inicial e 1234.</p>
      </section>
    </main>
  );
}

export function AssistantPage() {
  const { authorizations, session, advances, actions } = useAppContext();
  const assistantUser = session.assistantUser;
  const [selectedAuthorizationId, setSelectedAuthorizationId] = useState("");
  const [fontScale, setFontScale] = useState(() => Number(localStorage.getItem(FONT_SCALE_KEY) || 1));
  const [isMobileView, setIsMobileView] = useState(() =>
    typeof window !== "undefined" ? window.innerWidth <= 980 : false
  );

  const assignedAuthorizations = useMemo(() => {
    if (!assistantUser) return [];
    return authorizations.filter((item) => item.assistantId === assistantUser.id);
  }, [authorizations, assistantUser]);

  useEffect(() => {
    if (typeof window === "undefined") return undefined;
    function handleResize() {
      setIsMobileView(window.innerWidth <= 980);
    }
    handleResize();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  useEffect(() => {
    if (!assignedAuthorizations.length) {
      setSelectedAuthorizationId("");
      return;
    }

    const selectedStillExists = assignedAuthorizations.some((item) => item.id === selectedAuthorizationId);
    if (selectedStillExists) return;

    if (isMobileView) {
      setSelectedAuthorizationId("");
      return;
    }

    setSelectedAuthorizationId((current) => current || assignedAuthorizations[0].id);
  }, [assignedAuthorizations, selectedAuthorizationId, isMobileView]);

  const selectedAuthorization = assignedAuthorizations.find((item) => item.id === selectedAuthorizationId) || null;
  const advance = advances.find((item) => item.id === selectedAuthorization?.advanceId);

  function updateFontScale(nextValue) {
    const normalized = Math.min(1.3, Math.max(0.9, Number(nextValue.toFixed(2))));
    setFontScale(normalized);
    localStorage.setItem(FONT_SCALE_KEY, String(normalized));
  }

  if (!assistantUser) {
    return (
      <main className="assistant-shell dark-shell">
        <section className="assistant-card large-ui assistant-panel">
          <h1>Area do auxiliar indisponivel</h1>
          <p>Cadastre um usuario com papel `assistant` para liberar esta area no Firebase.</p>
        </section>
      </main>
    );
  }

  if (!actions.isAssistantUnlocked()) {
    return <PinGate assistantUser={assistantUser} onUnlock={actions.unlockAssistant} />;
  }

  return (
    <main className="assistant-shell dark-shell" style={{ "--assistant-font-scale": fontScale }}>
      <section className={`assistant-app-shell ${selectedAuthorization ? "showing-chat" : "showing-list"}`}>
        <aside className={`assistant-inbox panel ${selectedAuthorization ? "is-hidden-mobile" : ""}`}>
          <header className="assistant-inbox-header">
            <div>
              <span className="eyebrow">Auxiliar</span>
              <h1>Pessoas para entregar</h1>
            </div>
            <div className="assistant-header-actions">
              <div className="assistant-font-controls" aria-label="Controle do tamanho da letra">
                <button type="button" className="assistant-font-button" onClick={() => updateFontScale(fontScale - 0.1)}>
                  A-
                </button>
                <button type="button" className="assistant-font-button" onClick={() => updateFontScale(1)}>
                  A
                </button>
                <button type="button" className="assistant-font-button" onClick={() => updateFontScale(fontScale + 0.1)}>
                  A+
                </button>
              </div>
              <button className="button-ghost assistant-lock-button" onClick={() => actions.lockAssistant()}>
                <Icon name="lock" size={16} />
              </button>
            </div>
          </header>

          <div className="assistant-profile-strip">
            <div className="assistant-avatar">{assistantUser.nome?.slice(0, 2).toUpperCase() || "AX"}</div>
            <div>
              <strong>{assistantUser.nome}</strong>
              <p>Toque em uma pessoa para abrir a conversa</p>
            </div>
          </div>

          <div className="assistant-chat-list">
            {assignedAuthorizations.map((authorization) => (
              <button
                key={authorization.id}
                className={`assistant-chat-item ${selectedAuthorization?.id === authorization.id ? "is-active" : ""}`}
                onClick={() => setSelectedAuthorizationId(authorization.id)}
              >
                <div className="assistant-chat-avatar">{authorization.memberName.slice(0, 2).toUpperCase()}</div>
                <div className="assistant-chat-copy">
                  <div className="assistant-chat-top">
                    <strong>{authorization.memberName}</strong>
                    <span>{formatDate(authorization.createdAt)}</span>
                  </div>
                  <p>{authorization.description || "Toque para ver e ouvir a orientacao."}</p>
                  <div className="assistant-chat-meta">
                    <span>{formatCurrency(authorization.amount)}</span>
                    <StatusBadge status={authorization.status} />
                  </div>
                </div>
              </button>
            ))}
          </div>
        </aside>

        <section className={`assistant-message-frame panel ${selectedAuthorization ? "" : "is-empty-mobile"}`}>
          {selectedAuthorization ? (
            <>
              <header className="assistant-message-header">
                <button
                  type="button"
                  className="assistant-back-button"
                  onClick={() => setSelectedAuthorizationId("")}
                  aria-label="Voltar para a lista"
                >
                  <Icon name="arrowLeft" size={18} />
                </button>
                <div className="assistant-chat-avatar large">
                  {selectedAuthorization.memberName.slice(0, 2).toUpperCase()}
                </div>
                <div className="assistant-message-title">
                  <strong>{selectedAuthorization.memberName}</strong>
                  <span>{selectedAuthorization.status === "ENTREGUE" ? "Ja foi entregue" : "Pronto para entregar"}</span>
                </div>
                <StatusBadge status={selectedAuthorization.status} />
              </header>

              <div className="assistant-message-body">
                <div className="assistant-date-divider">
                  <span>{formatDate(selectedAuthorization.createdAt)}</span>
                </div>

                <article className="message-bubble message-bubble-incoming">
                  <span className="message-label">Tesouraria</span>
                  <strong className="message-amount">{formatCurrency(selectedAuthorization.amount)}</strong>
                  <p>{selectedAuthorization.description || "Repasse autorizado pela tesouraria."}</p>
                </article>

                {advance ? (
                  <article className="message-bubble message-bubble-system">
                    <span className="message-label">Finalidade</span>
                    <p>{advance.descricao}</p>
                    <div className="message-facts">
                      <span>Prazo: {advance.prazoDias} dias</span>
                      <span>Vencimento: {formatDate(advance.dataLimite)}</span>
                    </div>
                  </article>
                ) : null}

                {selectedAuthorization.audioUrl ? (
                  <article className="message-bubble message-bubble-incoming voice-bubble">
                    <div className="voice-badge">
                      <Icon name="mic" size={16} />
                      <span>Audio da tesouraria</span>
                    </div>
                    <VoiceNotePlayer src={selectedAuthorization.audioUrl} title="Instrucao de voz" />
                    {selectedAuthorization.audioName ? (
                      <span className="helper-text">{selectedAuthorization.audioName}</span>
                    ) : null}
                  </article>
                ) : (
                  <article className="message-bubble message-bubble-muted">
                    <span className="message-label">Audio</span>
                    <p>Nenhum audio enviado nesta autorizacao.</p>
                  </article>
                )}

                <article className="message-bubble message-bubble-outgoing">
                  <span className="message-label">Resumo rapido</span>
                  <div className="message-facts">
                    <span>Autorizado em {formatDate(selectedAuthorization.createdAt)}</span>
                    <span>{formatCurrency(selectedAuthorization.amount)}</span>
                  </div>
                  <p>
                    {selectedAuthorization.status === "ENTREGUE"
                      ? "Voce ja confirmou que o valor foi entregue."
                      : "Abra o audio, confirme os dados e marque a entrega quando repassar o valor."}
                  </p>
                </article>

                {selectedAuthorization.status === "ENTREGUE" ? (
                  <article className="message-bubble message-bubble-outgoing message-bubble-confirmed">
                    <span className="message-label">Confirmacao enviada</span>
                    <p>Entrega confirmada para a tesouraria. Esta conversa agora aparece em verde.</p>
                  </article>
                ) : null}
              </div>

              <footer className="assistant-message-composer">
                <button
                  className="button-primary button-large assistant-send-button"
                  disabled={selectedAuthorization.status === "ENTREGUE"}
                  onClick={() => actions.markAuthorizationDelivered(selectedAuthorization)}
                >
                  <Icon name="check" size={18} />
                  <span>
                    {selectedAuthorization.status === "ENTREGUE" ? "Entrega ja confirmada" : "Confirmar entrega"}
                  </span>
                </button>
              </footer>
            </>
          ) : (
            <div className="assistant-empty-state">
              <div className="assistant-chat-avatar large">+</div>
              <h2>Escolha uma pessoa</h2>
              <p>Toque em um nome da lista para abrir a conversa e ver os detalhes da entrega.</p>
            </div>
          )}
        </section>
      </section>
    </main>
  );
}
