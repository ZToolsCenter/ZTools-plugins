import type { ThemePreferences } from "../preload/window-preferences";

type Rgb = Readonly<{ red: number; green: number; blue: number }>;

const LIGHT_BACKGROUND = "#f7f7fb";
const DARK_BACKGROUND = "#24212d";

function parseHex(color: string): Rgb {
  return {
    red: Number.parseInt(color.slice(1, 3), 16),
    green: Number.parseInt(color.slice(3, 5), 16),
    blue: Number.parseInt(color.slice(5, 7), 16),
  };
}

function toHex({ red, green, blue }: Rgb): string {
  return `#${[red, green, blue]
    .map((channel) => Math.round(channel).toString(16).padStart(2, "0"))
    .join("")}`;
}

function mixColor(first: string, second: string, amount: number): string {
  const from = parseHex(first);
  const to = parseHex(second);
  return toHex({
    red: from.red + (to.red - from.red) * amount,
    green: from.green + (to.green - from.green) * amount,
    blue: from.blue + (to.blue - from.blue) * amount,
  });
}

function linearChannel(channel: number): number {
  const value = channel / 255;
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

function luminance(color: string): number {
  const { red, green, blue } = parseHex(color);
  return (
    0.2126 * linearChannel(red) +
    0.7152 * linearChannel(green) +
    0.0722 * linearChannel(blue)
  );
}

export function contrastRatio(first: string, second: string): number {
  const firstLuminance = luminance(first);
  const secondLuminance = luminance(second);
  return (
    (Math.max(firstLuminance, secondLuminance) + 0.05) /
    (Math.min(firstLuminance, secondLuminance) + 0.05)
  );
}

function accessibleAccent(accentColor: string, backgroundColor: string): string {
  if (contrastRatio(accentColor, backgroundColor) >= 4.5) return accentColor;
  const target =
    contrastRatio("#000000", backgroundColor) >=
    contrastRatio("#ffffff", backgroundColor)
      ? "#000000"
      : "#ffffff";
  for (let step = 1; step <= 20; step += 1) {
    const candidate = mixColor(accentColor, target, step / 20);
    if (contrastRatio(candidate, backgroundColor) >= 4.5) return candidate;
  }
  return target;
}

function accessibleForeground(backgroundColor: string): string {
  return contrastRatio("#000000", backgroundColor) >=
    contrastRatio("#ffffff", backgroundColor)
    ? "#000000"
    : "#ffffff";
}

function rgba(color: string, opacity: number): string {
  const { red, green, blue } = parseHex(color);
  return `rgb(${red} ${green} ${blue} / ${opacity})`;
}

export function themeCssVariables(
  theme: ThemePreferences,
  darkMode: boolean,
  surfaceBase?: string,
  surfacePreferences: Pick<ThemePreferences, "cardBackground" | "backgroundBaseColor"> = theme,
): Record<string, string> {
  const windowBackground = darkMode ? DARK_BACKGROUND : LIGHT_BACKGROUND;
  const accentSurface = surfaceBase ?? windowBackground;
  const accentColor = accessibleAccent(theme.accentColor, accentSurface);
  const onAccent = accessibleForeground(accentColor);
  const accentSoft = mixColor(accentColor, accentSurface, darkMode ? 0.58 : 0.78);
  const backgroundBaseColor =
    theme.background.type === "color"
      ? theme.background.color
      : theme.background.type === "image"
        ? windowBackground
        : surfacePreferences.backgroundBaseColor ?? windowBackground;
  const backgroundColor =
    theme.background.type === "color"
      ? theme.background.color
      : backgroundBaseColor;
  const backgroundImage =
    theme.background.type === "image"
      ? `linear-gradient(${darkMode ? "rgb(18 16 24 / 24%)" : "rgb(255 255 255 / 12%)"}, ${darkMode ? "rgb(18 16 24 / 24%)" : "rgb(255 255 255 / 12%)"}), url("${theme.background.imageDataUrl}")`
      : "none";
  const cardBackground = surfacePreferences.cardBackground;
  const cardSurface = cardBackground === undefined
    ? undefined
    : mixColor(cardBackground.color, backgroundBaseColor, 1 - cardBackground.opacity);
  const cardInk = cardSurface === undefined ? "initial" : accessibleForeground(cardSurface);
  const cardMuted = cardSurface === undefined
    ? "initial"
    : contrastRatio(mixColor(cardInk, cardSurface, 0.24), cardSurface) >= 4.5
      ? mixColor(cardInk, cardSurface, 0.24)
      : cardInk;
  const cardAccent = cardSurface === undefined
    ? "initial"
    : accessibleAccent(theme.accentColor, cardSurface);
  const cardAccentOn = cardAccent === "initial"
    ? "initial"
    : accessibleForeground(cardAccent);

  return {
    "--pb-violet": accentColor,
    "--pb-violet-soft": accentSoft,
    "--pb-on-accent": onAccent,
    "--pb-theme-accent": accentColor,
    "--pb-theme-on-accent": onAccent,
    "--pb-theme-accent-soft": accentSoft,
    "--pb-theme-background-color": backgroundColor,
    "--pb-theme-background-image": backgroundImage,
    "--pb-theme-card-background": cardBackground === undefined
      ? "initial"
      : rgba(cardBackground.color, cardBackground.opacity),
    "--pb-theme-card-ink": cardInk,
    "--pb-theme-card-muted": cardMuted,
    "--pb-theme-card-line": cardSurface === undefined
      ? "initial"
      : rgba(cardInk, 0.16),
    "--pb-theme-card-accent": cardAccent,
    "--pb-theme-card-accent-soft": cardSurface === undefined
      ? "initial"
      : mixColor(cardAccent, cardSurface, 0.88),
    "--pb-theme-card-on-accent": cardAccentOn,
  };
}
