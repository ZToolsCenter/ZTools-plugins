/**
 * 工具进度卡：消息流中渲染 tool parts（即便暂无真实 tool 也要组件存在）。
 * 一期无 ApprovalPlanCard / batch-plan。
 */
import {
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import { toWorkspaceRelativePath } from "@/lib/file-changes";
import { Tooltip } from "@/lib/heroui";
import { cn } from "@/lib/utils";
import { buiToolLoader } from "./aiMotionPresets";
import { CompactDiff } from "./beautiful-ui/CompactDiff";
import { LoadingState } from "./beautiful-ui/LoadingState";
import { TaskRows, type TaskRowModel } from "./beautiful-ui/TaskRows";
import { ToolChips } from "./beautiful-ui/ToolChips";
import {
  mapToolPartsToChips,
  mapToolPartsToTaskRows,
} from "./beautifulUiMap";

/**
 * 完整路径 hover 提示。
 * uTools/Electron 常不渲染原生 title，统一用 HeroUI Tooltip。
 */
function PathHoverTip({
  full,
  children,
  className,
  delay = 250,
}: {
  /** 完整相对路径 / 摘要；为空则不包 Tooltip */
  full?: string;
  children: ReactNode;
  className?: string;
  /** 悬停延迟 ms；内层路径默认 250，外层折叠头 700 */
  delay?: number;
}) {
  const show = Boolean(full && full.trim());
  if (!show) {
    return <span className={className}>{children}</span>;
  }

  return (
    <Tooltip delay={delay}>
      <Tooltip.Trigger className={cn("min-w-0 max-w-full outline-none", className)}>
        <span className="min-w-0">{children}</span>
      </Tooltip.Trigger>
      <Tooltip.Content
        placement="top"
        className={cn(
          "z-50 max-w-[min(28rem,calc(100vw-2rem))] break-all",
          "px-2.5 py-1.5 font-mono text-[11px] leading-snug text-fg",
        )}
      >
        {full}
      </Tooltip.Content>
    </Tooltip>
  );
}

export interface ToolProgressPart {
  type: string;
  state?: string;
  input?: unknown;
  output?: unknown;
  errorText?: string;
  toolCallId?: string;
}

interface ToolProgressCardProps {
  parts: ToolProgressPart[];
  isMessageStreaming?: boolean;
  /** 打开变更差异页并聚焦 path */
  onOpenDiff?: (path: string) => void;
  /** 会话绑定工作区根；用于展示路径相对化（diff 导航仍用绝对 path） */
  workspaceRoot?: string | null;
}

/** 可查看差异的写操作工具（含 deleteFile 别名） */
const DIFF_TOOL_TYPES = new Set([
  "tool-writeFile",
  "tool-deletePath",
  "tool-deleteFile",
  "tool-renamePath",
  "writeFile",
  "deletePath",
  "deleteFile",
  "renamePath",
]);

interface ProgressStep {
  label: string;
  detail: string;
  status: "running" | "done" | "error" | "waiting";
  /** loadSkill 时 skill 名单独展示为 tag */
  skillName?: string;
  /**
   * hover 展示完整相对路径（未中间省略）。
   * 有路径 detail 时设置；与 detail 相同时也可设，便于 title 稳定。
   */
  detailTitle?: string;
}

const INPUT_ONLY_STATES = new Set([
  "call",
  "partial-call",
  "input-streaming",
  "input-available",
  "approval-requested",
  "approval-responded",
]);

function readObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function truncate(text: string, max = 28) {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

/**
 * 中间省略：左右尽量完整，中间「…」。
 * 含 `/` 的路径：优先保留尾部 `/basename`（文件名完整），前面按剩余宽度截。
 * max 过小无法保文件名时退回通用头尾截断。
 */
export function truncateMiddle(text: string, max: number): string {
  if (text.length <= max) return text;
  if (max <= 1) return "…";

  const lastSlash = text.lastIndexOf("/");
  if (lastSlash > 0) {
    // 含路径分隔：优先完整保留 `/basename`
    const basename = text.slice(lastSlash); // includes leading /
    const ellipsis = "…";
    if (basename.length + ellipsis.length < max) {
      const prefixLen = max - ellipsis.length - basename.length;
      if (prefixLen > 0) {
        return `${text.slice(0, prefixLen)}${ellipsis}${basename}`;
      }
      return `${ellipsis}${basename}`;
    }
    // basename 过长，无法完整保留 → 通用头尾截断
  }

  // 通用：头 + … + 尾
  const keep = max - 1;
  const head = Math.ceil(keep / 2);
  const tail = Math.floor(keep / 2);
  return `${text.slice(0, head)}…${text.slice(text.length - tail)}`;
}

function isInputOnly(part: ToolProgressPart) {
  return INPUT_ONLY_STATES.has(part.state ?? "");
}

/**
 * 展示用路径：相对工作区根后再中间省略。
 * 无 root / 工作区外：保持 toWorkspaceRelativePath 行为（规范后的原 path）。
 */
/** 展示用完整相对路径（不截断），供 tooltip / title */
export function formatToolFullPath(
  path: string,
  workspaceRoot?: string | null,
): string {
  return toWorkspaceRelativePath(path, workspaceRoot);
}

export function formatToolDisplayPath(
  path: string,
  workspaceRoot?: string | null,
  max = 40,
): string {
  const relative = formatToolFullPath(path, workspaceRoot);
  return truncateMiddle(relative, max);
}

const TOOL_LABELS: Record<string, string> = {
  "tool-loadSkill": "加载能力",
  "tool-searchWeb": "联网搜索",
  "tool-readWebPage": "读取网页",
  "tool-readFile": "读取文件",
  "tool-writeFile": "写入文件",
  "tool-listDir": "列出目录",
  "tool-searchFiles": "搜索文件",
  "tool-mkdir": "创建目录",
  "tool-deletePath": "删除路径",
  "tool-deleteFile": "删除文件",
  "tool-renamePath": "重命名/移动",
  "tool-showTable": "展示表格",
  "tool-showChart": "展示图表",
  "tool-showDiagram": "展示图形",
  "tool-showSvg": "展示 SVG",
  "tool-showHtml": "展示 HTML",
  "tool-generateImage": "生成图片",
  "tool-parseOffice": "解析文档",
  "tool-writeDocx": "生成 Word",
  "tool-writeXlsx": "生成 Excel",
  "tool-writePptx": "生成 PPT",
  "tool-runSubagent": "子代理",
  "tool-task": "子代理",
};

export function getToolProgressStepStatus(
  part: ToolProgressPart,
  isMessageStreaming?: boolean,
): ProgressStep["status"] {
  if (part.state === "output-error" || part.errorText) return "error";
  if (part.state === "approval-requested") return "done";
  if (isInputOnly(part)) return isMessageStreaming ? "running" : "waiting";
  if (part.state === "output-available" || part.output !== undefined) {
    return "done";
  }
  return isMessageStreaming ? "running" : "done";
}

/**
 * 从 tool part 解析可聚焦的路径。
 * store 以工具结果中的绝对 path 为键；成功后优先 output，避免 input 相对路径对不上。
 * rename 聚焦最终 to。
 * **不相对化**——导航/store 用绝对 path。
 */
export function resolveToolDiffPath(part: ToolProgressPart): string | null {
  const input = readObject(part.input);
  const output = readObject(part.output);
  const type = part.type.startsWith("tool-")
    ? part.type.slice("tool-".length)
    : part.type;

  const outTo = asString(output?.to) || asString(output?.newPath);
  const outPath = asString(output?.path);
  const inTo = asString(input?.to) || asString(input?.newPath);
  const inPath =
    asString(input?.path) ||
    asString(input?.filePath) ||
    asString(input?.from);

  if (type === "renamePath") {
    return outTo || inTo || outPath || inPath || null;
  }
  // writeFile / deletePath：结果 path 为绝对路径
  return outPath || inPath || outTo || inTo || null;
}

function isDiffToolType(type: string): boolean {
  return DIFF_TOOL_TYPES.has(type);
}

function openChangesViaEvent(path: string) {
  window.dispatchEvent(
    new CustomEvent("goose-agent:open-changes", {
      detail: { path },
    }),
  );
}

/** 解析 loadSkill 展示名：output.skill 优先，否则 input.skill */
export function resolveLoadSkillName(part: ToolProgressPart): string {
  const input = readObject(part.input);
  const output = readObject(part.output);
  return asString(output?.skill) || asString(input?.skill);
}

const ARTIFACT_FALLBACK_DETAIL: Record<string, string> = {
  showHtml: "HTML 预览",
  showDiagram: "架构图",
  showSvg: "矢量图",
  showTable: "表格",
  showChart: "统计图",
  generateImage: "生图",
  writeDocx: "Word 文档",
  writeXlsx: "Excel 表格",
  writePptx: "演示文稿",
  parseOffice: "文档解析",
};

/**
 * Artifact 进度行 detail：标题 / 文件名 / 提示词摘要 / 类型兜底。
 * 导出供单测；完成后主预览由 ArtifactCard 接管。
 */
export function resolveArtifactProgressDetail(
  toolName: string,
  input: Record<string, unknown> | null,
  output: Record<string, unknown> | null,
): { detail: string; detailTitle?: string } | null {
  const title =
    asString(output?.title) ||
    asString(input?.title) ||
    asString(output?.filename) ||
    asString(input?.filename) ||
    asString(input?.prompt) ||
    asString(output?.prompt);
  if (title) {
    const short = truncate(title, 36);
    return {
      detail: short,
      detailTitle: title.length > short.length ? title : undefined,
    };
  }
  // 图表类型 / 表格行列数等轻量摘要
  if (toolName === "showChart") {
    const typeLabel = asString(output?.typeLabel);
    if (typeLabel) return { detail: typeLabel };
    const type = asString(output?.type) || asString(input?.type);
    if (type === "line") return { detail: "折线图" };
    if (type === "pie") return { detail: "饼图" };
    if (type === "bar" || type) return { detail: type === "bar" ? "柱状图" : type };
  }
  if (toolName === "showTable") {
    const cols = Array.isArray(output?.columns)
      ? output.columns.length
      : Array.isArray(input?.columns)
        ? input.columns.length
        : 0;
    const rows = Array.isArray(output?.rows)
      ? output.rows.length
      : Array.isArray(input?.rows)
        ? input.rows.length
        : 0;
    if (cols > 0 || rows > 0) {
      return { detail: `${cols} 列 · ${rows} 行` };
    }
  }
  const fallback = ARTIFACT_FALLBACK_DETAIL[toolName];
  if (fallback) return { detail: fallback };
  return null;
}

/**
 * 从 tool part 生成 label / detail / skillName / detailTitle。
 * path 展示经 workspaceRoot 相对化后再 truncateMiddle；
 * detailTitle 为完整相对路径，供 hover title；diff 导航路径不在此处理。
 */
export function getStepText(
  part: ToolProgressPart,
  workspaceRoot?: string | null,
): Pick<ProgressStep, "label" | "detail" | "skillName" | "detailTitle"> {
  const input = readObject(part.input);
  const output = readObject(part.output);
  const outputError = asString(output?.error) || asString(part.errorText);
  const path =
    asString(input?.path) ||
    asString(input?.filePath) ||
    asString(input?.from) ||
    asString(output?.path) ||
    asString(output?.from);
  const toPath =
    asString(input?.to) ||
    asString(input?.newPath) ||
    asString(output?.to);
  const query = asString(input?.query);

  const label =
    TOOL_LABELS[part.type] ||
    (part.type.startsWith("tool-")
      ? part.type.slice("tool-".length)
      : "处理内容");

  if (outputError) {
    return { label, detail: outputError };
  }

  if (part.type === "tool-loadSkill") {
    const skillName = resolveLoadSkillName(part);
    return {
      label: "加载能力",
      detail: output ? "已加载" : "正在加载",
      skillName: skillName || undefined,
    };
  }

  if (part.type === "tool-searchWeb") {
    const q = truncate(query || "关键词");
    const fullQ = query || "关键词";
    // label 已是「联网搜索」，detail 只留关键词；状态由 ✓/… 表达
    return {
      label: "联网搜索",
      detail: `「${q}」`,
      // 查询被截断时 hover 看全文
      detailTitle: fullQ.length > q.length ? `「${fullQ}」` : undefined,
    };
  }

  // Artifact 类：标题 / 文件名 / 类型提示（进度卡；完成后主预览由 ArtifactCard 接管）
  const toolName = part.type.startsWith("tool-")
    ? part.type.slice("tool-".length)
    : part.type;
  if (
    toolName === "showHtml" ||
    toolName === "showDiagram" ||
    toolName === "showSvg" ||
    toolName === "showTable" ||
    toolName === "showChart" ||
    toolName === "generateImage" ||
    toolName === "writeDocx" ||
    toolName === "writeXlsx" ||
    toolName === "writePptx" ||
    toolName === "parseOffice"
  ) {
    const artifactDetail = resolveArtifactProgressDetail(
      toolName,
      input,
      output,
    );
    if (artifactDetail) return { label, ...artifactDetail };
  }

  const fullPath = path ? formatToolFullPath(path, workspaceRoot) : "";
  const fullTo = toPath ? formatToolFullPath(toPath, workspaceRoot) : "";
  const displayPath = path
    ? formatToolDisplayPath(path, workspaceRoot)
    : "";
  const displayTo = toPath
    ? formatToolDisplayPath(toPath, workspaceRoot)
    : "";

  // label 已含动作（读取/写入…），detail 只放路径；完成/进行中靠左侧状态符
  if (displayPath && displayTo) {
    return {
      label,
      detail: `${displayPath} → ${displayTo}`,
      detailTitle: `${fullPath} → ${fullTo}`,
    };
  }

  if (displayPath) {
    return {
      label,
      detail: displayPath,
      detailTitle: fullPath,
    };
  }

  return {
    label,
    detail: part.output !== undefined ? "完成" : "处理中",
  };
}

function buildSteps(
  parts: ToolProgressPart[],
  isMessageStreaming?: boolean,
  workspaceRoot?: string | null,
): ProgressStep[] {
  return parts.map((part) => ({
    ...getStepText(part, workspaceRoot),
    status: getToolProgressStepStatus(part, isMessageStreaming),
  }));
}

/** 落盘变更类工具（成功 done 时计入「变更 k 个文件」） */
const FILE_CHANGE_TOOL_TYPES = new Set([
  "tool-writeFile",
  "tool-deletePath",
  "tool-deleteFile",
  "tool-renamePath",
  "writeFile",
  "deletePath",
  "deleteFile",
  "renamePath",
]);

function countSuccessfulFileChanges(
  parts: ToolProgressPart[],
  isMessageStreaming?: boolean,
): number {
  return parts.filter(
    (part) =>
      FILE_CHANGE_TOOL_TYPES.has(part.type) &&
      getToolProgressStepStatus(part, isMessageStreaming) === "done",
  ).length;
}

/**
 * 折叠头栏摘要（不含 statusText）。
 * 失败 → 错误短文案；处理中 → running 步骤 label；已完成 → 有落盘变更则「变更 k 个文件」，否则 null。
 * 禁止拼路径列表。
 */
function buildSummary(
  steps: ProgressStep[],
  opts: { hasError: boolean; isRunning: boolean; changeCount: number },
): string | null {
  if (opts.hasError) {
    const errorStep = steps.find((step) => step.status === "error");
    const detail = errorStep?.detail?.trim();
    return detail ? truncate(detail, 40) : null;
  }
  if (opts.isRunning) {
    const running = steps.find((step) => step.status === "running");
    return running?.label || null;
  }
  if (opts.changeCount > 0) {
    return `变更 ${opts.changeCount} 个文件`;
  }
  return null;
}

/**
 * 外层 Tooltip 全文（无路径列表）。
 * 失败 → 完整错误；处理中 →「处理中 · label」；已完成且有变更 →「共 n 步，变更 k 个文件」；否则 undefined（不挂 tip）。
 */
function buildSummaryTitle(
  steps: ProgressStep[],
  opts: { hasError: boolean; isRunning: boolean; changeCount: number },
): string | undefined {
  if (opts.hasError) {
    const errorStep = steps.find((step) => step.status === "error");
    const full = (errorStep?.detailTitle || errorStep?.detail || "").trim();
    return full || undefined;
  }
  if (opts.isRunning) {
    const running = steps.find((step) => step.status === "running");
    return running?.label ? `处理中 · ${running.label}` : undefined;
  }
  if (opts.changeCount > 0) {
    return `共 ${steps.length} 步，变更 ${opts.changeCount} 个文件`;
  }
  return undefined;
}

/** 折叠摘要（与头栏 · 后文案一致）；无附加信息时返回 null */
export function getToolProgressSummary(
  parts: ToolProgressPart[],
  isMessageStreaming?: boolean,
  workspaceRoot?: string | null,
): string | null {
  const steps = buildSteps(parts, isMessageStreaming, workspaceRoot);
  const hasError = steps.some((step) => step.status === "error");
  const isRunning =
    steps.length > 0 &&
    !hasError &&
    (Boolean(isMessageStreaming) ||
      steps.some((step) => step.status === "running"));
  const changeCount = countSuccessfulFileChanges(parts, isMessageStreaming);
  return buildSummary(steps, { hasError, isRunning, changeCount });
}

/** 从消息 parts 中筛出可展示的 tool parts */
export function extractToolParts(
  parts: Array<{ type: string } & Record<string, unknown>>,
): ToolProgressPart[] {
  return parts
    .filter(
      (p) =>
        p.type !== "text" &&
        p.type !== "reasoning" &&
        (p.type.startsWith("tool-") || p.type.startsWith("tool")),
    )
    .map((p) => ({
      type: p.type,
      state: typeof p.state === "string" ? p.state : undefined,
      input: p.input,
      output: p.output,
      errorText: typeof p.errorText === "string" ? p.errorText : undefined,
      toolCallId: typeof p.toolCallId === "string" ? p.toolCallId : undefined,
    }));
}

function SkillNameTag({
  name,
  loading,
}: {
  name: string;
  loading: boolean;
}) {
  const chip = (
    <span
      className={cn(
        "agent-skill-tag inline-flex max-w-[12rem] items-center truncate rounded-full",
        "border border-border bg-accent-subtle px-1.5 py-px",
        "font-mono text-[10.5px] leading-tight text-fg",
        loading && "agent-skill-tag--active",
      )}
    >
      {name}
    </span>
  );

  if (loading) {
    return (
      <span className="bui ml-1 inline-flex shrink-0 align-middle">
        <span className="bui-skill-chip--active inline-flex">{chip}</span>
      </span>
    );
  }

  return <span className="ml-1 inline-flex shrink-0 align-middle">{chip}</span>;
}

export function ToolProgressCard({
  parts,
  isMessageStreaming,
  onOpenDiff,
  workspaceRoot,
}: ToolProgressCardProps) {
  const [expanded, setExpanded] = useState(() => Boolean(isMessageStreaming));
  const steps = useMemo(
    () => buildSteps(parts, isMessageStreaming, workspaceRoot),
    [parts, isMessageStreaming, workspaceRoot],
  );

  useEffect(() => {
    setExpanded(Boolean(isMessageStreaming));
  }, [isMessageStreaming]);

  const hasError = steps.some((step) => step.status === "error");
  const isRunning =
    steps.length > 0 &&
    !hasError &&
    (Boolean(isMessageStreaming) ||
      steps.some((step) => step.status === "running"));

  if (steps.length === 0) return null;

  const statusText = hasError ? "失败" : isRunning ? "处理中" : "已完成";
  const changeCount = countSuccessfulFileChanges(parts, isMessageStreaming);
  const summaryOpts = { hasError, isRunning, changeCount };
  const summary = buildSummary(steps, summaryOpts);
  const summaryTitle = buildSummaryTitle(steps, summaryOpts);
  const chips = mapToolPartsToChips(parts, isMessageStreaming, workspaceRoot);
  const taskRows: TaskRowModel[] = mapToolPartsToTaskRows(
    parts,
    isMessageStreaming,
    workspaceRoot,
  ).map((row, index) => {
    const part = parts[index];
    const step = steps[index];
    const diffPath =
      part &&
      step?.status === "done" &&
      isDiffToolType(part.type)
        ? resolveToolDiffPath(part)
        : null;
    return {
      ...row,
      detailTitle: step?.detailTitle,
      skillName: step?.skillName,
      diffPath,
    };
  });
  const diffFiles = taskRows
    .filter((row) => row.diffPath)
    .map((row) => ({ path: row.diffPath as string }));

  const handleOpenDiff = (path: string) => {
    if (onOpenDiff) {
      onOpenDiff(path);
      return;
    }
    openChangesViaEvent(path);
  };

  const toggleExpanded = () => setExpanded((v) => !v);

  return (
    <div className="agent-tool-progress bui text-[12px]">
      {/*
        头栏不用嵌套 button+Tooltip.Trigger（会吞 hover / 非法嵌套）。
        整行 role=button 展开；路径用 HeroUI Tooltip 显示完整文案。
      */}
      <div
        role="button"
        tabIndex={0}
        className="flex w-full cursor-pointer items-center gap-2 px-0 py-1 text-left text-fg-muted"
        onClick={toggleExpanded}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            toggleExpanded();
          }
        }}
        aria-expanded={expanded}
      >
        {hasError ? (
          <AlertCircle
            className="size-3.5 shrink-0 text-[var(--color-timer-low)]"
            strokeWidth={1.75}
          />
        ) : isRunning ? (
          <LoadingState
            variant={buiToolLoader.variant}
            label={undefined}
            showElapsed={false}
            size="sm"
            className="shrink-0"
          />
        ) : (
          <CheckCircle2
            className="size-3.5 shrink-0 text-fg-faint"
            strokeWidth={1.75}
          />
        )}
        <PathHoverTip
          full={summaryTitle}
          delay={700}
          className="min-w-0 flex-1 truncate"
        >
          <span className="font-medium text-fg-muted">{statusText}</span>
          {summary ? (
            <span className="text-fg-faint"> · {summary}</span>
          ) : null}
        </PathHoverTip>
        {expanded ? (
          <ChevronDown className="size-3.5 shrink-0" strokeWidth={1.75} />
        ) : (
          <ChevronRight className="size-3.5 shrink-0" strokeWidth={1.75} />
        )}
      </div>

      {expanded ? (
        <div className="mt-1 space-y-2">
          <ToolChips chips={chips} />
          <TaskRows
            rows={taskRows}
            onOpenDiff={handleOpenDiff}
            renderExtra={(row) =>
              row.skillName ? (
                <SkillNameTag
                  name={row.skillName}
                  loading={row.status === "running"}
                />
              ) : null
            }
          />
          <CompactDiff files={diffFiles} onOpen={handleOpenDiff} />
        </div>
      ) : null}
    </div>
  );
}
