import { cn } from "@/lib/utils";

export type SettingsTabId =
  | "model"
  | "persona"
  | "prompt"
  | "skills"
  | "mcp"
  | "appearance";

export const SETTINGS_TABS: Array<{ id: SettingsTabId; label: string }> = [
  { id: "model", label: "模型" },
  { id: "persona", label: "角色" },
  { id: "prompt", label: "提示词" },
  { id: "skills", label: "技能" },
  { id: "mcp", label: "MCP" },
  { id: "appearance", label: "外观" },
];

interface SettingsNavProps {
  active: SettingsTabId;
  onChange: (id: SettingsTabId) => void;
}

/**
 * 设置页左侧垂直导航（约 7–8rem 宽，适配窄插件窗）。
 */
export function SettingsNav({ active, onChange }: SettingsNavProps) {
  return (
    <nav
      className="flex w-[7.5rem] shrink-0 flex-col gap-0.5 border-r border-border-soft py-2 pl-2 pr-1.5"
      aria-label="设置分类"
    >
      {SETTINGS_TABS.map((tab) => {
        const selected = tab.id === active;
        return (
          <button
            key={tab.id}
            type="button"
            onClick={() => onChange(tab.id)}
            className={cn(
              "rounded-lg px-2.5 py-2 text-left text-[12.5px] font-medium transition-colors",
              selected
                ? "bg-accent-subtle text-fg"
                : "text-fg-muted hover:bg-surface-hover hover:text-fg",
            )}
            aria-current={selected ? "page" : undefined}
          >
            {tab.label}
          </button>
        );
      })}
    </nav>
  );
}
