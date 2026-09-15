const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { randomUUID } = require("node:crypto");
const { normalizeOptionalTemperature } = require("./ai-chat-options");
const { createConversationStore } = require("./conversation-store");
const { normalizeConversationMessages } = require("./conversation-messages");
const { createPluginDataPaths } = require("./data-paths");
const { createWorkspaceStore } = require("./workspace-store");
const { createShellInvocation, normalizePathEnvironment } = require("./runtime/tools/shell-command");
const { resolveRuntimeToolName } = require("./runtime/tools/shell-tool-name");

const STORAGE_KEYS = {
  workspaces: "zvc:workspaces",
  selectedModel: "zvc:selected-model",
  autoApproveTools: "zvc:auto-approve-tools",
  activeConversation: "zvc:active-conversation",
  collapsedWorkspaces: "zvc:collapsed-workspaces",
  streamBatchIntervalMs: "zvc:stream-batch-interval-ms",
  autoCompactionThresholdPercent: "zvc:auto-compaction-threshold-percent",
  toolConcurrencyLimit: "zvc:tool-concurrency-limit",
};
const CONVERSATION_DB_PREFIX = "zvc/conversations/";
const CONVERSATION_STORAGE_VERSION = 5;
const MAX_OUTPUT_CHARS = 120000;
const MAX_WEB_RESULTS = 10;
const MAX_WEB_READ = 30000;
const BUNDLED_SKILL_REVISIONS = { "develop-ztools-plugin": "14" };
const DEFAULT_ENABLED_TOOLS = [];
const DEFAULT_STREAM_BATCH_INTERVAL_MS = 50;
const MAX_STREAM_BATCH_INTERVAL_MS = 1000;
const AI_REQUEST_TIMEOUT_MS = 300000;
const DEFAULT_AUTO_COMPACTION_THRESHOLD_PERCENT = 70;
const DEFAULT_TOOL_CONCURRENCY_LIMIT = 10;
const MAX_TOOL_CONCURRENCY_LIMIT = 50;
const REASONING_EFFORT_VALUES = new Set([
  'none',
  'off',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
]);
const LOCAL_RUNTIME_TOOL_NAMES = new Set([
  "read",
  "write",
  "edit",
  "grep",
  "find",
  "ls",
  "bash",
]);
const backgroundProcesses = new Map();
let childProcessModule = null;
let localToolRuntime = null;
let pluginDataPaths = null;
let workspaceStore = null;
let skillRootReady = false;
const DEBUG_CHAT = process.env.ZVC_DEBUG === "1";
const FILE_LANGUAGE_BY_EXTENSION = {
  ".c": "c",
  ".cc": "cpp",
  ".cpp": "cpp",
  ".css": "css",
  ".go": "go",
  ".html": "html",
  ".htm": "html",
  ".java": "java",
  ".js": "javascript",
  ".jsx": "javascript",
  ".json": "json",
  ".md": "markdown",
  ".php": "php",
  ".py": "python",
  ".rb": "ruby",
  ".rs": "rust",
  ".scss": "scss",
  ".sh": "shell",
  ".sql": "sql",
  ".ts": "typescript",
  ".tsx": "typescript",
  ".vue": "vue",
  ".xml": "xml",
  ".yaml": "yaml",
  ".yml": "yaml",
};

/**
 * 在调试开关启用时输出模型请求诊断日志。
 * @param {...unknown} args 日志参数。
 * @returns {void} 无返回值。
 */
const debugChat = (...args) => {
  if (DEBUG_CHAT) console.log("[ZVC chat]", ...args);
};

/**
 * 从当前 ZTools Electron 进程取得可重新启动主应用的真实宿主路径。
 * @returns {string} 当前宿主主程序绝对路径；进程信息异常时返回空字符串。
 */
function getRunningHostExecutablePath() {
  const executablePath = String(process.execPath || "").trim();
  if (
    !executablePath ||
    !path.isAbsolute(executablePath) ||
    !fs.existsSync(executablePath)
  )
    return "";
  if (process.platform === "darwin") {
    const marker = ".app/Contents/Frameworks/";
    const markerIndex = executablePath.indexOf(marker);
    if (markerIndex >= 0) {
      // Renderer 位于 Helper.app 中，需要回到同一主应用包的 MacOS 可执行文件。
      const appBundle = executablePath.slice(0, markerIndex + 4);
      const appName = path.basename(appBundle, ".app");
      const mainExecutable = path.join(appBundle, "Contents", "MacOS", appName);
      if (fs.existsSync(mainExecutable)) return fs.realpathSync(mainExecutable);
    }
  }
  return fs.realpathSync(executablePath);
}

/**
 * 构建可在 Finder 或 Spotlight 启动 ZTools 时使用的命令环境。
 * @returns {NodeJS.ProcessEnv} 补齐运行时目录、宿主位置和 Windows Python UTF-8 设置后的进程环境。
 */
function getCommandEnvironment() {
  const env = normalizePathEnvironment({ ...process.env, NO_COLOR: "1" });
  // Python 连接管道时可能回退到 GBK，显式要求其标准流输出 UTF-8，避免 Node 解码出错。
  if (process.platform === "win32") {
    env.PYTHONIOENCODING = "utf-8";
    env.PYTHONUTF8 = "1";
  }
  const pathKey = process.platform === "win32" ? "Path" : "PATH";
  const currentPath = String(env[pathKey] || "")
    .split(path.delimiter)
    .filter(Boolean);
  const extraPaths = [];
  const home = env.HOME || os.homedir();
  /**
   * 将存在且尚未登记的目录加入额外 PATH。
   * @param {unknown} entry 候选目录。
   * @returns {void} 无返回值。
   */
  const addPath = (entry) => {
    if (entry && fs.existsSync(entry) && !extraPaths.includes(entry))
      extraPaths.push(entry);
  };

  addPath(env.FNM_MULTISHELL_PATH);
  addPath(path.join(home, ".volta", "bin"));
  addPath(path.join(home, ".asdf", "shims"));
  addPath(path.join(home, ".local", "share", "mise", "shims"));
  addPath("/opt/homebrew/bin");
  addPath("/usr/local/bin");

  // nvm 将各 Node 版本放在独立 bin 目录，需要逐个补入宿主 PATH。
  const nvmVersions = path.join(home, ".nvm", "versions", "node");
  try {
    for (const version of fs.readdirSync(nvmVersions).sort().reverse())
      addPath(path.join(nvmVersions, version, "bin"));
  } catch {
    // nvm 为可选依赖，读取失败时继续使用系统 PATH。
  }

  env[pathKey] = [...new Set([...extraPaths, ...currentPath])].join(path.delimiter);
  const runningHostExecutable = getRunningHostExecutablePath();
  // 子进程始终使用当前 ZTools 实例，避免 E2E 自动选择到另一安装版本。
  if (runningHostExecutable)
    env.ZTOOLS_E2E_EXECUTABLE_PATH = runningHostExecutable;
  return env;
}

/**
 * 将搜索页面中的基础 HTML 实体和标签转换为纯文本。
 * @param {unknown} value 原始 HTML 片段。
 * @returns {string} 规范化后的纯文本。
 */
