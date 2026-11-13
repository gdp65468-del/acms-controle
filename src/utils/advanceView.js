import { getOutstandingAmount } from "./format.js";

function normalizeText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
}

export function getAdvancePersonKey(advance) {
  return String(advance?.usuarioId || `nome:${normalizeText(advance?.usuarioNome) || "sem-responsavel"}`);
}

export function isAdvanceInTrash(advance) {
  return Boolean(advance?.deletedAt);
}

export function isAdvanceTrashEligible(advance) {
  return !isAdvanceInTrash(advance)
    && !advance?.lancadoAcms
    && ["PENDENTE", "ATRASADO"].includes(advance?.status);
}

export function getAdvanceTrashBlockReason(advance) {
  if (isAdvanceInTrash(advance)) return "Já está na lixeira";
  if (advance?.lancadoAcms) return "Já lançado no ACMS";
  if (["PRESTADO", "JUSTIFICADO"].includes(advance?.status)) return "Prestação concluída";
  return "Não elegível para a lixeira";
}

export function isAdvanceDueSoon(advance, now = new Date()) {
  if (!advance?.dataLimite || !["PENDENTE", "ATRASADO"].includes(advance.status)) return false;
  const dueDate = new Date(advance.dataLimite);
  if (Number.isNaN(dueDate.getTime())) return false;
  const diff = dueDate.getTime() - now.getTime();
  return diff >= 0 && diff <= 7 * 24 * 60 * 60 * 1000;
}

export function filterAdvances(advances, { query = "", status = "TODOS", acms = "TODOS", from = "", to = "" } = {}) {
  const normalizedQuery = normalizeText(query);
  const fromTime = from ? new Date(`${from}T00:00:00`).getTime() : null;
  const toTime = to ? new Date(`${to}T23:59:59.999`).getTime() : null;

  return advances.filter((advance) => {
    if (status !== "TODOS" && advance.status !== status) return false;
    if (acms === "PENDENTE" && advance.lancadoAcms) return false;
    if (acms === "LANCADO" && !advance.lancadoAcms) return false;
    if (normalizedQuery && ![advance.usuarioNome, advance.descricao].some((value) => normalizeText(value).includes(normalizedQuery))) {
      return false;
    }
    const date = new Date(advance.dataAdiantamento || advance.dataLimite || 0).getTime();
    if (fromTime !== null && date < fromTime) return false;
    if (toTime !== null && date > toTime) return false;
    return true;
  });
}

export function groupAdvancesByPerson(advances) {
  const groups = new Map();
  advances.forEach((advance) => {
    const key = getAdvancePersonKey(advance);
    if (!groups.has(key)) {
      groups.set(key, { key, name: advance.usuarioNome || "Sem responsável", items: [] });
    }
    groups.get(key).items.push(advance);
  });
  return Array.from(groups.values()).map((group) => ({
    ...group,
    total: group.items.reduce((sum, item) => sum + Number(item.valor || 0), 0),
    outstanding: group.items.reduce((sum, item) => sum + getOutstandingAmount(item), 0),
    overdue: group.items.filter((item) => item.status === "ATRASADO").length,
    pending: group.items.filter((item) => item.status === "PENDENTE").length,
    completed: group.items.filter((item) => ["PRESTADO", "JUSTIFICADO"].includes(item.status)).length,
    acmsPending: group.items.filter((item) => !item.lancadoAcms).length,
    eligibleIds: group.items.filter(isAdvanceTrashEligible).map((item) => item.id)
  }));
}

export function groupAdvancesByDate(advances, organizeBy, formatDate, formatMonthYear) {
  const groups = new Map();
  advances.forEach((advance) => {
    const dateValue = advance.dataAdiantamento || advance.dataLimite;
    const date = new Date(dateValue || 0);
    const key = organizeBy === "dia"
      ? date.toISOString().slice(0, 10)
      : `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
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
}
