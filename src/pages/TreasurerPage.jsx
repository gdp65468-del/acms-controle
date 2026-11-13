import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { AdvanceForm } from "../components/AdvanceForm";
import { AuthorizationForm } from "../components/AuthorizationForm";
import { AudioRecorder } from "../components/AudioRecorder";
import { PrintTermButton } from "../components/PrintTermButton";
import { SettlementForm } from "../components/SettlementForm";
import { StatusBadge } from "../components/StatusBadge";
import { SummaryCard } from "../components/SummaryCard";
import { VoiceNotePlayer } from "../components/VoiceNotePlayer";
import { Icon } from "../components/Icon";
import { useAppContext } from "../context/AppContext";
import { acmsLaunchLabel, formatCurrency, formatDate, formatMonthYear, getOutstandingAmount } from "../utils/format";
import {
  filterAdvances,
  getAdvanceTrashBlockReason,
  groupAdvancesByDate,
  groupAdvancesByPerson,
  isAdvanceDueSoon,
  isAdvanceInTrash,
  isAdvanceTrashEligible
} from "../utils/advanceView";

export function TreasurerPage() {
  const { advances, users, authorizations, history, session, actions } = useAppContext();
  const [selectedAdvanceId, setSelectedAdvanceId] = useState("");
  const [lastCreatedAdvanceId, setLastCreatedAdvanceId] = useState("");
  const [activeFilter, setActiveFilter] = useState("TODOS");
  const [searchQuery, setSearchQuery] = useState("");
  const [organizeBy, setOrganizeBy] = useState(() => localStorage.getItem("acms-advance-organize-by") || "pessoa");
  const [detailTab, setDetailTab] = useState("resumo");
  const [acmsFilter, setAcmsFilter] = useState("TODOS");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [selectedAdvanceIds, setSelectedAdvanceIds] = useState(() => new Set());
  const [selectedTrashIds, setSelectedTrashIds] = useState(() => new Set());
  const [expandedPeople, setExpandedPeople] = useState(() => new Set());
  const [isTrashOpen, setIsTrashOpen] = useState(false);
  const [sidebarSection, setSidebarSection] = useState("dashboard");
  const [moduleTab, setModuleTab] = useState("pesquisar");
  const [assistantPortalData, setAssistantPortalData] = useState(null);
  const [assistantPortalFeedback, setAssistantPortalFeedback] = useState("");
  const [assistantPinDraft, setAssistantPinDraft] = useState("");
  const [assistantSetupName, setAssistantSetupName] = useState("");
  const [publicAdvanceSettings, setPublicAdvanceSettings] = useState(null);
  const [publicAdvanceCodeDraft, setPublicAdvanceCodeDraft] = useState("777");
  const [publicAdvanceFeedback, setPublicAdvanceFeedback] = useState("");
  const [selectedAuxAuthorizationId, setSelectedAuxAuthorizationId] = useState("");
  const [auxChatDescription, setAuxChatDescription] = useState("");
  const [auxChatAudioFile, setAuxChatAudioFile] = useState(null);
  const [toastMessage, setToastMessage] = useState("");
  const [toastType, setToastType] = useState("success");
  const topRef = useRef(null);
  const listRef = useRef(null);
  const activeAdvances = advances.filter((item) => !isAdvanceInTrash(item));
  const trashedAdvances = advances.filter(isAdvanceInTrash);
  const selectedAdvance = advances.find((item) => item.id === selectedAdvanceId) || null;
  const assistantUser = session.assistantUser || users.find((item) => item.role === "assistant");
  const selectedMember = users.find((item) => item.id === selectedAdvance?.usuarioId);
  const publicPersonToken = selectedMember?.publicToken || selectedAdvance?.publicToken || "";

  useEffect(() => {
    if (session.currentUser?.id) {
      const saved = localStorage.getItem(`acms-advance-organize-by:${session.currentUser.id}`);
      if (saved) setOrganizeBy(saved);
    }
  }, [session.currentUser?.id]);

  useEffect(() => {
    localStorage.setItem("acms-advance-organize-by", organizeBy);
    if (session.currentUser?.id) {
      localStorage.setItem(`acms-advance-organize-by:${session.currentUser.id}`, organizeBy);
    }
  }, [organizeBy, session.currentUser?.id]);

  useEffect(() => {
    if (selectedAdvanceId && !activeAdvances.some((item) => item.id === selectedAdvanceId)) {
      setSelectedAdvanceId("");
    }
  }, [activeAdvances, selectedAdvanceId]);

  useEffect(() => {
    if (!assistantUser) return;
    actions
      .getAssistantPortalAccess(assistantUser)
      .then((data) => {
        setAssistantPortalData(data);
        setAssistantPinDraft(data.assistantPin || "");
      })
      .catch(() => {});
  }, [actions, assistantUser]);

  useEffect(() => {
    if (!session.currentUser?.id) return;
    actions
      .getPublicAdvanceSettings()
      .then((data) => {
        setPublicAdvanceSettings(data);
        setPublicAdvanceCodeDraft(data.accessCode || "777");
      })
      .catch(() => {});
  }, [actions, session.currentUser?.id]);

  useEffect(() => {
    setAssistantSetupName(assistantUser?.nome || "");
  }, [assistantUser?.id, assistantUser?.nome]);

  useEffect(() => {
    if (!toastMessage) return undefined;
    const timeout = window.setTimeout(() => setToastMessage(""), 3200);
    return () => window.clearTimeout(timeout);
  }, [toastMessage]);

  const totals = useMemo(() => {
    return activeAdvances.reduce(
      (accumulator, advance) => {
        accumulator.total += Number(advance.valor || 0);
        accumulator[advance.status] = (accumulator[advance.status] || 0) + 1;
        accumulator.acmsPendente += advance.lancadoAcms ? 0 : 1;
        return accumulator;
      },
      { total: 0, PENDENTE: 0, ATRASADO: 0, PRESTADO: 0, JUSTIFICADO: 0, acmsPendente: 0 }
    );
  }, [activeAdvances]);

  const filteredAdvances = useMemo(() => {
    return filterAdvances(activeAdvances, {
      query: searchQuery,
      status: activeFilter === "ACMS_PENDENTE" ? "TODOS" : activeFilter,
      acms: activeFilter === "ACMS_PENDENTE" ? "PENDENTE" : acmsFilter,
      from: dateFrom,
      to: dateTo
    });
  }, [activeAdvances, activeFilter, acmsFilter, dateFrom, dateTo, searchQuery]);

  useEffect(() => {
    setSelectedAdvanceIds((current) => {
      const visible = new Set(filteredAdvances.map((item) => item.id));
      const next = new Set([...current].filter((id) => visible.has(id)));
      return next.size === current.size ? current : next;
    });
  }, [filteredAdvances]);

  const groupedAdvances = useMemo(() => {
    if (organizeBy === "pessoa") return groupAdvancesByPerson(filteredAdvances);
    if (organizeBy === "lista") return [{ key: "lista", label: "Todos os adiantamentos", items: filteredAdvances }];
    return groupAdvancesByDate(filteredAdvances, organizeBy, formatDate, formatMonthYear);
  }, [filteredAdvances, organizeBy]);

  const eligibleVisibleIds = filteredAdvances.filter(isAdvanceTrashEligible).map((item) => item.id);
  const selectedAdvances = advances.filter((item) => selectedAdvanceIds.has(item.id));
  const selectedTotal = selectedAdvances.reduce((sum, item) => sum + Number(item.valor || 0), 0);

  async function handleCreateAdvance(payload) {
    const created = await actions.createAdvance(payload);
    setSelectedAdvanceId(created.id);
    setLastCreatedAdvanceId(created.id);
    setDetailTab("resumo");
    setToastType("success");
    setToastMessage("Adiantamento salvo com sucesso.");
  }

  async function handleCreateMember(payload) {
    const member = await actions.createMember(payload);
    setToastType("success");
    setToastMessage("Responsavel cadastrado com sucesso.");
    return member;
  }

  async function handleDeleteMember(member) {
    await actions.deleteMember(member.id);
    setToastType("success");
    setToastMessage("Responsavel excluido com sucesso.");
  }

  async function handleSaveSettlement(payload) {
    await actions.saveSettlement(selectedAdvance, payload);
    setToastType("success");
    setToastMessage("Controle salvo com sucesso.");
  }

  async function handleAuthorize(payload) {
    if (payload.authorizationId) {
      const updated = await actions.updateAuthorization(payload);
      setToastType("success");
      setToastMessage("Repasse atualizado com sucesso.");
      return updated;
    }
    const created = await actions.createAuthorization(payload);
    setToastType("success");
    setToastMessage("Repasse autorizado com sucesso.");
    return created;
  }

  async function handleResendAuthorization(payload) {
    const resent = await actions.updateAuthorization(payload, { resent: true });
    setToastType("success");
    setToastMessage("Repasse reenviado ao auxiliar.");
    return resent;
  }

  async function handleDeleteAuthorization(authorization) {
    await actions.deleteAuthorization(authorization.id);
    setToastType("success");
    setToastMessage("Repasse excluido com sucesso.");
  }

  async function handleToggleAcmsLaunch(advance, launched) {
    await actions.toggleAcmsLaunch(advance.id, launched);
    setToastType("success");
    setToastMessage(
      launched ? "Adiantamento marcado como lancado no ACMS." : "Marcacao de lancamento ACMS removida."
    );
  }

  async function handleSignOut() {
    await actions.signOutTreasurer();
  }

  async function handlePrepareAssistantPortal() {
    if (!assistantUser) return;
    setAssistantPortalFeedback("");
    try {
      const data = await actions.getAssistantPortalAccess(assistantUser);
      setAssistantPortalData(data);
      setAssistantPinDraft(data.assistantPin || "");
      setAssistantPortalFeedback("Acesso do auxiliar atualizado com sucesso.");
      setToastType("success");
      setToastMessage("Acesso do auxiliar atualizado com sucesso.");
    } catch (error) {
      setAssistantPortalFeedback(error.message);
      setToastType("error");
      setToastMessage(error.message);
    }
  }

  async function handleCopyAssistantPortal(value, label) {
    try {
      await navigator.clipboard.writeText(value);
      setAssistantPortalFeedback(`${label} copiado com sucesso.`);
      setToastType("success");
      setToastMessage(`${label} copiado com sucesso.`);
    } catch {
      setAssistantPortalFeedback(`Nao foi possivel copiar ${label.toLowerCase()}.`);
      setToastType("error");
      setToastMessage(`Nao foi possivel copiar ${label.toLowerCase()}.`);
    }
  }

  async function handleSaveAssistantPin() {
    if (!assistantUser) return;
    setAssistantPortalFeedback("");
    try {
      const data = await actions.updateAssistantPortalPin(assistantUser, assistantPinDraft);
      setAssistantPortalData(data);
      setAssistantPinDraft(data.assistantPin || "");
      setAssistantPortalFeedback("Novo PIN salvo com sucesso. O acesso do auxiliar foi liberado.");
      setToastType("success");
      setToastMessage("Novo PIN salvo com sucesso.");
    } catch (error) {
      setAssistantPortalFeedback(error.message);
      setToastType("error");
      setToastMessage(error.message);
    }
  }

  async function handleCreateAssistantProfile() {
    setAssistantPortalFeedback("");
    try {
      const assistant = await actions.createAssistantProfile({
        nome: assistantSetupName,
        pin: assistantPinDraft
      });
      const data = await actions.getAssistantPortalAccess(assistant);
      setAssistantPortalData(data);
      setAssistantPinDraft(data.assistantPin || "");
      setAssistantSetupName(assistant.nome || "");
      setAssistantPortalFeedback("Tesoureiro auxiliar cadastrado com sucesso.");
      setToastType("success");
      setToastMessage("Tesoureiro auxiliar cadastrado com sucesso.");
    } catch (error) {
      setAssistantPortalFeedback(error.message);
      setToastType("error");
      setToastMessage(error.message);
    }
  }

  async function handleSavePublicAdvanceAccessCode() {
    try {
      setPublicAdvanceFeedback("");
      const data = await actions.updatePublicAdvanceSettings(publicAdvanceCodeDraft);
      setPublicAdvanceSettings(data);
      setPublicAdvanceCodeDraft(data.accessCode || "777");
      setPublicAdvanceFeedback("Codigo do link publico salvo com sucesso.");
      setToastType("success");
      setToastMessage("Codigo do link publico salvo com sucesso.");
    } catch (error) {
      setPublicAdvanceFeedback(error.message);
      setToastType("error");
      setToastMessage(error.message);
    }
  }

  async function handleDeleteAdvance() {
    if (!selectedAdvance) return;
    if (!isAdvanceTrashEligible(selectedAdvance)) {
      setToastType("error");
      setToastMessage(`Este registro não pode ir para a lixeira: ${getAdvanceTrashBlockReason(selectedAdvance)}.`);
      return;
    }
    const confirmed = window.confirm(`Mover o adiantamento de ${selectedAdvance.usuarioNome} para a lixeira?`);
    if (!confirmed) return;
    try {
      await actions.trashAdvance(selectedAdvance.id);
      setSelectedAdvanceId("");
      setToastType("success");
      setToastMessage("Adiantamento movido para a lixeira.");
    } catch (error) {
      setToastType("error");
      setToastMessage(error.message || "Nao foi possivel mover o adiantamento.");
    }
  }

  function toggleAdvanceSelection(advanceId) {
    setSelectedAdvanceIds((current) => {
      const next = new Set(current);
      if (next.has(advanceId)) next.delete(advanceId);
      else next.add(advanceId);
      return next;
    });
  }

  function toggleGroupSelection(group) {
    const ids = group.items.filter(isAdvanceTrashEligible).map((item) => item.id);
    setSelectedAdvanceIds((current) => {
      const next = new Set(current);
      const allSelected = ids.length > 0 && ids.every((id) => next.has(id));
      ids.forEach((id) => (allSelected ? next.delete(id) : next.add(id)));
      return next;
    });
  }

  function toggleVisibleSelection() {
    setSelectedAdvanceIds((current) => {
      const next = new Set(current);
      const allSelected = eligibleVisibleIds.length > 0 && eligibleVisibleIds.every((id) => next.has(id));
      eligibleVisibleIds.forEach((id) => (allSelected ? next.delete(id) : next.add(id)));
      return next;
    });
  }

  function toggleExpandedGroup(key) {
    setExpandedPeople((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function expandAllGroups() {
    setExpandedPeople(new Set(groupedAdvances.map((group) => group.key)));
  }

  function collapseAllGroups() {
    setExpandedPeople(new Set());
  }

  async function handleBulkTrash() {
    const ids = selectedAdvances.filter(isAdvanceTrashEligible).map((item) => item.id);
    if (!ids.length) {
      setToastType("error");
      setToastMessage("Nenhum registro selecionado pode ir para a lixeira.");
      return;
    }
    const blocked = selectedAdvances.length - ids.length;
    const suffix = blocked ? ` ${blocked} registro(s) não elegível(is) serão ignorados.` : "";
    if (!window.confirm(`Mover ${ids.length} adiantamento(s) para a lixeira?${suffix}`)) return;
    try {
      const result = await actions.bulkTrashAdvances(ids);
      setSelectedAdvanceIds(new Set());
      setToastType(result.rejected?.length ? "error" : "success");
      setToastMessage(`${result.trashed?.length || 0} registro(s) movido(s) para a lixeira.${result.rejected?.length ? ` ${result.rejected.length} recusado(s).` : ""}`);
    } catch (error) {
      setToastType("error");
      setToastMessage(error.message || "Não foi possível mover os registros.");
    }
  }

  async function handleRestoreAdvance(advance) {
    try {
      await actions.restoreAdvance(advance.id);
      setToastType("success");
      setToastMessage("Adiantamento restaurado.");
    } catch (error) {
      setToastType("error");
      setToastMessage(error.message || "Não foi possível restaurar o adiantamento.");
    }
  }

  async function handleBulkRestore() {
    if (!selectedTrashIds.size) return;
    try {
      const result = await actions.bulkRestoreAdvances([...selectedTrashIds]);
      setSelectedTrashIds(new Set());
      setToastType(result.rejected?.length ? "error" : "success");
      setToastMessage(`${result.restored?.length || 0} registro(s) restaurado(s).${result.rejected?.length ? ` ${result.rejected.length} recusado(s).` : ""}`);
    } catch (error) {
      setToastType("error");
      setToastMessage(error.message || "Não foi possível restaurar os registros.");
    }
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
      const nextAdvance = activeAdvances.find((item) => !item.lancadoAcms);
      if (nextAdvance) setSelectedAdvanceId(nextAdvance.id);
      scrollToRef(listRef);
      return;
    }
    if (section === "auxiliar") {
      setModuleTab("auxiliar");
      setDetailTab("repasse");
      scrollToRef(listRef);
    }
  }

  const selectedHistory = history.filter((item) => item.advanceId === selectedAdvance?.id).slice(0, 8);
  const selectedAuthorization = authorizations.find((item) => item.advanceId === selectedAdvance?.id);
  const selectedOutstandingAmount = selectedAdvance ? getOutstandingAmount(selectedAdvance) : 0;
  const publicAdvanceAccessCode = publicAdvanceSettings?.accessCode || publicAdvanceCodeDraft || "777";
  const assistantAuthorizations = useMemo(
    () => authorizations.filter((item) => item.assistantId === assistantUser?.id),
    [assistantUser?.id, authorizations]
  );
  const selectedAuxAuthorization =
    assistantAuthorizations.find((item) => item.id === selectedAuxAuthorizationId) || assistantAuthorizations[0] || null;
  const selectedAuxAdvance = advances.find((item) => item.id === selectedAuxAuthorization?.advanceId) || null;

  useEffect(() => {
    if (!assistantAuthorizations.length) {
      setSelectedAuxAuthorizationId("");
      return;
    }
    if (!assistantAuthorizations.some((item) => item.id === selectedAuxAuthorizationId)) {
      setSelectedAuxAuthorizationId(assistantAuthorizations[0].id);
    }
  }, [assistantAuthorizations, selectedAuxAuthorizationId]);

  useEffect(() => {
    setAuxChatDescription(selectedAuxAuthorization?.description || "");
    setAuxChatAudioFile(null);
  }, [selectedAuxAuthorization?.id, selectedAuxAuthorization?.description]);

  async function handleAuxChatSave(resent = false) {
    if (!selectedAuxAuthorization) return;
    try {
      const payload = {
        authorizationId: selectedAuxAuthorization.id,
        advanceId: selectedAuxAuthorization.advanceId,
        assistantId: selectedAuxAuthorization.assistantId,
        assistantName: selectedAuxAuthorization.assistantName,
        memberName: selectedAuxAuthorization.memberName,
        amount: selectedAuxAuthorization.amount,
        description: auxChatDescription,
        audioFile: auxChatAudioFile,
        existingAuthorization: selectedAuxAuthorization,
        advanceDescription: selectedAuxAdvance?.descricao || selectedAuxAuthorization.advanceDescription || "",
        prazoDias: selectedAuxAdvance?.prazoDias || selectedAuxAuthorization.prazoDias || 0,
        dataLimite: selectedAuxAdvance?.dataLimite || selectedAuxAuthorization.dataLimite || ""
      };
      if (resent) {
        await handleResendAuthorization(payload);
      } else {
        await handleAuthorize(payload);
      }
      setAuxChatAudioFile(null);
    } catch (error) {
      setToastType("error");
      setToastMessage(error.message || "Nao foi possivel atualizar a conversa do auxiliar.");
    }
  }

  return (
    <main className="dashboard-shell">
      {toastMessage ? (
        <div className={`files-toast ${toastType === "error" ? "is-error" : "is-success"}`}>
          <div>
            <strong>{toastType === "error" ? "Nao foi possivel concluir a acao" : "Acao concluida"}</strong>
            <p>{toastMessage}</p>
          </div>
          <button type="button" className="files-toast-close" onClick={() => setToastMessage("")}>
            <Icon name="close" size={16} />
          </button>
        </div>
      ) : null}
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
          <button
            className={`sidebar-item ${sidebarSection === "auxiliar" ? "is-active" : ""}`}
            type="button"
            onClick={() => handleSidebarNavigate("auxiliar")}
          >
            <Icon name="user" size={19} />
            Auxiliar
          </button>
        </nav>
      </aside>

      <section className="dashboard-main">
        <header ref={topRef} className="dashboard-topbar panel">
          <div className="dashboard-topbar-copy">
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
            <button className="button-ghost" type="button" onClick={() => setIsTrashOpen((value) => !value)}>
              Lixeira{trashedAdvances.length ? ` (${trashedAdvances.length})` : ""}
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
          <button
            className={`mobile-nav-item ${sidebarSection === "auxiliar" ? "is-active" : ""}`}
            type="button"
            onClick={() => handleSidebarNavigate("auxiliar")}
          >
            <Icon name="user" size={16} />
            Auxiliar
          </button>
        </section>

        <section className="module-tabs panel">
          {[
            ["pesquisar", "Pesquisar"],
            ["adiantamento", "Adiantamento"],
            ["acms", "Controle ACMS"],
            ["auxiliar", "Auxiliar"]
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
                } else if (value === "auxiliar") {
                  setDetailTab("repasse");
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

        <section className={`dashboard-grid${!selectedAdvance && moduleTab !== "auxiliar" && !isTrashOpen ? " is-detail-collapsed" : ""}`}>
          <div className="board-column">
            {moduleTab === "adiantamento" ? (
              <AdvanceForm
                users={users}
                advances={advances}
                currentUser={session.currentUser}
                onSave={handleCreateAdvance}
                onCreateMember={handleCreateMember}
                onDeleteMember={handleDeleteMember}
              />
            ) : null}

            {moduleTab === "auxiliar" ? (
              <section className="panel form-grid compact section-panel">
                <div className="panel-heading">
                  <div>
                    <h3>Acesso do tesoureiro auxiliar</h3>
                    <p>
                      {assistantUser
                        ? "Gere e copie o link fixo com PIN para o auxiliar entrar quando quiser."
                        : "Cadastre o tesoureiro auxiliar para liberar repasses, audio e acesso ao portal."}
                    </p>
                  </div>
                </div>

                <div className="form-intro-card full-span is-assistant">
                  <div>
                    <span className="eyebrow">Portal controlado</span>
                    <strong>Centralize o acesso do auxiliar com link fixo, PIN e uma mensagem pronta para compartilhar.</strong>
                  </div>
                  <p>Quando o PIN for alterado, o acesso anterior deixa de valer imediatamente e o portal continua no mesmo endereço.</p>
                </div>

                {assistantUser ? (
                  <>
                    <div className="detail-grid compact-grid assistant-access-grid">
                      <div>
                        <span>Link do auxiliar</span>
                        <strong>{assistantPortalData?.assistantLink || `${window.location.origin}/auxiliar`}</strong>
                      </div>
                      <div>
                        <span>Status do acesso</span>
                        <strong>{assistantPortalData?.statusLabel || "Aguardando configuracao"}</strong>
                      </div>
                      <div>
                        <span>Tentativas incorretas</span>
                        <strong>{assistantPortalData?.failedAttempts || 0} / 4</strong>
                      </div>
                      <div>
                        <span>Ultima atualizacao</span>
                        <strong>{assistantPortalData?.updatedAt ? formatDate(assistantPortalData.updatedAt) : "-"}</strong>
                      </div>
                    </div>

                    <label className="full-span">
                      Nome do auxiliar
                      <input
                        value={assistantSetupName}
                        onChange={(event) => setAssistantSetupName(event.target.value)}
                        placeholder="Ex.: Tesoureiro auxiliar"
                      />
                    </label>

                    <label className="full-span">
                      Novo PIN do auxiliar
                      <input
                        inputMode="numeric"
                        maxLength="4"
                        value={assistantPinDraft}
                        onChange={(event) => setAssistantPinDraft(event.target.value.replace(/\D/g, ""))}
                        placeholder="Digite 4 numeros"
                      />
                    </label>

                    <div className="actions-row">
                      <button className="button-primary" type="button" onClick={handleSaveAssistantPin}>
                        Salvar novo PIN
                      </button>
                      <button className="button-ghost" type="button" onClick={handlePrepareAssistantPortal}>
                        Atualizar acesso
                      </button>
                      <button
                        className="button-ghost"
                        type="button"
                        onClick={() => handleCopyAssistantPortal(assistantPortalData?.assistantLink || `${window.location.origin}/auxiliar`, "Link")}
                      >
                        Copiar link
                      </button>
                      <button
                        className="button-ghost"
                        type="button"
                        onClick={() => handleCopyAssistantPortal(String(assistantPortalData?.assistantPin || assistantPinDraft || assistantUser?.pin || ""), "PIN")}
                      >
                        Copiar PIN
                      </button>
                      <button
                        className="button-ghost"
                        type="button"
                        onClick={() =>
                          handleCopyAssistantPortal(
                            assistantPortalData?.shareMessage ||
                              `Acesso do Tesoureiro Auxiliar\n\nLink: ${assistantPortalData?.assistantLink || `${window.location.origin}/auxiliar`}\nPIN: ${assistantPortalData?.assistantPin || assistantPinDraft || assistantUser?.pin || ""}`,
                            "Mensagem"
                          )
                        }
                      >
                        Copiar mensagem pronta
                      </button>
                      <a className="button-ghost" href="/auxiliar" target="_blank" rel="noreferrer">
                        Abrir area do auxiliar
                      </a>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="callout-box full-span">
                      <strong>Cadastre o tesoureiro auxiliar</strong>
                      <p>Sem esse cadastro, o sistema nao consegue enviar repasses, audio nem montar a lista de ordens do portal.</p>
                    </div>

                    <label className="full-span">
                      Nome do auxiliar
                      <input
                        value={assistantSetupName}
                        onChange={(event) => setAssistantSetupName(event.target.value)}
                        placeholder="Ex.: Tesoureiro auxiliar"
                      />
                    </label>

                    <label className="full-span">
                      PIN inicial do auxiliar
                      <input
                        inputMode="numeric"
                        maxLength="4"
                        value={assistantPinDraft}
                        onChange={(event) => setAssistantPinDraft(event.target.value.replace(/\D/g, ""))}
                        placeholder="Digite 4 numeros"
                      />
                    </label>

                    <div className="actions-row">
                      <button className="button-primary" type="button" onClick={handleCreateAssistantProfile}>
                        Cadastrar auxiliar
                      </button>
                    </div>
                  </>
                )}

                {assistantPortalFeedback ? <p className="helper-text full-span">{assistantPortalFeedback}</p> : null}

                <div className="callout-box full-span assistant-share-box">
                  <strong>Mensagem pronta para envio</strong>
                  <pre>{assistantPortalData?.shareMessage || "Cadastre o auxiliar para gerar a mensagem pronta de acesso."}</pre>
                </div>

                <div className="callout-box full-span assistant-share-box">
                  <strong>Codigo do link publico de adiantamento</strong>
                  <p className="helper-text">
                    Quem abrir o link publico precisa informar este codigo. O padrao inicial e 777, mas voce pode trocar quando quiser.
                  </p>
                </div>

                <div className="detail-grid compact-grid assistant-access-grid full-span">
                  <div>
                    <span>Codigo atual</span>
                    <strong>{publicAdvanceAccessCode}</strong>
                  </div>
                  <div>
                    <span>Ultima atualizacao</span>
                    <strong>{publicAdvanceSettings?.updatedAt ? formatDate(publicAdvanceSettings.updatedAt) : "-"}</strong>
                  </div>
                </div>

                <label className="full-span">
                  Codigo do link publico
                  <input
                    inputMode="numeric"
                    maxLength="8"
                    value={publicAdvanceCodeDraft}
                    onChange={(event) => setPublicAdvanceCodeDraft(event.target.value.replace(/\D/g, ""))}
                    placeholder="Digite pelo menos 3 numeros"
                  />
                </label>

                <div className="actions-row">
                  <button className="button-primary" type="button" onClick={handleSavePublicAdvanceAccessCode}>
                    Salvar codigo do link
                  </button>
                  <button
                    className="button-ghost"
                    type="button"
                    onClick={() => handleCopyAssistantPortal(publicAdvanceAccessCode, "Codigo")}
                  >
                    Copiar codigo
                  </button>
                  {publicPersonToken ? (
                    <button
                      className="button-ghost"
                      type="button"
                      onClick={() =>
                        handleCopyAssistantPortal(
                          `Consulta publica de adiantamentos\n\nLink: ${window.location.origin}/publico/${publicPersonToken}\nCodigo: ${publicAdvanceAccessCode}`,
                          "Mensagem"
                        )
                      }
                    >
                      Copiar mensagem do link
                    </button>
                  ) : null}
                </div>

                {publicAdvanceFeedback ? <p className="helper-text full-span">{publicAdvanceFeedback}</p> : null}
              </section>
            ) : null}

            <section ref={listRef} className="panel list-panel">
              <div className="panel-heading">
                <div>
                  <h3>
                    {moduleTab === "acms"
                      ? "Pendencias de lancamento ACMS"
                      : moduleTab === "auxiliar"
                        ? "Ordens enviadas ao auxiliar"
                        : "Pesquisar adiantamentos"}
                  </h3>
                  <p>
                    {moduleTab === "acms"
                      ? "Veja apenas os registros que ainda precisam ser lancados no ACMS."
                      : moduleTab === "auxiliar"
                        ? "Acompanhe as autorizacoes de repasse ja liberadas para o auxiliar."
                      : "Acompanhe situacao, valor e o que ainda falta lancar no ACMS."}
                  </p>
                </div>
              </div>

              {moduleTab === "auxiliar" ? (
                <div className="assistant-chat-list treasurer-chat-list">
                  {assistantUser ? (
                    assistantAuthorizations.length ? (
                    assistantAuthorizations
                      .map((item) => (
                        <button
                          key={item.id}
                          type="button"
                          className={`assistant-chat-item ${selectedAuxAuthorization?.id === item.id ? "is-active" : ""}`}
                          onClick={() => setSelectedAuxAuthorizationId(item.id)}
                        >
                          <div className="assistant-chat-avatar">{item.memberName.slice(0, 2).toUpperCase()}</div>
                          <div className="assistant-chat-copy">
                            <div className="assistant-chat-top">
                              <strong>{item.memberName}</strong>
                              <span>{formatDate(item.createdAt)}</span>
                            </div>
                            <p>{item.description || "Sem observacao adicional."}</p>
                            <div className="assistant-chat-meta">
                              <span>{formatCurrency(item.amount)}</span>
                              <StatusBadge status={item.status} />
                            </div>
                          </div>
                        </button>
                      ))
                    ) : (
                      <article className="timeline-item">
                        <strong>Nenhuma ordem enviada ainda</strong>
                        <small>Envie uma autorizacao de repasse para comecar a acompanhar a conversa do auxiliar.</small>
                      </article>
                    )
                  ) : (
                    <article className="timeline-item">
                      <strong>Nenhum tesoureiro auxiliar cadastrado</strong>
                      <small>Cadastre o auxiliar nesta aba para comecar a enviar repasses e acompanhar as ordens.</small>
                    </article>
                  )}
                </div>
              ) : isTrashOpen ? (
                <div className="advance-trash-view">
                  <div className="trash-toolbar">
                    <div>
                      <strong>Lixeira de adiantamentos</strong>
                      <span>{trashedAdvances.length} registro(s) aguardando restauração.</span>
                    </div>
                    <div className="actions-row">
                      {selectedTrashIds.size ? <button type="button" className="button-primary" onClick={() => void handleBulkRestore()}>Restaurar selecionados ({selectedTrashIds.size})</button> : null}
                      <button type="button" className="button-ghost" onClick={() => setIsTrashOpen(false)}>Voltar aos ativos</button>
                    </div>
                  </div>
                  {trashedAdvances.length ? trashedAdvances.map((advance) => (
                    <article key={advance.id} className="trash-row">
                      <input
                        type="checkbox"
                        checked={selectedTrashIds.has(advance.id)}
                        onChange={() => setSelectedTrashIds((current) => {
                          const next = new Set(current);
                          if (next.has(advance.id)) next.delete(advance.id);
                          else next.add(advance.id);
                          return next;
                        })}
                      />
                      <div className="row-main">
                        <strong>{advance.usuarioNome}</strong>
                        <span>{advance.descricao}</span>
                        <small>Excluído em {formatDate(advance.deletedAt)} por {advance.deletedByName || advance.deletedBy || "tesouraria"}</small>
                      </div>
                      <strong>{formatCurrency(advance.valor)}</strong>
                      <button type="button" className="button-ghost" onClick={() => void handleRestoreAdvance(advance)}>Restaurar</button>
                    </article>
                  )) : (
                    <div className="empty-state"><strong>A lixeira está vazia</strong><span>Registros movidos para cá poderão ser restaurados.</span></div>
                  )}
                </div>
              ) : (
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
                    <option value="pessoa">Pessoa</option>
                    <option value="mes">Mes</option>
                    <option value="dia">Dia</option>
                    <option value="lista">Lista completa</option>
                  </select>
                </div>
                <div className="date-filter-row">
                  <label>De <input type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} /></label>
                  <label>Até <input type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} /></label>
                  <label>ACMS
                    <select value={acmsFilter} onChange={(event) => setAcmsFilter(event.target.value)}>
                      <option value="TODOS">Todos</option>
                      <option value="PENDENTE">Pendente</option>
                      <option value="LANCADO">Lançado</option>
                    </select>
                  </label>
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
                <div className="list-actions-row">
                  <label className="select-all-control">
                    <input
                      type="checkbox"
                      checked={eligibleVisibleIds.length > 0 && eligibleVisibleIds.every((id) => selectedAdvanceIds.has(id))}
                      onChange={toggleVisibleSelection}
                    />
                    Selecionar elegíveis visíveis
                  </label>
                  <div className="actions-row">
                    <button type="button" className="button-ghost" onClick={expandAllGroups}>Expandir todos</button>
                    <button type="button" className="button-ghost" onClick={collapseAllGroups}>Recolher todos</button>
                  </div>
                </div>
                {selectedAdvanceIds.size ? (
                  <div className="bulk-action-bar">
                    <strong>{selectedAdvanceIds.size} selecionado(s)</strong>
                    <span>{formatCurrency(selectedTotal)}</span>
                    <button type="button" className="button-ghost" onClick={() => setSelectedAdvanceIds(new Set())}>Limpar seleção</button>
                    <button type="button" className="button-danger" onClick={() => void handleBulkTrash()}>Mover para lixeira</button>
                  </div>
                ) : null}
              </div>
              )}

              {moduleTab !== "auxiliar" && !isTrashOpen ? (
              <div className="list-table">
                {groupedAdvances.map((group) => (
                  <section key={group.key} className="list-group">
                    {organizeBy === "pessoa" ? (
                      <button type="button" className="person-group-header" onClick={() => toggleExpandedGroup(group.key)}>
                        <span className="person-group-title">
                          <strong>{group.name}</strong>
                          <small>{group.items.length} adiantamento(s) · {formatCurrency(group.total)} · saldo {formatCurrency(group.outstanding)}</small>
                        </span>
                        <span className="person-group-metrics">
                          {group.pending ? <b>{group.pending} pendente(s)</b> : null}
                          {group.completed ? <b className="metric-success">{group.completed} concluído(s)</b> : null}
                          {group.overdue ? <b className="metric-danger">{group.overdue} atrasado(s)</b> : null}
                          {group.acmsPending ? <b className="metric-warning">{group.acmsPending} falta ACMS</b> : null}
                          <Icon name="chevron" size={16} />
                        </span>
                      </button>
                    ) : <div className="group-header">{group.label}</div>}
                    {organizeBy === "pessoa" && !expandedPeople.has(group.key) ? null : (
                    <>
                    <div className="list-head">
                      <span>Selecionar</span>
                      <span>Nome</span>
                      <span>Valor</span>
                      <span>Vencimento</span>
                      <span>Status</span>
                      <span>Acao</span>
                    </div>
                    {group.items.map((advance) => (
                      <div
                        key={advance.id}
                        className={`list-row ${selectedAdvance?.id === advance.id ? "is-active" : ""} ${advance.status === "ATRASADO" ? "is-overdue" : ""} ${isAdvanceDueSoon(advance) ? "is-due-soon" : ""}`}
                      >
                        <input
                          type="checkbox"
                          checked={selectedAdvanceIds.has(advance.id)}
                          disabled={!isAdvanceTrashEligible(advance)}
                          title={isAdvanceTrashEligible(advance) ? "Selecionar" : getAdvanceTrashBlockReason(advance)}
                          onChange={() => toggleAdvanceSelection(advance.id)}
                          onClick={(event) => event.stopPropagation()}
                        />
                        <div className="row-main">
                          <strong>{advance.usuarioNome}</strong>
                          <span>{advance.descricao}</span>
                          <small className="item-subline">{acmsLaunchLabel(advance.lancadoAcms)} · saldo {formatCurrency(getOutstandingAmount(advance))}</small>
                        </div>
                        <strong>{formatCurrency(advance.valor)}</strong>
                        <span>{formatDate(advance.dataLimite)}</span>
                        <StatusBadge status={advance.status} />
                        <button type="button" className="row-action" onClick={() => setSelectedAdvanceId(advance.id)}>
                          Ver detalhes <Icon name="chevron" size={14} />
                        </button>
                      </div>
                    ))}
                    </>
                    )}
                  </section>
                ))}
                {!groupedAdvances.length ? <div className="empty-state"><strong>Nenhum adiantamento encontrado</strong><span>Ajuste os filtros ou crie um novo registro.</span></div> : null}
              </div>
              ) : null}
            </section>
          </div>

          <aside className="detail-column">
            {isTrashOpen ? (
              <section className="panel detail-panel detail-empty-panel">
                <div className="empty-state">
                  <strong>Lixeira aberta</strong>
                  <span>Restaure um registro pela lista para voltar a trabalhar com ele.</span>
                </div>
              </section>
            ) : moduleTab === "auxiliar" ? (
              <section className="panel detail-panel">
                <div className="panel-heading">
                  <div>
                    <h3>Chat com o auxiliar</h3>
                    <p>Altere a orientacao, envie novo audio e acompanhe cada ordem como uma conversa.</p>
                  </div>
                </div>

                {selectedAuxAuthorization ? (
                  <div className="assistant-message-frame treasurer-chat-frame">
                    <header className="assistant-message-header">
                      <div className="assistant-chat-avatar large">
                        {selectedAuxAuthorization.memberName.slice(0, 2).toUpperCase()}
                      </div>
                      <div className="assistant-message-title">
                        <strong>{selectedAuxAuthorization.memberName}</strong>
                        <span>{selectedAuxAuthorization.status === "ENTREGUE" ? "Entrega confirmada" : "Aguardando entrega"}</span>
                      </div>
                      <StatusBadge status={selectedAuxAuthorization.status} />
                    </header>

                    <div className="assistant-message-body">
                      <div className="assistant-date-divider">
                        <span>{formatDate(selectedAuxAuthorization.createdAt)}</span>
                      </div>

                      <article className="message-bubble message-bubble-system">
                        <span className="message-label">Resumo da ordem</span>
                        <strong className="message-amount">{formatCurrency(selectedAuxAuthorization.amount)}</strong>
                        <p>{selectedAuxAdvance?.descricao || selectedAuxAuthorization.advanceDescription || "Repasse autorizado pela tesouraria."}</p>
                        <div className="message-facts">
                          <span>Prazo: {selectedAuxAdvance?.prazoDias || selectedAuxAuthorization.prazoDias} dias</span>
                          <span>Vencimento: {formatDate(selectedAuxAdvance?.dataLimite || selectedAuxAuthorization.dataLimite)}</span>
                        </div>
                      </article>

                      <article className="message-bubble message-bubble-incoming">
                        <span className="message-label">Ultima orientacao enviada</span>
                        <p>{selectedAuxAuthorization.description || "Sem observacao adicional."}</p>
                      </article>

                      {selectedAuxAuthorization.audioUrl ? (
                        <article className="message-bubble message-bubble-incoming voice-bubble">
                          <div className="voice-badge">
                            <Icon name="mic" size={16} />
                            <span>Ultimo audio enviado</span>
                          </div>
                          <VoiceNotePlayer src={selectedAuxAuthorization.audioUrl} title="Audio enviado ao auxiliar" />
                          {selectedAuxAuthorization.audioName ? <span className="helper-text">{selectedAuxAuthorization.audioName}</span> : null}
                        </article>
                      ) : (
                        <article className="message-bubble message-bubble-muted">
                          <span className="message-label">Audio</span>
                          <p>Nenhum audio enviado para esta ordem ate agora.</p>
                        </article>
                      )}

                      {selectedAuxAuthorization.status === "ENTREGUE" ? (
                        <article className="message-bubble message-bubble-outgoing message-bubble-confirmed">
                          <span className="message-label">Retorno do auxiliar</span>
                          <p>O auxiliar marcou esta ordem como entregue no portal.</p>
                        </article>
                      ) : (
                        <article className="message-bubble message-bubble-outgoing">
                          <span className="message-label">Status atual</span>
                          <p>Esta ordem continua aberta. Voce pode ajustar a mensagem e reenviar um novo audio a qualquer momento.</p>
                        </article>
                      )}
                    </div>

                    <footer className="assistant-message-composer treasurer-chat-composer">
                      <div className="treasurer-chat-composer-fields">
                        <label className="field">
                          <span>Mensagem para o auxiliar</span>
                          <textarea
                            rows="3"
                            value={auxChatDescription}
                            onChange={(event) => setAuxChatDescription(event.target.value)}
                            placeholder="Digite a orientacao que o auxiliar vai ver na conversa"
                          />
                        </label>

                        <div className="full-span">
                          <AudioRecorder onAudioReady={setAuxChatAudioFile} />
                          {auxChatAudioFile ? <p className="helper-text">Novo audio pronto: {auxChatAudioFile.name}</p> : null}
                          {!auxChatAudioFile && selectedAuxAuthorization.audioName ? (
                            <p className="helper-text">Audio atual: {selectedAuxAuthorization.audioName}</p>
                          ) : null}
                        </div>
                      </div>

                      <div className="actions-row">
                        <button type="button" className="button-primary" onClick={() => handleAuxChatSave(false)}>
                          Salvar orientacao
                        </button>
                        <button type="button" className="button-ghost" onClick={() => handleAuxChatSave(true)}>
                          Reenviar ao auxiliar
                        </button>
                        <button type="button" className="button-danger" onClick={() => handleDeleteAuthorization(selectedAuxAuthorization)}>
                          Excluir ordem
                        </button>
                      </div>
                    </footer>
                  </div>
                ) : (
                  <div className="assistant-empty-state">
                    <div className="assistant-chat-avatar large">+</div>
                    <h2>Selecione uma ordem</h2>
                    <p>Escolha uma conversa na lista para editar a orientacao ou enviar novo audio ao auxiliar.</p>
                  </div>
                )}
              </section>
            ) : selectedAdvance ? (
              <section className="panel detail-panel">
                <div className="panel-heading">
                  <div>
                    <h3>Detalhes do adiantamento</h3>
                    <p>Responsavel: {selectedAdvance.usuarioNome}</p>
                  </div>
                  <button type="button" className="icon-button" aria-label="Fechar detalhes" onClick={() => setSelectedAdvanceId("")}>×</button>
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
                      <span>Saldo faltante</span>
                      <strong>{formatCurrency(selectedOutstandingAmount)}</strong>
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
                    <div>
                      <span>Codigo do link</span>
                      <strong>{publicAdvanceAccessCode}</strong>
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
                      <AuthorizationForm
                        advance={selectedAdvance}
                        assistantUser={assistantUser}
                        existingAuthorization={selectedAuthorization}
                        onSave={handleAuthorize}
                        onResend={handleResendAuthorization}
                        onDelete={handleDeleteAuthorization}
                      />
                    ) : (
                      <div className="callout-box">
                        <strong>Cadastre o tesoureiro auxiliar primeiro</strong>
                        <p>Sem esse cadastro o sistema nao consegue enviar repasse, audio nem sincronizar as ordens do portal.</p>
                        <button
                          type="button"
                          className="button-primary"
                          onClick={() => {
                            setModuleTab("auxiliar");
                            setSidebarSection("auxiliar");
                            scrollToRef(listRef);
                          }}
                        >
                          Abrir configuracao do auxiliar
                        </button>
                      </div>
                    )}
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
                    Mover para a lixeira
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
