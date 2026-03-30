import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { AdvanceForm } from "../components/AdvanceForm";
import { AuthorizationForm } from "../components/AuthorizationForm";
import { PrintTermButton } from "../components/PrintTermButton";
import { SettlementForm } from "../components/SettlementForm";
import { StatusBadge } from "../components/StatusBadge";
import { SummaryCard } from "../components/SummaryCard";
import { Icon } from "../components/Icon";
import { useAppContext } from "../context/AppContext";
import { acmsLaunchLabel, formatCurrency, formatDate, formatMonthYear } from "../utils/format";

export function TreasurerPage() {
  const { advances, users, authorizations, history, session, actions } = useAppContext();
  const [selectedAdvanceId, setSelectedAdvanceId] = useState("");
  const [lastCreatedAdvanceId, setLastCreatedAdvanceId] = useState("");
  const [activeFilter, setActiveFilter] = useState("TODOS");
  const [searchQuery, setSearchQuery] = useState("");
  const [organizeBy, setOrganizeBy] = useState("mes");
  const [detailTab, setDetailTab] = useState("resumo");
  const [sidebarSection, setSidebarSection] = useState("dashboard");
  const [moduleTab, setModuleTab] = useState("pesquisar");
  const topRef = useRef(null);
  const listRef = useRef(null);
  const selectedAdvance = advances.find((item) => item.id === selectedAdvanceId) || advances[0];
  const assistantUser = session.assistantUser || users.find((item) => item.role === "assistant");
  const selectedMember = users.find((item) => item.id === selectedAdvance?.usuarioId);
  const publicPersonToken = selectedMember?.publicToken || selectedAdvance?.publicToken || "";

  useEffect(() => {
    if (!selectedAdvanceId && advances[0]?.id) {
      setSelectedAdvanceId(advances[0].id);
    }
  }, [advances, selectedAdvanceId]);

  const totals = useMemo(() => {
    return advances.reduce(
      (accumulator, advance) => {
        accumulator.total += Number(advance.valor || 0);
        accumulator[advance.status] = (accumulator[advance.status] || 0) + 1;
        accumulator.acmsPendente += advance.lancadoAcms ? 0 : 1;
        return accumulator;
      },
      { total: 0, PENDENTE: 0, ATRASADO: 0, PRESTADO: 0, JUSTIFICADO: 0, acmsPendente: 0 }
    );
  }, [advances]);

  const filteredAdvances = useMemo(() => {
    const normalizedQuery = searchQuery.trim().toLowerCase();
    return advances
      .filter((item) => {
        if (activeFilter === "TODOS") return true;
        if (activeFilter === "ACMS_PENDENTE") return !item.lancadoAcms;
        return item.status === activeFilter;
      })
      .filter((item) => {
        if (!normalizedQuery) return true;
        return (
          item.usuarioNome.toLowerCase().includes(normalizedQuery) ||
          item.descricao.toLowerCase().includes(normalizedQuery)
        );
      });
  }, [advances, activeFilter, searchQuery]);

  const groupedAdvances = useMemo(() => {
    const groups = new Map();
    filteredAdvances.forEach((advance) => {
      const dateValue = advance.dataAdiantamento || advance.dataLimite;
      const key =
        organizeBy === "dia"
          ? new Date(dateValue).toISOString().slice(0, 10)
          : `${new Date(dateValue).getFullYear()}-${String(new Date(dateValue).getMonth() + 1).padStart(2, "0")}`;
      if (!groups.has(key)) {
        groups.set(key, {
          key,
          label: organizeBy === "dia" ? formatDate(dateValue) : formatMonthYear(dateValue),
          items: []
        });
      }
      groups.get(key).items.push(advance);
    });
    return Array.from(groups.values());
  }, [filteredAdvances, organizeBy]);

  async function handleCreateAdvance(payload) {
    const created = await actions.createAdvance(payload);
    setSelectedAdvanceId(created.id);
    setLastCreatedAdvanceId(created.id);
    setDetailTab("resumo");
  }

  async function handleCreateMember(payload) {
    return actions.createMember(payload);
  }

  async function handleSaveSettlement(payload) {
    await actions.saveSettlement(selectedAdvance, payload);
  }

  async function handleAuthorize(payload) {
    await actions.createAuthorization(payload);
  }

  async function handleToggleAcmsLaunch(advance, launched) {
    await actions.toggleAcmsLaunch(advance.id, launched);
  }

  async function handleSignOut() {
    await actions.signOutTreasurer();
  }

  async function handleDeleteAdvance() {
    if (!selectedAdvance) return;
    const confirmed = window.confirm(`Excluir o adiantamento de ${selectedAdvance.usuarioNome}?`);
    if (!confirmed) return;
    const currentIndex = advances.findIndex((item) => item.id === selectedAdvance.id);
    const nextAdvance = advances[currentIndex + 1] || advances[currentIndex - 1] || null;
    await actions.deleteAdvance(selectedAdvance.id);
    setSelectedAdvanceId(nextAdvance?.id || "");
  }

  function scrollToRef(ref) {
    ref.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function handleSidebarNavigate(section) {
    setSidebarSection(section);
    if (section === "dashboard") {
      setModuleTab("pesquisar");
      setActiveFilter("TODOS");
      setDetailTab("resumo");
      scrollToRef(topRef);
      return;
    }
    if (section === "adiantamentos") {
      setModuleTab("adiantamento");
      setActiveFilter("TODOS");
      setDetailTab("resumo");
      scrollToRef(listRef);
      return;
    }
    if (section === "acms") {
      setModuleTab("acms");
      setActiveFilter("ACMS_PENDENTE");
      setDetailTab("acms");
      const nextAdvance = advances.find((item) => !item.lancadoAcms);
      if (nextAdvance) setSelectedAdvanceId(nextAdvance.id);
      scrollToRef(listRef);
    }
  }

  const selectedHistory = history.filter((item) => item.advanceId === selectedAdvance?.id).slice(0, 8);
  const selectedAuthorization = authorizations.find((item) => item.advanceId === selectedAdvance?.id);

  return (
    <main className="dashboard-shell">
      <aside className="dashboard-sidebar">
        <div className="brand-mark">AC</div>
        <nav className="sidebar-nav">
          <button
            className={`sidebar-item ${sidebarSection === "dashboard" ? "is-active" : ""}`}
            type="button"
            onClick={() => handleSidebarNavigate("dashboard")}
          >
            <Icon name="dashboard" size={19} />
            Dashboard
          </button>
          <button
            className={`sidebar-item ${sidebarSection === "adiantamentos" ? "is-active" : ""}`}
            type="button"
            onClick={() => handleSidebarNavigate("adiantamentos")}
          >
            <Icon name="wallet" size={19} />
            Adiantamentos
          </button>
          <button
            className={`sidebar-item ${sidebarSection === "acms" ? "is-active" : ""}`}
            type="button"
            onClick={() => handleSidebarNavigate("acms")}
          >
            <Icon name="acms" size={19} />
            ACMS
          </button>
          <Link className="sidebar-item" to="/arquivos">
            <Icon name="folder" size={19} />
            Arquivos
          </Link>
          <Link className="sidebar-item" to="/auxiliar">
            <Icon name="user" size={19} />
            Auxiliar
          </Link>
        </nav>
      </aside>

      <section className="dashboard-main">
        <header ref={topRef} className="dashboard-topbar panel">
          <div>
            <span className="eyebrow">Saidas</span>
            <h1>Adiantamento</h1>
            <p>{session.currentUser?.nome} - Tesouraria Central</p>
          </div>
          <div className="actions-row topbar-actions">
            <button className="icon-button" type="button" aria-label="Alertas">
              <Icon name="bell" size={18} />
            </button>
            <button className="button-primary" type="button" onClick={() => handleSidebarNavigate("adiantamentos")}>
              + Novo
            </button>
            <button className="button-ghost" onClick={handleSignOut}>
              Sair
            </button>
          </div>
        </header>

        <section className="mobile-nav panel">
          <button
            className={`mobile-nav-item ${sidebarSection === "dashboard" ? "is-active" : ""}`}
            type="button"
            onClick={() => handleSidebarNavigate("dashboard")}
          >
            <Icon name="dashboard" size={16} />
            Dashboard
          </button>
          <button
            className={`mobile-nav-item ${sidebarSection === "adiantamentos" ? "is-active" : ""}`}
            type="button"
            onClick={() => handleSidebarNavigate("adiantamentos")}
          >
            <Icon name="wallet" size={16} />
            Adiantamentos
          </button>
          <button
            className={`mobile-nav-item ${sidebarSection === "acms" ? "is-active" : ""}`}
            type="button"
            onClick={() => handleSidebarNavigate("acms")}
          >
            <Icon name="acms" size={16} />
            ACMS
          </button>
          <Link className="mobile-nav-item" to="/arquivos">
            <Icon name="folder" size={16} />
            Arquivos
          </Link>
          <Link className="mobile-nav-item" to="/auxiliar">
            <Icon name="user" size={16} />
            Auxiliar
          </Link>
        </section>

        <section className="module-tabs panel">
          {[
            ["pesquisar", "Pesquisar"],
            ["adiantamento", "Adiantamento"],
            ["acms", "Controle ACMS"]
          ].map(([value, label]) => (
            <button
              key={value}
              type="button"
              className={`module-tab ${moduleTab === value ? "is-active" : ""}`}
              onClick={() => {
                setModuleTab(value);
                if (value === "acms") {
                  setActiveFilter("ACMS_PENDENTE");
                  setDetailTab("acms");
                } else if (value === "pesquisar") {
                  setActiveFilter("TODOS");
                  setDetailTab("resumo");
                }
              }}
            >
              {label}
            </button>
          ))}
        </section>

        <section className="summary-grid compact-summary">
          <SummaryCard title="Total adiantado" value={formatCurrency(totals.total)} accent="blue" />
          <SummaryCard title="Pendentes" value={totals.PENDENTE} accent="sand" />
          <SummaryCard title="Atrasados" value={totals.ATRASADO} accent="red" />
          <SummaryCard title="Prestados" value={totals.PRESTADO + totals.JUSTIFICADO} accent="green" />
          <SummaryCard title="Falta no ACMS" value={totals.acmsPendente} accent="sand" />
        </section>

        <section className="dashboard-grid">
          <div className="board-column">
            {moduleTab === "adiantamento" ? (
              <AdvanceForm
                users={users}
                advances={advances}
                currentUser={session.currentUser}
                onSave={handleCreateAdvance}
                onCreateMember={handleCreateMember}
              />
            ) : null}

            <section ref={listRef} className="panel list-panel">
              <div className="panel-heading">
                <div>
                  <h3>{moduleTab === "acms" ? "Pendencias de lancamento ACMS" : "Pesquisar adiantamentos"}</h3>
                  <p>
                    {moduleTab === "acms"
                      ? "Veja apenas os registros que ainda precisam ser lancados no ACMS."
                      : "Acompanhe situacao, valor e o que ainda falta lancar no ACMS."}
                  </p>
                </div>
              </div>

              <div className="list-toolbar">
                <div className="search-wrap">
                  <Icon name="search" size={18} className="search-icon" />
                  <input
                    className="search-input"
                    type="search"
                    placeholder="Buscar responsavel ou finalidade"
                    value={searchQuery}
                    onChange={(event) => setSearchQuery(event.target.value)}
                  />
                </div>
                <div className="organize-wrap">
                  <label htmlFor="organize-by">Organizar por</label>
                  <select id="organize-by" value={organizeBy} onChange={(event) => setOrganizeBy(event.target.value)}>
                    <option value="mes">Mes</option>
                    <option value="dia">Dia</option>
                  </select>
                </div>
                <div className="filter-row">
                  {[
                    ["TODOS", "Todos"],
                    ["PENDENTE", "Pendentes"],
                    ["ATRASADO", "Atrasados"],
                    ["PRESTADO", "Prestados"],
                    ["JUSTIFICADO", "Justificados"],
                    ["ACMS_PENDENTE", "Falta ACMS"]
                  ].map(([value, label]) => (
                    <button
                      key={value}
                      type="button"
                      className={`filter-chip ${activeFilter === value ? "is-active" : ""}`}
                      onClick={() => setActiveFilter(value)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="list-table">
                {groupedAdvances.map((group) => (
                  <section key={group.key} className="list-group">
                    <div className="group-header">{group.label}</div>
                    <div className="list-head">
                      <span>Nome</span>
                      <span>Valor</span>
                      <span>Prazo</span>
                      <span>Status</span>
                      <span>Acao</span>
                    </div>
                    {group.items.map((advance) => (
                      <button
                        key={advance.id}
                        className={`list-row ${selectedAdvance?.id === advance.id ? "is-active" : ""}`}
                        onClick={() => setSelectedAdvanceId(advance.id)}
                      >
                        <div className="row-main">
                          <strong>{advance.usuarioNome}</strong>
                          <span>{advance.descricao}</span>
                          <small className="item-subline">{acmsLaunchLabel(advance.lancadoAcms)}</small>
                        </div>
                        <strong>{formatCurrency(advance.valor)}</strong>
                        <span>{advance.prazoDias} dias</span>
                        <StatusBadge status={advance.status} />
                        <span className="row-action">
                          Verificar
                          <Icon name="chevron" size={14} />
                        </span>
                      </button>
                    ))}
                  </section>
                ))}
              </div>
            </section>
          </div>

          <aside className="detail-column">
            {selectedAdvance ? (
              <section className="panel detail-panel">
                <div className="panel-heading">
                  <div>
                    <h3>Detalhes do adiantamento</h3>
                    <p>Responsavel: {selectedAdvance.usuarioNome}</p>
                  </div>
                  <PrintTermButton
                    advance={selectedAdvance}
                    onPrinted={() => actions.registerTermPrinted(selectedAdvance.id)}
                  />
                </div>

                {lastCreatedAdvanceId === selectedAdvance.id ? (
                  <div className="notice-banner">
                    Adiantamento salvo. A nota para impressao ja esta pronta para ser gerada.
                  </div>
                ) : null}

                <div className="detail-tabs">
                  {[
                    ["resumo", "Resumo"],
                    ["acms", "ACMS"],
                    ["repasse", "Repasse"],
                    ["historico", "Historico"]
                  ].map(([value, label]) => (
                    <button
                      key={value}
                      type="button"
                      className={`detail-tab ${detailTab === value ? "is-active" : ""}`}
                      onClick={() => setDetailTab(value)}
                    >
                      {label}
                    </button>
                  ))}
                </div>

                {detailTab === "resumo" ? (
                  <div className="detail-grid">
                    <div>
                      <span>Valor</span>
                      <strong>{formatCurrency(selectedAdvance.valor)}</strong>
                    </div>
                    <div>
                      <span>Status</span>
                      <StatusBadge status={selectedAdvance.status} />
                    </div>
                    <div>
                      <span>Data</span>
                      <strong>{formatDate(selectedAdvance.dataAdiantamento)}</strong>
                    </div>
                    <div>
                      <span>Vencimento</span>
                      <strong>{formatDate(selectedAdvance.dataLimite)}</strong>
                    </div>
                    <div>
                      <span>Total usado</span>
                      <strong>{formatCurrency(selectedAdvance.totalComprovado)}</strong>
                    </div>
                    <div>
                      <span>Diferenca</span>
                      <strong>{formatCurrency(selectedAdvance.valor - Number(selectedAdvance.totalComprovado || 0))}</strong>
                    </div>
                    <div className="full-span">
                      <span>Descricao</span>
                      <p>{selectedAdvance.descricao}</p>
                    </div>
                    <div className="full-span">
                      <span>Justificativa</span>
                      <p>{selectedAdvance.justificativa || "Sem justificativa registrada."}</p>
                    </div>
                    <div className="full-span">
                      <span>Link publico</span>
                      <a href={`/publico/${publicPersonToken}`} target="_blank" rel="noreferrer">
                        /publico/{publicPersonToken}
                      </a>
                    </div>
                  </div>
                ) : null}

                {detailTab === "acms" ? (
                  <div className="detail-tab-panel">
                    <div className="detail-grid compact-grid">
                      <div>
                        <span>ACMS</span>
                        <strong>{acmsLaunchLabel(selectedAdvance.lancadoAcms)}</strong>
                      </div>
                      <div>
                        <span>Data ACMS</span>
                        <strong>{selectedAdvance.dataLancamentoAcms ? formatDate(selectedAdvance.dataLancamentoAcms) : "-"}</strong>
                      </div>
                    </div>
                    <SettlementForm advance={selectedAdvance} onSave={handleSaveSettlement} />
                    <div className="actions-row">
                      <button
                        type="button"
                        className={selectedAdvance.lancadoAcms ? "button-ghost" : "button-primary"}
                        onClick={() => handleToggleAcmsLaunch(selectedAdvance, !selectedAdvance.lancadoAcms)}
                      >
                        {selectedAdvance.lancadoAcms ? "Remover marcacao ACMS" : "Marcar como lancado no ACMS"}
                      </button>
                    </div>
                  </div>
                ) : null}

                {detailTab === "repasse" ? (
                  <div className="detail-tab-panel">
                    {selectedAdvance && assistantUser ? (
                      <AuthorizationForm advance={selectedAdvance} assistantUser={assistantUser} onSave={handleAuthorize} />
                    ) : null}
                    {selectedAuthorization ? (
                      <div className="callout-box">
                        <strong>Repasse autorizado ao auxiliar</strong>
                        <p>{selectedAuthorization.description || "Sem observacao adicional."}</p>
                        <p>Status da ordem: {selectedAuthorization.status}</p>
                        {selectedAuthorization.audioName ? <p>Audio: {selectedAuthorization.audioName}</p> : null}
                      </div>
                    ) : null}
                  </div>
                ) : null}

                {detailTab === "historico" ? (
                  <section className="history-block">
                    <div className="timeline">
                      {selectedHistory.map((item) => (
                        <article key={item.id} className="timeline-item">
                          <strong>{item.message}</strong>
                          <span>{formatDate(item.createdAt)}</span>
                        </article>
                      ))}
                    </div>
                  </section>
                ) : null}

                <div className="actions-row">
                  <button type="button" className="button-danger" onClick={handleDeleteAdvance}>
                    Excluir adiantamento
                  </button>
                </div>
              </section>
            ) : null}
          </aside>
        </section>
      </section>
    </main>
  );
}
