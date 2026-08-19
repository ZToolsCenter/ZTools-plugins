import type { CardTheme } from "./types";
import { TECH_THEMES } from "./presets/tech";
import { ARTISTIC_THEMES } from "./presets/artistic";
import { COLORFUL_THEMES } from "./presets/colorful";

// Helper to find a theme by id from category sheets
const findTheme = (id: string): CardTheme => {
  const all = [...TECH_THEMES, ...ARTISTIC_THEMES, ...COLORFUL_THEMES];
  const found = all.find((t) => t.id === id);
  if (!found) throw new Error(`Theme ${id} not found in presets!`);
  return found;
};

const CARD_THEME_IDS = [
  "github-light",
  "medium",
  "kenya-hara",
  "typewriter",
  "neon",
  "stationery",
  "poster",
  "github-dark",
  "vercel-dark",
  "tokyo-night",
  "catppuccin",
  "synthwave",
  "mocha-mousse",
  "brutalist",
  "risograph",
] as const;

export type CardThemeId = (typeof CARD_THEME_IDS)[number];

export const CARD_THEMES: Array<CardTheme & { id: CardThemeId }> =
  CARD_THEME_IDS.map((id) => findTheme(id) as CardTheme & { id: CardThemeId });

const REMOVED_THEME_REPLACEMENTS: Record<string, CardThemeId> = {
  notion: "github-light",
  obsidian: "github-dark",
  academic: "medium",
  linear: "github-light",
  "solarized-light": "typewriter",
};

export function normalizeCardThemeId(themeId: unknown): CardThemeId {
  if (typeof themeId === "string") {
    const activeTheme = CARD_THEME_IDS.find((id) => id === themeId);
    if (activeTheme) return activeTheme;
    const replacement = REMOVED_THEME_REPLACEMENTS[themeId];
    if (replacement) return replacement;
  }
  return "github-light";
}

export function getCardTheme(themeId: CardThemeId): CardTheme {
  return CARD_THEMES.find((t) => t.id === themeId) ?? CARD_THEMES[0];
}
