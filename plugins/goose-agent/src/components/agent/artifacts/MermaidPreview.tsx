/**
 * Mermaid 懒加载渲染：按文档主题选用 dark / base，输出 SVG。
 */
import { useEffect, useId, useState } from "react";
import { cn } from "@/lib/utils";

type MermaidPreviewProps = {
  source: string;
  className?: string;
  onSvgReady?: (svg: string) => void;
};

function isDarkTheme(): boolean {
  if (typeof document === "undefined") return true;
  const root = document.documentElement;
  if (root.classList.contains("dark")) return true;
  if (root.classList.contains("light")) return false;
  if (root.dataset.theme === "light") return false;
  if (root.dataset.theme === "dark") return true;
  // color-scheme / 系统偏好
  const scheme = getComputedStyle(root).colorScheme;
  if (scheme.includes("light") && !scheme.includes("dark")) return false;
  if (scheme.includes("dark")) return true;
  if (typeof window !== "undefined" && window.matchMedia) {
    return window.matchMedia("(prefers-color-scheme: dark)").matches;
  }
  return true;
}

/** 将 Mermaid 原始错误压成用户可读简体中文（导出供测试） */
export function formatMermaidError(raw: string): string {
  const msg = (raw || "").trim();
  if (!msg) return "源码无法解析，请检查语法后重试。";
  const lower = msg.toLowerCase();
  if (
    lower.includes("lexical") ||
    lower.includes("parse error") ||
    lower.includes("syntax error") ||
    lower.includes("expecting")
  ) {
    return "Mermaid 语法有误，请核对节点/连线写法，或改用 showHtml 展示复杂架构。";
  }
  if (lower.includes("unknown diagram") || lower.includes("no diagram type")) {
    return "未识别的图表类型。请以 graph / flowchart / sequenceDiagram 等关键字开头。";
  }
  // 截断过长堆栈，避免卡片爆炸
  const short = msg.replace(/\s+/g, " ").slice(0, 160);
  return short;
}

export function MermaidPreview({
  source,
  className,
  onSvgReady,
}: MermaidPreviewProps) {
  const reactId = useId().replace(/:/g, "");
  const [svg, setSvg] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const code = source.trim();
    if (!code) {
      setError("无 Mermaid 源码");
      setLoading(false);
      setSvg("");
      return;
    }

    setLoading(true);
    setError(null);

    void (async () => {
      try {
        const mermaid = (await import("mermaid")).default;
        const dark = isDarkTheme();
        mermaid.initialize({
          startOnLoad: false,
          // dark / base 主题；hex 实色变量便于 uTools 旧内核
          theme: dark ? "dark" : "base",
          themeVariables: dark
            ? {
                primaryColor: "#3b82f6",
                primaryTextColor: "#e8e8e8",
                primaryBorderColor: "#525252",
                lineColor: "#a3a3a3",
                secondaryColor: "#2a2a2a",
                tertiaryColor: "#1a1a1a",
                background: "#1a1a1a",
                mainBkg: "#262626",
                nodeBorder: "#525252",
                clusterBkg: "#222222",
                titleColor: "#e8e8e8",
                edgeLabelBackground: "#1a1a1a",
              }
            : {
                primaryColor: "#3b82f6",
                primaryTextColor: "#171717",
                primaryBorderColor: "#d9d9d9",
                lineColor: "#525252",
                secondaryColor: "#f4f4f4",
                tertiaryColor: "#ffffff",
                background: "#ffffff",
                mainBkg: "#ffffff",
                nodeBorder: "#d9d9d9",
                clusterBkg: "#f4f4f4",
                titleColor: "#171717",
                edgeLabelBackground: "#ffffff",
              },
          securityLevel: "strict",
          fontFamily: "inherit",
        });
        const id = `mmd-${reactId}-${Date.now().toString(36)}`;
        const { svg: rendered } = await mermaid.render(id, code);
        if (cancelled) return;
        setSvg(rendered);
        setLoading(false);
        onSvgReady?.(rendered);
      } catch (err) {
        if (cancelled) return;
        const msg = err instanceof Error ? err.message : String(err);
        setError(formatMermaidError(msg));
        setSvg("");
        setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [source, reactId, onSvgReady]);

  if (loading) {
    return (
      <div
        className={cn(
          "flex min-h-[120px] items-center justify-center text-[12px] text-fg-faint",
          className,
        )}
        aria-busy="true"
        aria-live="polite"
      >
        渲染图表…
      </div>
    );
  }

  if (error) {
    return (
      <div
        role="alert"
        className={cn(
          "rounded-[10px] border border-border bg-bg px-3 py-2 text-[12px] text-[var(--color-timer-low)]",
          className,
        )}
      >
        <p className="font-medium">图表渲染失败</p>
        <p className="mt-0.5 text-fg-muted">{error}</p>
        <p className="mt-1 text-[11px] text-fg-faint">
          仍可下载源码；复杂架构建议改用 HTML 产物。
        </p>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "artifact-mermaid overflow-x-auto rounded-[10px] bg-bg p-2",
        className,
      )}
      role="img"
      aria-label="Mermaid 图表"
      // mermaid 输出可信（strict + 我方源码）；不执行脚本
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
