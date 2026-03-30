import { statusLabel } from "../utils/format";
import { Icon } from "./Icon";

const statusIcons = {
  PENDENTE: "clock",
  ATRASADO: "alert",
  PRESTADO: "check",
  JUSTIFICADO: "check",
  AUTORIZADO: "clock",
  ENTREGUE: "check"
};

export function StatusBadge({ status }) {
  return (
    <span className={`status-badge status-${String(status).toLowerCase()}`}>
      <Icon name={statusIcons[status]} size={14} />
      {statusLabel(status)}
    </span>
  );
}
