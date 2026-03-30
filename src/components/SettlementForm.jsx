import { useEffect, useMemo, useState } from "react";
import { formatCurrency, getOutstandingAmount } from "../utils/format";

export function SettlementForm({ advance, onSave }) {
  const [totalComprovado, setTotalComprovado] = useState(advance.totalComprovado || "");
  const [justificativa, setJustificativa] = useState(advance.justificativa || "");
  const [lancadoAcms, setLancadoAcms] = useState(Boolean(advance.lancadoAcms));
  const [error, setError] = useState("");
  const outstandingAmount = useMemo(
    () => getOutstandingAmount({ ...advance, totalComprovado }),
    [advance, totalComprovado]
  );

  useEffect(() => {
    setTotalComprovado(advance.totalComprovado || "");
    setJustificativa(advance.justificativa || "");
    setLancadoAcms(Boolean(advance.lancadoAcms));
    setError("");
  }, [advance]);

  async function handleSubmit(event) {
    event.preventDefault();
    setError("");
    if (!Number(totalComprovado) && !String(justificativa).trim()) {
      setError("Informe o valor prestado ou escreva a justificativa.");
      return;
    }
    try {
      await onSave({
        totalComprovado,
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

      <label>
        Valor utilizado
        <input
          type="number"
          min="0"
          step="0.01"
          value={totalComprovado}
          onChange={(event) => setTotalComprovado(event.target.value)}
        />
      </label>

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
