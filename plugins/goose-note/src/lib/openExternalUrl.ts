import { shell } from "@/lib/utools/shell";
import { isUTools } from "@/lib/utools/env";

export function normalizeExternalUrl(url: string): string {
  const trimmed = url.trim();
  if (!trimmed) return "";
  if (/^www\./i.test(trimmed)) return `https://${trimmed}`;
  return trimmed;
}

export function openExternalUrl(url: string): void {
  const targetUrl = normalizeExternalUrl(url);
  if (!targetUrl) return;

  if (isUTools()) {
    shell.openUrl(targetUrl, false);
    return;
  }

  window.open(targetUrl, "_blank", "noopener,noreferrer");
}
