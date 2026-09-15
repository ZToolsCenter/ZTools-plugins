import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstat, readFile, readdir } from "node:fs/promises";
import {
  dirname,
  extname,
  relative,
  resolve,
  sep,
} from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const artifactRoot = resolve(
  process.argv[2]
    ?? process.env.GOOSE_NATIVE_EDITOR_DIST
    ?? resolve(repositoryRoot, "dist-native-editor"),
);
const manifestName = "editor-manifest.json";
const inputsName = "editor-inputs.json";

const expectedManifest = Object.freeze({
  artifactVersion: 1,
  bridgeProtocolVersion: 1,
  target: "native-editor",
  entry: "index.html",
  handler: "gooseNotes",
});

const expectedCapabilities = Object.freeze({
  markdown: true,
  openExternalLink: true,
  localResource: true,
  localAsset: true,
  saveAck: true,
  flush: true,
  ai: true,
  utools: false,
  quicknote: false,
  network: false,
});

const allowedArtifactExtensions = new Set([
  ".avif",
  ".css",
  ".gif",
  ".jpeg",
  ".jpg",
  ".js",
  ".json",
  ".otf",
  ".png",
  ".svg",
  ".ttf",
  ".wasm",
  ".webp",
  ".woff",
  ".woff2",
]);
const allowedFontExtensions = new Set([".otf", ".ttf", ".woff", ".woff2"]);
const textArtifactExtensions = new Set([".css", ".html", ".js", ".json", ".svg"]);