function decodeHtmlText(value) {
  return String(value || "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * 从 DuckDuckGo 或 Bing HTML 中提取有限数量的搜索结果。
 * @param {string} html 搜索结果页面 HTML。
 * @param {number} limit 最大结果数量。
 * @param {'duckduckgo'|'bing'} source 搜索来源。
 * @returns {Array<{title: string, link: string, snippet: string}>} 搜索结果列表。
 */
function parseSearchResults(html, limit, source) {
  const results = [];
  if (source === "duckduckgo") {
    const titles = [
      ...String(html).matchAll(
        /<a[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g,
      ),
    ];
    const snippets = [
      ...String(html).matchAll(
        /class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/(?:a|div)>/g,
      ),
    ];
    for (
      let index = 0;
      index < titles.length && results.length < limit;
      index += 1
    ) {
      let link = titles[index][1];
      try {
        const parsed = new URL(link, "https://html.duckduckgo.com");
        link = parsed.searchParams.get("uddg") || link;
      } catch {
        /* 重定向地址解析失败时保留原始链接。 */
      }
      const title = decodeHtmlText(titles[index][2]);
      link = decodeHtmlText(link);
      if (title && /^https?:\/\//i.test(link))
        results.push({
          title,
          link,
          snippet: decodeHtmlText(snippets[index]?.[1] || ""),
        });
    }
  } else {
    const blocks = [
      ...String(html).matchAll(
        /<li[^>]*class="[^"]*b_algo[^"]*"[^>]*>([\s\S]*?)<\/li>/gi,
      ),
    ];
    for (const match of blocks) {
      if (results.length >= limit) break;
      const block = match[1] || "";
      const titleMatch = block.match(
        /<h2[^>]*>\s*<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i,
      );
      if (!titleMatch || !/^https?:\/\//i.test(titleMatch[1])) continue;
      const snippetMatch = block.match(
        /<(?:p|div|span)[^>]*class="[^"]*(?:b_caption|b_snippet|b_lineclamp)[^"]*"[^>]*>([\s\S]*?)<\/(?:p|div|span)>/i,
      );
      results.push({
        title: decodeHtmlText(titleMatch[2]),
        link: decodeHtmlText(titleMatch[1]),
        snippet: decodeHtmlText(snippetMatch?.[1] || ""),
      });
    }
  }
  return results.filter((item) => item.title && item.link);
}

/**
 * 发起带超时和浏览器请求头的网页请求。
 * @param {string} url 请求地址。
 * @param {Record<string, unknown>} options 请求方法、正文、语言和超时设置。
 * @returns {Promise<Response>} 网络响应。
 * @throws {Error} 网络失败或请求超时时抛出。
 */
async function fetchWebText(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(),
    Math.min(Math.max(Number(options.timeout) || 30000, 5000), 60000),
  );
  try {
    return await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/122 Safari/537.36",
        Accept:
          "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8",
        "Accept-Language": options.acceptLanguage || "zh-CN,zh;q=0.9,en;q=0.8",
        ...(options.method === "POST"
          ? { "Content-Type": "application/x-www-form-urlencoded" }
          : {}),
      },
      redirect: "follow",
      method: options.method || "GET",
      body: options.body,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 搜索网页，并在 DuckDuckGo 失败或无结果时回退到 Bing。
 * @param {Record<string, unknown>} args 搜索词、数量和语言参数。
 * @returns {Promise<Record<string, unknown>>} 搜索结果与失败信息。
 * @throws {Error} 搜索词为空或超过长度限制时抛出。
 */
async function webSearch(args = {}) {
  const query = String(args.query || "").trim();
  if (!query || query.length > 500) throw new Error("搜索关键词为空或过长");
  const limit = Math.min(Math.max(Number(args.count) || 5, 1), MAX_WEB_RESULTS);
  const language = String(args.language || "zh-CN").toLowerCase();
  const isEnglish = language.includes("en") || language.includes("us");
  const isJapanese = language.includes("jp") || language.includes("ja");
  const acceptLanguage = isEnglish
    ? "en-US,en;q=0.9"
    : isJapanese
      ? "ja-JP,ja;q=0.9,en;q=0.8"
      : "zh-CN,zh;q=0.9,en;q=0.8";
  const ddgRegion = isEnglish
    ? "us-en"
    : isJapanese
      ? "jp-jp"
      : language === "all" || language === "world"
        ? "wt-wt"
        : "cn-zh";
  let results = [];
  let ddgError = "";
  // 优先使用轻量 DuckDuckGo HTML 接口，避免依赖额外搜索密钥。
  try {
    const response = await fetchWebText("https://html.duckduckgo.com/html/", {
      acceptLanguage,
      timeout: 30000,
      method: "POST",
      body: new URLSearchParams({ q: query, b: "", kl: ddgRegion }),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const html = await response.text();
    results = parseSearchResults(html, limit, "duckduckgo");
  } catch (event) {
    ddgError = event.message || String(event);
  }
  // 主搜索源失败或无结果时回退到 Bing，保证工具仍可给出明确结果。
  if (!results.length) {
    try {
      const market = isEnglish ? "en-US" : isJapanese ? "ja-JP" : "zh-CN";
      const response = await fetchWebText(
        `https://www.bing.com/search?q=${encodeURIComponent(query)}&setlang=${encodeURIComponent(market)}&mkt=${encodeURIComponent(market)}`,
        { acceptLanguage, timeout: 30000 },
      );
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      results = parseSearchResults(await response.text(), limit, "bing");
    } catch (event) {
      return {
        query,
        results: [],
        message:
          "Web search request failed. Please check your network or proxy settings.",
        error: ddgError,
        fallbackError: event.message || String(event),
      };
    }
  }
  return {
    query,
    region: ddgRegion,
    results,
    message: results.length ? undefined : "No results found.",
  };
}

/**
 * 读取网页正文并按偏移量返回有界文本片段。
 * @param {Record<string, unknown>} args URL、偏移量和读取长度。
 * @returns {Promise<string>} 清理后的网页文本或错误说明。
 * @throws {Error} URL 无效或协议不受支持时抛出。
 */
async function webFetch(args = {}) {
  const url = String(args.url || "").trim();
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("URL 无效，必须是完整的 http:// 或 https:// 地址");
  }
  if (!["http:", "https:"].includes(parsed.protocol))
    throw new Error("只支持 http:// 或 https:// 网页地址");
  const offset = Math.max(0, Number(args.offset) || 0);
  const length = Math.min(
    Math.max(Number(args.length) || MAX_WEB_READ, 1000),
    MAX_WEB_READ,
  );
  const response = await fetchWebText(parsed.href, { timeout: 45000 });
  if (response.status === 403 || response.status === 521)
    return `Failed to fetch page (Anti-bot protection ${response.status}).`;
  if (!response.ok)
    return `Failed to fetch page. Status: ${response.status} ${response.statusText}`;
  const contentType = response.headers.get("content-type") || "";
  const raw = await response.text();
  let fullText;
  if (contentType.includes("application/json")) {
    try {
      fullText = JSON.stringify(JSON.parse(raw), null, 2);
    } catch {
      fullText = raw;
    }
  } else {
    const title = decodeHtmlText(
      raw.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "",
    );
    const body = raw
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<nav[\s\S]*?<\/nav>/gi, " ");
    const text = decodeHtmlText(body);
    fullText = `URL: ${parsed.href}\n\n${title ? `# ${title}\n\n` : ""}---\n\n${text}`;
  }
  const chunk = fullText.slice(offset, offset + length);
  const nextOffset = offset + chunk.length;
  if (nextOffset < fullText.length)
    return `${chunk}\n\n--- [SYSTEM NOTE: CONTENT TRUNCATED] ---\nTotal characters: ${fullText.length}. Call builtin_web_fetch with offset=${nextOffset} to read more.`;
  return offset > 0
    ? `${chunk}\n\n--- [SYSTEM NOTE: END OF PAGE REACHED] ---`
    : chunk;
}
/**
 * 将最近的模型请求或响应保存在窗口调试状态中。
 * @param {'request'|'response'|'error'} kind 调试记录类型。
 * @param {unknown} value 调试数据。
 * @returns {void} 无返回值。
 */
function recordChatDebug(kind, value) {
  if (!DEBUG_CHAT || typeof window === "undefined") return;
  const key =
    kind === "request"
      ? "__zvcDebugRequests"
      : kind === "error"
        ? "__zvcDebugErrors"
        : "__zvcDebugResponses";
  const next = Array.isArray(window[key]) ? window[key].slice(-7) : [];
  next.push(value);
  window[key] = next;
}

/**
 * 从 ZTools 插件存储读取值，并在缺失或异常时返回默认值。
 * @param {string} key 存储键。
 * @param {unknown} fallback 默认值。
 * @returns {unknown} 已存储的值或默认值。
 */
function readStorage(key, fallback) {
  try {
    const value = window.ztools?.dbStorage?.getItem(key);
    return value == null ? fallback : value;
  } catch {
    return fallback;
  }
}

/**
 * 将流事件合并间隔规范化到 ZTools AI 接口允许的范围。
 * @param {unknown} value 用户设置或请求传入的毫秒值。
 * @returns {number} 0 到 1000 之间的整数毫秒值。
 */
function normalizeStreamBatchIntervalMs(value) {
  const interval = Number(value);
  if (!Number.isFinite(interval) || interval < 0)
    return DEFAULT_STREAM_BATCH_INTERVAL_MS;
  return Math.min(MAX_STREAM_BATCH_INTERVAL_MS, Math.round(interval));
}

/**
 * 将自动压缩阈值规范化为设置界面和运行时共同支持的百分比。
 * @param {unknown} value 用户设置或存储中的百分比。
 * @returns {number} 50 到 95 之间的整数百分比。
 */
function normalizeAutoCompactionThresholdPercent(value) {
  const percent = Number(value);
  if (!Number.isFinite(percent))
    return DEFAULT_AUTO_COMPACTION_THRESHOLD_PERCENT;
  return Math.min(95, Math.max(50, Math.round(percent)));
}

/**
 * 将工具并发上限规范化到调度器和设置界面共同支持的范围。
 * @param {unknown} value 用户设置或存储中的并发数量。
 * @returns {number} 1 到 50 之间的整数并发上限。
 */
function normalizeToolConcurrencyLimit(value) {
  const limit = Number(value);
  if (!Number.isFinite(limit)) return DEFAULT_TOOL_CONCURRENCY_LIMIT;
  return Math.min(MAX_TOOL_CONCURRENCY_LIMIT, Math.max(1, Math.round(limit)));
}

/**
 * 将包括 Vue 响应式代理在内的值转换为可克隆普通数据。
 * @param {unknown} value 渲染层数据。
 * @param {unknown} fallback 序列化失败时的默认值。
 * @returns {unknown} JSON 兼容的普通数据。
 */
function toPlainStorageValue(value, fallback = null) {
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return fallback;
  }
}

/**
 * 将可序列化值写入 ZTools 插件存储。
 * @param {string} key 存储键。
 * @param {unknown} value 待保存值。
 * @returns {boolean} 是否完成写入。
 */
function writeStorage(key, value) {
  const plainValue = toPlainStorageValue(value);
  window.ztools?.dbStorage?.setItem(key, plainValue);
  return true;
}

/**
 * 延迟解析宿主为当前插件分配的专属数据目录布局。
 * @returns {ReturnType<typeof createPluginDataPaths>} 插件文件系统数据目录布局。
 * @throws {Error} 宿主未提供有效插件数据目录时抛出。
 */
function getPluginDataPaths() {
  if (!pluginDataPaths) {
    pluginDataPaths = createPluginDataPaths((name) => window.ztools?.getPath?.(name));
  }
  return pluginDataPaths;
}

/**
 * 延迟创建工作区索引服务，确保根目录来自当前插件隔离域。
 * @returns {ReturnType<typeof createWorkspaceStore>} 工作区索引服务。
 * @throws {Error} 插件数据目录或宿主存储不可用时抛出。
 */
function getWorkspaceStore() {
  if (!workspaceStore) {
    workspaceStore = createWorkspaceStore({
      read: readStorage,
      write: writeStorage,
      storageKey: STORAGE_KEYS.workspaces,
      rootDirectory: getPluginDataPaths().workspaceRoot,
    });
  }
  return workspaceStore;
}

/**
 * 读取全部已登记工作区。
 * @returns {Array<Record<string, unknown>>} 有效工作区记录。
 */
function getWorkspaces() {
  return getWorkspaceStore().list();
}

/**
 * 解析 Skill frontmatter 常用的 YAML 标量子集。
 * @param {unknown} rawValue frontmatter 原始值。
 * @returns {unknown} 规范化后的标量或数组。
 */
function parseYamlScalar(rawValue) {
  const value = String(rawValue ?? "").trim();
  if (value === "true") return true;
  if (value === "false") return false;
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  )
    return value.slice(1, -1);
  if (value.startsWith("[") && value.endsWith("]")) {
    const inner = value.slice(1, -1).trim();
    return inner ? inner.split(",").map((item) => parseYamlScalar(item)) : [];
  }
  return value;
}

/**
 * 从 SKILL.md 中解析元数据和指令正文。
 * @param {unknown} content 原始 Markdown 文档。
 * @returns {{metadata: Record<string, unknown>, body: string}} 解析后的文档。
 */
function parseSkillFrontmatter(content) {
  const normalized = String(content || "").replace(/\r\n/g, "\n");
  const match = normalized.match(/^---\s*\n([\s\S]*?)\n---\s*\n?([\s\S]*)$/);
  if (!match) return { metadata: {}, body: normalized };
  const lines = match[1].split("\n");
  const metadata = {};
  for (let index = 0; index < lines.length; index += 1) {
    const item = lines[index].match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!item) continue;
    const key = item[1];
    const rawValue = item[2].trim();
    if (rawValue === "|" || rawValue === ">") {
      const block = [];
      for (
        index += 1;
        index < lines.length &&
        (/^\s+/.test(lines[index]) || !lines[index].trim());
        index += 1
      )
        block.push(lines[index].replace(/^\s{2}/, "").replace(/^\t/, ""));
      index -= 1;
      metadata[key] = block.join(rawValue === ">" ? " " : "\n").trim();
      continue;
    }
    if (!rawValue) {
      const list = [];
      let cursor = index + 1;
      while (cursor < lines.length) {
        const listItem = lines[cursor].match(/^\s*-\s+(.*)$/);
        if (!listItem) break;
        list.push(parseYamlScalar(listItem[1]));
        cursor += 1;
      }
      if (list.length) index = cursor - 1;
      metadata[key] = list.length ? list : "";
      continue;
    }
    metadata[key] = parseYamlScalar(rawValue);
  }
  return { metadata, body: match[2] };
}

/**
 * 在目标不存在时递归复制内置 Skill 目录。
 * @param {string} source 源目录。
 * @param {string} target 目标目录。
 * @returns {void} 无返回值。
 */
function copyDirectoryIfMissing(source, target) {
  if (!fs.existsSync(source) || fs.existsSync(target)) return;
  fs.mkdirSync(target, { recursive: true });
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue;
    const sourcePath = path.join(source, entry.name);
    const targetPath = path.join(target, entry.name);
    if (entry.isDirectory()) copyDirectoryIfMissing(sourcePath, targetPath);
    else if (entry.isFile()) fs.copyFileSync(sourcePath, targetPath);
  }
}

/**
 * 同步 ZVC 随包提供的指定版本内置 Skill。
 * @param {string} source 随插件打包的 Skill 源目录。
 * @param {string} target 用户目录中的 Skill 目标目录。
 * @param {string} skillId Skill 目录标识。
 * @returns {void} 无返回值。
 * @throws {Error} 内置 Skill 目录无法更新时抛出。
 */
function syncBundledSkill(source, target, skillId) {
  const revision = BUNDLED_SKILL_REVISIONS[skillId];
  if (!revision) {
    copyDirectoryIfMissing(source, target);
    return;
  }

  const revisionFile = path.join(target, ".zvc-bundled-revision");
  let installedRevision = "";
  try {
    installedRevision = fs.readFileSync(revisionFile, "utf8").trim();
  } catch {
    // 旧版内置 Skill 没有版本标记，需要在本次启动时刷新一次。
  }
  if (installedRevision === revision) return;

  // 只处理 ZVC 自己管理的内置 Skill 目录，不触碰其他用户 Skill。
  if (fs.existsSync(target))
    fs.rmSync(target, { recursive: true, force: true });
  copyDirectoryIfMissing(source, target);
  // 记录已安装版本，后续启动避免重复覆盖用户目录。
  fs.writeFileSync(revisionFile, revision, "utf8");
}

/**
 * 创建用户 Skill 根目录并补充尚未安装的内置 Skill。
 * @returns {void} 无返回值。
 */
function ensureSkillRoot() {
  if (skillRootReady) return;
  const skillRoot = getPluginDataPaths().skillRoot;
  // 用户目录仍是动态来源；仅补充缺失或版本过期的随包内置 Skill。
  fs.mkdirSync(skillRoot, { recursive: true });
  const bundledSkills = path.join(__dirname, "skills");
  if (fs.existsSync(bundledSkills)) {
    for (const entry of fs.readdirSync(bundledSkills, {
      withFileTypes: true,
    })) {
      if (entry.isDirectory())
        syncBundledSkill(
          path.join(bundledSkills, entry.name),
          path.join(skillRoot, entry.name),
          entry.name,
        );
    }
  }
  // 当前 preload 生命周期内只同步一次内置 Skill，后续刷新仅扫描用户目录。
  skillRootReady = true;
}

/**
 * 扫描用户 ZVC Skill 库中的有效 Skill 目录。
 * @returns {Array<Record<string, unknown>>} Skill 元数据记录。
 */
function getSkills() {
  ensureSkillRoot();
  const skillRoot = getPluginDataPaths().skillRoot;
  const skills = [];
  for (const entry of fs.readdirSync(skillRoot, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
    const skillPath = path.join(skillRoot, entry.name);
    const filePath = path.join(skillPath, "SKILL.md");
    if (!fs.existsSync(filePath)) continue;
    try {
      const { metadata } = parseSkillFrontmatter(
        fs.readFileSync(filePath, "utf8"),
      );
      skills.push({
        id: entry.name,
        name: String(metadata.name || entry.name),
        description: String(
          metadata.description || "加载此 Skill 的专业工作规范。",
        ),
        path: skillPath,
        context: metadata.context === "fork" ? "fork" : "normal",
        userInvocable: metadata["user-invocable"] !== false,
        disabled: metadata["disable-model-invocation"] === true,
        allowedTools: Array.isArray(metadata["allowed-tools"])
          ? metadata["allowed-tools"].map(String)
          : String(metadata["allowed-tools"] || ""),
      });
    } catch {
      /* 跳过损坏或格式错误的 Skill 目录。 */
    }
  }
  return skills.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * 有界递归枚举 Skill 目录中的附属资源。
 * @param {string} skillPath Skill 绝对目录。
 * @param {string} currentPath 当前扫描目录。
 * @param {number} depth 当前递归深度。
 * @param {Array<Record<string, unknown>>} output 已累计的资源记录。
 * @returns {Array<Record<string, unknown>>} Skill 相对资源记录。
 */
function listSkillAssets(
  skillPath,
  currentPath = skillPath,
  depth = 0,
  output = [],
) {
  if (depth > 8 || output.length >= 300) return output;
  for (const entry of fs.readdirSync(currentPath, { withFileTypes: true })) {
    if (
      output.length >= 300 ||
      entry.name.startsWith(".") ||
      entry.name === "node_modules"
    )
      continue;
    const absolutePath = path.join(currentPath, entry.name);
    const relativePath = path
      .relative(skillPath, absolutePath)
      .split(path.sep)
      .join("/");
    if (relativePath.toLowerCase() === "skill.md" || entry.isSymbolicLink())
      continue;
    if (entry.isDirectory()) {
      output.push({ path: relativePath, type: "directory" });
      listSkillAssets(skillPath, absolutePath, depth + 1, output);
    } else if (entry.isFile()) {
      output.push({
        path: relativePath,
        type: "file",
        size: fs.statSync(absolutePath).size,
      });
    }
  }
  return output;
}

/**
 * 将 Skill 资源渲染为提供给模型的紧凑目录列表。
 * @param {Array<Record<string, unknown>>} assets Skill 资源记录。
 * @returns {string} 相对路径 Markdown 列表。
 */
function formatSkillAssets(assets) {
  return assets
    .map((asset) => {
      const depth = String(asset.path).split("/").length - 1;
      const suffix = asset.type === "directory" ? "/" : "";
      return `${"  ".repeat(depth)}- ${asset.path}${suffix}`;
    })
    .join("\n");
}

/**
 * 根据当前会话选中的 Skill 动态构建工具定义。
 * @param {string[]} enabledSkillNames 已选中的 Skill 目录标识。
 * @returns {Record<string, unknown>|null} Skill 工具定义；未选择时返回 null。
 */
function getSkillToolDefinition(enabledSkillNames = []) {
  const active = getSkills().filter(
    (skill) => !skill.disabled && enabledSkillNames.includes(skill.id),
  );
  if (!active.length) return null;
  const available = active
    .map(
      (skill) =>
        `- ${skill.id}${skill.context === "fork" ? " [Sub-Agent]" : " [Direct]"}: ${skill.description}`,
    )
    .join("\n");
  return {
    type: "function",
    function: {
      name: "Skill",
      description: `Execute a selected Skill in the current conversation. When a selected Skill is relevant, invoke this tool as the first action before answering or using other tools. Do not invoke a Skill that is not listed below.\n\nAvailable skills:\n${available}`,
      parameters: {
        type: "object",
        properties: {
          skill: {
            type: "string",
            enum: active.map((skill) => skill.id),
            description: "要加载的 Skill 目录名称。",
          },
          args: { type: "string", description: "可选的 Skill 输入参数。" },
          task: { type: "string", description: "可选的当前任务说明。" },
          context: { type: "string", description: "可选的任务背景信息。" },
        },
        required: ["skill"],
        additionalProperties: false,
      },
    },
  };
}

/**
 * 为模型加载已选择 Skill 的指令和资源清单。
 * @param {string} skillName Skill 目录标识或显示名称。
 * @param {Record<string, unknown>} args Skill 参数和任务上下文。
 * @returns {{skill: string, name: string, description: string, skillPath: string, assets: Array<Record<string, unknown>>, instructions: string}} 已加载的指令和资源。
 * @throws {Error} Skill 未启用、目录缺失或文档不可用时抛出。
 */
function resolveSkillInvocation(skillName, args = {}) {
  const skill = getSkills().find(
    (item) => item.id === skillName || item.name === skillName,
  );
  if (!skill) throw new Error(`Skill "${skillName}" 不存在或未启用`);
  const raw = fs.readFileSync(path.join(skill.path, "SKILL.md"), "utf8");
  const { metadata, body } = parseSkillFrontmatter(raw);
  let instructions = body;
  const assets = listSkillAssets(skill.path);
  const argument = String(args.args || "");
  if (instructions.includes("$ARGUMENTS"))
    instructions = instructions.replace(/\$ARGUMENTS/g, argument);
  else if (argument) instructions += `\n\n### Input Arguments\n${argument}`;
  if (args.task)
    instructions += `\n\n### Current Task Request\n${String(args.task)}`;
  instructions += `\n\n### Skill Directory\n${skill.path}\nResolve relative paths mentioned by this Skill against the directory above. Read referenced files from references/ when needed, and execute relevant scripts from scripts/ using their absolute paths. Do not modify the Skill directory unless the user explicitly asks.`;
  if (assets.length)
    instructions += `\n\n### Skill Directory Assets\n${formatSkillAssets(assets)}`;
  return {
    skill: skill.id,
    name: String(metadata.name || skill.name),
    description: skill.description,
    skillPath: skill.path,
    assets,
    instructions,
  };
}

/**
 * 将会话上下文状态限制为可持久化的稳定字段。
 * @param {unknown} value 原始上下文状态。
 * @returns {Record<string, unknown>} 规范化后的上下文状态。
 */
function normalizeConversationContextState(value) {
  const source = value && typeof value === "object" ? value : {};
  return {
    version: 1,
    summary: typeof source.summary === "string" ? source.summary : "",
    compactedThroughMessageId:
      typeof source.compactedThroughMessageId === "string"
        ? source.compactedThroughMessageId
        : "",
    compactedThroughTurnId:
      typeof source.compactedThroughTurnId === "string"
        ? source.compactedThroughTurnId
        : "",
    estimatedTokens: Math.max(
      0,
      Math.round(Number(source.estimatedTokens) || 0),
    ),
    summaryTokens: Math.max(0, Math.round(Number(source.summaryTokens) || 0)),
    lastPromptTokens: Math.max(
      0,
      Math.round(Number(source.lastPromptTokens) || 0),
    ),
    sampledPromptEstimateTokens: Math.max(
      0,
      Math.round(Number(source.sampledPromptEstimateTokens) || 0),
    ),
    tokenScale: Math.min(4, Math.max(0.5, Number(source.tokenScale) || 1)),
    lastCompactedAt: Math.max(
      0,
      Math.round(Number(source.lastCompactedAt) || 0),
    ),
    modelKey: typeof source.modelKey === "string" ? source.modelKey : "",
  };
}

/**
 * 将上下文占用读数限制为可持久化的稳定数值。
 * @param {unknown} value 原始上下文占用读数。
 * @returns {{usedTokens: number, contextWindow: number, breakdown: Record<string, number>}} 规范化后的上下文占用读数。
 */
function normalizeConversationContextMeter(value) {
  const source = value && typeof value === "object" ? value : {};
  const breakdown =
    source.breakdown && typeof source.breakdown === "object"
      ? source.breakdown
      : {};
  return {
    usedTokens: Math.max(0, Math.round(Number(source.usedTokens) || 0)),
    contextWindow: Math.max(0, Math.round(Number(source.contextWindow) || 0)),
    breakdown: {
      systemTokens: Math.max(
        0,
        Math.round(Number(breakdown.systemTokens) || 0),
      ),
      toolsTokens: Math.max(0, Math.round(Number(breakdown.toolsTokens) || 0)),
      messageTokens: Math.max(
        0,
        Math.round(Number(breakdown.messageTokens) || 0),
      ),
    },
  };
}

/**
 * 将任务清单限制为可持久化的完整会话快照。
 * @param {unknown} value 原始任务清单。
 * @returns {Array<{content: string, status: 'pending'|'in_progress'|'completed'}>} 规范化后的任务列表。
 */
function normalizeConversationTasks(value) {
  return Array.isArray(value)
    ? value
        .slice(0, 30)
        .map((task) => ({
          content: String(task?.content || "")
            .trim()
            .slice(0, 200),
          status: ["pending", "in_progress", "completed"].includes(task?.status)
            ? task.status
            : "pending",
        }))
        .filter((task) => task.content)
    : [];
}

/**
 * 将会话 Inbox 限制为可持久化的排队和插话消息。
 * @param {unknown} value 原始待处理消息列表。
 * @returns {Array<Record<string, unknown>>} 已去重并移除无效内容的 Inbox。
 */
function normalizePendingMessages(value) {
  const seen = new Set();
  const messages = [];
  for (const item of Array.isArray(value) ? value : []) {
    const id = typeof item?.id === "string" ? item.id.trim() : "";
    const text = typeof item?.text === "string" ? item.text.trim() : "";
    const attachments = Array.isArray(item?.attachments)
      ? item.attachments.filter(
          (attachment) => attachment && typeof attachment === "object",
        )
      : [];
    if (!id || seen.has(id) || (!text && !attachments.length)) continue;
    seen.add(id);
    messages.push({
      id,
      placement: item.placement === "steering" ? "steering" : "queued",
      text,
      attachments,
      createdAt: Number(item.createdAt) || Date.now(),
    });
  }
  return messages;
}

/**
 * 按 Harness 规则递增分叉会话标题末尾的半角或全角编号。
 * @param {unknown} value 源会话标题。
 * @returns {string} 分叉会话标题。
 */
function increaseForkConversationTitle(value) {
  const title = String(value || "新的对话").slice(0, 100);
  const ascii = /^(.*?)\((\d+)\)$/u.exec(title);
  if (ascii) return `${ascii[1]}(${BigInt(ascii[2]) + 1n})`.slice(0, 100);
  const fullWidth = /^(.*?)（(\d+)）$/u.exec(title);
  if (fullWidth)
    return `${fullWidth[1]}（${BigInt(fullWidth[2]) + 1n}）`.slice(0, 100);
  return `${title} (1)`.slice(0, 100);
}

/**
 * 将任意会话记录规范化为当前存储结构。
 * @param {Record<string, unknown>} item 原始会话记录。
 * @returns {Record<string, unknown>} 规范化后的会话记录。
 */
function normalizeConversation(item = {}) {
  const id = typeof item.id === "string" && item.id ? item.id : randomUUID();
  const hasMessageArray = Array.isArray(item.messages);
  // 日志中的稀疏数组会被 JSON 编码为 null，恢复时统一压缩为连续工具列表。
  const messages = hasMessageArray ? normalizeConversationMessages(item.messages) : [];
  const enabledTools = Array.isArray(item.enabledTools)
    ? item.enabledTools.filter(
        (name) => typeof name === "string" && name !== "Skill",
      )
    : DEFAULT_ENABLED_TOOLS;
  return {
    storageVersion: CONVERSATION_STORAGE_VERSION,
    id,
    title: String(item.title || "新的对话").slice(0, 100),
    modelKey:
      typeof item.modelKey === "string" ? item.modelKey.slice(0, 500) : "",
    reasoningEffort: REASONING_EFFORT_VALUES.has(item.reasoningEffort)
      ? item.reasoningEffort
      : "",
    messages,
    projectId: typeof item.projectId === "string" ? item.projectId : "",
    workspaceLocked:
      item.workspaceLocked === true ||
      (typeof item.workspaceLocked !== "boolean" &&
        messages.some(
          (message) =>
            message?.role === "user" && message?.source !== "tool-context",
        )),
    enabledTools: [...new Set(enabledTools)],
    enabledSkills: Array.isArray(item.enabledSkills)
      ? [
          ...new Set(
            item.enabledSkills.filter((name) => typeof name === "string"),
          ),
        ]
      : [],
    autoApproveTools: item.autoApproveTools !== false,
    archived: item.archived === true,
    tasks: normalizeConversationTasks(item.tasks),
    pendingMessages: normalizePendingMessages(item.pendingMessages),
    contextState: normalizeConversationContextState(item.contextState),
    contextMeter: normalizeConversationContextMeter(item.contextMeter),
    hasImages:
      typeof item.hasImages === "boolean"
        ? item.hasImages
        : messages.some(
            (message) =>
              Array.isArray(message?.parts) &&
              message.parts.some((part) => part?.type === "image"),
          ),
    messageCount: hasMessageArray
      ? messages.length
      : Math.max(0, Math.round(Number(item.messageCount) || 0)),
    createdAt: Number(item.createdAt) || Date.now(),
    updatedAt: Number(item.updatedAt) || Date.now(),
  };
}

/**
 * 从完整会话中提取不含正文的运行状态。
 * @param {Record<string, unknown>} conversation 已规范化的完整会话。
 * @returns {Record<string, unknown>} 可与历史页面组合的会话状态。
 */
function createConversationStateSnapshot(conversation) {
  return {
    storageVersion: CONVERSATION_STORAGE_VERSION,
    id: String(conversation.id || ""),
    title: String(conversation.title || "新的对话").slice(0, 100),
    modelKey:
      typeof conversation.modelKey === "string"
        ? conversation.modelKey.slice(0, 500)
        : "",
    reasoningEffort: REASONING_EFFORT_VALUES.has(conversation.reasoningEffort)
      ? conversation.reasoningEffort
      : "",
    projectId:
      typeof conversation.projectId === "string" ? conversation.projectId : "",
    workspaceLocked: conversation.workspaceLocked === true,
    enabledTools: Array.isArray(conversation.enabledTools)
      ? [
          ...new Set(
            conversation.enabledTools.filter(
              (name) => typeof name === "string" && name !== "Skill",
            ),
          ),
        ]
      : [],
    enabledSkills: Array.isArray(conversation.enabledSkills)
      ? [
          ...new Set(
            conversation.enabledSkills.filter(
              (name) => typeof name === "string",
            ),
          ),
        ]
      : [],
    autoApproveTools: conversation.autoApproveTools !== false,
    archived: conversation.archived === true,
    tasks: normalizeConversationTasks(conversation.tasks),
    pendingMessages: normalizePendingMessages(conversation.pendingMessages),
    contextState: normalizeConversationContextState(conversation.contextState),
    contextMeter: normalizeConversationContextMeter(conversation.contextMeter),
    hasImages: conversation.hasImages === true,
    messageCount: Math.max(
      0,
      Math.round(Number(conversation.messageCount) || 0),
    ),
    createdAt: Number(conversation.createdAt) || Date.now(),
    updatedAt: Number(conversation.updatedAt) || Date.now(),
  };
}

/**
 * 为 Renderer 创建仅包含尾部历史窗口的会话快照。
 * @param {string} id 会话标识。
 * @param {{before?: number, limit?: number}} page 历史分页参数。
 * @returns {Record<string, unknown>|null} 会话状态和历史窗口；会话不存在时返回空值。
 */
function createConversationView(id, page = {}) {
  const state = getConversationStore().getState(id);
  if (!state) return null;
  const history = getConversationStore().getPage(id, page);
  if (!history) return null;
  return { ...state, messages: history.messages, history };
}

/**
 * 获取 ZTools 结构化数据库并校验会话存储所需的方法。
 * @returns {{get: Function, put: Function, allDocs: Function, remove: Function}} 会话数据库接口。
 * @throws {Error} 宿主未提供完整结构化数据库接口时抛出。
 */
function getConversationDb() {
  const db = window.ztools?.db;
  if (
    !db ||
    typeof db.get !== "function" ||
    typeof db.put !== "function" ||
    typeof db.allDocs !== "function" ||
    typeof db.remove !== "function"
  ) {
    throw new Error("ZTools 结构化数据库不可用，无法保存会话");
  }
  return db;
}

/**
 * 获取当前 ZTools 数据隔离域中的会话日志根目录。
 * @returns {string} 会话 JSONL 日志根目录。
 * @throws {Error} 宿主未提供用户数据目录时抛出。
 */
function getConversationSessionRoot() {
  return getPluginDataPaths().sessionRoot;
}

let conversationStore = null;
let attachmentStore = null;

/**
 * 延迟创建图片附件存储，确保宿主用户数据目录已经注入。
 * @returns {ReturnType<typeof createAttachmentStore>} 图片附件存储实例。
 * @throws {Error} ZTools 用户数据目录不可用时抛出。
 */
function getAttachmentStore() {
  if (!attachmentStore) {
    const { createAttachmentStore } = require("./attachment-store");
    attachmentStore = createAttachmentStore(getPluginDataPaths().pluginDataRoot);
  }
  return attachmentStore;
}

/**
 * 延迟加载 Node 子进程模块，避免空会话启动解析未使用的执行能力。
 * @returns {typeof import('node:child_process')} Node 子进程模块。
 */
function getChildProcessModule() {
  if (!childProcessModule) childProcessModule = require("node:child_process");
  return childProcessModule;
}

/**
 * 延迟创建会话存储，确保宿主 API 已完成注入。
 * @returns {ReturnType<typeof createConversationStore>} 会话 JSONL 存储实例。
 */
function getConversationStore() {
  if (!conversationStore) {
    conversationStore = createConversationStore({
      getDb: getConversationDb,
      getRootDirectory: getConversationSessionRoot,
      normalizeConversation,
      documentPrefix: CONVERSATION_DB_PREFIX,
    });
  }
  return conversationStore;
}

/**
 * 读取单个会话索引并重放其 JSONL 事件日志。
 * @param {unknown} id 会话标识。
 * @returns {Record<string, unknown>|null} 完整会话；索引不存在时返回空值。
 */
function getConversationDocument(id) {
  return getConversationStore().get(id);
}

/**
 * 创建单个会话的 JSONL 日志和轻量数据库索引。
 * @param {Record<string, unknown>} conversation 会话记录。
 * @returns {Record<string, unknown>} 已规范化并保存的会话。
 * @throws {Error} 会话日志或索引创建失败时抛出。
 */
function createConversationDocument(conversation) {
  return getConversationStore().create(conversation);
}

/**
 * 将会话变化追加到 JSONL 日志并更新轻量数据库索引。
 * @param {Record<string, unknown>} conversation 会话记录。
 * @returns {Record<string, unknown>} 已规范化并保存的会话。
 * @throws {Error} 会话无效、日志追加或索引写入失败时抛出。
 */
function saveConversationDocument(conversation) {
  return getConversationStore().save(conversation);
}

/**
 * 读取并按更新时间排序所有轻量会话索引。
 * @returns {Array<Record<string, unknown>>} 不含消息正文的会话列表。
 */
function getConversations() {
  return getConversationStore().list();
}

/**
 * 根据标识获取已登记工作区。
 * @param {unknown} workspaceId 工作区标识。
 * @returns {Record<string, unknown>} 匹配的工作区。
 * @throws {Error} 工作区未登记时抛出。
 */
function requireWorkspace(workspaceId) {
  const workspace = getWorkspaceStore().get(workspaceId);
  if (!workspace) throw new Error("工作区不存在或已被移除");
  return workspace;
}

/**
 * 使用绑定工作区或默认工作区根目录解析本地工具路径。
 * 与 Anywhere 一样支持绝对路径；相对路径优先基于绑定工作区。
 * @param {Record<string, unknown>|null} workspace 当前绑定工作区。
 * @param {unknown} input 用户或模型提供的路径。
 * @param {{allowRoot?: boolean}} options 路径解析选项。
 * @returns {string} 规范化后的绝对路径。
 * @throws {Error} 路径无效、过于宽泛或指向敏感位置时抛出。
 */
function resolveToolPath(workspace, input, options = {}) {
  const base = workspace?.path
    ? path.resolve(String(workspace.path))
    : getPluginDataPaths().workspaceRoot;
  const raw = typeof input === "string" && input.trim() ? input.trim() : ".";
  const expanded =
    raw === "~"
      ? os.homedir()
      : raw.startsWith(`~${path.sep}`) || raw.startsWith("~/")
        ? path.join(os.homedir(), raw.slice(2))
        : raw;
  const target = path.resolve(
    path.isAbsolute(expanded) ? expanded : path.join(base, expanded),
  );
  // 解析完成后统一执行敏感路径校验，防止相对路径绕过规则。
  if (!options.allowRoot && target === base && raw !== ".")
    throw new Error("请指定具体的文件路径");
  if (!isToolPathSafe(target))
    throw new Error(`出于安全原因，禁止访问敏感路径：${target}`);
  return target;
}

/**
 * 判断路径是否避开常见凭据和系统敏感位置。
 * @param {string} targetPath 待检查的绝对路径。
 * @returns {boolean} 本地工具是否可以使用该路径。
 */
function isToolPathSafe(targetPath) {
  const normalized = path.normalize(targetPath);
  const forbidden = [
    /[\\/]\.ssh(?:[\\/]|$)/i,
    /[\\/]\.aws(?:[\\/]|$)/i,
    /[\\/]\.env(?:\.|$)/i,
    /[\\/]\.gitconfig$/i,
    /[\\/]id_rsa(?:\.|$)/i,
    /[\\/]authorized_keys$/i,
    /[\\/]etc[\\/]shadow$/i,
    /[\\/]etc[\\/]passwd$/i,
    /[\\/]Windows[\\/]System32[\\/]config[\\/]/i,
  ];
  return !forbidden.some((pattern) => pattern.test(normalized));
}

/**
 * 创建一个只包含空目录的工作区并登记到本地索引。
 * @param {{name?: unknown}} input 工作区创建参数。
 * @returns {Record<string, unknown>} 已创建工作区。
 * @throws {Error} 工作区名称无效或目录创建失败时抛出。
 */
function createWorkspace(input = {}) {
  return getWorkspaceStore().create(input.name);
}

/**
 * 选择并登记一个本地文件夹，不修改文件夹内容。
 * @returns {Record<string, unknown>|null} 已登记工作区；用户取消时返回空值。
 */
function importWorkspace() {
  const selected = window.ztools?.showOpenDialog?.({
    properties: ["openDirectory", "createDirectory"],
  });
  const root = Array.isArray(selected) ? selected[0] : null;
  return root ? getWorkspaceStore().register(root) : null;
}

/**
 * 从 ZVC 工作区索引移除记录，但保留本地目录。
 * @param {unknown} workspaceId 工作区标识。
 * @returns {boolean} 是否移除了工作区记录。
 */
function removeWorkspace(workspaceId) {
  return getWorkspaceStore().remove(workspaceId);
}

/**
 * 根据文件扩展名推导读取卡片使用的语法语言。
 * @param {string} filePath 文件绝对路径。
 * @returns {string} Highlight.js 可识别的语言标识；未知扩展名时为空。
 */
function resolveFileLanguage(filePath) {
  return FILE_LANGUAGE_BY_EXTENSION[path.extname(filePath).toLowerCase()] || "";
}

/**
 * 将文件文本拆成正文行，避免把单个末尾换行符误算成额外空白行。
 * @param {string} content 文件或读取窗口文本。
 * @returns {string[]} 不包含末尾行终止符的正文行。
 */
function splitFileLines(content) {
  if (!content) return [];
  return String(content)
    .replace(/\r?\n$/, "")
    .split(/\r?\n/);
}

/**
 * 将一段文件文本转换为保留原文件行号的结构化行数据。
 * @param {string} content 待读取的文本窗口。
 * @param {number} firstLine 第一行在原文件中的一基行号。
 * @returns {Array<{number: number, text: string}>} 可直接渲染的文件行。
 */
function createFileLines(content, firstLine = 1) {
  return splitFileLines(content).map((text, index) => ({
    number: firstLine + index,
    text,
  }));
}

/**
 * 使用统一差异算法计算带三行上下文的真实文件变更片段。
 * @param {string} filePath 发生变更的文件绝对路径。
 * @param {string} before 修改前文本。
 * @param {string} after 修改后文本。
 * @returns {Array<{path: string, oldText: string|null, newText: string}>} 按文件顺序排列的差异片段。
 */
function computeFileDiffs(filePath, before, after) {
  // diff 仅在写入或编辑文件后使用，延迟加载可缩短空会话 preload 执行时间。
  const { structuredPatch } = require("diff");
  const patch = structuredPatch("", "", before, after, undefined, undefined, {
    context: 3,
  });
  const diffs = [];
  for (const hunk of patch.hunks) {
    const oldLines = [];
    const newLines = [];
    for (const line of hunk.lines) {
      // 忽略补丁中的“末尾无换行”标记，它不是文件正文的一部分。
      if (line.startsWith("\\")) continue;
      const text = line.slice(1);
      if (line.startsWith("-")) oldLines.push(text);
      else if (line.startsWith("+")) newLines.push(text);
      else {
        oldLines.push(text);
        newLines.push(text);
      }
    }
    diffs.push({
      path: filePath,
      oldText: oldLines.length ? oldLines.join("\n") : null,
      newText: newLines.join("\n"),
    });
  }
  return diffs;
}

/**
 * 将模型可读结果与仅供界面使用的结构化卡片数据分开返回。
 * @param {unknown} output 发送给模型并保存为工具消息的结果。
 * @param {Record<string, unknown>} presentation 文件卡片展示数据。
 * @param {Array<Record<string, unknown>>} modelContext 需要注入下一模型步骤的多模态内容块。
 * @returns {{output: unknown, presentation: Record<string, unknown>, modelContext: Array<Record<string, unknown>>}} 工具结果信封。
 */
function createPresentedToolResult(output, presentation, modelContext = []) {
  return { output, presentation, modelContext };
}

/**
 * 尝试从 ZTools 宿主获取当前插件的短期下载令牌。
 * @returns {Promise<string>} 可用的 Bearer token；未登录或宿主不支持时返回空字符串。
 */
async function getOptionalFileDownloadToken() {
  if (typeof window.ztools?.getUserTempToken !== "function") return "";
  try {
    const credential = await window.ztools.getUserTempToken();
    return typeof credential?.token === "string" ? credential.token : "";
  } catch {
    // 文件下载允许匿名访问，临时鉴权失败不应阻断搜索工具安装。
    return "";
  }
}

/**
 * 首次执行文件、搜索或 Bash 工具时创建本地工具运行时。
 * @returns {ReturnType<import('./runtime/tools').createLocalToolRuntime>} 本地工具运行时单例。
 */
function getLocalToolRuntime() {
  if (!localToolRuntime) {
    const { createLocalToolRuntime } = require("./runtime/tools");
    const dataPaths = getPluginDataPaths();
    localToolRuntime = createLocalToolRuntime({
      resolvePath: resolveToolPath,
      getAttachmentStore,
      createPresentedResult: createPresentedToolResult,
      computeDiffs: computeFileDiffs,
      resolveLanguage: resolveFileLanguage,
      createLines: createFileLines,
      getEnvironment: getCommandEnvironment,
      getDownloadToken: getOptionalFileDownloadToken,
      toolRoot: dataPaths.toolBinaryRoot,
      outputRoot: dataPaths.toolOutputRoot,
    });
  }
  return localToolRuntime;
}

/**
 * 在绑定工作区或默认工作区根目录中执行一项已允许的内置工具。
 * @param {string} projectId 当前工作区标识。
 * @param {string} toolName 工具函数名称。
 * @param {Record<string, unknown>} args 工具参数。
 * @param {{enabledSkills?: string[], conversationId?: string, callId?: string, supportsImages?: boolean}} context 当前会话能力上下文。
 * @param {(update: Record<string, unknown>) => void} onUpdate 工具过程更新回调。
 * @returns {Promise<unknown>} 可序列化工具结果。
 * @throws {Error} 参数无效、路径不安全或执行失败时抛出。
 */
async function invokeTool(
  projectId,
  toolName,
  args = {},
  context = {},
  onUpdate = null,
) {
  // 模型侧工具名必须先通过宿主平台校验，再进入内部统一的 Shell 能力名称。
  const runtimeToolName = resolveRuntimeToolName(toolName, process.platform);
  const workspace = projectId ? requireWorkspace(projectId) : null;
  const root = workspace ? path.resolve(workspace.path) : "";
  const workingDirectory = root || getPluginDataPaths().workspaceRoot;
  // 未绑定会话首次调用本地工具时准备默认目录，避免子进程因 cwd 不存在而失败。
  if (!workspace) fs.mkdirSync(workingDirectory, { recursive: true });

  if (runtimeToolName === "bash" && args.background) {
    const command = String(args.command || "").trim();
    if (!command || command.length > 10000) throw new Error("命令为空或过长");
    const dangerousPatterns = [
      /(^|[;&|\s])rm\s+(-rf|-r|-f)\s+\/(?:$|[;&|\s])/i,
      />\s*\/dev\/sd/i,
      /\bmkfs\b/i,
      /\bdd\s+/i,
      /\bcurl\s+.*\|\s*(?:ba)?sh/i,
      /\bwget\s+.*\|\s*(?:ba)?sh/i,
      /\bchmod\s+777\b/i,
      /\bcat\s+.*(?:id_rsa|authorized_keys|\.env)/i,
    ];
    if (dangerousPatterns.some((pattern) => pattern.test(command)))
      throw new Error("命令包含高风险操作，已被安全策略阻止");
    const environment = getCommandEnvironment();
    const invocation = createShellInvocation(command, environment);
    const id = randomUUID();
    const { spawn } = getChildProcessModule();
    const child = spawn(invocation.command, invocation.args, {
      cwd: workingDirectory,
      windowsHide: true,
      detached: process.platform !== "win32",
      env: environment,
    });
    // 后台输出同样使用 UTF-8 流，避免与前台 Shell 产生不同的编码结果。
    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    const record = {
      id,
      command,
      pid: child.pid,
      active: true,
      output: "",
      startedAt: Date.now(),
      child,
    };

    /**
     * 累加后台进程输出，并限制保留的最大字符数。
     * @param {unknown} chunk 标准输出或错误输出分片。
     * @returns {void} 无返回值。
     */
    const append = (chunk) => {
      record.output = `${record.output}${String(chunk)}`.slice(
        -MAX_OUTPUT_CHARS,
      );
    };
    child.stdout?.on("data", append);
    child.stderr?.on("data", append);
    child.on("exit", (code) => {
      record.active = false;
      record.code = code;
    });
    backgroundProcesses.set(id, record);
    return { shell_id: id, pid: child.pid };
  }
  if (LOCAL_RUNTIME_TOOL_NAMES.has(runtimeToolName)) {
    const toolRuntime = getLocalToolRuntime();
    return toolRuntime.execute(runtimeToolName, args, {
      callId: context.callId,
      workspace,
      workingDirectory,
      supportsImages: context.supportsImages === true,
      onUpdate,
    });
  }

  if (toolName === "list_background_shells") {
    return [...backgroundProcesses.values()].map(
      ({ child, output, ...item }) => ({ ...item, outputChars: output.length }),
    );
  }
  if (toolName === "read_background_shell_output") {
    const record = backgroundProcesses.get(String(args.shell_id || ""));
    if (!record) throw new Error("后台进程不存在");
    const offset = Math.max(0, Number(args.offset) || 0);
    return {
      active: record.active,
      code: record.code ?? null,
      output: record.output.slice(offset, offset + 128000),
      totalChars: record.output.length,
    };
  }
  if (toolName === "kill_background_shell") {
    const record = backgroundProcesses.get(String(args.shell_id || ""));
    if (!record) throw new Error("后台进程不存在");
    if (record.active) {
      if (process.platform !== "win32") {
        try {
          process.kill(-record.pid, "SIGTERM");
        } catch {
          record.child.kill("SIGTERM");
        }
      } else record.child.kill();
      record.active = false;
    }
    return { ok: true };
  }
  if (toolName === "task_read") {
    const conversation = getConversationDocument(context.conversationId);
    if (!conversation) throw new Error("任务清单缺少有效的所属会话");
    return normalizeConversationTasks(conversation.tasks);
  }
  if (toolName === "task_write") {
    if (!getConversationDocument(context.conversationId))
      throw new Error("任务清单缺少有效的所属会话");
    const tasks = normalizeConversationTasks(args.tasks);
    return { ok: true, tasks };
  }
  if (toolName === "builtin_web_search") return webSearch(args);
  if (toolName === "builtin_web_fetch") return webFetch(args);
  if (toolName === "Skill") {
    const skillName = String(args.skill || "");
    const enabledSkills = Array.isArray(context.enabledSkills)
      ? context.enabledSkills
      : [];
    const skill = getSkills().find(
      (item) => item.id === skillName || item.name === skillName,
    );
    if (
      !skill ||
      skill.disabled ||
      (!enabledSkills.includes(skill.id) && !enabledSkills.includes(skill.name))
    )
      throw new Error(`Skill "${skillName}" 未在当前会话中启用`);
    return resolveSkillInvocation(skillName, args);
  }
  throw new Error(`未知工具：${toolName}`);
}

/**
 * 将 ZVC 内部图片引用解析为 OpenAI Chat Completions 的图片块。
 * @param {Array<Record<string, unknown>>} messages 含内部图片块的请求消息。
 * @returns {Promise<Array<Record<string, unknown>>>} 已临时填充 Base64 的模型消息。
 * @throws {Error} 图片附件不存在或读取失败时抛出。
 */
async function materializeImageMessages(messages) {
  /**
   * 转换单条消息中的内部图片内容块。
   * @param {unknown} content 原始消息内容。
   * @returns {Promise<unknown>} 已转换的消息内容。
   */
  const materializeContent = async (content) => {
    if (!Array.isArray(content)) return content;
    const blocks = [];
    for (const block of content) {
      if (block?.type !== "image" || !block.attachment?.attachmentId) {
        blocks.push(block);
        continue;
      }
      // Base64 只在即将发起模型请求时短暂生成，不写入会话或调试持久化。
      const image = getAttachmentStore().readImage(
        block.attachment.attachmentId,
      );
      blocks.push({
        type: "image_url",
        image_url: {
          url: `data:${image.mediaType};base64,${image.bytes.toString("base64")}`,
        },
      });
    }
    return blocks;
  };
  const result = [];
  for (const message of Array.isArray(messages) ? messages : [])
    result.push({
      ...message,
      content: await materializeContent(message.content),
    });
  return result;
}

/**
 * 将 Vue 响应式对象递归转换为 Electron IPC 可克隆的普通数据。
 * @param {unknown} value 消息、工具或生成配置中的未知值。
 * @param {WeakSet<object>} ancestors 当前递归路径中的对象集合。
 * @returns {unknown} 仅包含普通对象、数组和基础类型的等价值。
 * @throws {Error} 数据包含循环引用或不可传输类型时抛出。
 */
function toIpcCloneable(value, ancestors = new WeakSet()) {
  if (value === null || ["string", "boolean"].includes(typeof value))
    return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "undefined") return undefined;
  if (typeof value !== "object")
    throw new Error(`AI 请求包含不可传输的数据类型：${typeof value}`);
  if (ancestors.has(value))
    throw new Error("AI 请求包含循环引用，无法发送给 ZTools");

  // 只在当前递归路径保留对象，允许不同字段安全复用同一份普通数据。
  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      return value.map((item) => {
        const cloned = toIpcCloneable(item, ancestors);
        return typeof cloned === "undefined" ? null : cloned;
      });
    }
    const result = {};
    for (const [key, item] of Object.entries(value)) {
      const cloned = toIpcCloneable(item, ancestors);
      if (typeof cloned !== "undefined") result[key] = cloned;
    }
    return result;
  } finally {
    // 清理路径标记，避免共享引用被误判为循环结构。
    ancestors.delete(value);
  }
}

