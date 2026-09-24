import type { CodeFontId } from "./fonts";

/** Module-level cache: load JetBrains Mono (latin 400) at most once. */
let jetbrainsLoadPromise: Promise<void> | null = null;

/**
 * Ensure a bundled code font is loaded when needed.
 * Currently only JetBrains Mono is self-hosted via Fontsource; other presets use system fonts.
 * Safe with no DOM (SSR / tests): still schedules the CSS import when id is jetbrains.
 */
export function ensureCodeFontLoaded(id: CodeFontId): void {
  if (id !== "jetbrains") return;

  if (!jetbrainsLoadPromise) {
    jetbrainsLoadPromise = import(
      "@fontsource/jetbrains-mono/latin-400.css"
    ).then(
      () => undefined,
      () => {
        // Allow a later call to retry if the dynamic import failed
        jetbrainsLoadPromise = null;
      },
    );
  }
}
