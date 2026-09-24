/**
 * 会话级文件变更差异全页（ADR 0010 / DESIGN）。
 * 宽：左文件列表 + 右 @pierre/diffs FileDiff；窄：上文件芯片条 + 下 diff。
 * 支持单文件「还原」（按 before 快照写回 / create 则删文件）。
 *
 * pierre worker：React FileDiff 支持 disableWorkerPool。
 * 一期直接 client 主线程高亮（disableWorkerPool），避免 Vite/uTools
 * 对 worker 入口的额外配置；库内部会 import web-components 注册
 * <diffs-container> 并注入 Shadow DOM 样式。
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from "react";
import { ArrowLeft, Columns2, RotateCcw, Rows3 } from "lucide-react";
import { parseDiffFromFile } from "@pierre/diffs";
import { FileDiff } from "@pierre/diffs/react";
import type { FileContents, FileDiffMetadata } from "@pierre/diffs";
import { toast } from "@/lib/toast";
import { useAgentChats } from "@/stores/useAgentChats";
import {
  useFileChanges,
  type FileChange,
  type FileChangeKind,
} from "@/stores/useFileChanges";
import {
  canRestoreFileChange,
  getRestoreBlockReason,
  getRestoreConfirmCopy,
  pathBasename,
  pathDirname,
  restoreFileChange,
  toWorkspaceRelativePath,
} from "@/lib/file-changes";
import { Button, Modal, useOverlayState } from "@/lib/heroui";
import { cn } from "@/lib/utils";
import { useWorkspaces } from "@/stores/useWorkspaces";

export interface ChangesPageProps {
  conversationId: string | null;
  onBack: () => void;
  /** 打开时定位的文件 path */
  initialPath?: string | null;
}

type DiffStyle = "unified" | "split";

const KIND_LABEL: Record<FileChangeKind, string> = {
  create: "新建",
  modify: "修改",
  delete: "删除",
  rename: "重命名",
};

/** uTools 插件窗常见窄宽；< 640 改用上下布局 */
const NARROW_MAX_PX = 640;

function useIsNarrow(maxPx: number = NARROW_MAX_PX): boolean {
  const [narrow, setNarrow] = useState(() =>
    typeof window !== "undefined" ? window.innerWidth < maxPx : false,
  );

  useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${maxPx - 1}px)`);
    const sync = () => setNarrow(mql.matches);
    sync();
    mql.addEventListener("change", sync);
    return () => mql.removeEventListener("change", sync);
  }, [maxPx]);

  return narrow;
}

function useIsDocumentDark(): boolean {
  const [dark, setDark] = useState(() =>
    typeof document !== "undefined"
      ? document.documentElement.classList.contains("dark")
      : false,
  );

  useEffect(() => {
    const root = document.documentElement;
    const sync = () => setDark(root.classList.contains("dark"));
    sync();
    const obs = new MutationObserver(sync);
    obs.observe(root, { attributes: true, attributeFilter: ["class"] });
    return () => obs.disconnect();
  }, []);

  return dark;
}

/** 扩展名 → pierre/shiki 语言 id；未知不设，交由库推断。 */
function langFromPath(path: string): FileContents["lang"] | undefined {
  const base = pathBasename(path).toLowerCase();
  const dot = base.lastIndexOf(".");
  const ext = dot >= 0 ? base.slice(dot + 1) : "";
  switch (ext) {
    case "ts":
      return "typescript";
    case "tsx":
      return "tsx";
    case "js":
    case "mjs":
    case "cjs":
      return "javascript";
    case "jsx":
      return "jsx";
    case "css":
      return "css";
    case "scss":
      return "scss";
    case "less":
      return "less";
    case "json":
    case "jsonc":
      return "json";
    case "md":
    case "mdx":
      return "markdown";
    case "html":
    case "htm":
      return "html";
    case "vue":
      return "vue";
    case "svelte":
      return "svelte";
    case "py":
      return "python";
    case "rs":
      return "rust";
    case "go":
      return "go";
    case "java":
      return "java";
    case "kt":
      return "kotlin";
    case "rb":
      return "ruby";
    case "php":
      return "php";
    case "sh":
    case "bash":
    case "zsh":
      return "bash";
    case "yml":
    case "yaml":
      return "yaml";
    case "toml":
      return "toml";
    case "xml":
    case "svg":
      return "xml";
    case "sql":
      return "sql";
    default:
      return undefined;
  }
}

/**
 * pierre FileContents.name：相对工作区路径；无法相对化时用 basename（保留扩展名）。
 * 勿传入绝对路径，否则头栏会露出全路径。
 */
function pierreDisplayName(
  path: string,
  workspaceRoot: string | null,
): string {
  const rel = toWorkspaceRelativePath(path, workspaceRoot);
  if (!rel || rel === ".") return pathBasename(path);
  // 仍是绝对路径（root 不匹配）→ basename，保留扩展名供语言推断
  if (rel.startsWith("/") || /^[A-Za-z]:\//.test(rel)) {
    return pathBasename(rel);
  }
  return rel;
}

function toFileContents(
  displayName: string,
  contents: string | null,
): FileContents | null {
  if (contents == null) return null;
  const lang = langFromPath(displayName);
  return lang
    ? { name: displayName, contents, lang }
    : { name: displayName, contents };
}

function buildFileDiff(
  change: FileChange,
  workspaceRoot: string | null,
): FileDiffMetadata | null {
  if (change.binary) return null;
  const name = pierreDisplayName(change.path, workspaceRoot);
  const oldName = pierreDisplayName(
    change.fromPath ?? change.path,
    workspaceRoot,
  );
  const oldFile = toFileContents(oldName, change.before);
  const newFile = toFileContents(name, change.after);
  if (oldFile == null && newFile == null) return null;
  try {
    return parseDiffFromFile(oldFile, newFile);
  } catch {
    return null;
  }
}

/**
 * uTools 旧内核不支持 light-dark / color-mix / rgb(from)。
 * pierre 默认链依赖这些函数时：增删行背景、主色、以及 Shiki token 着色
 *（[data-line] span 的 light-dark(var(--diffs-token-light), …)）都会失效。
 * 同时设 *-override 与 --diffs-bg/--diffs-fg，并对增删行直接写
 * --diffs-computed-diff-line-bg / --diffs-line-bg 为 hex 实色；
 * token 用主题对应的 --diffs-token-light/dark 实色覆盖；字体走 --diffs-font-family。
 */
/** 全部展开：双箭头图标（与单箭头「部分展开」区分） */
const PIERRE_EXPAND_ALL_ICON_MASK =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16' fill='black'%3E%3Cpath d='M11.47 9.47a.75.75 0 1 1 1.06 1.06l-4 4a.75.75 0 0 1-1.06 0l-4-4a.75.75 0 1 1 1.06-1.06L8 12.94zM7.526 1.418a.75.75 0 0 1 1.004.052l4 4a.75.75 0 1 1-1.06 1.06L8 3.06 4.53 6.53a.75.75 0 1 1-1.06-1.06l4-4z'/%3E%3C/svg%3E\")";

/**
 * 折叠/展开条：一体灰底 + flex 横排图标（部分 / 全部）+ 中文标签由 JS 注入。
 * unified 下 wrapper 在 gutter，须 100cqi 拉满；勿用 width:100%（会裁成「pand all」）。
 */
function pierreExpandBarCSS(separator: string, separatorEdge: string, mutedFg: string, fg: string): string {
  return `
