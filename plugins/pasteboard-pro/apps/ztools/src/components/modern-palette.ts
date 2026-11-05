const PALETTE_VARIABLES = [
  "--pb-ink",
  "--pb-muted",
  "--pb-violet",
  "--pb-glass",
  "--pb-glass-strong",
  "--pb-line",
  "--pb-shadow",
  "--pb-window-bg",
] as const;

export function readModernPalette(element: Element): Record<string, string> {
  const computed = getComputedStyle(element);
  const palette: Record<string, string> = {};
  for (const name of PALETTE_VARIABLES) {
    const value = computed.getPropertyValue(name).trim();
    if (value.length > 0) palette[name] = value;
  }
  return palette;
}
