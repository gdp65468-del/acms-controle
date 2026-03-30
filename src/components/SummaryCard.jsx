import { Icon } from "./Icon";

const iconsByAccent = {
  blue: "wallet",
  sand: "clock",
  red: "alert",
  green: "check"
};

export function SummaryCard({ title, value, accent }) {
  return (
    <article className={`summary-card accent-${accent || "sand"}`}>
      <div className="summary-topline">
        <span className={`summary-icon tone-${accent || "sand"}`}>
          <Icon name={iconsByAccent[accent || "sand"]} size={16} />
        </span>
        <p>{title}</p>
      </div>
      <strong>{value}</strong>
    </article>
  );
}
