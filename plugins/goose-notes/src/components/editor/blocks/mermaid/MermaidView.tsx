import { useEffect, useState } from "react";
import { useEditorSettings } from "@/components/editor/platform/hostContext";
import { useResolvedTheme } from "@/hooks/useResolvedTheme";
import {
  getMermaidInitConfig,
  stripMermaidInitDirectives,
} from "@/lib/imageExport/mermaidTheme";
import { tryRenderMermaidTimeline } from "@/lib/imageExport/timelineSvg";

interface MermaidViewProps {
  value: string;
}

export const MermaidView: React.FC<MermaidViewProps> = ({ value }) => {
  const [svg, setSvg] = useState<string>("");
  const { theme, features } = useEditorSettings();
  const resolvedTheme = useResolvedTheme(theme);

  useEffect(() => {
    let active = true;
    const isDark = resolvedTheme === "dark";

    const renderMermaid = async () => {
      if (!value) {
        setSvg("");
        return;
      }
      try {
        const timeline = tryRenderMermaidTimeline(
          value,
          isDark ? "dark" : "light",
        );
        if (timeline) {
          if (active) setSvg(timeline);
          return;
        }
        const { default: mermaid } = await import("mermaid");
        if (!active) return;
        mermaid.initialize(
          getMermaidInitConfig({
            mode: isDark ? "dark" : "light",
            securityLevel: features.mermaidUnsafeHTML ? "loose" : "strict",
            fontFamily: "inherit",
            useMaxWidth: true,
          }),
        );
        const id = `mermaid-${Math.random().toString(36).slice(2, 11)}`;
        const { svg } = await mermaid.render(id, stripMermaidInitDirectives(value));
        if (!active) return;
        setSvg(svg);
      } catch {
        if (active) setSvg("");
      }
    };

    const debounceTimer = window.setTimeout(() => { void renderMermaid(); }, 500);
    return () => {
      active = false;
      if (debounceTimer) clearTimeout(debounceTimer);
    };
  }, [features.mermaidUnsafeHTML, value, resolvedTheme]);

  if (!svg) return null;

  return (
    <div
      className="mermaid-preview flex justify-center overflow-x-auto bg-transparent"
      style={{ padding: "var(--editor-code-preview-padding, 16px)" }}
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
};
