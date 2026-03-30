import { Link, useNavigate } from "react-router-dom";
import { useEffect } from "react";
import { Icon } from "../components/Icon";
import { useAppContext } from "../context/AppContext";

export function LandingPage() {
  const navigate = useNavigate();
  const { actions, session, message, setMessage } = useAppContext();

  useEffect(() => {
    if (session.currentUser?.role === "treasurer") {
      navigate("/app", { replace: true });
    }
  }, [navigate, session.currentUser]);

  async function handleGoogleLogin() {
    try {
      setMessage("");
      await actions.signInTreasurer();
    } catch (error) {
      setMessage(error?.message || "Nao foi possivel entrar agora.");
    }
  }

  return (
    <main className="landing-shell dark-shell">
      <section className="hero-card landing-panel">
        <div className="landing-topline">
          <span className="eyebrow">Sistema de Tesouraria</span>
          <span className="landing-badge">Adiantamentos</span>
        </div>
        <h1>ACMS Controle Operacional</h1>
        <p>
          Organize saidas, acompanhe repasses, marque lancamentos no ACMS e mantenha o historico da
          tesouraria em um so painel.
        </p>

        <div className="landing-grid">
          <div className="landing-metric">
            <Icon name="wallet" size={18} />
            <span>Controle de adiantamentos</span>
          </div>
          <div className="landing-metric">
            <Icon name="acms" size={18} />
            <span>Lembrete de lancamento ACMS</span>
          </div>
          <div className="landing-metric">
            <Icon name="mic" size={18} />
            <span>Repasse com audio</span>
          </div>
        </div>

        <div className="actions-row">
          <button className="button-primary" onClick={handleGoogleLogin}>
            Entrar como tesouraria
          </button>
          <Link className="button-ghost" to="/auxiliar">
            Abrir area do auxiliar
          </Link>
        </div>

        {session.currentUser ? (
          <button className="text-link" onClick={() => navigate("/app")}>
            Continuar sessao de {session.currentUser.nome}
          </button>
        ) : null}
        {message ? <p className="helper-text">{message}</p> : null}
        {!actions.isFirebaseEnabled ? (
          <p className="helper-text">Modo demonstracao ativo. Configure o arquivo `.env` para usar Firebase real.</p>
        ) : null}
      </section>
    </main>
  );
}