[data-separator],
[data-separator="line-info"],
[data-separator="line-info-basic"],
[data-separator="metadata"],
[data-separator="simple"] {
  background-color: ${separator};
}
/* 强制横排 flex，覆盖库 multi-button 的 3 列 grid / 50% 叠层，避免 Expand all 掉到条外 */
[data-expand-index] [data-separator-wrapper],
[data-expand-index] [data-separator-wrapper][data-separator-multi-button] {
  display: flex !important;
  flex-direction: row !important;
  flex-wrap: nowrap !important;
  align-items: stretch !important;
  grid-template-columns: none !important;
  grid-template-rows: none !important;
  background-color: ${separator};
  z-index: 4;
  box-sizing: border-box;
  gap: 0;
}
[data-separator-wrapper] {
  background-color: ${separator};
  z-index: 4;
}
[data-separator="metadata"] [data-separator-wrapper] {
  background-color: ${separator};
}
[data-expand-button],
[data-separator-content] {
  background-color: ${separator};
}
/* 部分展开：单箭头；order 把「全部」图标插到标签前：[部分…][全部][文案] */
[data-expand-button] {
  display: flex !important;
  flex: 0 0 28px;
  width: 28px;
  min-width: 28px;
  max-width: 28px;
  padding: 0;
  border-right: 1px solid ${separatorEdge};
  color: ${mutedFg};
  justify-content: center;
  align-items: center;
  align-self: stretch;
  cursor: pointer;
  box-sizing: border-box;
  order: 1;
}
[data-expand-button]:hover {
  color: ${fg};
  background-color: ${separatorEdge};
}
[data-expand-button] [data-icon] {
  width: 14px;
  height: 14px;
}
/* 全部展开：双箭头图标（隐藏英文 Expand all 文本） */
[data-expand-button][data-expand-all-button] {
  display: flex !important;
  flex: 0 0 28px;
  width: 28px;
  min-width: 28px;
  max-width: 28px;
  padding: 0;
  border-right: 1px solid ${separatorEdge};
  font-size: 0 !important;
  line-height: 0 !important;
  color: ${mutedFg};
  position: relative;
  overflow: hidden;
  order: 2;
}
[data-expand-button][data-expand-all-button]::before {
  content: "";
  display: block;
  width: 14px;
  height: 14px;
  background-color: currentColor;
  -webkit-mask-image: ${PIERRE_EXPAND_ALL_ICON_MASK};
  mask-image: ${PIERRE_EXPAND_ALL_ICON_MASK};
  -webkit-mask-size: contain;
  mask-size: contain;
  -webkit-mask-repeat: no-repeat;
  mask-repeat: no-repeat;
  -webkit-mask-position: center;
  mask-position: center;
}
[data-expand-button][data-expand-all-button]:hover {
  color: ${fg};
  background-color: ${separatorEdge};
}
[data-expand-index] [data-separator-content]:hover {
  text-decoration: none;
  background-color: ${separatorEdge};
  cursor: pointer;
}
[data-overflow="scroll"] [data-gutter] {
  background-color: var(--diffs-bg);
}
[data-gutter] [data-separator="line-info"],
[data-gutter] [data-separator="line-info-basic"] {
  background-color: ${separator};
  border-right: none;
}
@supports (width: 1cqi) {
  [data-unified] [data-separator="line-info"] [data-separator-wrapper],
  [data-unified] [data-separator="line-info"] [data-separator-wrapper][data-separator-multi-button] {
    padding-inline: 0 !important;
    width: 100cqi !important;
    max-width: 100cqi !important;
    background-color: ${separator};
  }
  [data-unified] [data-separator="line-info"] [data-separator-wrapper] [data-separator-content] {
    border-radius: 0 !important;
  }
  [data-gutter] [data-separator="line-info"] [data-separator-wrapper] {
    padding-left: 0 !important;
    background-color: ${separator};
  }
  [data-overflow="scroll"] [data-additions] [data-gutter] [data-separator="line-info"] [data-separator-wrapper] {
    width: 100cqi !important;
    background-color: ${separator};
  }
}
@supports not (width: 1cqi) {
  [data-unified] [data-separator="line-info"] [data-separator-wrapper] {
    min-width: min(100%, 48rem);
    width: max-content;
    background-color: ${separator};
  }
}
[data-separator="line-info"],
[data-separator="line-info-basic"],
[data-separator="metadata"] {
  height: 28px;
}
[data-separator-content] {
  flex: 1 1 auto !important;
  min-width: 0 !important;
  height: 100%;
  color: ${mutedFg};
  font-size: 11.5px;
  letter-spacing: 0.01em;
  overflow: hidden;
  justify-content: flex-start;
  align-items: center;
  padding: 0 10px !important;
  border-radius: 0 !important;
  grid-area: auto !important;
  order: 3;
}
[data-unmodified-lines] {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
}
/* 覆盖 pointer:fine 下 multi-button 上下对半布局 */
@media (pointer: fine) {
  [data-separator-wrapper][data-separator-multi-button] {
    display: flex !important;
    grid-template-rows: none !important;
    grid-template-columns: none !important;
  }
  [data-separator-wrapper][data-separator-multi-button] [data-separator-content] {
    grid-area: auto !important;
  }
}
`.trim();
}

const UNMODIFIED_LINES_RE = /(\d+)\s*unmodified lines?/i;
const GA_LOCALIZED_ATTR = "data-ga-i18n";

/**
 * 把 Pierre 英文展开文案改成中文，并为部分/全部展开补齐 title。
 * 已处理节点打 data-ga-i18n，避免重复写 DOM（防止 MutationObserver 死循环卡死）。
 */
function localizePierreExpandChrome(root: ParentNode): void {
  root.querySelectorAll<HTMLElement>("[data-unmodified-lines]").forEach((el) => {
    if (el.getAttribute(GA_LOCALIZED_ATTR) === "1") return;
    const raw = el.textContent?.trim() ?? "";
    const m = raw.match(UNMODIFIED_LINES_RE);
    if (!m) {
      if (/行未修改/.test(raw)) el.setAttribute(GA_LOCALIZED_ATTR, "1");
      return;
    }
    el.textContent = `${m[1]} 行未修改`;
    el.setAttribute(GA_LOCALIZED_ATTR, "1");
  });

  root.querySelectorAll<HTMLElement>("[data-expand-all-button]").forEach((el) => {
    if (el.getAttribute(GA_LOCALIZED_ATTR) === "1") return;
    el.setAttribute("title", "全部展开");
    el.setAttribute("aria-label", "全部展开");
    // 清空英文文本，仅保留 CSS ::before 图标
    if (el.childNodes.length > 0) el.textContent = "";
    el.setAttribute(GA_LOCALIZED_ATTR, "1");
  });

  const titlePairs: Array<[string, string]> = [
    ["[data-expand-up]", "向上展开"],
    ["[data-expand-down]", "向下展开"],
    ["[data-expand-both]", "展开"],
  ];
  for (const [sel, label] of titlePairs) {
    root.querySelectorAll<HTMLElement>(sel).forEach((el) => {
      if (el.getAttribute(GA_LOCALIZED_ATTR) === "1") return;
      // expand-all 已单独处理
      if (el.hasAttribute("data-expand-all-button")) return;
      el.setAttribute("title", label);
      el.setAttribute("aria-label", label);
      el.setAttribute(GA_LOCALIZED_ATTR, "1");
    });
  }
}

/**
 * 安全观察：仅 childList、防重入、rAF 合并、不监听 characterData/attributes，
 * 避免「改文案 → 再触发 observer」把主线程打满、界面假死且无报错。
 */
function observePierreExpandChrome(host: Element): () => void {
  let cancelled = false;
  let scheduled = false;
  let patching = false;
  let shadowObserved = false;

  const run = () => {
    if (cancelled || patching) return;
    patching = true;
    try {
      const shadow = host.shadowRoot;
      if (shadow) localizePierreExpandChrome(shadow);
      localizePierreExpandChrome(host);
    } finally {
      patching = false;
    }
  };

  const schedule = () => {
    if (cancelled || scheduled || patching) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      if (!cancelled) run();
    });
  };

  const observers: MutationObserver[] = [];
  const observe = (target: Node) => {
    const mo = new MutationObserver((records) => {
      if (patching) return;
      // 忽略我们自己打的 data-ga-i18n / title 等属性变更（未订阅 attributes 也双保险）
      const meaningful = records.some(
        (r) => r.type === "childList" && (r.addedNodes.length > 0 || r.removedNodes.length > 0),
      );
      if (meaningful) schedule();
    });
    mo.observe(target, { childList: true, subtree: true });
    observers.push(mo);
  };

  observe(host);
  if (host.shadowRoot) {
    observe(host.shadowRoot);
    shadowObserved = true;
  }

  // 首帧与短暂重试：等 shadow 挂上 / 首屏渲染完
  schedule();
  const retryTicks = [80, 200, 500, 1200];
  const timers = retryTicks.map((ms) =>
    window.setTimeout(() => {
      if (cancelled) return;
      if (!shadowObserved && host.shadowRoot) {
        observe(host.shadowRoot);
        shadowObserved = true;
      }
      schedule();
    }, ms),
  );

  return () => {
    cancelled = true;
    timers.forEach((id) => window.clearTimeout(id));
    observers.forEach((o) => o.disconnect());
  };
}

function buildPierreUnsafeCSS(themeType: "light" | "dark"): string {
  if (themeType === "dark") {
    const bg = "#1e1e1e";
    const fg = "#e8e8e8";
    const addition = "#1a3d2b";
    const deletion = "#4a2024";
    const additionEm = "#2d6a45";
    const deletionEm = "#7a3038";
    const additionHover = "#234d35";
    const deletionHover = "#5c2830";
    const context = "#252526";
    const separator = "#2a2b2d";
    const separatorEdge = "#353638";
    const number = "#8a8a8a";
    return `
