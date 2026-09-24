export type ThemeBackground =
  | Readonly<{ type: "default" }>
  | Readonly<{ type: "color"; color: string }>
  | Readonly<{ type: "image"; imageDataUrl: string }>;

export type ThemePreferences = Readonly<{
  accentColor: string;
  background: ThemeBackground;
}>;

export const defaultThemePreferences: ThemePreferences = {
  accentColor: "#6f61ea",
  background: { type: "default" },
};

const MAX_THEME_IMAGE_DATA_URL_LENGTH = Math.ceil((8 * 1_024 * 1_024 * 4) / 3) + 64;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function isThemeColor(value: unknown): value is string {
  return typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value);
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
    return { type: "image", imageDataUrl: value.imageDataUrl };
  }
  return undefined;
}

export function parseThemePreferences(value: unknown): ThemePreferences {
  if (!isRecord(value)) return structuredClone(defaultThemePreferences);
  const background = parseThemeBackground(value.background);
  return {
    accentColor: isThemeColor(value.accentColor)
      ? value.accentColor.toLowerCase()
      : defaultThemePreferences.accentColor,
    background: background ?? { type: "default" },
  };
}

export function validateThemePreferences(value: unknown): asserts value is ThemePreferences {
  if (!isRecord(value) || !isThemeColor(value.accentColor)) {
    throw new TypeError("Theme accent color must use #RRGGBB format");
  }
  if (parseThemeBackground(value.background) === undefined) {
    throw new TypeError("Theme background must be default, a #RRGGBB color, or an image data URL");
  }
}