const forbiddenSourceModules = [
  ["AI 编辑器实现（仅允许原生菜单）", /^src\/components\/editor\/ai\/(?!GooseAIMenu\.tsx$)/i],
  ["AI 编辑器状态（仅允许选区状态）", /^src\/components\/editor\/.*ai(?:[./_-]|$)/i],
  ["应用 Agent", /^src\/agent\//i],
  ["uTools 宿主实现", /^src\/(?:lib\/)?(?:utools|lib\/editor-platform\/utools)(?:[-./]|$)/i],
  ["Quicknote 宿主实现", /^src\/(?:pages\/quick-note|lib\/quicknote)(?:[./]|$)/i],
  ["应用状态仓库", /^src\/stores\//i],
  ["应用数据库或正文副本", /^src\/lib\/(?:storage|history|local-md-snapshot|local-page-idmap)(?:[./]|$)/i],
  ["WebDAV", /^src\/lib\/webdav/i],
  ["AI 或 MCP", /^src\/lib\/(?:ai(?:[./_-]|$)|notebook-ai(?:[./]|$))/i],
  ["具体宿主运行时", /^src\/lib\/(?:host|editor-platform\/utools)(?:[./]|$)/i],
  ["PDF、Word 或图片导出", /^src\/lib\/(?:pdfExport|docxExport|imageExport)(?:[./]|$)/i],
  ["应用级导出流程", /^src\/lib\/export(?:\.ts$|\/(?!markdown\/))/i],
  ["应用页面", /^src\/pages\/(?!workspace\/styles\/(?:editor-base|code-themes)\.css$)/i],
];

const forbiddenPackages = [
  ["AI SDK", /^(?:@ai-sdk\/|@json-render\/|streamdown$|@streamdown\/)/i],
  ["WebDAV", /^webdav$/i],
  ["PDF、Word 或压缩导出", /^(?:@blocknote\/xl-pdf-exporter|@react-pdf\/renderer|docx|html-to-image|jszip)$/i],
  ["桌面或插件宿主", /^(?:electron|@electron\/|@tauri-apps\/|utools)$/i],
  ["浏览器数据库", /^(?:dexie|idb|localforage|pouchdb|sql\.js|better-sqlite3|@sqlite\.org\/)/i],
];

const targetedRuntimeChecks = [
  ["uTools 运行时", /\butools\b/i],
  ["Quicknote 运行时或样式", /quick[\s_-]?note/i],
  ["WebDAV 运行时", /\bwebdav\b/i],
  ["Tauri 运行时", /__TAURI__|@tauri-apps/i],
  ["Electron 运行时", /require\(\s*["']electron["']\s*\)|\bBrowserWindow\b|electronAPI/i],
  ["AI SDK 运行时", /@ai-sdk\//i],
  ["正文数据库访问", /\bindexedDB\s*\.\s*(?:open|deleteDatabase)\s*\(|\bnew\s+Dexie\b|\bPouchDB\s*\(|\butools\s*\.\s*db\b|\blibrary\.json\b/i],
  ["浏览器文件系统宿主能力", /\bshow(?:SaveFile|OpenFile|Directory)Picker\s*\(/],
  ["远程网络调用", /\bfetch\s*\(\s*["'`]\s*(?:https?:|\/\/)|\b(?:WebSocket|EventSource)\s*\(\s*["'`]\s*(?:wss?:|https?:|\/\/)|\bsendBeacon\s*\(\s*["'`]\s*(?:https?:|\/\/)/i],
  ["Service Worker 注册", /\bnavigator\s*\.\s*serviceWorker\s*\.\s*register\s*\(/i],
  ["源码编辑器回退", /native-source-editor|Markdown 源码编辑器|已使用源码模式保护原文/i],
  ["源码映射引用", /sourceMappingURL\s*=/i],
];

const violations = [];

function report(message) {
  violations.push(message);
}

function toPosixPath(value) {
  return value.split(sep).join("/");
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

async function collectFiles(root, directory = root) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const absolute = resolve(directory, entry.name);
    const entryStat = await lstat(absolute);
    const displayPath = toPosixPath(relative(root, absolute));
    if (entryStat.isSymbolicLink()) {
      report(`${displayPath}: 产物禁止符号链接`);
      continue;
    }
    if (entryStat.isDirectory()) {
      files.push(...(await collectFiles(root, absolute)));
    } else if (entryStat.isFile()) {
      files.push(absolute);
    } else {
      report(`${displayPath}: 产物包含不支持的文件类型`);
    }
  }

  return files;
}

function contentHash(files) {
  const hash = createHash("sha256");
  const included = files
    .filter((file) => toPosixPath(relative(artifactRoot, file)) !== manifestName)
    .sort((left, right) => {
      const leftPath = toPosixPath(relative(artifactRoot, left));
      const rightPath = toPosixPath(relative(artifactRoot, right));
      return leftPath < rightPath ? -1 : leftPath > rightPath ? 1 : 0;
    });

  return Promise.all(included.map(async (file) => ({
    path: toPosixPath(relative(artifactRoot, file)),
    contents: await readFile(file),
  }))).then((entries) => {
    for (const entry of entries) {
      hash.update(entry.path, "utf8");
      hash.update("\0", "utf8");
      hash.update(entry.contents);
      hash.update("\0", "utf8");
    }
    return `sha256:${hash.digest("hex")}`;
  });
}

async function readJSON(relativePath) {
  try {
    return JSON.parse(await readFile(resolve(artifactRoot, relativePath), "utf8"));
  } catch (error) {
    report(`${relativePath}: 不是可读取的有效 JSON（${error.message}）`);
    return null;
  }
}

function requireEqual(object, field, expected, owner = manifestName) {
  if (object?.[field] !== expected) {
    report(`${owner}: ${field} 必须是 ${JSON.stringify(expected)}`);
  }
}

async function auditManifest(files) {
  const manifest = await readJSON(manifestName);
  if (!isPlainObject(manifest)) {
    if (manifest !== null) report(`${manifestName}: 根节点必须是对象`);
    return null;
  }

  for (const [field, expected] of Object.entries(expectedManifest)) {
    requireEqual(manifest, field, expected);
  }

  if (!/^[a-f0-9]{40}$/.test(manifest.gitCommit ?? "")) {
    report(`${manifestName}: gitCommit 必须是 40 位小写 Git 提交哈希`);
  } else {
    try {
      const currentCommit = execFileSync("git", ["rev-parse", "HEAD"], {
        cwd: repositoryRoot,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      }).trim();
      if (manifest.gitCommit !== currentCommit) {
        report(`${manifestName}: gitCommit 与当前 goose-note 提交不一致，请重新构建产物`);
      }
    } catch {
      report(`${manifestName}: 无法核对 goose-note 的 Git 提交`);
    }
  }
  if (typeof manifest.dirty !== "boolean") {
    report(`${manifestName}: dirty 必须是布尔值`);
  }
  if (!/^sha256:[a-f0-9]{64}$/.test(manifest.tokensHash ?? "")) {
    report(`${manifestName}: tokensHash 必须是 sha256:<64 位小写十六进制>`);
  }
  if (!/^sha256:[a-f0-9]{64}$/.test(manifest.contentHash ?? "")) {
    report(`${manifestName}: contentHash 必须是 sha256:<64 位小写十六进制>`);
  } else {
    const actualHash = await contentHash(files);
    if (manifest.contentHash !== actualHash) {
      report(`${manifestName}: 内容哈希不匹配（清单 ${manifest.contentHash}，实际 ${actualHash}）`);
    }
  }

  if (!isPlainObject(manifest.capabilities)) {
    report(`${manifestName}: capabilities 必须是对象`);
  } else {
    for (const [capability, expected] of Object.entries(expectedCapabilities)) {
      requireEqual(manifest.capabilities, capability, expected, `${manifestName}.capabilities`);
    }
    const unexpected = Object.keys(manifest.capabilities)
      .filter((capability) => !(capability in expectedCapabilities));
    if (unexpected.length > 0) {
      report(`${manifestName}.capabilities: 包含未约定能力 ${unexpected.join("、")}`);
    }
  }

  const tokenSource = resolve(
    process.env.GOOSE_NATIVE_EDITOR_TOKENS
      ?? resolve(repositoryRoot, "../super-note/Design/tokens.json"),
  );
  const tokenStat = await lstat(tokenSource).catch(() => null);
  if (process.env.GOOSE_NATIVE_EDITOR_TOKENS && !tokenStat?.isFile()) {
    report(`${manifestName}: GOOSE_NATIVE_EDITOR_TOKENS 指向的文件不存在：${tokenSource}`);
  } else if (tokenStat?.isFile() && /^sha256:[a-f0-9]{64}$/.test(manifest.tokensHash ?? "")) {
    const actualTokenHash = `sha256:${createHash("sha256")
      .update(await readFile(tokenSource))
      .digest("hex")}`;
    if (manifest.tokensHash !== actualTokenHash) {
      report(`${manifestName}: tokensHash 与当前 consumer 设计令牌不一致，请重新构建产物`);
    }
  }

  return manifest;
}

function parseAttribute(tag, name) {
  const match = tag.match(new RegExp(`\\b${name}\\s*=\\s*(["'])(.*?)\\1`, "i"));
  return match?.[2] ?? null;
}

function parseCSP(html) {
  const metaTag = (html.match(/<meta\b[^>]*>/gi) ?? []).find((tag) => (
    parseAttribute(tag, "http-equiv")?.toLowerCase() === "content-security-policy"
  ));
  const policy = metaTag ? parseAttribute(metaTag, "content") : null;
  if (!policy) return null;
  const csp = new Map();
  for (const [rawName, ...values] of policy
    .split(";")
    .map((directive) => directive.trim().split(/\s+/))
    .filter(([name]) => name)) {
    const name = rawName.toLowerCase();
    if (csp.has(name)) {
      report(`index.html: CSP 指令不能重复：${name}`);
      continue;
    }
    csp.set(name, values);
  }
  return csp;
}

function requireCSP(csp, directive, required, allowed = required) {
  const values = csp.get(directive) ?? [];
  for (const value of required) {
    if (!values.includes(value)) report(`index.html: CSP ${directive} 缺少 ${value}`);
  }
  for (const value of values) {
    if (!allowed.includes(value)) report(`index.html: CSP ${directive} 禁止 ${value}`);
  }
}

function resolveLocalReference(entryPath, reference, label) {
  if (/^(?:[a-z][a-z\d+.-]*:|\/)/i.test(reference)) {
    report(`index.html: ${label}必须使用产物内相对路径，当前为 ${reference}`);
    return null;
  }
  const clean = reference.split(/[?#]/, 1)[0];
  if (!clean) {
    report(`index.html: ${label}路径不能为空`);
    return null;
  }
  const absolute = resolve(dirname(entryPath), clean);
  const escaped = relative(artifactRoot, absolute);
  if (escaped === ".." || escaped.startsWith(`..${sep}`) || escaped.startsWith(sep)) {
    report(`index.html: ${label}逃逸产物目录：${reference}`);
    return null;
  }
  return absolute;
}

async function auditHTML(manifest) {
  const entry = manifest?.entry === "index.html" ? manifest.entry : "index.html";
  const entryPath = resolve(artifactRoot, entry);
  const htmlStat = await lstat(entryPath).catch(() => null);
  if (!htmlStat?.isFile()) {
    report(`${entry}: 缺少 HTML 入口`);
    return { html: null, scriptPath: null };
  }
  const html = await readFile(entryPath, "utf8");

  const csp = parseCSP(html);
  if (!csp) {
    report(`${entry}: 缺少 Content-Security-Policy`);
  } else {
    requireCSP(csp, "default-src", ["'none'"]);
    requireCSP(csp, "script-src", ["'self'"]);
    requireCSP(csp, "style-src", ["'self'", "'unsafe-inline'"]);
    requireCSP(csp, "img-src", ["'self'", "data:", "blob:", "goose-note-resource:"]);
    requireCSP(csp, "font-src", ["'self'", "data:"]);
    requireCSP(csp, "media-src", ["data:", "blob:", "goose-note-resource:"]);
    const connectValues = csp.get("connect-src");
    const allowedConnect = ["'none'", "data:", "blob:", "goose-note-resource:"];
    if (!connectValues?.length) {
      report(`${entry}: CSP connect-src 缺失`);
    } else {
      for (const value of connectValues) {
        if (!allowedConnect.includes(value)) report(`${entry}: CSP connect-src 禁止 ${value}`);
      }
      if (connectValues.includes("'none'") && connectValues.length !== 1) {
        report(`${entry}: CSP connect-src 的 'none' 不能与其他来源并用`);
      }
    }
    for (const directive of ["object-src", "frame-src", "base-uri", "form-action"]) {
      requireCSP(csp, directive, ["'none'"]);
    }
  }

  if (/<link\b[^>]*\brel\s*=\s*["'][^"']*(?:modulepreload|preload|prefetch|prerender)[^"']*["']/i.test(html)) {
    report(`${entry}: 禁止 preload、modulepreload、prefetch 或 prerender`);
  }
  if (/\son[a-z]+\s*=/i.test(html)) {
    report(`${entry}: 禁止内联事件处理器`);
  }

  const scripts = html.match(/<script\b[^>]*>/gi) ?? [];
  if (scripts.length !== 1) {
    report(`${entry}: 必须且只能加载一个 classic 本地脚本，当前为 ${scripts.length} 个`);
  }
  let scriptPath = null;
  for (const script of scripts) {
    const source = parseAttribute(script, "src");
    if (!source) {
      report(`${entry}: 禁止内联脚本，script 必须提供 src`);
      continue;
    }
    const type = parseAttribute(script, "type")?.toLowerCase();
    if (type && !["text/javascript", "application/javascript"].includes(type)) {
      report(`${entry}: 脚本必须是 classic script，禁止 type=${JSON.stringify(type)}`);
    }
    if (!/\bdefer(?:\s|=|>)/i.test(`${script}>`)) {
      report(`${entry}: classic 脚本必须使用 defer`);
    }
    const absolute = resolveLocalReference(entryPath, source, "脚本");
    if (!absolute) continue;
    const scriptStat = await lstat(absolute).catch(() => null);
    if (!scriptStat?.isFile()) {
      report(`${entry}: 脚本不存在：${source}`);
    } else if (extname(absolute).toLowerCase() !== ".js") {
      report(`${entry}: 脚本入口必须是 .js 文件：${source}`);
    } else {
      scriptPath = absolute;
    }
  }

  for (const link of html.match(/<link\b[^>]*>/gi) ?? []) {
    const relation = (parseAttribute(link, "rel") ?? "").toLowerCase();
    const reference = parseAttribute(link, "href");
    if (relation !== "stylesheet") {
      report(`${entry}: 只允许本地 stylesheet link，当前 rel=${JSON.stringify(relation)}`);
      continue;
    }
    if (!reference) {
      report(`${entry}: stylesheet link 缺少 href`);
      continue;
    }
    const absolute = resolveLocalReference(entryPath, reference, "样式表");
    const styleStat = absolute ? await lstat(absolute).catch(() => null) : null;
    if (absolute && !styleStat?.isFile()) report(`${entry}: 样式表不存在：${reference}`);
  }

  return { html, scriptPath };
}

function packageNameForModule(moduleID) {
  if (moduleID.startsWith("package:")) return moduleID.slice("package:".length);
  if (!moduleID.includes("node_modules/")) return null;
  const packagePath = moduleID.split("/node_modules/").at(-1);
  if (!packagePath || packagePath.startsWith(".pnpm/")) return null;
  const segments = packagePath.split("/");
  return segments[0]?.startsWith("@")
    ? segments.slice(0, 2).join("/")
    : segments[0];
}

async function auditInputs() {
  const inputs = await readJSON(inputsName);
  if (!isPlainObject(inputs)) {
    if (inputs !== null) report(`${inputsName}: 根节点必须是对象`);
    return;
  }
  requireEqual(inputs, "target", "native-editor", inputsName);
  if (!Array.isArray(inputs.modules) || inputs.modules.length === 0) {
    report(`${inputsName}: modules 必须是非空数组`);
    return;
  }
  if (inputs.modules.some((moduleID) => typeof moduleID !== "string" || !moduleID)) {
    report(`${inputsName}: modules 只能包含非空字符串`);
    return;
  }

  const sortedModules = [...inputs.modules].sort();
  if (JSON.stringify(inputs.modules) !== JSON.stringify(sortedModules)) {
    report(`${inputsName}: modules 必须按字典序排序`);
  }
  if (new Set(inputs.modules).size !== inputs.modules.length) {
    report(`${inputsName}: modules 不能包含重复项`);
  }

  for (const moduleID of inputs.modules) {
    if (moduleID.includes("\\") || moduleID.startsWith("/") || moduleID.split("/").includes("..")) {
      report(`${inputsName}: 模块路径必须是规范的产物相对标识：${moduleID}`);
      continue;
    }
    const packageName = packageNameForModule(moduleID);
    if (packageName) {
      for (const [label, pattern] of forbiddenPackages) {
        if (pattern.test(packageName)) report(`${inputsName}: 禁止${label}依赖 ${packageName}`);
      }
      continue;
    }
    if (!moduleID.startsWith("src/")) continue;
    for (const [label, pattern] of forbiddenSourceModules) {
      if (pattern.test(moduleID)) report(`${inputsName}: ${moduleID} 越界到${label}`);
    }
  }
}

async function auditArtifactFiles(files, scriptPath) {
  const scriptRelative = scriptPath ? toPosixPath(relative(artifactRoot, scriptPath)) : null;
  let scriptFileCount = 0;

  for (const file of files) {
    const artifactPath = toPosixPath(relative(artifactRoot, file));
    const lowerPath = artifactPath.toLowerCase();
    const extension = extname(lowerPath);

    if (extension === ".map") report(`${artifactPath}: 生产产物禁止 sourcemap`);
    if (/(?:^|\/)(?:plugin(?:\.json|[-_.\/])|preload(?:[-_.\/]|$)|quick[\s_-]?note|utools|service[-_.]?worker|sw\.js)/i.test(lowerPath)) {
      report(`${artifactPath}: 文件名越过 native-editor 边界`);
    }

    const isRootContractFile = ["index.html", manifestName, inputsName].includes(artifactPath);
    const isAsset = artifactPath.startsWith("assets/") && allowedArtifactExtensions.has(extension);
    const isFont = artifactPath.startsWith("fonts/") && allowedFontExtensions.has(extension);
    if (!isRootContractFile && !isAsset && !isFont) {
      report(`${artifactPath}: 不是 native-editor 允许的产物文件`);
    }

    if (extension === ".js") {
      scriptFileCount += 1;
      if (scriptRelative && artifactPath !== scriptRelative) {
        report(`${artifactPath}: 单脚本产物包含入口未引用的额外 JavaScript`);
      }
    }

    if (!textArtifactExtensions.has(extension) || artifactPath === manifestName || artifactPath === inputsName) {
      continue;
    }
    const content = await readFile(file, "utf8");
    for (const [label, pattern] of targetedRuntimeChecks) {
      if (pattern.test(content)) report(`${artifactPath}: 包含${label}`);
    }
    if (extension === ".css" && /(?:@import\s+(?:url\()?|url\()["']?\s*(?:https?:|\/\/)/i.test(content)) {
      report(`${artifactPath}: CSS 包含远程资源请求`);
    }
  }

  if (scriptFileCount !== 1) {
    report(`产物必须且只能包含一个 JavaScript 文件，当前为 ${scriptFileCount} 个`);
  }
}

async function main() {
  const rootStat = await lstat(artifactRoot).catch(() => null);
  if (!rootStat?.isDirectory() || rootStat.isSymbolicLink()) {
    throw new Error(`找不到有效的 native-editor 产物目录：${artifactRoot}`);
  }

  const files = await collectFiles(artifactRoot);
  const manifest = await auditManifest(files);
  const { scriptPath } = await auditHTML(manifest);
  await auditInputs();
  await auditArtifactFiles(files, scriptPath);

  if (violations.length > 0) {
    const uniqueViolations = [...new Set(violations)];
    console.error(`native-editor 产物审计失败（${uniqueViolations.length} 项）：`);
    for (const violation of uniqueViolations) console.error(`- ${violation}`);
    process.exitCode = 1;
    return;
  }

  console.log(`native-editor 产物审计通过：${artifactRoot}（${manifest.contentHash}）`);
}

main().catch((error) => {
  console.error(`native-editor 产物审计失败：${error.message}`);
  process.exitCode = 1;
});
