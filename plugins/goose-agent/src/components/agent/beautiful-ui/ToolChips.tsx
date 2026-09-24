/**
 * Compact tool-call chips. Adapted from Beautiful UI (MIT © 2026 Shane Levine).
 */
import type { BuiToolChip } from "../beautifulUiMap";

export interface ToolChipsProps {
  chips: BuiToolChip[];
  className?: string;
}

export function ToolChips({ chips, className }: ToolChipsProps) {
  if (chips.length === 0) return null;
  return (
    <div className={["bui", "bui-chips", className].filter(Boolean).join(" ")}>
      {chips.map((chip) => (
        <div key={chip.id} className="bui-chip-row">
          <span className="bui-chip-name">{chip.name}</span>
          <span
            className={[
              "bui-chip",
              "bui-chip--mono",
              `bui-chip--${chip.status}`,
            ].join(" ")}
          >
            {chip.label}
          </span>
        </div>
      ))}
    </div>
  );
}
