import React, { useEffect, useRef, useState } from "react";
import * as echarts from "echarts";

interface UseEchartsLifecycleOptions {
  isDark: boolean;
  option: echarts.EChartsOption | null;
  chartHeight: number;
  contentWidth: number;
  editorScale: number;
  externalRef?: React.Ref<HTMLDivElement>;
}

interface UseEchartsLifecycleResult {
  frameRef: React.RefObject<HTMLDivElement | null>;
  containerRef: React.RefObject<HTMLDivElement | null>;
  setRefs: (node: HTMLDivElement | null) => void;
  error: string | null;
}

export function useEchartsLifecycle({
  isDark,
  option,
  chartHeight,
  contentWidth,
  editorScale,
  externalRef,
}: UseEchartsLifecycleOptions): UseEchartsLifecycleResult {
  const frameRef = useRef<HTMLDivElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<echarts.ECharts | null>(null);
  const [error, setError] = useState<string | null>(null);

  /* forward ref while keeping internal ref */
  const setRefs = React.useCallback(
    (node: HTMLDivElement | null) => {
      containerRef.current = node;
      if (typeof externalRef === "function") {
        externalRef(node);
      } else if (externalRef) {
        (externalRef as React.MutableRefObject<HTMLDivElement | null>).current = node;
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [externalRef],
  );

  /* observe frame width */
  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;

    const updateWidth = () => {
      // width state is managed by the parent component
    };

    updateWidth();
    const resizeObserver = new ResizeObserver(updateWidth);
    resizeObserver.observe(frame);
    return () => { resizeObserver.disconnect(); };
  }, []);

  /* init / reinit echarts instance when theme changes */
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    try {
      // 不使用 ECharts 内置 dark 主题，避免覆盖自定义色板/tooltip/轴线
      chartRef.current = echarts.init(el, undefined, {
        renderer: "canvas",
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "图表渲染失败");
      chartRef.current = null;
    }

    return () => {
      chartRef.current?.dispose();
      chartRef.current = null;
    };
  }, [isDark]);

  /* apply option */
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    if (!option) {
      setError("无法解析图表配置");
      chartRef.current?.clear();
      return;
    }

    try {
      const instance =
        chartRef.current ??
        echarts.init(el, undefined, {
          renderer: "canvas",
        });
      chartRef.current = instance;
      instance.setOption(option, {
        notMerge: true,
        lazyUpdate: true,
      });
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "图表渲染失败");
    }
  }, [isDark, option]);

  /* resize on layout changes */
  useEffect(() => {
    const instance = chartRef.current;
    const el = containerRef.current;
    if (!instance || !el) return;
    instance.resize({
      width: el.clientWidth,
      height: el.clientHeight,
    });
  }, [chartHeight, contentWidth, editorScale]);

  return { frameRef, containerRef, setRefs, error };
}
