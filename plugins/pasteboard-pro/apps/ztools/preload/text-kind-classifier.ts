import type { PasteItem } from "@pasteboard-pro/core";

const URL_PATTERN = /^(?:https?|ftp):\/\/[^\s/$.?#].[^\s]*$/i;
const BARE_WEB_DOMAIN_PATTERN =
  /^(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+(?:com|cn|org|net|io|me|co|info|app|dev|ai|edu|gov|top|vip|xyz|cc|tv|so|biz|tech|store|space|online|site|club|fun|pro|ink|run|zone)(?::\d{1,5})?(?:[/?#]\S*)?$/i;

const HEX_COLOR_PATTERN = /^#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
const RGB_COLOR_PATTERN = /^rgba?\(\s*\d{1,3}\s*[, ]\s*\d{1,3}\s*[, ]\s*\d{1,3}(?:\s*[,/]\s*(?:0|1|0?\.\d+|\d{1,3}%))?\s*\)$/i;
const HSL_COLOR_PATTERN = /^hsla?\(\s*\d{1,3}(?:deg)?\s*[, ]\s*\d{1,3}%\s*[, ]\s*\d{1,3}%(?:\s*[,/]\s*(?:0|1|0?\.\d+|\d{1,3}%))?\s*\)$/i;

export function classifyTextKind(text: string): "text" | "url" | "color" {
  const trimmed = text.trim();
  if (trimmed.length === 0 || trimmed.includes("\n") || trimmed.includes("\r")) {
    return "text";
  }
  if (HEX_COLOR_PATTERN.test(trimmed) || RGB_COLOR_PATTERN.test(trimmed) || HSL_COLOR_PATTERN.test(trimmed)) {
    return "color";
  }
  if (URL_PATTERN.test(trimmed)) {
    try {
      const parsed = new URL(trimmed);
      if (parsed.protocol === "http:" || parsed.protocol === "https:" || parsed.protocol === "ftp:") {
        return "url";
      }
    } catch {}
  }
  if (BARE_WEB_DOMAIN_PATTERN.test(trimmed)) {
    return "url";
  }
  return "text";
}

export function refinePasteItemKind(item: PasteItem): PasteItem {
  if (item.kind === "text" && typeof item.payload.text === "string") {
    const refined = classifyTextKind(item.payload.text);
    if (refined !== "text") {
      return { ...item, kind: refined };
    }
  }
  return item;
}
