/**
 * 消息流内嵌 Artifact 卡片：预览 + 下载；有工作区可「保存到工作区」。
 * 覆盖 HTML / Mermaid / SVG / 表 / 图 / 生图 / Office 二进制。
 */
import { useCallback, useMemo, useState } from "react";
import {
  Download,
  FileSpreadsheet,
  FileText,
  Image as ImageIcon,
  Presentation,
  Code2,
} from "lucide-react";
import { toast } from "@/lib/toast";
import { Button } from "@/lib/heroui";
import { writeFile, isFsAvailable } from "@/lib/fs";
import { assertCanWrite } from "@/lib/agent/sandbox";
import { cn } from "@/lib/utils";
import type { PermissionMode } from "@/lib/agent/permission";
import {
  kindLabel,
  parseArtifactPayload,
  type ArtifactKind,
  type ArtifactPayload,
} from "./artifactKinds";
import {
  downloadBase64,
  downloadSvgMarkup,
  downloadText,
} from "./download";
import { MermaidPreview } from "./MermaidPreview";

export type ArtifactCardProps = {
  toolType: string;
  output: unknown;
  /** 会话绑定工作区；用于可选落盘 */
  workspaceRoot?: string | null;
  /** 权限模式；与会话 Composer 一致，缺省 workspace-write */
  permissionMode?: PermissionMode;
  className?: string;
};

