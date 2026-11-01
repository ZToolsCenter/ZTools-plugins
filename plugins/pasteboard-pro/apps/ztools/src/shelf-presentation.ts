import type { ComputedRef, InjectionKey, Ref } from "vue";
import type { ShelfUiVersion, ThemeBackground, ThemePreferences } from "../preload/window-preferences";
import { defaultThemePreferences } from "../preload/window-theme-preferences";
import { themeCssVariables } from "./theme";

export const shelfUiVersionKey: InjectionKey<Readonly<Ref<ShelfUiVersion>> | ComputedRef<ShelfUiVersion>> = Symbol("shelf-ui-version");

export function modernShelfVariables(
  accent: string | undefined,
  dark: boolean,
  background: ThemeBackground = defaultThemePreferences.background,
  surfacePreferences: Pick<ThemePreferences, "cardBackground" | "backgroundBaseColor"> = {},
): Record<string, string> {
  const cardSurface = dark ? "#2f343b" : "#ffffff";
  const theme: ThemePreferences = {
    accentColor: accent ?? defaultThemePreferences.accentColor,
    background,
    ...surfacePreferences,
  };
  const variables = themeCssVariables(
    theme,
    dark,
    cardSurface,
  );
  if (background.type === "default" && surfacePreferences.backgroundBaseColor === undefined) {
    variables["--pb-theme-background-color"] = dark ? "#24282e" : "#f5f6f8";
  }
  return variables;
}