/**
 * 通过 ZTools 宿主管理的 AI 供应商创建一项单轮流式请求。
 * @param {Record<string, unknown>} options 模型、消息、工具和生成参数。
 * @param {(event: Record<string, unknown>) => void} onEvent 流式事件回调。
 * @returns {{id: string, promise: Promise<Record<string, unknown>>, abort: () => void}} 可中止请求句柄。
 */
function createChatRequest(options, onEvent) {
  const id = randomUUID();
  let hostRequest = null;
  let aborted = false;
  const promise = new Promise((resolve, reject) => {
    (async () => {
      try {
        debugChat("request start", {
          model: options.model,
          messages: options.messages?.length,
          tools: options.tools?.length,
        });
        if (typeof window.ztools?.aiChat !== "function") {
          const unavailable = new Error(
            "当前 ZTools 版本不支持统一 AI 接口，请升级 ZTools 后重试",
          );
          unavailable.code = "HOST_AI_UNAVAILABLE";
          throw unavailable;
        }
        const internalMessages = Array.isArray(options.messages)
          ? options.messages.map((message) => {
              if (message?.role !== "assistant" || !message.reasoning_content)
                return message;
              return {
                ...message,
                reasoning_content: String(message.reasoning_content),
              };
            })
          : [];
        const requestMessages =
          await materializeImageMessages(internalMessages);
        const requestTools =
          Array.isArray(options.tools) && options.tools.length
            ? options.tools
            : undefined;
        const toolChoice = requestTools
          ? options.toolChoice || "auto"
          : undefined;
        // 未显式配置时交由宿主和模型采用默认采样策略，兼容不支持 temperature 的推理模型。
        const temperature = normalizeOptionalTemperature(options.temperature);
        const streamBatchIntervalMs = normalizeStreamBatchIntervalMs(
          options.streamBatchIntervalMs ??
            readStorage(
              STORAGE_KEYS.streamBatchIntervalMs,
              DEFAULT_STREAM_BATCH_INTERVAL_MS,
            ),
        );
        recordChatDebug("request", {
          model: String(options.model || ""),
          messages: requestMessages,
          tools: requestTools || [],
          stream: true,
          tool_choice: toolChoice,
          ...(temperature === undefined ? {} : { temperature }),
          streamBatchIntervalMs,
        });
        const hostOptions = toIpcCloneable({
          model: String(options.model || ""),
          messages: requestMessages,
          tools: requestTools,
          toolChoice,
          ...(temperature === undefined ? {} : { temperature }),
          reasoningEffort: options.reasoningEffort,
          maxTokens:
            Number(options.maxTokens) > 0
              ? Math.min(Number(options.maxTokens), 32768)
              : undefined,
          timeout: AI_REQUEST_TIMEOUT_MS,
          streamBatchIntervalMs,
        });
        hostRequest = window.ztools.aiChat(hostOptions, (event) => {
          // 对外继续使用 ZVC 本地请求 ID，确保现有多会话停止映射保持稳定。
          if (event?.type !== "request") onEvent?.(event);
        });
        if (aborted) hostRequest.abort();
        const response = await hostRequest;
        debugChat("request complete", {
          contentChars: String(response?.content || "").length,
          reasoningChars: String(response?.reasoning_content || "").length,
          toolCalls: response?.tool_calls?.length || 0,
        });
        recordChatDebug("response", response);
        resolve(response);
      } catch (error) {
        // 调试记录只保留提供商诊断，不记录请求消息或密钥。
        recordChatDebug("error", {
          name: error?.name,
          code: error?.code,
          providerCode: error?.providerCode,
          status: error?.status,
          requestId: error?.requestId,
          message: error?.message,
        });
        debugChat(
          "request error",
          error?.code,
          error?.status,
          error?.requestId,
          error?.message,
        );
        reject(error);
      }
    })();
  });
  return {
    id,
    promise,
    abort: () => {
      aborted = true;
      hostRequest?.abort?.();
    },
  };
}

