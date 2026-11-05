import { computed, onBeforeUnmount, provide, watchEffect, type Ref } from "vue";
import type { WindowPreferences } from "../preload/window-preferences";
import { modernShelfVariables, shelfUiVersionKey } from "./shelf-presentation";
import { themeCssVariables } from "./theme";

/** Shared by the shelf, standalone panels and body-teleported menus. */
export function applicationThemeVariables(preferences: WindowPreferences, dark: boolean): Record<string, string> {
  if (preferences.uiVersion === "classic") {
    return themeCssVariables(preferences.theme, dark);
  }
  return modernShelfVariables(
    preferences.theme.accentColor,
    dark,
    preferences.theme.background,
    preferences.theme,
  );
}

export function useApplicationPresentation(preferences: Ref<WindowPreferences>, dark: Ref<boolean>) {
  const uiVersion = computed(() => preferences.value.uiVersion ?? "modern");
  const themeStyle = computed(() => applicationThemeVariables(preferences.value, dark.value));
  provide(shelfUiVersionKey, uiVersion);
  const root = document.documentElement;
  const previousVersion = root.dataset.pbUiVersion;
  const previousStyles = new Map<string, string>();
  watchEffect(() => {
    root.dataset.pbUiVersion = uiVersion.value;
    for (const [name, value] of Object.entries(themeStyle.value)) {
      if (!previousStyles.has(name)) previousStyles.set(name, root.style.getPropertyValue(name));
      root.style.setProperty(name, value);
    }
  });
  onBeforeUnmount(() => {
    if (previousVersion === undefined) delete root.dataset.pbUiVersion;
    else root.dataset.pbUiVersion = previousVersion;
    for (const [name, value] of previousStyles) {
      if (value.length === 0) root.style.removeProperty(name);
      else root.style.setProperty(name, value);
    }
  });
  return { uiVersion, themeStyle };
}
