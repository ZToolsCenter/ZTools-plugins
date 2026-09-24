import type { ToolChipView } from "../beautifulUiMap";

export function ToolChips({
  chips,
  summary,
}: {
  chips: ToolChipView[];
  summary?: string;
}) {
  if (chips.length === 0) return null;
  return (
    <div className="bui-chips" role="list" aria-label={summary || "工具调用"}>
      {chips.map((chip) => (
        <div key={chip.id} className="bui-chip-row" role="listitem">
          <span className="shrink-0 text-[12.5px] font-medium">{chip.name}</span>
          <span className="bui-chip" data-status={chip.status} title={chip.label}>
            {chip.label}
          </span>
        </div>
      ))}
    </div>
  );
}
