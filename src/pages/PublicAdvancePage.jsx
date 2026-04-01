import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { Icon } from "../components/Icon";
import { StatusBadge } from "../components/StatusBadge";
import { appService } from "../services/appService";
import { formatCurrency, formatDate, getOutstandingAmount } from "../utils/format";

export function PublicAdvancePage() {
  const { token = "" } = useParams();
  const [publicData, setPublicData] = useState(null);
  const [accessCode, setAccessCode] = useState("");
  const [loading, setLoading] = useState(true);
  const [unlocking, setUnlocking] = useState(false);
  const [error, setError] = useState("");
  const [needsCode, setNeedsCode] = useState(true);

  useEffect(() => {
    setPublicData(null);
    setError("");
    setAccessCode("");

    if (!token) {
      setNeedsCode(false);
      setLoading(false);
      return;
    }

    // Public links now require the access code on every new page open.
    appService.lockPublicAdvance(token);
    setNeedsCode(true);
    setLoading(false);
  }, [token]);

  async function handleUnlock(event) {
    event.preventDefault();
    if (!token) return;

    try {
      setUnlocking(true);
      setError("");
      const payload = await appService.unlockPublicAdvance(token, accessCode);
      setPublicData(payload.publicData || null);
      setNeedsCode(false);
      setAccessCode("");
    } catch (unlockError) {
      const message = unlockError?.message || "Nao foi possivel validar o codigo.";
      setPublicData(null);
      setNeedsCode(!message.toLowerCase().includes("link nao encontrado"));
      setError(message);
    } finally {
      setUnlocking(false);
      setLoading(false);
    }
  }

  function handleLock() {
    appService.lockPublicAdvance(token);
    setPublicData(null);
    setNeedsCode(true);
    setError("");
  }

  const showNotFound = !loading && !needsCode && !publicData;

  return (
    <main className="landing-shell dark-shell">
      <section className="hero-card public-card consult-panel">
        {loading ? (
          <>
            <h1>Carregando link publico</h1>
            <p>Estamos validando este acesso para mostrar os adiantamentos em aberto.</p>
          </>
        ) : showNotFound ? (
          <>
            <h1>Link nao encontrado</h1>
            <p>Verifique o endereco informado pela tesouraria.</p>
          </>
        ) : needsCode ? (
          <>
            <div className="landing-topline">
              <span className="eyebrow">Consulta publica</span>
              <span className="landing-badge">Codigo necessario</span>
            </div>
            <h1>Acesso aos adiantamentos</h1>
            <p>Digite o codigo informado pela tesouraria para abrir este link publico.</p>

            <form className="pin-form" onSubmit={handleUnlock}>
              <label>
                Codigo de acesso
                <input
                  inputMode="numeric"
                  maxLength="8"
                  value={accessCode}
                  onChange={(event) => setAccessCode(event.target.value.replace(/\D/g, ""))}
                  placeholder="Digite o codigo"
                />
              </label>

              <div className="actions-row">
                <button className="button-primary" type="submit" disabled={unlocking}>
                  {unlocking ? "Validando..." : "Abrir link"}
                </button>
              </div>
            </form>

            {error ? <p className="helper-text">{error}</p> : null}

            <div className="consult-footer">
              <Icon name="user" size={18} />
              <p className="helper-text">Se voce nao recebeu o codigo, solicite o acesso para a tesouraria.</p>
            </div>
          </>
        ) : (
          <>
            <div className="landing-topline">
              <span className="eyebrow">Consulta publica</span>
              <span className="landing-badge">Adiantamentos em aberto</span>
            </div>
            <h1>{publicData.memberName}</h1>
            <p>Esta pagina mostra, de forma simples, os adiantamentos que ainda estao em aberto para esta pessoa.</p>

            <div className="callout-box">
              <strong>O que e um adiantamento?</strong>
              <p className="helper-text">
                Adiantamento e um valor entregue antes para pagar uma necessidade do departamento ou da igreja.
              </p>
              <p className="helper-text">
                Depois, esse gasto precisa ser comprovado com nota fiscal. Isso ajuda a manter a administracao
                organizada e mostra com clareza como o dinheiro da igreja foi usado.
              </p>
            </div>

            <div className="callout-box">
              <strong>Como ler estas informacoes</strong>
              <p className="helper-text">
                Valor total: e o valor que foi entregue para gastar.
              </p>
              <p className="helper-text">
                Total comprovado: e a parte que ja foi apresentada com nota fiscal.
              </p>
              <p className="helper-text">
                Valor restante: e o que ainda falta comprovar para fechar esse relatorio.
              </p>
            </div>

            {publicData.advances.length ? (
              <div className="public-advance-list">
                {publicData.advances.map((advance) => (
                  <article key={advance.id} className="public-advance-item">
                    <div className="public-advance-top">
                      <strong>{advance.descricao}</strong>
                      <StatusBadge status={advance.status} />
                    </div>
                    <div className="detail-grid">
                      <div>
                        <span>Valor total</span>
                        <strong>{formatCurrency(advance.valor)}</strong>
                      </div>
                      <div>
                        <span>Total comprovado</span>
                        <strong>{formatCurrency(advance.totalComprovado || 0)}</strong>
                      </div>
                      <div>
                        <span>Valor restante</span>
                        <strong>{formatCurrency(getOutstandingAmount(advance))}</strong>
                      </div>
                      <div>
                        <span>Data do adiantamento</span>
                        <strong>{formatDate(advance.dataAdiantamento)}</strong>
                      </div>
                      <div>
                        <span>Data limite</span>
                        <strong>{formatDate(advance.dataLimite)}</strong>
                      </div>
                      <div>
                        <span>Prazo</span>
                        <strong>{advance.prazoDias} dias</strong>
                      </div>
                    </div>

                    {getOutstandingAmount(advance) > 0 ? (
                      <div className="callout-box">
                        <strong>Ainda falta comprovar {formatCurrency(getOutstandingAmount(advance))}.</strong>
                        <p className="helper-text">
                          Isso quer dizer que a tesouraria ainda aguarda a nota fiscal desse valor.
                        </p>
                      </div>
                    ) : null}
                  </article>
                ))}
              </div>
            ) : (
              <div className="callout-box">
                <strong>Nenhum adiantamento em aberto.</strong>
                <p className="helper-text">
                  Todos os registros desta pessoa ja foram fechados e organizados pela tesouraria.
                </p>
              </div>
            )}

            <div className="actions-row">
              <button className="button-ghost" type="button" onClick={handleLock}>
                Trocar codigo
              </button>
            </div>

            <div className="consult-footer">
              <Icon name="user" size={18} />
              <p className="helper-text">
                Se precisar corrigir alguma informacao ou confirmar algum gasto, procure a tesouraria da igreja.
              </p>
            </div>
          </>
        )}
      </section>
    </main>
  );
}
