/**
 * web 工具：fetch + 公开搜索回退（无 Exa MCP 依赖）。
 * 无可用出口时返回明确错误。
 */

const MAX_TOOL_CONTENT = 48_000;
const JINA_READER_BASE_URL = "https://r.jina.ai/";

function truncateContent(text: string, max = MAX_TOOL_CONTENT) {
  const normalized = text.trim();
  return normalized.length > max
    ? `${normalized.slice(0, max)}\n\n[内容过长，已截断]`
    : normalized;
}

function errorMessage(error: unknown) {
  return error instanceof Error && error.message.trim()
    ? error.message.trim()
    : "联网服务暂不可用";
}

function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  onTimeout?: () => void,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      onTimeout?.();
      reject(new Error("联网请求超时"));
    }, timeoutMs);

    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function createLinkedAbortController(
  outerSignal: AbortSignal | undefined,
  timeoutMs: number,
) {
  const controller = new AbortController();
  const abortFromOuter = () => controller.abort(outerSignal?.reason);
  if (outerSignal?.aborted) {
    abortFromOuter();
  } else {
    outerSignal?.addEventListener("abort", abortFromOuter, { once: true });
  }
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  return {
    signal: controller.signal,
    abort: () => controller.abort(),
    cleanup: () => {
      clearTimeout(timer);
      outerSignal?.removeEventListener("abort", abortFromOuter);
    },
  };
}

export function validateExternalHttpUrl(rawUrl: string) {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl.trim());
  } catch {
    throw new Error("网址格式不正确");
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("只允许读取 HTTP 或 HTTPS 网页");
  }
  if (parsed.username || parsed.password) {
    throw new Error("网址不能包含账号或密码");
  }

  const hostname = parsed.hostname.toLowerCase().replace(/\.$/, "");
  const isPrivateIpv4 =
    /^(?:0|10|127)\.|^169\.254\.|^192\.168\.|^172\.(?:1[6-9]|2\d|3[01])\./.test(
      hostname,
    );
  const isPrivateIpv6 =
    hostname === "::" ||
    hostname === "::1" ||
    /^(?:fc|fd|fe[89ab])/i.test(hostname);
  if (
    !hostname ||
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local") ||
    hostname.endsWith(".internal") ||
    !hostname.includes(".") ||
    isPrivateIpv4 ||
    isPrivateIpv6
  ) {
    throw new Error("不能读取本机或内网地址");
  }

  return parsed.toString();
}

async function fetchText(url: string, outerSignal?: AbortSignal) {
  const bridge =
    typeof window !== "undefined"
      ? (window as Window & { gooseWeb?: { fetchText?: (u: string) => Promise<{
          ok: boolean;
          url: string;
          status: number;
          contentType: string;
          text: string;
        }> } }).gooseWeb
      : undefined;
  if (bridge?.fetchText) {
    return withTimeout(bridge.fetchText(url), 15_000);
  }

  const linkedAbort = createLinkedAbortController(outerSignal, 15_000);
  try {
    const response = await fetch(url, {
      headers: {
        Accept: "text/plain,text/html,application/xml,text/xml;q=0.9,*/*;q=0.1",
      },
      signal: linkedAbort.signal,
    });
    if (!response.ok) {
      throw new Error(`网页请求失败（HTTP ${response.status}）`);
    }
    const text = await response.text();
    if (text.length > 2 * 1024 * 1024) {
      throw new Error("网页内容过大，已停止读取");
    }
    return {
      ok: true as const,
      url: response.url || url,
      status: response.status,
      contentType: response.headers.get("content-type") || "",
      text,
    };
  } finally {
    linkedAbort.cleanup();
  }
}