:host {
  display: block;
  width: 100%;
  box-sizing: border-box;
  font-size: 12.5px;
  --diffs-line-height: 20px;
  --diffs-font-family: var(--font-mono);
  border-radius: 0;
  --diffs-dark-bg: ${bg};
  --diffs-dark: ${fg};
  --diffs-bg: ${bg};
  --diffs-fg: ${fg};
  --diffs-bg-addition-override: ${addition};
  --diffs-bg-deletion-override: ${deletion};
  --diffs-bg-addition-emphasis-override: ${additionEm};
  --diffs-bg-deletion-emphasis-override: ${deletionEm};
  --diffs-bg-addition-number-override: ${addition};
  --diffs-bg-deletion-number-override: ${deletion};
  --diffs-fg-number-override: ${number};
  --diffs-bg-context-override: ${context};
  --diffs-bg-context-gutter-override: ${context};
  --diffs-bg-buffer-override: ${bg};
  --diffs-bg-separator-override: ${separator};
  --diffs-addition-color-override: #5ecc71;
  --diffs-deletion-color-override: #ff6762;
}
[data-line] span {
  color: var(--diffs-token-dark, var(--diffs-dark, ${fg}));
  background-color: var(--diffs-token-dark-bg, inherit);
  font-weight: var(--diffs-token-dark-font-weight, inherit);
  font-style: var(--diffs-token-dark-font-style, inherit);
  text-decoration: var(--diffs-token-dark-text-decoration, inherit);
}
[data-line-type="change-addition"],
[data-column-number][data-line-type="change-addition"],
[data-gutter-buffer][data-line-type="change-addition"] {
  --diffs-computed-diff-line-bg: ${addition};
  --diffs-line-bg: ${addition};
  --diffs-computed-selected-line-bg: ${addition};
  --diffs-computed-hovered-line-bg: ${additionHover};
  --diffs-computed-editor-active-line-bg: ${addition};
}
[data-line-type="change-deletion"],
[data-column-number][data-line-type="change-deletion"],
[data-gutter-buffer][data-line-type="change-deletion"] {
  --diffs-computed-diff-line-bg: ${deletion};
  --diffs-line-bg: ${deletion};
  --diffs-computed-selected-line-bg: ${deletion};
  --diffs-computed-hovered-line-bg: ${deletionHover};
  --diffs-computed-editor-active-line-bg: ${deletion};
}
[data-line-type="change-addition"] [data-diff-span] {
  background-color: ${additionEm};
}
[data-line-type="change-deletion"] [data-diff-span] {
  background-color: ${deletionEm};
}
${pierreExpandBarCSS(separator, separatorEdge, number, fg)}
`.trim();
  }

  const bg = "#ffffff";
  const fg = "#171717";
  const addition = "#e6f7ed";
  const deletion = "#fdebec";
  const additionEm = "#b7ebc9";
  const deletionEm = "#f8b4b4";
  const additionHover = "#d4f0e0";
  const deletionHover = "#fad5d8";
  const context = "#f6f6f6";
  /* 与 surface-hover 接近的一体灰，避免 wrapper 白 + content 灰拼缝 */
  const separator = "#ebebeb";
  const separatorEdge = "#e0e0e0";
  const number = "#6b6b6b";
  return `
