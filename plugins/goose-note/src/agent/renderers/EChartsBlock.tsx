import React, { useMemo, useRef, useState } from "react";
import * as echarts from "echarts";
import { EDITOR_FONT_SIZE_DEFAULT, useSettings } from "@/stores/useSettings";
import { DatavizToolbar } from "./DatavizToolbar";
import { getPalette } from "./echarts/chartPalette";
import {
  TM,
  clamp,
  parseConfig,
  isRawEChartsOption,
  buildOption,
  polishRawOption,
  getPreferredChartHeight,
} from "./echarts/chartTheme";
import { useEchartsLifecycle } from "./echarts/useEchartsLifecycle";
import { useResolvedTheme } from "@/hooks/useResolvedTheme";

/* ── component ──────────────────────────────────────────────────── */

export interface EChartsBlockProps {
  config: Record<string, unknown>;
}

export const EChartsBlock = React.memo(
  React.forwardRef<HTMLDivElement, EChartsBlockProps>(({ config }, ref) => {
    const [frameWidth, setFrameWidth] = useState(0);
    const frameResizeRef = useRef<HTMLDivElement | null>(null);

    const theme = useSettings((state) => state.theme);
    const editorFontSize = useSettings((state) => state.editorFontSize);
    const isDark = useResolvedTheme(theme) === "dark";
    const editorScale = editorFontSize / EDITOR_FONT_SIZE_DEFAULT;
    const framePadding = Math.round(clamp(12 * editorScale, 10, 18));
    const contentWidth = Math.max(frameWidth - framePadding * 2, 0);

    const chartHeight = useMemo(
      () => getPreferredChartHeight(config, contentWidth, editorScale),
      [config, contentWidth, editorScale],
    );
    const parsedConfig = useMemo(() => parseConfig(config), [config]);
    const useRaw = useMemo(
      () => !parsedConfig && isRawEChartsOption(config),
      [config, parsedConfig],
    );
    const option = useMemo((): echarts.EChartsOption | null => {
      if (parsedConfig) {
        return {
          backgroundColor: "transparent",
          color: getPalette(isDark),
          ...buildOption(parsedConfig, isDark, editorScale),
        } satisfies echarts.EChartsOption;
      }
      if (useRaw) {
        return polishRawOption(config as echarts.EChartsOption, isDark);
      }
      return null;
    }, [config, editorScale, isDark, parsedConfig, useRaw]);

    const { frameRef, containerRef, setRefs, error } = useEchartsLifecycle({
      isDark,
      option,
      chartHeight,
      contentWidth,
      editorScale,
      externalRef: ref,
    });

    /* observe frame width */
    React.useEffect(() => {
      const frame = frameRef.current ?? frameResizeRef.current;
      if (!frame) return;
      const updateWidth = () => setFrameWidth(frame.clientWidth);
      updateWidth();
      const ro = new ResizeObserver(updateWidth);
      ro.observe(frame);
      return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    /* combine frameRef and frameResizeRef */
    const setFrameRef = React.useCallback((node: HTMLDivElement | null) => {
      (frameRef as React.MutableRefObject<HTMLDivElement | null>).current = node;
      frameResizeRef.current = node;
    }, [frameRef]);

    if (error) {
      return (
        <div
          ref={setFrameRef}
          className="group relative"
          style={{ width: "100%", padding: `${framePadding}px` }}
        >
          <DatavizToolbar targetRef={containerRef} blockType="echarts" />
          <div
            ref={setRefs}
            style={{
              minHeight: Math.max(96, Math.round(108 * editorScale)),
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: isDark ? TM.dark.sc : TM.light.sc,
              fontSize: Math.max(13, Math.round(13 * editorScale)),
              opacity: 0.7,
              textAlign: "center",
            }}
          >
            {error}
          </div>
        </div>
      );
    }

    return (
      <div
        ref={setFrameRef}
        className="group relative"
        style={{
          width: "100%",
          padding: `${framePadding}px ${framePadding}px ${Math.max(framePadding, 12)}px`,
        }}
      >
        <DatavizToolbar targetRef={containerRef} blockType="echarts" />
        <div
          ref={setRefs}
          style={{ width: "100%", height: chartHeight, background: "transparent" }}
        />
      </div>
    );
  }),
);

EChartsBlock.displayName = "EChartsBlock";
