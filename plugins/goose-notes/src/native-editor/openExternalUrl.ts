import { nativeEditorPlatform } from "./runtime";

export function normalizeExternalUrl(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return "";
  return /^www\./i.test(trimmed) ? `https://${trimmed}` : trimmed;
}

export function openExternalUrl(value: string) {
  const normalized = normalizeExternalUrl(value);
  if (normalized) void nativeEditorPlatform.shell.openUrl(normalized);
}
