export function normalizeClipboardLineEndings(value: string): string {
  return value.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

export function looksLikeMarkdownFragment(text: string): boolean {
  const value = text.trim();
  if (!value) return false;
  return (
    /^(#{1,6}\s|\s*[-*+]\s|\s*\d+\.\s|\s*[-*+]\s\[[ xX]\]\s|\s*[•·]\s|\s*\.\s)/m.test(value) ||
    /```/.test(value) ||
    /\|.+\|/.test(value) ||
    /(\*\*|__|~~|`[^`]+`)/.test(value) ||
    /\[([^\]]+)\]\(([^)]+)\)/.test(value)
  );
}

const MERMAID_START_PATTERNS = [
  /^(?:graph|flowchart)\s+(?:TB|TD|BT|RL|LR)\b/i,
  /^sequenceDiagram\b/i,
  /^classDiagram(?:-v2)?\b/i,
  /^stateDiagram(?:-v2)?\b/i,
  /^erDiagram\b/i,
  /^journey\b/i,
  /^gantt\b/i,
  /^pie(?:\s+title\b|\b)/i,
  /^gitGraph\b/i,
  /^mindmap\b/i,
  /^timeline\b/i,
  /^quadrantChart\b/i,
  /^requirementDiagram\b/i,
  /^C4(?:Context|Container|Component|Dynamic|Deployment)\b/,
  /^sankey-beta\b/i,
  /^xychart-beta\b/i,
  /^block-beta\b/i,
  /^packet-beta\b/i,
  /^architecture-beta\b/i,
];

export function looksLikeMermaidDiagram(text: string): boolean {
  const normalized = normalizeClipboardLineEndings(text).trim();
  if (!normalized || normalized.includes("```")) return false;

  const lines = normalized
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const firstContentLine = lines.find(
    (line) => !line.startsWith("%%") && !/^---$/.test(line),
  );
  if (!firstContentLine) return false;
  if (!MERMAID_START_PATTERNS.some((pattern) => pattern.test(firstContentLine))) {
    return false;
  }

  // 避免用户只粘了一个 Mermaid 声明词时误转。真实图表通常还有一行内容，
  // 或同一行已经包含标题/数据/关系语法。
  return (
    lines.length > 1 ||
    /(-->|---|==>|-.->|:\s|title\s+|accTitle\s*:|accDescr\s*:)/i.test(
      firstContentLine,
    )
  );
}

export function stripMarkdownHardBreaks(text: string): string {
  return normalizeClipboardLineEndings(text)
    .replace(/\\\n/g, "\n")
    .replace(/ {2,}\n/g, "\n")
    .replace(/\\$/g, "");
}

export function normalizeMarkdownPasteText(text: string): string {
  return stripMarkdownHardBreaks(text).replace(
    /^(\s*)(?:[•·]|\.)\s+/gm,
    "$1- ",
  );
}

export function parseMarkdownLink(text: string): { text: string; url: string } | null {
  const match = text.trim().match(/^\[([^\]]+)\]\(([^)]+)\)$/);
  if (!match) return null;
  return { text: match[1], url: match[2] };
}

function stripMarkdownHardBreakArtifacts(value: string): string {
  return normalizeClipboardLineEndings(value)
    .replace(/\\\n/g, "\n")
    .replace(/ {2,}\n/g, "\n");
}

function unwrapMarkdownAutolink(value: string): string | null {
  const normalized = normalizeClipboardLineEndings(value).trim();
  const match = normalized.match(/^<([^<>\s]+)>$/);
  return match?.[1] ?? null;
}

export function shouldPreferVisibleSelectionText(
  clipboardText: string,
  selectedText: string,
  withinCodeBlock: boolean,
): boolean {
  if (!selectedText) return false;
  if (withinCodeBlock) return true;
  if (unwrapMarkdownAutolink(clipboardText) === selectedText.trim()) return true;
  if (!clipboardText.includes("\\\n") && !clipboardText.match(/ {2,}\n/)) return false;
  return stripMarkdownHardBreakArtifacts(clipboardText) === selectedText;
}

/**
 * 判断剪贴板内容是否为「块结构」(非纯单行文本)——用于「标题一隔离」：光标在标题一时，
 * 块结构应落到标题下方而非注入标题。判定为「块结构」的依据(命中任一即是)：
 * - HTML 含块级标签：img/figure/table/pre/code/ul/ol/li/h1-6/blockquote/hr/p×多 等；
 * - 纯文本含块级 Markdown：标题(# )/列表(- 1.)/待办/代码围栏(```)/表格(|...|)/引用(> )/分隔线；
 * - 纯文本含换行(多行)——标题是单行的，多行内容应落正文。
 * 反之：单行纯文本、或仅含 inline 标签(b/i/a/strong/em/span/code-inline)的 HTML → 非块结构，
 * 照常注入标题文字。
 */
