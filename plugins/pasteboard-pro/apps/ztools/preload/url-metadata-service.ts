import type { UrlMeta } from "@pasteboard-pro/core";

export type { UrlMeta };

const SENSITIVE_QUERY_PATTERN =
  /(?:^|_|-)(?:token|auth|sig|signature|ticket|verify|verification|secret|access_token|refresh_token|reset|otp|code|session|session_id|password|passwd|key|api_key|nonce|credential|invite|magic)(?:$|_|-)/i;

const SENSITIVE_PATH_PATTERN =
  /(?:reset[-_]password|verify[-_]email|magic[-_]link|invite|confirm[-_]email|auth\/callback)/i;

const PRIVATE_TLD_PATTERN =
  /\.(?:local|internal|lan|home|corp|test|example|invalid)$/i;

const BARE_WEB_DOMAIN_PATTERN =
  /^(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+(?:com|cn|org|net|io|me|co|info|app|dev|ai|edu|gov|top|vip|xyz|cc|tv|so|biz|tech|store|space|online|site|club|fun|pro|ink|run|zone)(?::\d{1,5})?(?:[/?#]\S*)?$/i;

const ALLOWED_FAVICON_DATA_MIME_PATTERN =
  /^data:image\/(?:png|x-icon|vnd\.microsoft\.icon|jpeg|svg\+xml|webp);base64,/i;

export function normalizeCandidateUrl(raw: string): string | undefined {
  const trimmed = raw.trim();
  if (trimmed.length === 0 || trimmed.includes("\n") || trimmed.includes("\r")) {
    return undefined;
  }
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(trimmed)) {
    return trimmed;
  }
  if (BARE_WEB_DOMAIN_PATTERN.test(trimmed)) {
    return "https://" + trimmed;
  }
  return undefined;
}

export function isPrivateHost(hostname: string): boolean {
  const normalized = hostname.trim().toLowerCase();
  if (normalized === "localhost" || normalized === "0.0.0.0" || normalized === "::") return true;
  if (!normalized.includes(".")) return true; // Single-word host like "nas", "router"
  if (PRIVATE_TLD_PATTERN.test(normalized)) return true;

  // IPv4 checks
  const ipv4Match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(normalized);
  if (ipv4Match) {
    const [, a, b] = ipv4Match.map(Number);
    if (a === 127) return true; // Loopback
    if (a === 10) return true;  // Private
    if (a === 192 && b === 168) return true; // Private
    if (a === 172 && b !== undefined && b >= 16 && b <= 31) return true; // Private
    if (a === 169 && b === 254) return true; // Link-local
    if (a === 100 && b !== undefined && b >= 64 && b <= 127) return true; // CGNAT
    if (a === 0) return true;
  }

  // IPv6 checks
  if (
    normalized === "::1" ||
    normalized.startsWith("fe80:") ||
    normalized.startsWith("fc00:") ||
    normalized.startsWith("fd00:")
  ) {
    return true;
  }

  // IPv4-mapped IPv6
  if (normalized.startsWith("::ffff:")) {
    return isPrivateHost(normalized.slice(7));
  }

  return false;
}

export function isSensitiveUrl(url: URL): boolean {
  // Disallow URLs with embedded credentials (e.g. https://user:pass@example.com)
  if (url.username || url.password) return true;

  // Check path for sensitive actions
  if (SENSITIVE_PATH_PATTERN.test(url.pathname)) return true;

  // Check query parameters
  for (const [key, val] of url.searchParams.entries()) {
    if (SENSITIVE_QUERY_PATTERN.test(key)) return true;
    if (val.length > 20 && /^[a-zA-Z0-9_-]{20,}$/.test(val) && SENSITIVE_QUERY_PATTERN.test(key)) return true;
  }

  return false;
}

export function shouldFetchUrlMetadata(rawUrl: string): boolean {
  const normalized = normalizeCandidateUrl(rawUrl);
  if (!normalized) return false;

  try {
    const url = new URL(normalized);
    if (url.protocol !== "http:" && url.protocol !== "https:") return false;
    if (isPrivateHost(url.hostname)) return false;
    if (isSensitiveUrl(url)) return false;
    return true;
  } catch {
    return false;
  }
}

export function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, dec) => {
      const num = Number(dec);
      return Number.isFinite(num) ? String.fromCharCode(num) : "";
    })
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => {
      const num = parseInt(hex, 16);
      return Number.isFinite(num) ? String.fromCharCode(num) : "";
    });
}