const activeChatRequests = new Map();

/**
 * 启动聊天请求并在结束后释放活动请求记录。
 * @param {Record<string, unknown>} options 请求参数。
 * @param {(event: Record<string, unknown>) => void} onEvent 流式事件回调。
 * @returns {Promise<Record<string, unknown>>} 最终助手消息。
 * @throws {Error} 模型请求失败或被中止时抛出。
 */
async function chat(options, onEvent) {
  const handle = createChatRequest(options, onEvent);
  // 先登记句柄再通知界面，确保用户立即停止时能够找到请求。
  activeChatRequests.set(handle.id, handle);
  onEvent?.({ type: "request", requestId: handle.id });
  try {
    return await handle.promise;
  } finally {
    activeChatRequests.delete(handle.id);
  }
}

/**
 * 使用当前兼容模型生成上下文摘要，并禁止摘要过程实际调用工具。
 * @param {Record<string, unknown>} options 提供商、消息、工具定义和摘要上限。
 * @param {(event: Record<string, unknown>) => void} onEvent 请求标识回调。
 * @returns {Promise<Record<string, unknown>>} 完整摘要响应。
 * @throws {Error} 模型请求失败或被中止时抛出。
 */
async function summarizeContext(options, onEvent) {
  return chat(
    {
      ...options,
      tools: Array.isArray(options.tools) ? options.tools : [],
      toolChoice: "none",
      // 摘要同样沿用模型默认采样策略，避免推理模型拒绝 temperature 参数。
      maxTokens: Math.min(
        Math.max(Number(options.maxTokens) || 4096, 256),
        8192,
      ),
    },
    onEvent,
  );
}

