export const UI_SIZE_VALUES = ['compact', 'standard', 'comfortable'] as const;

export type UiSize = typeof UI_SIZE_VALUES[number];

export const DEFAULT_UI_SIZE: UiSize = 'standard';

export function normalizeUiSize(value: unknown): UiSize {
  return UI_SIZE_VALUES.includes(value as UiSize)
    ? value as UiSize
    : DEFAULT_UI_SIZE;
}

export function applyUiSizeToRoot(value: unknown): UiSize {
  const normalized = normalizeUiSize(value);
  if (typeof document !== 'undefined') {
    document.documentElement.dataset.uiSize = normalized;
  }
  return normalized;
}