function readableTextFromHtml(html: string, sourceUrl: string) {
  if (typeof DOMParser === "undefined") {
    return html
      .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
      .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  const document = new DOMParser().parseFromString(html, "text/html");
  document
    .querySelectorAll(
      "script,style,noscript,nav,footer,aside,form,dialog,iframe,svg,canvas",
    )
    .forEach((node) => node.remove());

  const title =
    document
      .querySelector('meta[property="og:title"]')
      ?.getAttribute("content") ||
    document.querySelector("h1")?.textContent ||
    document.title ||
    new URL(sourceUrl).hostname;
  const root =
    document.querySelector("article") ||
    document.querySelector("main") ||
    document.querySelector('[role="main"]') ||
    document.body;
  const blocks = root
    ? Array.from(
        root.querySelectorAll("h1,h2,h3,h4,h5,h6,p,li,blockquote,pre"),
      )
        .map((node) => {
          const text = node.textContent?.replace(/\s+/g, " ").trim() || "";
          if (!text) return "";
          const tag = node.tagName.toLowerCase();
          if (/^h[1-6]$/.test(tag)) {
            return `${"#".repeat(Number(tag.slice(1)))} ${text}`;
          }
          if (tag === "li") return `- ${text}`;
          if (tag === "blockquote") return `> ${text}`;
          if (tag === "pre") return `\`\`\`\n${text}\n\`\`\``;
          return text;
        })
        .filter((text, index, all) => Boolean(text) && text !== all[index - 1])
    : [];

  return [`# ${title.trim()}`, ...blocks].join("\n\n").trim();
}

function decodeXml(text: string) {
  return text
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function parseSearchRss(xml: string, maxResults = 5) {
  return [...xml.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)]
    .slice(0, Math.max(1, Math.min(8, maxResults)))
    .map((match) => {
      const item = match[1] ?? "";
      const value = (tag: string) => {
        const found = item.match(
          new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"),
        );
        return decodeXml(found?.[1] || "");
      };
      return {
        title: value("title"),
        url: value("link"),
        snippet: value("description"),
      };
    })
    .filter((item) => item.title && item.url);
}

async function searchWithPublicFeed(
  query: string,
  maxResults: number,
  signal?: AbortSignal,
) {
  const searchUrl = `https://www.bing.com/search?format=rss&mkt=zh-CN&q=${encodeURIComponent(query)}`;
  const response = await fetchText(searchUrl, signal);
  const results = parseSearchRss(response.text, maxResults);
  if (results.length === 0) {
    throw new Error("公开搜索没有返回结果");
  }
  return results;
}

async function searchWithDuckDuckGo(
  query: string,
  maxResults: number,
  signal?: AbortSignal,
) {
  const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`;
  const linkedAbort = createLinkedAbortController(signal, 12_000);
  try {
    const response = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: linkedAbort.signal,
    });
    if (!response.ok) {
      throw new Error(`DuckDuckGo HTTP ${response.status}`);
    }
    const data = (await response.json()) as {
      AbstractText?: string;
      AbstractURL?: string;
      AbstractSource?: string;
      Heading?: string;
      RelatedTopics?: Array<
        | { Text?: string; FirstURL?: string }
        | { Topics?: Array<{ Text?: string; FirstURL?: string }> }
      >;
      Results?: Array<{ Text?: string; FirstURL?: string }>;
    };

    const results: Array<{ title: string; url: string; snippet: string }> = [];
    if (data.AbstractText && data.AbstractURL) {
      results.push({
        title: data.Heading || data.AbstractSource || query,
        url: data.AbstractURL,
        snippet: data.AbstractText,
      });
    }

    const pushTopic = (topic?: { Text?: string; FirstURL?: string }) => {
      if (!topic?.Text || !topic.FirstURL) return;
      if (results.some((item) => item.url === topic.FirstURL)) return;
      results.push({
        title: topic.Text.slice(0, 120),
        url: topic.FirstURL,
        snippet: topic.Text,
      });
    };

    for (const item of data.Results ?? []) pushTopic(item);
    for (const topic of data.RelatedTopics ?? []) {
      if ("Topics" in topic && Array.isArray(topic.Topics)) {
        for (const nested of topic.Topics) pushTopic(nested);
      } else {
        pushTopic(topic as { Text?: string; FirstURL?: string });
      }
      if (results.length >= maxResults) break;
    }

    const sliced = results.slice(0, Math.max(1, Math.min(8, maxResults)));
    if (sliced.length === 0) {
      throw new Error("DuckDuckGo 没有返回结果");
    }
    return sliced;
  } finally {
    linkedAbort.cleanup();
  }
}

async function readWithJina(url: string, signal?: AbortSignal) {
  const response = await fetchText(`${JINA_READER_BASE_URL}${url}`, signal);
  const content = truncateContent(response.text);
  if (!content) throw new Error("Jina 没有返回网页正文");
  return content;
}

async function readDirectly(url: string, signal?: AbortSignal) {
  const response = await fetchText(url, signal);
  const isHtml =
    /html/i.test(response.contentType) || /<html[\s>]/i.test(response.text);
  const content = truncateContent(
    isHtml ? readableTextFromHtml(response.text, response.url) : response.text,
  );
  if (!content) throw new Error("网页没有可读取正文");
  return { content, finalUrl: response.url };
}

export async function executeSearchWeb(
  input: Record<string, unknown>,
): Promise<unknown> {
  const query = typeof input.query === "string" ? input.query.trim() : "";
  if (!query) {
    return { error: "搜索词不能为空" };
  }
  const maxResults =
    typeof input.maxResults === "number"
      ? Math.min(8, Math.max(1, Math.floor(input.maxResults)))
      : 5;

  const failures: string[] = [];

  try {
    return {
      source: "公开搜索",
      query,
      results: await searchWithPublicFeed(query, maxResults),
      untrustedExternalContent: true,
    };
  } catch (error) {
    failures.push(`公开搜索：${errorMessage(error)}`);
  }

  try {
    return {
      source: "DuckDuckGo",
      query,
      results: await searchWithDuckDuckGo(query, maxResults),
      untrustedExternalContent: true,
    };
  } catch (error) {
    failures.push(`DuckDuckGo：${errorMessage(error)}`);
  }

  return {
    error:
      "联网搜索暂不可用（未配置 Exa 等专用 key 时依赖公开搜索；请检查网络后重试）。",
    attempts: failures,
  };
}

export async function executeReadWebPage(
  input: Record<string, unknown>,
): Promise<unknown> {
  const rawUrl = typeof input.url === "string" ? input.url : "";
  let url: string;
  try {
    url = validateExternalHttpUrl(rawUrl);
  } catch (error) {
    return { error: errorMessage(error) };
  }

  const failures: string[] = [];

  try {
    return {
      source: "Jina Reader",
      url,
      content: await readWithJina(url),
      untrustedExternalContent: true,
    };
  } catch (error) {
    failures.push(`Jina Reader：${errorMessage(error)}`);
  }

  try {
    const direct = await readDirectly(url);
    return {
      source: "直接读取",
      url: direct.finalUrl,
      content: direct.content,
      untrustedExternalContent: true,
    };
  } catch (error) {
    failures.push(`直接读取：${errorMessage(error)}`);
  }

  return {
    error: "网页暂时无法读取，请稍后重试或粘贴正文。",
    attempts: failures,
  };
}
