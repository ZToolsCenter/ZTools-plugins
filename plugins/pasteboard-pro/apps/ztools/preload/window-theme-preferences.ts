export const MAX_THEME_BACKGROUND_BYTES = 8 * 1_024 * 1_024;

export type ThemeImageLayout = "cover" | "contain" | "tile" | "repeat-x";

export type ThemeBackground =
  | Readonly<{ type: "default" }>
  | Readonly<{ type: "color"; color: string }>
  | Readonly<{
      type: "image";
      imageDataUrl: string;
      frosted?: boolean;
      layout?: ThemeImageLayout;
      tilesPerRow?: number;
    }>;

export type ThemePreferences = Readonly<{
  accentColor: string;
  background: ThemeBackground;
  backgroundBaseColor?: string;
  cardBackground?: Readonly<{ color: string; opacity: number }>;
}>;

export const defaultThemePreferences: ThemePreferences = {
  accentColor: "#6f61ea",
  background: { type: "default" },
};

const MAX_THEME_IMAGE_DATA_URL_LENGTH = Math.ceil(MAX_THEME_BACKGROUND_BYTES * 4 / 3) + 64;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function isThemeColor(value: unknown): value is string {
  return typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value);
}

function isThemeImageLayout(value: unknown): value is ThemeImageLayout {
  return value === "cover" || value === "contain" || value === "tile" || value === "repeat-x";
}

function isThemeImageTilesPerRow(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 12;
}

export function isThemeImageDataUrl(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length <= MAX_THEME_IMAGE_DATA_URL_LENGTH &&
    /^data:image\/(?:png|jpeg|webp);base64,[a-z0-9+/]+={0,2}$/i.test(value)
  );
}

export function parseThemeBackground(value: unknown): ThemeBackground | undefined {
  if (!isRecord(value)) return undefined;
  if (value.type === "default") return { type: "default" };
  if (value.type === "color" && isThemeColor(value.color)) {
    return { type: "color", color: value.color.toLowerCase() };
  }
  if (value.type === "image" && isThemeImageDataUrl(value.imageDataUrl)) {
    const background: {
      type: "image";
      imageDataUrl: string;
      frosted?: boolean;
      layout?: ThemeImageLayout;
      tilesPerRow?: number;
    } = { type: "image", imageDataUrl: value.imageDataUrl };
    if (typeof value.frosted === "boolean") background.frosted = value.frosted;
    if (isThemeImageLayout(value.layout)) background.layout = value.layout;
    if (isThemeImageTilesPerRow(value.tilesPerRow)) background.tilesPerRow = value.tilesPerRow;
    return background;
  }
  return undefined;
}

export function parseThemePreferences(value: unknown): ThemePreferences {
  if (!isRecord(value)) return structuredClone(defaultThemePreferences);
  const background = parseThemeBackground(value.background);
  const parsed: {
    accentColor: string;
    background: ThemeBackground;
    backgroundBaseColor?: string;
    cardBackground?: Readonly<{ color: string; opacity: number }>;
  } = {
    accentColor: isThemeColor(value.accentColor)
      ? value.accentColor.toLowerCase()
      : defaultThemePreferences.accentColor,
    background: background ?? { type: "default" },
  };
  if (isThemeColor(value.backgroundBaseColor)) {
    parsed.backgroundBaseColor = value.backgroundBaseColor.toLowerCase();
  }
  if (
    isRecord(value.cardBackground) &&
    isThemeColor(value.cardBackground.color) &&
    typeof value.cardBackground.opacity === "number" &&
    Number.isFinite(value.cardBackground.opacity) &&
    value.cardBackground.opacity >= 0 &&
    value.cardBackground.opacity <= 1
  ) {
    parsed.cardBackground = {
      color: value.cardBackground.color.toLowerCase(),
      opacity: value.cardBackground.opacity,
    };
  }
  return parsed;
}

export function validateThemePreferences(value: unknown): asserts value is ThemePreferences {
  if (!isRecord(value) || !isThemeColor(value.accentColor)) {
    throw new TypeError("Theme accent color must use #RRGGBB format");
  }
  if (
    "backgroundBaseColor" in value &&
    !isThemeColor(value.backgroundBaseColor)
  ) {
    throw new TypeError("Theme background base color must use #RRGGBB format");
  }
  if ("cardBackground" in value) {
    const cardBackground = value.cardBackground;
    if (
      !isRecord(cardBackground) ||
      !isThemeColor(cardBackground.color) ||
      typeof cardBackground.opacity !== "number" ||
      !Number.isFinite(cardBackground.opacity) ||
      cardBackground.opacity < 0 ||
      cardBackground.opacity > 1
    ) {
      throw new TypeError("Card background requires a #RRGGBB color and opacity from 0 to 1");
    }
  }
  if (parseThemeBackground(value.background) === undefined) {
    throw new TypeError("Theme background must be default, a #RRGGBB color, or an image data URL");
  }
  if (
    isRecord(value.background) &&
    value.background.type === "image" &&
    "frosted" in value.background &&
    typeof value.background.frosted !== "boolean"
  ) {
    throw new TypeError("Image background frosted preference must be a boolean");
  }
  if (isRecord(value.background) && value.background.type === "image") {
    if ("layout" in value.background && !isThemeImageLayout(value.background.layout)) {
      throw new TypeError("Image background layout must be cover, contain, tile, or repeat-x");
    }
    if ("tilesPerRow" in value.background && !isThemeImageTilesPerRow(value.background.tilesPerRow)) {
      throw new TypeError("Image background tiles per row must be an integer from 1 to 12");
    }
  }
}