:host {
  display: block;
  width: 100%;
  box-sizing: border-box;
  font-size: 12.5px;
  --diffs-line-height: 20px;
  --diffs-font-family: var(--font-mono);
  border-radius: 0;
  --diffs-light-bg: ${bg};
  --diffs-light: ${fg};
  --diffs-bg: ${bg};
  --diffs-fg: ${fg};
  --diffs-bg-addition-override: ${addition};
  --diffs-bg-deletion-override: ${deletion};
  --diffs-bg-addition-emphasis-override: ${additionEm};
  --diffs-bg-deletion-emphasis-override: ${deletionEm};
  --diffs-bg-addition-number-override: ${addition};
  --diffs-bg-deletion-number-override: ${deletion};
  --diffs-fg-number-override: ${number};
  --diffs-bg-context-override: ${context};
  --diffs-bg-context-gutter-override: ${context};
  --diffs-bg-buffer-override: ${bg};
  --diffs-bg-separator-override: ${separator};
  --diffs-addition-color-override: #0dbe4e;
  --diffs-deletion-color-override: #ff2e3f;
}
[data-line] span {
  color: var(--diffs-token-light, var(--diffs-light, ${fg}));
  background-color: var(--diffs-token-light-bg, inherit);
  font-weight: var(--diffs-token-light-font-weight, inherit);
  font-style: var(--diffs-token-light-font-style, inherit);
  text-decoration: var(--diffs-token-light-text-decoration, inherit);
}
[data-line-type="change-addition"],
[data-column-number][data-line-type="change-addition"],
[data-gutter-buffer][data-line-type="change-addition"] {
  --diffs-computed-diff-line-bg: ${addition};
  --diffs-line-bg: ${addition};
  --diffs-computed-selected-line-bg: ${addition};
  --diffs-computed-hovered-line-bg: ${additionHover};
  --diffs-computed-editor-active-line-bg: ${addition};
}
[data-line-type="change-deletion"],
[data-column-number][data-line-type="change-deletion"],
[data-gutter-buffer][data-line-type="change-deletion"] {
  --diffs-computed-diff-line-bg: ${deletion};
  --diffs-line-bg: ${deletion};
  --diffs-computed-selected-line-bg: ${deletion};
  --diffs-computed-hovered-line-bg: ${deletionHover};
  --diffs-computed-editor-active-line-bg: ${deletion};
}
[data-line-type="change-addition"] [data-diff-span] {
  background-color: ${additionEm};
}
[data-line-type="change-deletion"] [data-diff-span] {
  background-color: ${deletionEm};
}
${pierreExpandBarCSS(separator, separatorEdge, number, fg)}
`.trim();
}

/**
 * 粗算 +/- 行数：按行 multiset 差，不必完美 diffstat。
 * binary / 无文本时返回 null。
 */
function roughDiffstat(
  change: FileChange,
): { plus: number; minus: number } | null {
  if (change.binary) return null;
  if (change.before == null && change.after == null) return null;

  if (change.kind === "create") {
    const plus =
      change.after == null || change.after === ""
        ? 0
        : change.after.split("\n").length;
    return { plus, minus: 0 };
  }
  if (change.kind === "delete") {
    const minus =
      change.before == null || change.before === ""
        ? 0
        : change.before.split("\n").length;
    return { plus: 0, minus };
  }

  const bLines = change.before == null ? [] : change.before.split("\n");
  const aLines = change.after == null ? [] : change.after.split("\n");
  const bCounts = new Map<string, number>();
  for (const line of bLines) {
    bCounts.set(line, (bCounts.get(line) ?? 0) + 1);
  }
  let plus = 0;
  let minus = 0;
  const aCounts = new Map<string, number>();
  for (const line of aLines) {
    aCounts.set(line, (aCounts.get(line) ?? 0) + 1);
  }
  const keys = new Set<string>([...bCounts.keys(), ...aCounts.keys()]);
  for (const key of keys) {
    const bc = bCounts.get(key) ?? 0;
    const ac = aCounts.get(key) ?? 0;
    if (ac > bc) plus += ac - bc;
    if (bc > ac) minus += bc - ac;
  }
  return { plus, minus };
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  if (target.isContentEditable) return true;
  return Boolean(target.closest("[contenteditable='true']"));
}

/**
 * 变更独立全页：顶栏返回 +「变更」；宽屏左列表右 diff，窄屏上芯片下 diff。
 */
export function ChangesPage({
  conversationId: conversationIdProp,
  onBack,
  initialPath,
}: ChangesPageProps) {
  const activeId = useAgentChats((s) => s.activeConversationId);
  const conversationId = conversationIdProp ?? activeId;

  const byConversation = useFileChanges((s) => s.byConversation);
  const focusPath = useFileChanges((s) => s.focusPath);
  const setFocusPath = useFileChanges((s) => s.setFocusPath);

  const changes = useMemo(() => {
    if (!conversationId) return [];
    return byConversation[conversationId] ?? [];
  }, [byConversation, conversationId]);

  const [diffStyle, setDiffStyle] = useState<DiffStyle>("unified");
  const [restoring, setRestoring] = useState(false);
  const restoreModal = useOverlayState();
  const isDark = useIsDocumentDark();
  const isNarrow = useIsNarrow();
  const themeType = isDark ? "dark" : "light";
  /** 展示用相对路径根；订阅 active 工作区变化 */
  const workspaceRoot = useWorkspaces((s) => {
    if (!s.activeId) return null;
    const active = s.workspaces.find((w) => w.id === s.activeId);
    const path = active?.path?.trim();
    return path || null;
  });

  /**
   * 打开意图 path：组件随 view 挂载，首次有列表时用 openedPath 定位。
   * App 会把 focusPath 回传为 initialPath，故 miss 提示不能依赖后续 initialPath。
   */
  const [pathMissHint, setPathMissHint] = useState<string | null>(null);
  const openedPathRef = useRef(initialPath ?? null);
  const focusResolvedRef = useRef(false);

  // 选中同步：打开 path 优先；否则保留合法 focus；否则首项。仅 path 变化时写 store。
  useEffect(() => {
    if (changes.length === 0) return;

    const paths = new Set(changes.map((c) => c.path));

    if (!focusResolvedRef.current) {
      focusResolvedRef.current = true;
      const want = openedPathRef.current;
      if (want && paths.has(want)) {
        if (focusPath !== want) setFocusPath(want);
        return;
      }
      if (want) setPathMissHint(pathBasename(want));
      const first = changes[0]!.path;
      if (focusPath !== first) setFocusPath(first);
      return;
    }

    // 列表更新后若当前 focus 已不在列表，落到首项
    if (focusPath && paths.has(focusPath)) return;
    const first = changes[0]!.path;
    if (focusPath !== first) setFocusPath(first);
  }, [changes, focusPath, setFocusPath]);

  const selected =
    changes.find((c) => c.path === focusPath) ?? changes[0] ?? null;

  const selectedIndex = useMemo(() => {
    if (!selected) return -1;
    return changes.findIndex((c) => c.id === selected.id);
  }, [changes, selected]);

  const fileDiff = useMemo(
    () => (selected ? buildFileDiff(selected, workspaceRoot) : null),
    [selected, workspaceRoot],
  );

  const restoreBlockedReason = selected
    ? getRestoreBlockReason(selected)
    : "未选择文件";
  const canRestore = selected ? canRestoreFileChange(selected) : false;
  const restoreCopy = selected ? getRestoreConfirmCopy(selected) : null;

  const selectByIndex = useCallback(
    (index: number) => {
      const next = changes[index];
      if (next) setFocusPath(next.path);
    },
    [changes, setFocusPath],
  );

  const openRestoreConfirm = useCallback(() => {
    if (!selected || !canRestoreFileChange(selected) || restoring) return;
    restoreModal.open();
  }, [selected, restoring, restoreModal.open]);

  const confirmRestore = useCallback(async () => {
    if (!selected || restoring) return;
    if (!canRestoreFileChange(selected)) return;
    setRestoring(true);
    try {
      const result = await restoreFileChange(selected);
      if (result.ok) {
        toast.success("已还原");
        restoreModal.close();
      } else {
        toast.error(result.error || "还原失败");
      }
    } catch {
      toast.error("还原失败");
    } finally {
      setRestoring(false);
    }
  }, [selected, restoring, restoreModal.open, restoreModal.close]);

  // Escape 返回；↑↓ 切换文件（本页全屏，不与工作台停流 Escape 冲突）
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (isEditableTarget(e.target)) return;

      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onBack();
        return;
      }

      if (changes.length === 0) return;

      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const cur = selectedIndex >= 0 ? selectedIndex : 0;
        if (e.key === "ArrowDown") {
          selectByIndex(Math.min(cur + 1, changes.length - 1));
        } else {
          selectByIndex(Math.max(cur - 1, 0));
        }
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onBack, changes.length, selectedIndex, selectByIndex]);

  const fileCount = changes.length;

  return (
    <div className="flex h-full min-h-0 w-full flex-col bg-bg text-fg">
      <header className="flex shrink-0 items-center gap-2 px-3 py-2.5">
        <button
          type="button"
          onClick={onBack}
          className="icon-control inline-flex size-8 items-center justify-center rounded-md text-fg-muted"
          title="返回（Esc）"
          aria-label="返回工作台"
        >
          <ArrowLeft size={18} strokeWidth={1.75} />
        </button>
        <div className="min-w-0 flex-1">
          <h1 className="text-[14px] font-semibold leading-tight text-fg">
            变更
          </h1>
          <p className="text-[11.5px] leading-tight text-fg-faint">
            {fileCount > 0
              ? `本会话 ${fileCount} 个文件`
              : "本会话 Agent 落盘回顾"}
          </p>
        </div>

        <div
          className="inline-flex shrink-0 items-center rounded-lg bg-surface-hover p-0.5"
          role="group"
          aria-label="差异布局"
        >
          <button
            type="button"
            onClick={() => setDiffStyle("unified")}
            className={cn(
              "inline-flex h-7 items-center gap-1 rounded-md px-2 text-[11.5px] font-medium transition-colors",
              diffStyle === "unified"
                ? "bg-surface text-fg shadow-sm"
                : "text-fg-muted hover:text-fg",
            )}
            aria-pressed={diffStyle === "unified"}
            title="统一视图"
          >
            <Rows3 size={14} strokeWidth={1.75} />
            <span className={cn(isNarrow && "sr-only")}>统一</span>
          </button>
          <button
            type="button"
            onClick={() => setDiffStyle("split")}
            className={cn(
              "inline-flex h-7 items-center gap-1 rounded-md px-2 text-[11.5px] font-medium transition-colors",
              diffStyle === "split"
                ? "bg-surface text-fg shadow-sm"
                : "text-fg-muted hover:text-fg",
            )}
            aria-pressed={diffStyle === "split"}
            title="分栏视图"
          >
            <Columns2 size={14} strokeWidth={1.75} />
            <span className={cn(isNarrow && "sr-only")}>分栏</span>
          </button>
        </div>
      </header>

      {pathMissHint ? (
        <div className="shrink-0 px-3 pb-1.5">
          <p className="rounded-md bg-surface px-2.5 py-1.5 text-[11.5px] text-fg-faint">
            未找到「{pathMissHint}」的变更记录，已显示列表首项
          </p>
        </div>
      ) : null}

      {fileCount === 0 ? (
        <div className="flex min-h-0 flex-1 items-center justify-center px-4 pb-8">
          <div className="max-w-sm rounded-panel bg-surface px-6 py-8 text-center">
            <p className="text-[13px] font-medium text-fg">
              当前会话暂无文件变更
            </p>
            <p className="mt-2 text-[12px] leading-relaxed text-fg-faint">
              Agent 成功写入、删除或重命名文件后，将出现在此页。仅文件内容与路径变更；建目录可不列出。
            </p>
          </div>
        </div>
      ) : (
        <div
          className={cn(
            "flex min-h-0 flex-1 px-3 pb-3",
            isNarrow ? "flex-col gap-2" : "flex-row gap-0",
          )}
        >
          {isNarrow ? (
            <FileChipBar
              changes={changes}
              selectedId={selected?.id ?? null}
              onSelect={(path) => setFocusPath(path)}
              workspaceRoot={workspaceRoot}
            />
          ) : (
            <aside
              className="flex min-h-0 w-[11.5rem] shrink-0 flex-col overflow-hidden rounded-panel bg-surface sm:w-[14rem]"
              aria-label="变更文件列表"
            >
              <div className="shrink-0 px-2.5 py-2 text-[11px] font-medium text-fg-faint">
                文件
              </div>
              <ul className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-1.5 pb-2">
                {changes.map((change) => (
                  <li key={change.id} className="min-w-0">
                    <FileListItem
                      change={change}
                      active={selected?.id === change.id}
                      onSelect={() => setFocusPath(change.path)}
                      compact={false}
                      workspaceRoot={workspaceRoot}
                    />
                  </li>
                ))}
              </ul>
            </aside>
          )}

          <div
            className={cn(
              "flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-panel bg-surface",
              !isNarrow && "ml-2",
            )}
          >
            {selected ? (
              <DiffPanelToolbar
                change={selected}
                isNarrow={isNarrow}
                canRestore={canRestore}
                restoreBlockedReason={restoreBlockedReason}
                restoring={restoring}
                onRestore={openRestoreConfirm}
                workspaceRoot={workspaceRoot}
              />
            ) : null}

            {selected?.truncated && !selected.binary ? (
              <div className="shrink-0 border-b border-border-soft px-3 py-1.5 text-[11px] text-fg-faint">
                内容已截断，仅展示部分差异
              </div>
            ) : null}

            {/*
              Pierre FileDiff 默认渲染完整行高；[data-code] 为 overflow-y: clip，
              纵向滚动必须由外层容器承担。overflow-hidden 会裁切且无法滚动
             （含展开 unchanged hunk 后内容变长）。
            */}
            <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto">
              {selected?.binary ? (
                <div className="flex h-full items-center justify-center px-4 text-[12.5px] text-fg-faint">
                  二进制文件，无法展示文本差异
                </div>
              ) : fileDiff ? (
                <PierreFileDiff
                  fileDiff={fileDiff}
                  diffStyle={diffStyle}
                  themeType={themeType}
                />
              ) : selected ? (
                <MissingDiffBody
                  change={selected}
                  workspaceRoot={workspaceRoot}
                />
              ) : (
                <div className="flex h-full items-center justify-center text-[12.5px] text-fg-faint">
                  {isNarrow ? "选择文件查看差异" : "选择左侧文件查看差异"}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {restoreCopy ? (
        <Modal state={restoreModal}>
          <Modal.Backdrop
            isDismissable={!restoring}
            className="bg-black/40"
          >
            <Modal.Container size="sm" placement="center">
              <Modal.Dialog className="rounded-xl bg-surface text-fg shadow-lg ring-1 ring-border">
                <Modal.Header className="px-4 pt-4">
                  <Modal.Heading className="text-[14px] font-semibold text-fg">
                    {restoreCopy.title}
                  </Modal.Heading>
                </Modal.Header>
                <Modal.Body className="px-4 py-2">
                  <p className="text-[12.5px] leading-relaxed text-fg-muted">
                    {restoreCopy.description}
                  </p>
                  {selected ? (
                    <p className="mt-2 break-all font-mono text-[11px] text-fg-faint">
                      {toWorkspaceRelativePath(selected.path, workspaceRoot)}
                    </p>
                  ) : null}
                </Modal.Body>
                <Modal.Footer className="flex justify-end gap-2 px-4 pb-4 pt-2">
                  <Button
                    variant="secondary"
                    size="sm"
                    isDisabled={restoring}
                    onPress={() => restoreModal.close()}
                  >
                    取消
                  </Button>
                  <Button
                    variant="danger"
                    size="sm"
                    isDisabled={restoring}
                    onPress={() => {
                      void confirmRestore();
                    }}
                  >
                    {restoring ? "还原中…" : "还原"}
                  </Button>
                </Modal.Footer>
              </Modal.Dialog>
            </Modal.Container>
          </Modal.Backdrop>
        </Modal>
      ) : null}
    </div>
  );
}

function DiffPanelToolbar({
  change,
  isNarrow,
  canRestore,
  restoreBlockedReason,
  restoring,
  onRestore,
  workspaceRoot,
}: {
  change: FileChange;
  isNarrow: boolean;
  canRestore: boolean;
  restoreBlockedReason: string | null;
  restoring: boolean;
  onRestore: () => void;
  workspaceRoot: string | null;
}) {
  const disabled = !canRestore || restoring;
  const title = restoring
    ? "正在还原…"
    : canRestore
      ? "还原此文件"
      : (restoreBlockedReason ?? "无法还原");
  const relativePath = toWorkspaceRelativePath(change.path, workspaceRoot);

  return (
    <div className="flex shrink-0 items-center gap-2 border-b border-border-soft px-3 py-1.5">
      <div className="min-w-0 flex-1 overflow-hidden">
        <div className="truncate text-[12.5px] font-medium leading-tight text-fg">
          {pathBasename(change.path)}
        </div>
        <div className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[10.5px] leading-none text-fg-faint">
          <span
            className={cn(
              "shrink-0",
              change.kind === "create" && "text-copied",
              change.kind === "delete" && "text-timer-low",
            )}
          >
            {KIND_LABEL[change.kind]}
          </span>
          {!isNarrow ? (
            <span className="min-w-0 truncate font-mono" title={relativePath}>
              {relativePath}
            </span>
          ) : null}
        </div>
      </div>
      <button
        type="button"
        onClick={onRestore}
        disabled={disabled}
        title={title}
        aria-label={title}
        className={cn(
          "inline-flex h-7 shrink-0 items-center gap-1 rounded-md px-2 text-[11.5px] font-medium transition-colors",
          "text-fg-muted hover:bg-surface-hover hover:text-fg",
          // 保留 pointer 以在 disabled 时仍能通过 title 说明原因
          "disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-fg-muted",
        )}
      >
        <RotateCcw size={14} strokeWidth={1.75} />
        <span className={cn(isNarrow && "sr-only")}>还原</span>
      </button>
    </div>
  );
}

function FileChipBar({
  changes,
  selectedId,
  onSelect,
  workspaceRoot,
}: {
  changes: FileChange[];
  selectedId: string | null;
  onSelect: (path: string) => void;
  workspaceRoot: string | null;
}) {
  const activeRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    activeRef.current?.scrollIntoView({
      behavior: "smooth",
      inline: "nearest",
      block: "nearest",
    });
  }, [selectedId]);

  return (
    <div
      className="shrink-0 overflow-x-auto rounded-panel bg-surface px-1.5 py-1.5"
      aria-label="变更文件列表"
    >
      <ul className="flex w-max min-w-full items-stretch gap-1">
        {changes.map((change) => {
          const active = selectedId === change.id;
          return (
            <li key={change.id} className="shrink-0">
              <FileListItem
                change={change}
                active={active}
                onSelect={() => onSelect(change.path)}
                compact
                buttonRef={active ? activeRef : undefined}
                workspaceRoot={workspaceRoot}
              />
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function FileListItem({
  change,
  active,
  onSelect,
  compact,
  buttonRef,
  workspaceRoot,
}: {
  change: FileChange;
  active: boolean;
  onSelect: () => void;
  compact: boolean;
  buttonRef?: RefObject<HTMLButtonElement | null>;
  workspaceRoot: string | null;
}) {
  const stat = useMemo(() => roughDiffstat(change), [change]);
  const relativePath = toWorkspaceRelativePath(change.path, workspaceRoot);
  const dirLabel = pathDirname(relativePath);
  const fromRelative = change.fromPath
    ? toWorkspaceRelativePath(change.fromPath, workspaceRoot)
    : null;

  return (
    <button
      ref={buttonRef}
      type="button"
      onClick={onSelect}
      className={cn(
        "min-w-0 overflow-hidden text-left transition-colors",
        compact
          ? "flex max-w-[11rem] flex-col gap-0.5 rounded-lg px-2.5 py-1.5"
          : "flex w-full flex-col gap-0.5 rounded-lg px-2 py-1.5",
        active
          ? "bg-accent-subtle text-fg"
          : "text-fg-muted hover:bg-surface-hover hover:text-fg",
      )}
      aria-current={active ? "true" : undefined}
      title={relativePath}
    >
      <span
        className={cn(
          "min-w-0 truncate font-medium leading-snug",
          compact ? "text-[12px]" : "text-[12.5px]",
        )}
      >
        {pathBasename(change.path)}
      </span>
      <span className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5">
        <span
          className={cn(
            "shrink-0 text-[10.5px] leading-none",
            change.kind === "create" && "text-copied",
            change.kind === "delete" && "text-timer-low",
            (change.kind === "modify" || change.kind === "rename") &&
              "text-fg-faint",
          )}
        >
          {KIND_LABEL[change.kind]}
        </span>
        {stat && (stat.plus > 0 || stat.minus > 0) ? (
          <span className="shrink-0 font-mono text-[10px] leading-none tabular-nums">
            {stat.plus > 0 ? (
              <span className="text-copied">+{stat.plus}</span>
            ) : null}
            {stat.plus > 0 && stat.minus > 0 ? (
              <span className="text-fg-faint"> </span>
            ) : null}
            {stat.minus > 0 ? (
              <span className="text-timer-low">-{stat.minus}</span>
            ) : null}
          </span>
        ) : null}
        {change.binary ? (
          <span className="shrink-0 rounded px-1 text-[9.5px] leading-none text-fg-faint ring-1 ring-border-soft">
            二进制
          </span>
        ) : null}
        {change.truncated ? (
          <span className="shrink-0 rounded px-1 text-[9.5px] leading-none text-fg-faint ring-1 ring-border-soft">
            截断
          </span>
        ) : null}
      </span>
      {!compact && dirLabel ? (
        <span
          className="min-w-0 truncate text-[10px] leading-snug text-fg-faint"
          title={relativePath}
        >
          {dirLabel}
        </span>
      ) : null}
      {!compact && change.kind === "rename" && fromRelative ? (
        <span
          className="min-w-0 truncate text-[10px] leading-snug text-fg-faint"
          title={fromRelative}
        >
          ← {fromRelative}
        </span>
      ) : null}
    </button>
  );
}

function MissingDiffBody({
  change,
  workspaceRoot,
}: {
  change: FileChange;
  workspaceRoot: string | null;
}) {
  const relativePath = toWorkspaceRelativePath(change.path, workspaceRoot);
  const fromRelative = change.fromPath
    ? toWorkspaceRelativePath(change.fromPath, workspaceRoot)
    : null;

  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 px-4 text-center">
      <p className="text-[12.5px] text-fg-muted">
        {change.kind === "rename"
          ? "路径已变更，无文本内容可对比"
          : "暂无可用的文本差异内容"}
      </p>
      <p className="max-w-md break-all font-mono text-[11px] text-fg-faint">
        {fromRelative ? `${fromRelative} → ${relativePath}` : relativePath}
      </p>
    </div>
  );
}

function PierreFileDiff({
  fileDiff,
  diffStyle,
  themeType,
}: {
  fileDiff: FileDiffMetadata;
  diffStyle: DiffStyle;
  themeType: "light" | "dark";
}) {
  const wrapRef = useRef<HTMLDivElement>(null);

  // 预热 shiki 高亮（主线程）；失败忽略，FileDiff 仍会自行加载
  useEffect(() => {
    let cancelled = false;
    void import("@pierre/diffs")
      .then((m) => {
        if (cancelled || typeof m.preloadHighlighter !== "function") return;
        return m.preloadHighlighter({
          themes: ["pierre-dark", "pierre-light"],
          langs: fileDiff.lang ? [fileDiff.lang] : [],
        });
      })
      .catch(() => {
        /* 预热失败不阻塞渲染 */
      });
    return () => {
      cancelled = true;
    };
  }, [fileDiff.lang]);

  // 中文标签 + 部分/全部展开 title；库重渲染后 MutationObserver 再刷
  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const host = wrap.querySelector("diffs-container");
    if (!host) {
      // FileDiff 挂载略晚：短轮询一次
      let stop: (() => void) | undefined;
      const id = window.setInterval(() => {
        const el = wrapRef.current?.querySelector("diffs-container");
        if (!el) return;
        window.clearInterval(id);
        stop = observePierreExpandChrome(el);
      }, 40);
      const kill = window.setTimeout(() => window.clearInterval(id), 4000);
      return () => {
        window.clearInterval(id);
        window.clearTimeout(kill);
        stop?.();
      };
    }
    return observePierreExpandChrome(host);
  }, [fileDiff.name, diffStyle, themeType]);

  const unsafeCSS = useMemo(
    () => buildPierreUnsafeCSS(themeType),
    [themeType],
  );

  // 不设 h-full：由内容撑开高度，纵向滚动交给外层 overflow-y-auto
  return (
    <div ref={wrapRef} className="block w-full min-w-0">
      <FileDiff
        // key 强制在布局/主题切换时重建实例，避免 stale options
        key={`${fileDiff.name}:${diffStyle}:${themeType}`}
        fileDiff={fileDiff}
        className="block w-full min-w-0"
        // 主线程同步高亮：uTools/Vite 不额外配 worker
        disableWorkerPool
        options={{
          diffStyle,
          themeType,
          theme: { dark: "pierre-dark", light: "pierre-light" },
          // 显式主线程 shiki-js（库默认；与 disableWorkerPool 一致）
          preferredHighlighter: "shiki-js",
          // 横向滚动由 pierre [data-code] 负责；纵向由外层容器滚动
          overflow: "scroll",
          diffIndicators: "classic",
          stickyHeader: true,
          // 页面已有 DiffPanelToolbar，关掉 pierre 自带头栏以免绝对路径/双头栏
          disableFileHeader: true,
          hunkSeparators: "line-info",
          // uTools 旧内核：hex 实色覆盖 color-mix / light-dark（含 token 着色）
          unsafeCSS,
        }}
      />
    </div>
  );
}
