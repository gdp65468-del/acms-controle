import { formatCurrency, formatDate } from "../utils/format";
import { Icon } from "./Icon";

function buildHtml(advance) {
  return `
    <html lang="pt-BR">
      <head>
        <title>Termo de Adiantamento</title>
        <style>
          body { font-family: Arial, sans-serif; padding: 40px; color: #1f2933; }
          h1 { color: #0f4c5c; }
          .row { margin: 14px 0; font-size: 16px; }
          .signature { margin-top: 80px; display: flex; gap: 32px; }
          .signature div { flex: 1; border-top: 1px solid #444; padding-top: 12px; text-align: center; }
        </style>
      </head>
      <body>
        <h1>Termo de Adiantamento</h1>
        <div class="row"><strong>Igreja:</strong> Igreja Adventista do Sétimo Dia</div>
        <div class="row"><strong>Responsável:</strong> ${advance.usuarioNome}</div>
        <div class="row"><strong>Valor:</strong> ${formatCurrency(advance.valor)}</div>
        <div class="row"><strong>Finalidade:</strong> ${advance.descricao}</div>
        <div class="row"><strong>Data do adiantamento:</strong> ${formatDate(advance.dataAdiantamento)}</div>
        <div class="row"><strong>Prazo:</strong> ${advance.prazoDias} dias</div>
        <div class="row"><strong>Data limite:</strong> ${formatDate(advance.dataLimite)}</div>
        <p>Declaro que recebi o valor acima e assumo o compromisso de prestar contas com nota fiscal ou justificativa.</p>
        <div class="signature">
          <div>Assinatura do responsável</div>
          <div>Assinatura da tesouraria</div>
        </div>
      </body>
    </html>
  `;
}

export function PrintTermButton({ advance, onPrinted }) {
  function handlePrint() {
    const popup = window.open("", "_blank", "width=900,height=700");
    if (!popup) return;
    popup.document.write(buildHtml(advance));
    popup.document.close();
    popup.focus();
    popup.print();
    onPrinted?.();
  }

  return (
    <button className="button-ghost" type="button" onClick={handlePrint}>
      <Icon name="print" size={16} />
      Gerar nota para imprimir
    </button>
  );
}
