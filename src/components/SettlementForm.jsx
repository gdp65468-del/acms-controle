import { useEffect, useMemo, useState } from "react";
import { formatCurrency, getOutstandingAmount } from "../utils/format";

function createEntryId() {
  return globalThis.crypto?.randomUUID?.() || `prestacao-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function parseMoneyInput(value) {
  const rawValue = String(value || "").trim().replace(/\s/g, "");
  if (!rawValue) return 0;
  const normalized =
    rawValue.includes(",") && rawValue.includes(".")
      ? rawValue.replace(/\./g, "").replace(",", ".")
      : rawValue.replace(",", ".");
  const amount = Number(normalized);
  return Number.isFinite(amount) ? amount : 0;
}

function roundMoney(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}

function normalizeEntries(advance) {
  const entries = Array.isArray(advance.prestacoes) ? advance.prestacoes : [];
  if (entries.length) {
    return entries
      .map((entry) => ({
        id: String(entry.id || createEntryId()),
        valor: roundMoney(entry.valor),
        descricao: String(entry.descricao || "").trim(),
        createdAt: entry.createdAt || ""
      }))
      .filter((entry) => entry.valor > 0);
  }

  const legacyTotal = roundMoney(advance.totalComprovado);
  if (legacyTotal <= 0) return [];
  return [
    {
      id: "valor-anterior",
      valor: legacyTotal,
      descricao: "Valor ja registrado",
      createdAt: advance.dataPrestacao || ""
    }
  ];
}

function sumEntries(entries) {
  return roundMoney(entries.reduce((total, entry) => total + Number(entry.valor || 0), 0));
}

export function SettlementForm({ advance, onSave }) {
  const [entries, setEntries] = useState(() => normalizeEntries(advance));
  const [entryValue, setEntryValue] = useState("");
  const [entryDescription, setEntryDescription] = useState("");
  const [justificativa, setJustificativa] = useState(advance.justificativa || "");
  const [lancadoAcms, setLancadoAcms] = useState(Boolean(advance.lancadoAcms));
  const [error, setError] = useState("");
  const totalComprovado = useMemo(() => sumEntries(entries), [entries]);
  const outstandingAmount = useMemo(
    () => getOutstandingAmount({ ...advance, totalComprovado }),
    [advance, totalComprovado]
  );

  useEffect(() => {
    setEntries(normalizeEntries(advance));
    setEntryValue("");
    setEntryDescription("");
    setJustificativa(advance.justificativa || "");
    setLancadoAcms(Boolean(advance.lancadoAcms));
    setError("");
  }, [advance]);

  function handleAddEntry() {
    const amount = roundMoney(parseMoneyInput(entryValue));
    const nextTotal = roundMoney(totalComprovado + amount);
    const advanceAmount = roundMoney(advance.valor);

    setError("");
    if (amount <= 0) {
      setError("Informe um valor de nota maior que zero.");
      return;
    }
    if (advanceAmount > 0 && nextTotal > advanceAmount) {
      setError("O valor das notas nao pode passar do valor adiantado.");
      return;
    }

    setEntries((current) => [
      ...current,
      {
        id: createEntryId(),
        valor: amount,
        descricao: entryDescription.trim(),
        createdAt: new Date().toISOString()
      }
    ]);
    setEntryValue("");
    setEntryDescription("");
  }

  function handleRemoveEntry(entryId) {
    setError("");
    setEntries((current) => current.filter((entry) => entry.id !== entryId));
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setError("");
    try {
      await onSave({
        totalComprovado,
        prestacoes: entries,
        justificativa,
        lancadoAcms
      });
    } catch (submitError) {
      setError(submitError.message);
    }
  }

  return (
    <form className="panel form-grid compact section-panel" onSubmit={handleSubmit}>
      <div className="panel-heading">
        <div>
          <h3>Controle e lembrete ACMS</h3>
          <p>Valor adiantado: {formatCurrency(advance.valor)}</p>
        </div>
      </div>

      <div className="form-intro-card full-span is-acms">
        <div>
          <span className="eyebrow">Controle operacional</span>
          <strong>Registre o uso do valor e acompanhe o que ainda falta lancar.</strong>
        </div>
        <p>Esse bloco serve como apoio de conferência e lembrete operacional, sem substituir os documentos fiscais.</p>
      </div>

      <div className="detail-grid compact-grid full-span">
        <div>
          <span>Valor comprovado</span>
          <strong>{formatCurrency(totalComprovado || 0)}</strong>
        </div>
        <div>
          <span>Saldo faltante</span>
          <strong>{formatCurrency(outstandingAmount)}</strong>
        </div>
      </div>

      <div className="settlement-entry-editor full-span">
        <div className="settlement-entry-fields">
          <label>
            Valor da nota
            <input
              inputMode="decimal"
              value={entryValue}
              onChange={(event) => setEntryValue(event.target.value)}
              placeholder="Ex.: 50,00"
            />
          </label>
          <label>
            Observacao
            <input
              value={entryDescription}
              onChange={(event) => setEntryDescription(event.target.value)}
              placeholder="Ex.: nota mercado"
            />
          </label>
          <button className="button-primary" type="button" onClick={handleAddEntry}>
            Adicionar
          </button>
        </div>
        <p className="helper-text">
          Digite cada nota separadamente. O sistema soma tudo e atualiza o saldo faltante.
        </p>
      </div>

      <div className="settlement-entry-list full-span">
        <div className="settlement-entry-total">
          <strong>Valores lancados</strong>
          <span>{entries.length} item(ns)</span>
        </div>
        {entries.length ? (
          entries.map((entry) => (
            <div className="settlement-entry-item" key={entry.id}>
              <div>
                <strong>{formatCurrency(entry.valor)}</strong>
                <span>{entry.descricao || "Sem observacao"}</span>
              </div>
              <button className="button-danger" type="button" onClick={() => handleRemoveEntry(entry.id)}>
                Remover
              </button>
            </div>
          ))
        ) : (
          <p className="helper-text">Nenhum valor de nota lancado ainda.</p>
        )}
      </div>

      <label className="toggle-field">
        <input type="checkbox" checked={lancadoAcms} onChange={(event) => setLancadoAcms(event.target.checked)} />
        <span>Ja lancei este adiantamento no ACMS</span>
      </label>

      <label className="full-span">
        Justificativa
        <textarea
          rows="3"
          value={justificativa}
          onChange={(event) => setJustificativa(event.target.value)}
          placeholder="Use quando precisar registrar observacao, acerto ou motivo sem valor final."
        />
      </label>

      <p className="helper-text full-span">
        Este sistema nao guarda nota fiscal. Ele serve para controlar o adiantamento e lembrar o lancamento no
        acmsnet.org.
      </p>

      {outstandingAmount > 0 ? (
        <div className="notice-banner full-span">
          Ainda faltam {formatCurrency(outstandingAmount)} para fechar este adiantamento. Enquanto houver saldo faltante,
          ele nao sera marcado como prestado.
        </div>
      ) : null}

      {error ? <p className="form-error full-span">{error}</p> : null}

      <div className="full-span actions-row">
        <button className="button-secondary" type="submit">
          Salvar controle
        </button>
      </div>
    </form>
  );
}