/**
 * 中止一项正在运行的模型请求。
 * @param {unknown} requestId 活动请求标识。
 * @returns {boolean} 是否找到并中止了请求。
 */
function abortChat(requestId) {
  const handle = activeChatRequests.get(String(requestId || ""));
  if (!handle) return false;
  handle.abort();
  return true;
}

/**
 * 停止由插件启动的所有后台进程。
 * @returns {void} 无返回值。
 */
function cleanupBackgroundProcesses() {
  for (const record of backgroundProcesses.values()) {
    if (!record.active) continue;
    try {
      if (process.platform !== "win32") process.kill(-record.pid, "SIGTERM");
      else record.child.kill();
    } catch {
      // 清理阶段允许进程已经退出，避免重复终止阻断后续资源释放。
    }
  }
  backgroundProcesses.clear();
}

window.zvcBridge = {
  /**
   * 获取插件启动所需的全部本地状态。
   * @returns {Record<string, unknown>} 工作区、会话、模型、能力和宿主平台初始状态。
   */
  getInitialState() {
    const conversations = getConversations();
    return {
      workspaces: getWorkspaces(),
      conversations,
      runtimePlatform: process.platform,
      selectedModel: readStorage(STORAGE_KEYS.selectedModel, ""),
      autoApproveTools:
        readStorage(STORAGE_KEYS.autoApproveTools, true) !== false,
      streamBatchIntervalMs: normalizeStreamBatchIntervalMs(
        readStorage(
          STORAGE_KEYS.streamBatchIntervalMs,
          DEFAULT_STREAM_BATCH_INTERVAL_MS,
        ),
      ),
      autoCompactionThresholdPercent: normalizeAutoCompactionThresholdPercent(
        readStorage(
          STORAGE_KEYS.autoCompactionThresholdPercent,
          DEFAULT_AUTO_COMPACTION_THRESHOLD_PERCENT,
        ),
      ),
      toolConcurrencyLimit: normalizeToolConcurrencyLimit(
        readStorage(
          STORAGE_KEYS.toolConcurrencyLimit,
          DEFAULT_TOOL_CONCURRENCY_LIMIT,
        ),
      ),
      activeConversationId:
        readStorage(STORAGE_KEYS.activeConversation, "") ||
        conversations[0]?.id ||
        "",
      workspacePath: getPluginDataPaths().workspaceRoot,
      collapsedWorkspaceIds: readStorage(STORAGE_KEYS.collapsedWorkspaces, []),
      skillRoot: getPluginDataPaths().skillRoot,
      skills: [],
    };
  },
  createWorkspace,
  importWorkspace,
  removeWorkspace,
  /**
   * 保存侧边栏工作区的折叠状态。
   * @param {string[]} workspaceIds 已折叠工作区标识。
   * @returns {boolean} 是否完成写入。
   */
  saveCollapsedWorkspaces(workspaceIds) {
    const validIds = new Set(getWorkspaces().map((item) => item.id));
    const normalized = Array.isArray(workspaceIds)
      ? [...new Set(workspaceIds.filter((id) => validIds.has(id)))]
      : [];
    return writeStorage(STORAGE_KEYS.collapsedWorkspaces, normalized);
  },
  /**
   * 创建并激活一个新会话。
   * @param {Record<string, unknown>} input 会话初始设置。
   * @returns {Record<string, unknown>} 新会话记录。
   */
  createConversation(input = {}) {
    // 创建时分配全新标识和时间戳，确保日志目录不会覆盖已有会话。
    const now = Date.now();
    const conversation = normalizeConversation({
      ...input,
      id: randomUUID(),
      createdAt: now,
      updatedAt: now,
    });
    // 先发布 JSONL 日志和轻量索引，再更新活动会话指针。
    createConversationDocument(conversation);
    writeStorage(STORAGE_KEYS.activeConversation, conversation.id);
    return createConversationView(conversation.id, { limit: 50 });
  },
  /**
   * 获取全部会话记录。
   * @returns {Array<Record<string, unknown>>} 会话列表。
   */
  getConversationList() {
    return getConversations();
  },
  /**
   * 按完整 Turn 读取指定会话的一页历史消息。
   * @param {string} id 会话标识。
   * @param {{before?: number, limit?: number}} page 分页游标和目标条数。
   * @returns {Record<string, unknown>|null} 历史窗口；会话不存在时返回 null。
   */
  getConversationHistoryPage(id, page = {}) {
    return getConversationStore().getPage(id, page);
  },
  /**
   * 释放指定会话在 preload 存储层中的完整快照缓存。
   * @param {string} id 会话标识。
   * @returns {boolean} 是否移除了缓存。
   */
  releaseConversation(id) {
    return getConversationStore().release(id);
  },
  /**
   * 在首条用户消息发送前绑定或清除会话工作区。
   * @param {string} id 会话标识。
   * @param {string} workspaceId 工作区标识；空字符串表示不绑定。
   * @returns {Record<string, unknown>} 更新后的会话。
   * @throws {Error} 会话不存在、工作区无效或会话已经锁定时抛出。
   */
  setConversationWorkspace(id, workspaceId = "") {
    const current = getConversationStore().getState(id);
    if (!current) throw new Error("会话不存在");
    if (current.workspaceLocked)
      throw new Error("该会话已经开始，工作区不可更改");
    const normalizedWorkspaceId = String(workspaceId || "").trim();
    if (normalizedWorkspaceId) requireWorkspace(normalizedWorkspaceId);
    const next = normalizeConversation({
      ...current,
      projectId: normalizedWorkspaceId,
      updatedAt: Date.now(),
    });
    return getConversationStore().commit(id, {
      state: createConversationStateSnapshot(next),
    });
  },
  /**
   * 归档指定会话但保留其日志和数据库索引。
   * @param {string} id 会话标识。
   * @returns {Record<string, unknown>|null} 归档后的会话；目标不存在时返回 null。
   */
  archiveConversation(id) {
    // 归档只切换轻量元数据，不删除消息正文，确保本地记录可恢复。
    return this.updateConversation(id, { archived: true });
  },
  /**
   * 从指定 Turn 或会话最后一个完整 Turn 创建分叉会话。
   * @param {string} id 源会话标识。
   * @param {string} turnId 可选的目标 Turn 标识；为空时使用最后一个完整 Turn。
   * @returns {Record<string, unknown>} 新建的分叉会话。
   * @throws {Error} 源会话不存在、目标 Turn 不完整或分叉日志创建失败时抛出。
   */
  forkConversation(id, turnId = "") {
    const source = getConversationDocument(id);
    if (!source) throw new Error("会话不存在");
    const sourceMessages = Array.isArray(source.messages)
      ? source.messages
      : [];
    const targetTurnId = String(turnId || "").trim();
    let completedIndex = -1;
    // 从尾部定位目标 Turn 的最终完整回答，正在生成或已停止的半截消息不能作为分叉边界。
    for (let index = sourceMessages.length - 1; index >= 0; index -= 1) {
      const message = sourceMessages[index];
      if (
        message?.role === "assistant" &&
        message.status === "completed" &&
        (!Array.isArray(message.tool_calls) ||
          message.tool_calls.length === 0) &&
        (!targetTurnId || message.turnId === targetTurnId)
      ) {
        completedIndex = index;
        break;
      }
    }
    if (targetTurnId && completedIndex < 0)
      throw new Error("目标 Turn 尚未完整结束，无法分叉");
    const messages =
      completedIndex >= 0 ? sourceMessages.slice(0, completedIndex + 1) : [];
    const title = increaseForkConversationTitle(source.title);
    const now = Date.now();
    // 新会话复制能力和工作区绑定，但清空任务与派生摘要，避免目标 Turn 之后的状态泄漏到分叉。
    const forked = normalizeConversation({
      ...source,
      id: randomUUID(),
      title,
      messages,
      tasks: [],
      pendingMessages: [],
      contextState: normalizeConversationContextState({}),
      archived: false,
      createdAt: now,
      updatedAt: now,
    });
    // 先创建独立日志，再由前端切换活动指针，避免出现半成品会话。
    createConversationDocument(forked);
    return createConversationView(forked.id, { limit: 50 });
  },
  /**
   * 合并并保存指定会话字段。
   * @param {string} id 会话标识。
   * @param {Record<string, unknown>} patch 会话更新字段。
   * @param {{preserveUpdatedAt?: boolean}} options 更新时间选项；恢复性保存可保留原时间。
   * @returns {Record<string, unknown>|null} 更新后的会话。
   */
  updateConversation(id, patch = {}, options = {}) {
    // 状态更新只读取非消息快照，不为改标题或能力设置复制完整历史。
    const current = getConversationStore().getState(id);
    if (!current) return null;
    const changesWorkspace =
      Object.prototype.hasOwnProperty.call(patch, "projectId") &&
      String(patch.projectId || "") !== current.projectId;
    if (changesWorkspace && current.workspaceLocked)
      throw new Error("该会话已经开始，工作区不可更改");
    if (current.workspaceLocked && patch.workspaceLocked === false)
      throw new Error("会话工作区锁定状态不可撤销");
    // 普通交互更新时间；仅打开会话触发的恢复性整理沿用原活动时间。
    const updatedAt =
      options.preserveUpdatedAt === true ? current.updatedAt : Date.now();
    const next = normalizeConversation({ ...current, ...patch, id, updatedAt });
    // 普通状态更新不再重新比较消息数组，只提交规范化后的非消息状态。
    return getConversationStore().commit(id, {
      state: createConversationStateSnapshot(next),
    });
  },
  /**
   * 删除指定会话并修正活动会话标识。
   * @param {string} id 会话标识。
   * @returns {boolean} 是否完成删除流程。
   */
  removeConversation(id) {
    // 存储层会一并删除数据库索引和当前设备上的会话日志。
    getConversationStore().remove(id);
    const active = readStorage(STORAGE_KEYS.activeConversation, "");
    if (active === id)
      writeStorage(
        STORAGE_KEYS.activeConversation,
        getConversations()[0]?.id || "",
      );
    return true;
  },
  /**
   * 激活指定会话并返回尾部历史窗口。
   * @param {string} id 会话标识。
   * @returns {Record<string, unknown>} 会话状态和尾部历史窗口。
   * @throws {Error} 会话不存在时抛出。
   */
  setActiveConversation(id) {
    // 激活前只向 Renderer 发布尾部窗口，完整历史保留在 preload 存储缓存中。
    const item = createConversationView(id, { limit: 50 });
    if (!item) throw new Error("会话不存在");
    // 仅保存轻量活动指针，不改写会话正文。
    writeStorage(STORAGE_KEYS.activeConversation, id);
    return item;
  },
  /**
   * 仅激活已在前端驻留的会话，不读取或克隆完整消息历史。
   * @param {string} id 会话标识。
   * @returns {Record<string, unknown>} 会话轻量元数据。
   * @throws {Error} 会话索引不存在时抛出。
   */
  setActiveConversationPointer(id) {
    // 仅校验同步索引，完整历史继续由前端驻留运行时持有。
    const item = getConversationStore().getMetadata(id);
    if (!item) throw new Error("会话不存在");
    writeStorage(STORAGE_KEYS.activeConversation, id);
    return item;
  },
  /**
   * 按标识读取会话。
   * @param {string} id 会话标识。
   * @returns {Record<string, unknown>|null} 匹配的会话。
   */
  getConversationById(id) {
    return getConversationDocument(id);
  },
  /**
   * 按需读取模型循环使用的完整消息历史，不参与会话切换和页面渲染。
   * @param {string} id 会话标识。
   * @returns {Array<Record<string, unknown>>} 完整消息时间线。
   * @throws {Error} 会话不存在时抛出。
   */
  getConversationExecutionMessages(id) {
    const conversation = getConversationDocument(id);
    if (!conversation) throw new Error("会话不存在");
    return conversation.messages;
  },
  /**
   * 返回会话日志位置，供诊断和存储状态展示使用。
   * @param {string} id 会话标识。
   * @returns {{root: string, logPath: string}} 当前设备上的 JSONL 存储位置。
   */
  getConversationStorageInfo(id) {
    return {
      root: getConversationSessionRoot(),
      logPath: getConversationStore().getLogPath(id),
    };
  },
  /**
   * 重新扫描并返回用户 Skill 列表。
   * @returns {Array<Record<string, unknown>>} Skill 列表。
   */
  getSkills() {
    return getSkills();
  },
  /**
   * 为当前选择的 Skill 构建动态工具定义。
   * @param {string[]} enabledSkillNames 已启用的 Skill 标识。
   * @returns {Record<string, unknown>|null} Skill 工具定义。
   */
  getSkillToolDefinition(enabledSkillNames = []) {
    return getSkillToolDefinition(enabledSkillNames);
  },
  /**
   * 保存当前会话的非消息状态。
   * @param {string} id 会话标识。
   * @param {Record<string, unknown>} patch 会话状态字段。
   * @param {{preserveUpdatedAt?: boolean}} options 更新时间选项；恢复性保存可保留原时间。
   * @returns {Record<string, unknown>|null} 保存后的会话。
   */
  saveConversationState(id, patch = {}, options = {}) {
    return this.updateConversation(id, patch, options);
  },
  /**
   * 原子提交已变更消息和非消息状态，避免对完整历史执行序列化差异比较。
   * @param {string} id 会话标识。
   * @param {{state?: Record<string, unknown>, upserts?: Array<Record<string, unknown>>, removedIds?: string[]}} changes 本次原子变化。
   * @param {{preserveUpdatedAt?: boolean}} options 更新时间选项。
   * @returns {Record<string, unknown>} 提交后的轻量会话元数据。
   * @throws {Error} 会话不存在、工作区状态非法或日志提交失败时抛出。
   */
  commitConversationChanges(id, changes = {}, options = {}) {
    const current = getConversationStore().getState(id);
    if (!current) throw new Error("会话不存在");
    const patch =
      changes.state && typeof changes.state === "object" ? changes.state : {};
    const changesWorkspace =
      Object.prototype.hasOwnProperty.call(patch, "projectId") &&
      String(patch.projectId || "") !== current.projectId;
    if (changesWorkspace && current.workspaceLocked)
      throw new Error("该会话已经开始，工作区不可更改");
    if (current.workspaceLocked && patch.workspaceLocked === false)
      throw new Error("会话工作区锁定状态不可撤销");
    const updatedAt =
      options.preserveUpdatedAt === true ? current.updatedAt : Date.now();
    const next = normalizeConversation({ ...current, ...patch, id, updatedAt });
    return getConversationStore().commit(id, {
      state: createConversationStateSnapshot(next),
      upserts: Array.isArray(changes.upserts) ? changes.upserts : [],
      removedIds: Array.isArray(changes.removedIds) ? changes.removedIds : [],
    });
  },
  /**
   * 读取指定会话当前保存的任务列表。
   * @param {string} conversationId 会话标识。
   * @returns {Array<Record<string, unknown>>} 任务列表。
   * @throws {Error} 指定会话不存在时抛出。
   */
  getTasks(conversationId = "") {
    const conversation = getConversationDocument(conversationId);
    if (!conversation) throw new Error("会话不存在");
    return normalizeConversationTasks(conversation.tasks);
  },
  /**
   * 保存宿主模型列表中的默认选择标识。
   * @param {string} selectedModel 当前宿主模型标识。
   * @returns {boolean} 是否完成写入。
   */
  saveSelectedModel(selectedModel) {
    writeStorage(STORAGE_KEYS.selectedModel, String(selectedModel || ""));
    return true;
  },
  /**
   * 保存工具自动执行开关。
   * @param {unknown} value 开关值。
   * @returns {boolean} 是否完成写入。
   */
  saveAutoApproveTools(value) {
    return writeStorage(STORAGE_KEYS.autoApproveTools, Boolean(value));
  },
  /**
   * 保存宿主 AI 流事件的合并间隔。
   * @param {unknown} value 用户选择的毫秒值。
   * @returns {number} 已规范化并保存的毫秒值。
   */
  saveStreamBatchIntervalMs(value) {
    const interval = normalizeStreamBatchIntervalMs(value);
    writeStorage(STORAGE_KEYS.streamBatchIntervalMs, interval);
    return interval;
  },
  /**
   * 保存自动压缩上下文的触发阈值。
   * @param {unknown} value 用户选择的百分比。
   * @returns {number} 已规范化并保存的整数百分比。
   */
  saveAutoCompactionThresholdPercent(value) {
    const percent = normalizeAutoCompactionThresholdPercent(value);
    writeStorage(STORAGE_KEYS.autoCompactionThresholdPercent, percent);
    return percent;
  },
  /**
   * 保存后续工具调度使用的最大并发调用数。
   * @param {unknown} value 用户选择的并发数量。
   * @returns {number} 已规范化并保存的并发上限。
   */
  saveToolConcurrencyLimit(value) {
    const limit = normalizeToolConcurrencyLimit(value);
    writeStorage(STORAGE_KEYS.toolConcurrencyLimit, limit);
    return limit;
  },
  /**
   * 获取宿主管理的 AI 模型列表。
   * @returns {Promise<Array<unknown>>} 模型列表；读取失败时返回空数组。
   */
  getHostModels: async () => {
    try {
      return (await window.ztools?.allAiModels?.()) || [];
    } catch {
      return [];
    }
  },
  chat,
  summarizeContext,
  abortChat,
  invokeTool,
  /**
   * 取消指定本地工具调用及其关联进程树。
   * @param {string} callId 工具调用标识。
   * @returns {boolean} 是否找到活动调用。
   */
  cancelTool(callId) {
    return localToolRuntime?.cancel(callId) || false;
  },
  /**
   * 将用户选择或粘贴的图片保存到内容寻址附件仓库。
   * @param {{bytes: unknown, mediaType?: string, name?: string}} input 图片字节和元数据。
   * @returns {Record<string, unknown>} 可写入会话的轻量图片引用。
   * @throws {Error} 图片无效、超限或保存失败时抛出。
   */
  saveImageAttachment(input) {
    return getAttachmentStore().saveImage(input);
  },
  /**
   * 读取图片附件并生成仅供当前界面预览的数据地址。
   * @param {string} attachmentId 图片附件标识。
   * @returns {{mediaType: string, dataUrl: string}} 图片媒体类型和预览地址。
   * @throws {Error} 图片附件不存在或已损坏时抛出。
   */
  readImageAttachment(attachmentId) {
    const image = getAttachmentStore().readImage(attachmentId);
    return {
      mediaType: image.mediaType,
      dataUrl: `data:${image.mediaType};base64,${image.bytes.toString("base64")}`,
    };
  },
  /**
   * 使用系统默认应用打开一个已经解析的本机路径。
   * @param {string} targetPath 待打开的文件或目录绝对路径。
   * @returns {unknown} ZTools 打开路径结果。
   * @throws {Error} 路径为空、不存在或不是绝对路径时抛出。
   */
  openPath(targetPath) {
    const resolved = path.resolve(String(targetPath || ""));
    if (
      !targetPath ||
      !path.isAbsolute(String(targetPath)) ||
      !fs.existsSync(resolved)
    )
      throw new Error("要打开的本机路径不存在");
    return window.ztools?.shellOpenPath?.(resolved);
  },
  /**
   * 使用系统默认应用打开工作区目录。
   * @param {string} workspaceId 工作区标识。
   * @returns {unknown} ZTools 打开路径结果。
   * @throws {Error} 工作区不存在时抛出。
   */
  openWorkspace(workspaceId) {
    const workspace = requireWorkspace(workspaceId);
    return window.ztools?.shellOpenPath?.(workspace.path);
  },
  /**
   * 在文件管理器中定位工作区目录。
   * @param {string} workspaceId 工作区标识。
   * @returns {unknown} ZTools 定位路径结果。
   * @throws {Error} 工作区不存在时抛出。
   */
  showWorkspace(workspaceId) {
    const workspace = requireWorkspace(workspaceId);
    return window.ztools?.shellShowItemInFolder?.(workspace.path);
  },
};

window.ztools?.onPluginOut?.(() => {
  // 退出插件时先中止网络请求，再释放前台和后台进程。
  for (const handle of activeChatRequests.values()) handle.abort();
  localToolRuntime?.cancelAll();
  cleanupBackgroundProcesses();
});
