export const EDITOR_CONTEXT_UI_GAP = 6;

export function normalizeEditorUiScale(value: unknown): number {
  const parsed =
    typeof value === "number" ? value : Number.parseFloat(String(value ?? ""));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

export function getEditorUiScale(): number {
  if (
    typeof document === "undefined" ||
    typeof getComputedStyle !== "function"
  ) {
    return 1;
  }
  return normalizeEditorUiScale(
    getComputedStyle(document.documentElement).getPropertyValue(
      "--editor-ui-scale",
    ),
  );
}

export function getScaledEditorUiPx(
  pixels: number,
  scale = getEditorUiScale(),
): number {
  return pixels * normalizeEditorUiScale(scale);
}