function defaultFilename(payload: ArtifactPayload): string {
  if (payload.filename?.trim()) return payload.filename.trim();
  const base = (payload.title || kindLabel(payload.kind) || "artifact")
    .replace(/[\\/:*?"<>|]+/g, "_")
    .slice(0, 48);
  switch (payload.kind) {
    case "html":
      return `${base}.html`;
    case "diagram":
      return `${base}.mmd`;
    case "svg":
      return `${base}.svg`;
    case "image":
      return `${base}.png`;
    case "office-docx":
      return `${base}.docx`;
    case "office-xlsx":
      return `${base}.xlsx`;
    case "office-pptx":
      return `${base}.pptx`;
    case "table":
      return `${base}.csv`;
    default:
      return `${base}.txt`;
  }
}

function KindIcon({ kind }: { kind: ArtifactKind }) {
  const cls = "size-3.5 shrink-0 text-fg-faint";
  switch (kind) {
    case "office-xlsx":
    case "table":
    case "chart":
      return <FileSpreadsheet className={cls} strokeWidth={1.75} />;
    case "office-pptx":
      return <Presentation className={cls} strokeWidth={1.75} />;
    case "image":
      return <ImageIcon className={cls} strokeWidth={1.75} />;
    case "html":
    case "diagram":
    case "svg":
      return <Code2 className={cls} strokeWidth={1.75} />;
    default:
      return <FileText className={cls} strokeWidth={1.75} />;
  }
}

function HtmlPreview({ html }: { html: string }) {
  // 沙箱：禁止 top-nav / 脚本同源；允许少量 inline 样式
  const srcDoc = useMemo(() => {
    const body = html.trim();
    if (/<html[\s>]/i.test(body) || /<!DOCTYPE/i.test(body)) {
      return body;
    }
    return `<!DOCTYPE html><html><head><meta charset="utf-8"/><style>body{margin:12px;font-family:system-ui,sans-serif;color:#e8e8e8;background:#1a1a1a}</style></head><body>${body}</body></html>`;
  }, [html]);

  return (
    <iframe
      title="HTML 预览"
      // 不放 allow-same-origin：降低沙箱逃逸面；脚本仅在 iframe 内
      sandbox="allow-scripts"
      srcDoc={srcDoc}
      className="h-[280px] w-full rounded-[10px] border border-border bg-[#1a1a1a]"
      referrerPolicy="no-referrer"
    />
  );
}

function TablePreview({
  columns,
  rows,
}: {
  columns?: string[];
  rows?: string[][];
}) {
  const cols = columns ?? [];
  const data = rows ?? [];
  if (cols.length === 0 && data.length === 0) {
    return (
      <div className="px-2 py-3 text-[12px] text-fg-faint">表格为空</div>
    );
  }
  return (
    <div className="max-h-[280px] overflow-auto rounded-[10px] border border-border">
      <table className="w-full border-collapse text-left text-[12px]">
        {cols.length > 0 ? (
          <thead className="sticky top-0 bg-surface">
            <tr>
              {cols.map((c, i) => (
                <th
                  key={i}
                  className="border-b border-border px-2 py-1.5 font-medium text-fg"
                >
                  {c}
                </th>
              ))}
            </tr>
          </thead>
        ) : null}
        <tbody>
          {data.map((row, ri) => (
            <tr
              key={ri}
              className={ri % 2 === 0 ? "bg-bg" : "bg-surface"}
            >
              {(cols.length > 0 ? cols : row).map((_, ci) => (
                <td
                  key={ci}
                  className="border-b border-border-soft px-2 py-1 text-fg-muted"
                >
                  {row[ci] ?? ""}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const CHART_BAR_COLORS = ["#3b82f6", "#22c55e", "#f59e0b", "#a855f7", "#ef4444"];

function chartTypeLabel(chartType?: string): string {
  switch (chartType) {
    case "line":
      return "折线图";
    case "pie":
      return "饼图";
    case "bar":
    default:
      return "柱状图";
  }
}

function ChartPreview({
  chartType,
  categories,
  series,
}: {
  chartType?: string;
  categories?: string[];
  series?: Array<{ name: string; data: number[] }>;
}) {
  // 轻量预览：不拉 recharts；多系列并排条形；饼图按首系列占比
  const cats = categories ?? [];
  const list = series ?? [];
  const first = list[0];
  const data = first?.data ?? [];
  if (data.length === 0) {
    return (
      <div className="px-2 py-3 text-[12px] text-fg-faint">图表无数据</div>
    );
  }

  const typeLabel = chartTypeLabel(chartType);
  const seriesNames = list
    .map((s) => s.name)
    .filter(Boolean)
    .slice(0, 4)
    .join(" · ");

  if (chartType === "pie") {
    const total = data.reduce((s, n) => s + Math.abs(n), 0) || 1;
    return (
      <div className="space-y-1.5 rounded-[10px] border border-border bg-bg p-3">
        <div className="text-[11px] text-fg-faint">
          {typeLabel}
          {first?.name ? ` · ${first.name}` : ""}
        </div>
        {data.map((n, i) => {
          const pct = Math.round((Math.abs(n) / total) * 100);
          return (
            <div key={i} className="flex items-center gap-2">
              <span
                className="size-2 shrink-0 rounded-full"
                style={{
                  backgroundColor: CHART_BAR_COLORS[i % CHART_BAR_COLORS.length],
                }}
                aria-hidden
              />
              <span className="w-16 shrink-0 truncate text-[11px] text-fg-muted">
                {cats[i] ?? `#${i + 1}`}
              </span>
              <div className="h-2 flex-1 overflow-hidden rounded-full bg-border-soft">
                <div
                  className="h-full rounded-full"
                  style={{
                    width: `${pct}%`,
                    backgroundColor:
                      CHART_BAR_COLORS[i % CHART_BAR_COLORS.length],
                  }}
                />
              </div>
              <span className="w-12 shrink-0 text-right text-[11px] tabular-nums text-fg-faint">
                {pct}%
              </span>
            </div>
          );
        })}
      </div>
    );
  }

  // bar / line：按类目行，多系列多条
  const rowCount = Math.max(
    data.length,
    ...list.map((s) => s.data.length),
    cats.length,
  );
  const absMax = Math.max(
    1,
    ...list.flatMap((s) => s.data.map((n) => Math.abs(n))),
  );

  return (
    <div className="space-y-2 rounded-[10px] border border-border bg-bg p-3">
      <div className="text-[11px] text-fg-faint">
        {typeLabel}
        {seriesNames ? ` · ${seriesNames}` : ""}
      </div>
      {Array.from({ length: Math.min(rowCount, 24) }, (_, i) => (
        <div key={i} className="space-y-0.5">
          <div className="truncate text-[11px] text-fg-muted">
            {cats[i] ?? `#${i + 1}`}
          </div>
          {list.slice(0, 5).map((s, si) => {
            const n = s.data[i] ?? 0;
            return (
              <div key={si} className="flex items-center gap-2">
                {list.length > 1 ? (
                  <span className="w-12 shrink-0 truncate text-[10px] text-fg-faint">
                    {s.name}
                  </span>
                ) : null}
                <div className="h-2 flex-1 overflow-hidden rounded-full bg-border-soft">
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: `${Math.round((Math.abs(n) / absMax) * 100)}%`,
                      backgroundColor:
                        CHART_BAR_COLORS[si % CHART_BAR_COLORS.length],
                    }}
                  />
                </div>
                <span className="w-10 shrink-0 text-right text-[11px] tabular-nums text-fg-faint">
                  {n}
                </span>
              </div>
            );
          })}
        </div>
      ))}
      {rowCount > 24 ? (
        <div className="text-[11px] text-fg-faint">
          仅预览前 24 项，完整数据请下载或改用表格。
        </div>
      ) : null}
    </div>
  );
}

export function ArtifactCard({
  toolType,
  output,
  workspaceRoot,
  permissionMode = "workspace-write",
  className,
}: ArtifactCardProps) {
  const payload = useMemo(
    () => parseArtifactPayload(toolType, output),
    [toolType, output],
  );
  const [mermaidSvg, setMermaidSvg] = useState<string>("");
  const [saving, setSaving] = useState(false);

  const onSvgReady = useCallback((svg: string) => {
    setMermaidSvg(svg);
  }, []);

  if (!payload) return null;

  const canSaveToWorkspace = Boolean(workspaceRoot?.trim());
  const filename = defaultFilename(payload);

  const handleDownload = () => {
    try {
      switch (payload.kind) {
        case "html":
          if (payload.html) {
            downloadText(
              payload.html,
              "text/html;charset=utf-8",
              filename,
            );
          }
          break;
        case "diagram":
          if (mermaidSvg) {
            downloadSvgMarkup(
              mermaidSvg,
              filename.replace(/\.mmd$/i, ".svg"),
            );
          } else if (payload.source) {
            downloadText(
              payload.source,
              "text/plain;charset=utf-8",
              filename.endsWith(".mmd") ? filename : `${filename}.mmd`,
            );
          }
          break;
        case "svg":
          if (payload.svg) downloadSvgMarkup(payload.svg, filename);
          break;
        case "image":
          if (payload.contentBase64) {
            downloadBase64(
              payload.contentBase64,
              payload.mimeType || "image/png",
              filename,
            );
          } else if (payload.url) {
            window.open(payload.url, "_blank", "noopener,noreferrer");
          }
          break;
        case "office-docx":
        case "office-xlsx":
        case "office-pptx":
          if (payload.contentBase64) {
            downloadBase64(
              payload.contentBase64,
              payload.mimeType || "application/octet-stream",
              filename,
            );
          }
          break;
        case "table": {
          const cols = payload.columns ?? [];
          const rows = payload.rows ?? [];
          const lines = [
            cols.join(","),
            ...rows.map((r) =>
              r
                .map((c) => `"${String(c).replace(/"/g, '""')}"`)
                .join(","),
            ),
          ];
          downloadText(
            lines.join("\n"),
            "text/csv;charset=utf-8",
            filename,
          );
          break;
        }
        case "office-parse":
          if (payload.text) {
            downloadText(
              payload.text,
              "text/plain;charset=utf-8",
              filename.endsWith(".txt") ? filename : `${filename}.txt`,
            );
          }
          break;
        default:
          if (payload.contentBase64) {
            downloadBase64(
              payload.contentBase64,
              payload.mimeType || "application/octet-stream",
              filename,
            );
          } else if (payload.html) {
            downloadText(payload.html, "text/html;charset=utf-8", filename);
          } else if (payload.source) {
            downloadText(payload.source, "text/plain;charset=utf-8", filename);
          }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(`下载失败：${msg}`);
    }
  };

  const handleSaveWorkspace = async () => {
    if (!workspaceRoot?.trim()) {
      toast.error("当前无工作区，无法保存");
      return;
    }
    if (!isFsAvailable()) {
      toast.error("本机文件桥不可用");
      return;
    }
    setSaving(true);
    try {
      const rel = `artifacts/${filename}`;
      const resolved = assertCanWrite(permissionMode, workspaceRoot, rel);
      if (!resolved.ok) {
        toast.error(resolved.message);
        return;
      }

      let ok = false;
      if (
        payload.contentBase64 &&
        (payload.kind === "image" ||
          (payload.kind.startsWith("office-") &&
            payload.kind !== "office-parse"))
      ) {
        ok = await writeFile(
          resolved.absolutePath,
          payload.contentBase64,
          "base64",
        );
      } else if (payload.kind === "html" && payload.html) {
        ok = await writeFile(resolved.absolutePath, payload.html, "utf8");
      } else if (payload.kind === "diagram" && mermaidSvg) {
        ok = await writeFile(
          resolved.absolutePath.replace(/\.mmd$/i, ".svg"),
          mermaidSvg,
          "utf8",
        );
      } else if (payload.kind === "svg" && payload.svg) {
        ok = await writeFile(resolved.absolutePath, payload.svg, "utf8");
      } else if (payload.source) {
        ok = await writeFile(resolved.absolutePath, payload.source, "utf8");
      } else if (payload.text) {
        ok = await writeFile(resolved.absolutePath, payload.text, "utf8");
      } else {
        toast.error("当前产物无法直接写入工作区");
        return;
      }

      if (ok) toast.success(`已保存到 ${rel}`);
      else toast.error("写入工作区失败");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(`保存失败：${msg}`);
    } finally {
      setSaving(false);
    }
  };

  const cardTitle = payload.title || kindLabel(payload.kind);
  const regionLabel = `产物：${kindLabel(payload.kind)}${payload.title ? ` · ${payload.title}` : ""}`;

  if (payload.error && payload.ok === false) {
    return (
      <div
        role="region"
        aria-label={regionLabel}
        className={cn(
          "rounded-[12px] border border-border bg-bg px-3 py-2.5 text-[12px]",
          className,
        )}
      >
        <div className="mb-1 flex items-center gap-1.5 font-medium text-fg-muted">
          <KindIcon kind={payload.kind} />
          <span>{kindLabel(payload.kind)}</span>
        </div>
        <p role="alert" className="text-[var(--color-timer-low)]">
          {payload.error}
        </p>
      </div>
    );
  }

  const canDownload =
    Boolean(payload.html) ||
    Boolean(payload.source) ||
    Boolean(payload.svg) ||
    Boolean(payload.contentBase64) ||
    Boolean(payload.url) ||
    Boolean(payload.text) ||
    payload.kind === "table" ||
    Boolean(mermaidSvg);

  return (
    <div
      role="region"
      aria-label={regionLabel}
      className={cn(
        "artifact-card overflow-hidden rounded-[12px] border border-border bg-bg",
        className,
      )}
    >
      <div className="flex items-center gap-2 border-b border-border-soft px-3 py-2">
        <KindIcon kind={payload.kind} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[12.5px] font-medium text-fg">
            {cardTitle}
          </div>
          <div className="truncate text-[11px] text-fg-faint">
            {kindLabel(payload.kind)}
            {payload.byteLength
              ? ` · ${Math.max(1, Math.round(payload.byteLength / 1024))} KB`
              : ""}
            {payload.savedPath ? " · 已写入工作区" : ""}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {canDownload ? (
            <Button
              size="sm"
              variant="secondary"
              className="h-7 gap-1 px-2 text-[11px]"
              aria-label={`下载 ${cardTitle}`}
              onPress={handleDownload}
            >
              <Download className="size-3" strokeWidth={2} aria-hidden />
              下载
            </Button>
          ) : null}
          {canSaveToWorkspace && canDownload ? (
            <Button
              size="sm"
              variant="secondary"
              className="h-7 px-2 text-[11px]"
              isDisabled={saving}
              aria-label={`保存 ${cardTitle} 到工作区`}
              aria-busy={saving}
              onPress={() => void handleSaveWorkspace()}
            >
              {saving ? "保存中…" : "保存到工作区"}
            </Button>
          ) : null}
        </div>
      </div>

      <div className="p-2.5">
        {payload.kind === "html" && payload.html ? (
          <HtmlPreview html={payload.html} />
        ) : null}

        {payload.kind === "diagram" && payload.source ? (
          <MermaidPreview source={payload.source} onSvgReady={onSvgReady} />
        ) : null}

        {payload.kind === "svg" && payload.svg ? (
          <div
            className="overflow-x-auto rounded-[10px] bg-bg p-2"
            dangerouslySetInnerHTML={{
              __html: payload.svg.trim().startsWith("<")
                ? payload.svg
                : `<svg xmlns="http://www.w3.org/2000/svg">${payload.svg}</svg>`,
            }}
          />
        ) : null}

        {payload.kind === "image" ? (
          payload.contentBase64 ? (
            <img
              src={`data:${payload.mimeType || "image/png"};base64,${payload.contentBase64}`}
              alt={payload.title || "生成图片"}
              className="max-h-[360px] w-full rounded-[10px] object-contain bg-[#111]"
              draggable={false}
            />
          ) : payload.url ? (
            <img
              src={payload.url}
              alt={payload.title || "生成图片"}
              className="max-h-[360px] w-full rounded-[10px] object-contain bg-[#111]"
              draggable={false}
            />
          ) : (
            <div className="text-[12px] text-fg-faint">无图像数据</div>
          )
        ) : null}

        {payload.kind === "table" ? (
          <TablePreview columns={payload.columns} rows={payload.rows} />
        ) : null}

        {payload.kind === "chart" ? (
          <ChartPreview
            chartType={payload.chartType}
            categories={payload.categories}
            series={payload.series}
          />
        ) : null}

        {payload.kind === "office-parse" && payload.text ? (
          <pre className="max-h-[240px] overflow-auto whitespace-pre-wrap rounded-[10px] border border-border bg-surface p-2.5 font-mono text-[11px] leading-relaxed text-fg-muted">
            {payload.text}
          </pre>
        ) : null}

        {(payload.kind === "office-docx" ||
          payload.kind === "office-xlsx" ||
          payload.kind === "office-pptx") &&
        payload.contentBase64 ? (
          <div className="flex items-center gap-2 rounded-[10px] border border-border-soft bg-surface px-3 py-3 text-[12px] text-fg-muted">
            <KindIcon kind={payload.kind} />
            <span className="min-w-0 flex-1 truncate">
              {filename}
              {payload.byteLength
                ? `（${Math.max(1, Math.round(payload.byteLength / 1024))} KB）`
                : ""}
            </span>
          </div>
        ) : null}

        {payload.saveError ? (
          <p className="mt-2 text-[11px] text-[var(--color-timer-low)]">
            保存提示：{payload.saveError}
          </p>
        ) : null}
      </div>
    </div>
  );
}

/**
 * 从 tool parts 中筛出已完成的 Artifact 工具，供消息流渲染。
 */
export function extractArtifactParts(
  parts: Array<{
    type: string;
    state?: string;
    output?: unknown;
    errorText?: string;
  }>,
): Array<{ type: string; output: unknown }> {
  const out: Array<{ type: string; output: unknown }> = [];
  for (const p of parts) {
    const name = p.type.startsWith("tool-")
      ? p.type.slice("tool-".length)
      : p.type;
    if (!parseArtifactPayload(p.type, p.output ?? { ok: false })) continue;
    // 仅成功或有结构化输出时展示卡；错误也展示（卡片内错误态）
    if (p.output === undefined && !p.errorText) continue;
    if (
      p.state &&
      (p.state === "input-streaming" ||
        p.state === "partial-call" ||
        p.state === "call" ||
        p.state === "input-available")
    ) {
      continue;
    }
    out.push({
      type: p.type.startsWith("tool-") ? p.type : `tool-${name}`,
      output: p.output ?? { ok: false, error: p.errorText || "失败" },
    });
  }
  return out;
}
