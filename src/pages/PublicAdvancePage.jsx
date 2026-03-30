import { useMemo } from "react";
import { useParams } from "react-router-dom";
import { Icon } from "../components/Icon";
import { StatusBadge } from "../components/StatusBadge";
import { useAppContext } from "../context/AppContext";
import { formatCurrency, formatDate } from "../utils/format";

const FINAL_STATUSES = new Set(["PRESTADO", "JUSTIFICADO"]);

export function PublicAdvancePage() {
  const { token } = useParams();
  const { advances, users } = useAppContext();

  const publicData = useMemo(() => {
    const member = users.find((item) => item.role === "member" && item.publicToken === token);
    const referenceAdvance = advances.find((item) => item.publicToken === token);
    const memberId = member?.id || referenceAdvance?.usuarioId || "";

    if (!memberId) {
      return null;
    }

    const memberAdvances = advances
      .filter((item) => item.usuarioId === memberId && !FINAL_STATUSES.has(item.status))
      .sort((left, right) => new Date(right.dataAdiantamento).getTime() - new Date(left.dataAdiantamento).getTime());

    return {
      memberName: member?.nome || referenceAdvance?.usuarioNome || "Responsavel",
      advances: memberAdvances
    };
  }, [advances, token, users]);

  return (
    <main className="landing-shell dark-shell">
      <section className="hero-card public-card consult-panel">
        {publicData ? (
          <>
            <div className="landing-topline">
              <span className="eyebrow">Consulta publica</span>
              <span className="landing-badge">Adiantamentos em aberto</span>
            </div>
            <h1>{publicData.memberName}</h1>
            <p>Este link mostra todos os adiantamentos que ainda nao foram finalizados para esta pessoa.</p>

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
                        <span>Valor</span>
                        <strong>{formatCurrency(advance.valor)}</strong>
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
                  </article>
                ))}
              </div>
            ) : (
              <div className="callout-box">
                <strong>Nenhum adiantamento em aberto.</strong>
                <p className="helper-text">Todos os registros desta pessoa ja foram finalizados pela tesouraria.</p>
              </div>
            )}

            <div className="consult-footer">
              <Icon name="user" size={18} />
              <p className="helper-text">Para qualquer ajuste ou confirmacao, procure a tesouraria da igreja.</p>
            </div>
          </>
        ) : (
          <>
            <h1>Link nao encontrado</h1>
            <p>Verifique o endereco informado pela tesouraria.</p>
          </>
        )}
      </section>
    </main>
  );
}
