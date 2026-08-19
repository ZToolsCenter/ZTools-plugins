// Public API — re-export everything consumers need
export type { CardTheme, CardThemeId } from "./themes";
export { CARD_THEMES, getCardTheme, normalizeCardThemeId } from "./themes";
export type { WatermarkConfig } from "./watermark";
export { DEFAULT_WATERMARK_CONFIG, normalizeWatermarkConfig } from "./watermark";
export { exportPageToImage, exportSelectionToImage, exportToImage } from "./renderer";