export function extractHtmlMetadata(html: string, pageUrl: string): { title?: string; favicon?: string } {
  let title: string | undefined;
  let favicon: string | undefined;

  // 1. Title extraction: prefer og:title / twitter:title, then <title>
  const ogTitleMatch =
    /<meta[^>]+(?:property|name)=["'](?:og:title|twitter:title)["'][^>]+content=["']([^"']+)["'][^>]*>/i.exec(html) ??
    /<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["'](?:og:title|twitter:title)["'][^>]*>/i.exec(html);

  if (ogTitleMatch?.[1]) {
    title = decodeHtmlEntities(ogTitleMatch[1]).trim();
  } else {
    const titleTagMatch = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
    if (titleTagMatch?.[1]) {
      title = decodeHtmlEntities(titleTagMatch[1]).replace(/\s+/g, " ").trim();
    }
  }

  // 2. Favicon extraction: look for <link rel="..." href="...">
  const linkMatches = html.matchAll(/<link\s+[^>]*>/gi);
  let bestIconHref: string | undefined;
  let isHighRes = false;

  for (const match of linkMatches) {
    const tag = match[0];
    const relMatch = /rel=["']([^"']+)["']/i.exec(tag);
    const hrefMatch = /href=["']([^"']+)["']/i.exec(tag);
    if (!relMatch?.[1] || !hrefMatch?.[1]) continue;

    const rel = relMatch[1].toLowerCase();
    const href = hrefMatch[1].trim();

    if (rel.includes("apple-touch-icon")) {
      bestIconHref = href;
      isHighRes = true;
      break;
    } else if (rel.includes("icon") && (!bestIconHref || !isHighRes)) {
      bestIconHref = href;
    }
  }

  if (bestIconHref) {
    try {
      if (bestIconHref.startsWith("data:")) {
        // Enforce safe image mime and max 32KB data URI limit
        if (ALLOWED_FAVICON_DATA_MIME_PATTERN.test(bestIconHref) && bestIconHref.length <= 32_768) {
          favicon = bestIconHref;
        }
      } else {
        const parsed = new URL(bestIconHref, pageUrl);
        if ((parsed.protocol === "http:" || parsed.protocol === "https:") && !isPrivateHost(parsed.hostname)) {
          favicon = parsed.href;
        }
      }
    } catch {}
  }

  // Fallback to /favicon.ico if none declared
  if (!favicon) {
    try {
      const parsed = new URL(pageUrl);
      if ((parsed.protocol === "http:" || parsed.protocol === "https:") && !isPrivateHost(parsed.hostname)) {
        favicon = `${parsed.origin}/favicon.ico`;
      }
    } catch {}
  }

  return {
    ...(title ? { title: title.slice(0, 200) } : {}),
    ...(favicon ? { favicon } : {}),
  };
}

export type FetchUrlMetadataOptions = Readonly<{
  timeoutMs?: number;
  maxBytes?: number;
}>;

export async function fetchUrlMetadata(
  rawUrl: string,
  options: FetchUrlMetadataOptions = {},
): Promise<UrlMeta | undefined> {
  const normalized = normalizeCandidateUrl(rawUrl);
  if (!normalized || !shouldFetchUrlMetadata(normalized)) return undefined;

  let currentUrl: URL;
  try {
    currentUrl = new URL(normalized);
  } catch {
    return undefined;
  }

  const timeoutMs = options.timeoutMs ?? 3000;
  const maxBytes = options.maxBytes ?? 32_768; // 32KB is plenty for <head>
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    let redirects = 0;
    const maxRedirects = 3;
    let finalResponse: Response | undefined;

    while (redirects <= maxRedirects) {
      if (!shouldFetchUrlMetadata(currentUrl.href)) return undefined;

      const response = await fetch(currentUrl.href, {
        signal: controller.signal,
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
        },
        redirect: "manual",
      });

      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get("location");
        if (!location || redirects >= maxRedirects) return undefined;
        try {
          currentUrl = new URL(location, currentUrl.href);
        } catch {
          return undefined;
        }
        redirects += 1;
        continue;
      }

      finalResponse = response;
      break;
    }

    if (!finalResponse || !finalResponse.ok) return undefined;

    const contentType = finalResponse.headers.get("content-type") ?? "";
    if (!contentType.includes("html") && !contentType.includes("xml")) {
      return { hostname: currentUrl.hostname };
    }

    if (!finalResponse.body) {
      return { hostname: currentUrl.hostname };
    }

    const reader = finalResponse.body.getReader();
    const decoder = new TextDecoder("utf-8", { fatal: false, ignoreBOM: true });
    let html = "";
    let receivedBytes = 0;

    try {
      while (receivedBytes < maxBytes) {
        const { done, value } = await reader.read();
        if (done || !value) break;
        receivedBytes += value.byteLength;
        html += decoder.decode(value, { stream: true });

        // If we found both title and icon or finished head, stop early to save CPU/network
        if (html.includes("</head>") || (html.includes("</title>") && html.includes("icon"))) {
          controller.abort();
          break;
        }
      }
    } catch {
      // Aborting stream early is intentional
    } finally {
      try {
        reader.releaseLock();
      } catch {}
    }

    const extracted = extractHtmlMetadata(html, currentUrl.href);
    return {
      hostname: currentUrl.hostname,
      ...(extracted.title ? { title: extracted.title } : {}),
      ...(extracted.favicon ? { favicon: extracted.favicon } : {}),
    };
  } catch {
    return undefined;
  } finally {
    clearTimeout(timer);
  }
}
