/** Lucide 图标名 → 语义对应 emoji，供导出端 / Markdown 往返使用 */
export const DEFAULT_CALLOUT_ICON = "Lightbulb";

export const LUCIDE_ICON_TO_EMOJI: Record<string, string> = {
  Lightbulb: "💡",
  AlertTriangle: "⚠️",
  CircleAlert: "❗",
  CircleCheck: "✅",
  Flame: "🔥",
  Pin: "📌",
  MessageSquare: "💬",
  Target: "🎯",
  Rocket: "🚀",
  Star: "⭐",
  Bell: "🔔",
  Bug: "🐛",
};

const EMOJI_TO_LUCIDE_ICON: Record<string, string> = Object.fromEntries(
  Object.entries(LUCIDE_ICON_TO_EMOJI).map(([name, emoji]) => [emoji, name]),
);

const LUCIDE_ICON_NAME_RE = /^[A-Z][A-Za-z0-9]*$/;

/** 将 Lucide 名（新存）或 emoji（存量/Markdown 导入）统一成图标名 */
export function normalizeCalloutIcon(iconStr?: string): string {
  const raw = (iconStr || DEFAULT_CALLOUT_ICON).trim();
  if (!raw) return DEFAULT_CALLOUT_ICON;
  // IconSelector / 新文档存 Lucide 组件名；旧文档与 Markdown 导入可能是 emoji。
  if (LUCIDE_ICON_NAME_RE.test(raw)) return raw;
  return EMOJI_TO_LUCIDE_ICON[raw] ?? raw;
}

/** 导出端：Lucide 名转 emoji；未知值原样返回 */
export function resolveCalloutIcon(raw?: string): string {
  if (!raw) return LUCIDE_ICON_TO_EMOJI[DEFAULT_CALLOUT_ICON];
  return LUCIDE_ICON_TO_EMOJI[raw] ?? raw;
}
