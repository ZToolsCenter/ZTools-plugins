// ── Card Theme Interface ───────────────────────────────────────
export interface CardTheme {
  id: string;
  name: string;
  nameEn: string;
  description: string;
  tags: string[];
  mode: "light" | "dark";

  // Typography
  titleFont: string;
  bodyFont: string;
  codeFont: string;
  titleFontSize: number;
  titleFontWeight: number;
  titleLineHeight: number;
  titleLetterSpacing: string;
  titleAlign: "left" | "center" | "right";
  bodyFontSize: number;
  bodyLineHeight: number;
  bodyLetterSpacing: string;

  // Colors
  background: string;
  cardBg: string;
  textColor: string;
  secondaryText: string;
  accent: string;
  codeBg: string;
  codeTextColor?: string;
  quoteBorder: string;
  calloutBg: string;
  tableBorder: string;
  divider: string;
  watermark: string;

  // Layout & Decorations
  containerPaddingX: number;
  containerPaddingY: number;
  cardPaddingX: number;
  cardPaddingY: number;
  cardRadius: number;
  cardBorder: string;
  cardShadow: string;
  showDecorations: boolean;
  decorationColor: string;
  watermarkVisible: boolean;
}