export function looksLikeBlockStructure(
  plainText: string,
  htmlText: string,
): boolean {
  const html = (htmlText || "").trim();
  if (html) {
    // 块级标签出现即视为块结构。
    if (
      /<\s*(img|figure|picture|table|thead|tbody|tr|td|th|pre|ul|ol|li|h[1-6]|blockquote|hr|video|audio|iframe)\b/i.test(
        html,
      )
    ) {
      return true;
    }
    // 多个 <p>/<div> 段落 → 多块结构。
    const blockParaCount = (html.match(/<\s*(p|div)\b/gi) || []).length;
    if (blockParaCount >= 2) return true;
  }

  const text = (plainText || "").trim();
  if (!text) return false;
  // 含换行 = 多行 → 落正文。
  if (/\n/.test(text)) return true;
  // 单行但含块级 Markdown 语法。
  if (
    /^(#{1,6}\s|\s*[-*+]\s|\s*\d+\.\s|\s*[-*+]\s\[[ xX]\]\s|>\s|```|\|.+\||-{3,}$)/.test(
      text,
    )
  ) {
    return true;
  }
  return false;
}

export function isValidUrl(text: string): boolean {
  if (!text) return false;
  // 协议 URL
  if (/^[a-z][a-z0-9+.-]*:\/\/\S+/i.test(text)) return true;
  // www. 开头的 URL
  if (/^www\.\S+\.\S{2,}/i.test(text)) return true;
  // 域名格式 of URL (example.com/path)——形状正则只管「像域名」(≥2 段标签)，
  // 语义交给 isLinkworthyText 的 TLD 白名单，否则 Java 全限定名
  // (cn.cerc.mis.core.AppClient)、文件名(AppClient.java)会被误判成 URL。
  if (
    /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+(\/\S*)?$/i.test(text) &&
    isLinkworthyText(text)
  ) {
    return true;
  }
  return false;
}

// ===== 自动建链边界 =====
// BlockNote 的 autolink/pasteRule 用 linkifyjs 按「真实 TLD 全表」识别裸域名，
// 而 .java/.md/.sh/.app 等既是真实 TLD 又是常见文件后缀，导致粘贴
// `AppClient.java`、`cn.cerc.mis.core.AppClient` 这类类名/文件名被误转成链接。
// 原则：宁可漏建链(真链接用户仍可 Cmd-K 手动建)，也不误建链。

// 裸域名(无协议、无 www.)允许自动建链的常用 TLD 白名单。
// 刻意排除与代码文件后缀 / macOS 应用名冲突的真实 TLD：
// java、md、sh、rs、so、cc、pl、zip、mov、app 等。
const BARE_DOMAIN_TLDS = new Set([
  "com", "net", "org", "io", "dev", "ai", "cn", "co", "me", "edu",
  "gov", "mil", "info", "biz", "tv", "im", "ly", "to", "us", "uk",
  "jp", "de", "fr", "ru", "br", "in", "kr", "hk", "tw", "sg",
  "au", "ca", "it", "es", "nl", "se", "ch", "at", "fi", "no",
  "dk", "cz", "pt", "tr", "mx", "id", "th", "vn", "my", "ph",
  "nz", "za", "eu", "xyz", "top", "site", "online", "store", "tech", "fun",
  "live", "news", "work", "world", "zone", "cloud", "club", "space", "vip", "pro",
  "link", "run", "mobi", "name", "asia", "fm", "am", "gg", "wiki", "blog",
  "email", "design", "page", "one", "icu", "ren", "wang", "la", "moe",
]);

const HAS_URI_SCHEME = /^[a-z][a-z0-9+.-]*:/i;
const ALLOWED_LINK_SCHEMES = /^(https?|ftps?|mailto|tel|callto|sms|cid|xmpp):/i;

/**
 * 判断一段文本是否「值得」成为链接。接入两处：
 * - BlockNote 编辑器选项 links.isValidLink(autolink/粘贴/HTML 导入的统一闸口，
 *   autolink 传入的是匹配原文如 `AppClient.java`，HTML 导入传入的是带协议 href)；
 * - 本文件 isValidUrl 的裸域名分支(整段粘贴是 URL 时的判定)。
 */
export function isLinkworthyText(value: string): boolean {
  const v = value.trim();
  if (!v) return false;
  // 带 scheme(含 `host:port` 形态会被当 scheme 拒掉，无协议带端口的粘贴可接受漏建链)
  if (HAS_URI_SCHEME.test(v)) return ALLOWED_LINK_SCHEMES.test(v);
  if (/^www\./i.test(v)) return true;
  // 邮箱 → autolink 会转 mailto
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) return true;
  // 裸域名：大写字母是 CamelCase 类名/文件名特征，直接拒；TLD 必须在白名单内。
  const host = v.split(/[/?#]/)[0];
  if (host !== host.toLowerCase()) return false;
  const tld = host.split(".").pop() ?? "";
  return BARE_DOMAIN_TLDS.has(tld);
}
