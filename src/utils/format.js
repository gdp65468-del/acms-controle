function normalizeDateValue(value) {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value?.toDate === "function") {
    const converted = value.toDate();
    return Number.isNaN(converted.getTime()) ? null : converted;
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function formatCurrency(value) {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL"
  }).format(Number(value || 0));
}

export function formatDate(value) {
  const date = normalizeDateValue(value);
  if (!date) return "-";
  return new Intl.DateTimeFormat("pt-BR").format(date);
}

export function formatMonthYear(value) {
  const date = normalizeDateValue(value);
  if (!date) return "-";
  return new Intl.DateTimeFormat("pt-BR", {
    month: "long",
    year: "numeric"
  }).format(date);
}

export function toDateInputValue(value) {
  const date = normalizeDateValue(value) || new Date();
  return date.toISOString().split("T")[0];
}

export function computeDueDate(startDate, prazoDias) {
  const date = new Date(startDate);
  date.setDate(date.getDate() + Number(prazoDias || 0));
  return date.toISOString();
}

export function computeAdvanceStatus(advance) {
  const hasReceipt = Number(advance.totalComprovado || 0) > 0;
  const hasJustification = Boolean(advance.justificativa?.trim());
  if (hasReceipt) return "PRESTADO";
  if (hasJustification) return "JUSTIFICADO";
  const dueDate = normalizeDateValue(advance.dataLimite);
  if (dueDate && dueDate < new Date()) return "ATRASADO";
  return "PENDENTE";
}

export function statusLabel(status) {
  return {
    PENDENTE: "Pendente",
    ATRASADO: "Atrasado",
    PRESTADO: "Prestado",
    JUSTIFICADO: "Justificado",
    AUTORIZADO: "Autorizado",
    ENTREGUE: "Entregue"
  }[status] || status;
}

export function acmsLaunchLabel(value) {
  return value ? "Lancado no ACMS" : "Pendente no ACMS";
}
