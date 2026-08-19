import React, { useCallback, useState } from "react";
import { Copy, Download, Loader2 } from "lucide-react";
import { toPng } from "html-to-image";
import { toast } from "@/components/ui/sonner";
import { calculateContentAwarePixelRatio } from "@/lib/imageExport/svgToPng";
import { shell } from "@/lib/utools/shell";
import { dialogs } from "@/lib/utools/dialogs";
import { fs } from "@/lib/utools/fs";

export interface DatavizToolbarProps {
  targetRef?: React.RefObject<HTMLDivElement | null>;
  blockType?: "echarts" | "html";
  /** 自定义截图函数，传入时优先使用，不再依赖 targetRef + blockType */
  onCapture?: () => Promise<string>;
}

/** 优先用 ECharts 原生 getDataURL，HTML 组件回退到 html-to-image */
async function captureImage(
  el: HTMLDivElement,
  blockType: "echarts" | "html",
): Promise<string> {
  const width = Math.max(1, el.clientWidth || el.offsetWidth || 1);
  const height = Math.max(1, el.clientHeight || el.offsetHeight || 1);
  const pixelRatio = calculateContentAwarePixelRatio(width, height);

  if (blockType === "echarts") {
    const echarts = await import("echarts");
    const instance = echarts.getInstanceByDom(el);
    if (instance) {
      return instance.getDataURL({
        type: "png",
        pixelRatio,
        backgroundColor: "transparent",
      });
    }
  }
  return toPng(el, { pixelRatio, width, height });
}

export const DatavizToolbar: React.FC<DatavizToolbarProps> = React.memo(
  ({ targetRef, blockType, onCapture }) => {
    const [copyLoading, setCopyLoading] = useState(false);
    const [downloadLoading, setDownloadLoading] = useState(false);

    const capture = useCallback(async () => {
      if (onCapture) return onCapture();
      if (!targetRef?.current || !blockType)
        throw new Error("No capture method available");
      return captureImage(targetRef.current, blockType);
    }, [onCapture, targetRef, blockType]);

    const handleCopy = useCallback(async () => {
      if (!onCapture && !targetRef?.current) return;
      setCopyLoading(true);
      try {
        const dataUrl = await capture();
        shell.copyImage(dataUrl);
        toast.success("已复制到剪贴板");
      } catch (err) {
        toast.error(
          `复制失败: ${err instanceof Error ? err.message : "未知错误"}`,
        );
      } finally {
        setCopyLoading(false);
      }
    }, [capture, onCapture, targetRef]);

    const handleDownload = useCallback(async () => {
      if (!onCapture && !targetRef?.current) return;
      setDownloadLoading(true);
      try {
        const dataUrl = await capture();
        const savePath = await dialogs.showSaveDialog({
          title: "保存图片",
          defaultPath: `chart-${Date.now()}.png`,
          filters: [{ name: "PNG 图片", extensions: ["png"] }],
        });
        if (savePath !== null) {
          // uTools 环境：通过对话框保存
          if (savePath) {
            const base64 = dataUrl.replace(/^data:image\/png;base64,/, "");
            const ok = fs.writeFile(savePath, base64, "base64");
            if (ok) {
              toast.success("已保存");
            } else {
              toast.error("保存失败");
            }
          }
          // savePath 为空字符串表示用户取消，不提示
        } else {
          // 非 uTools 环境：浏览器下载
          const link = document.createElement("a");
          link.download = `chart-${Date.now()}.png`;
          link.href = dataUrl;
          link.click();
          toast.success("已开始下载");
        }
      } catch (err) {
        toast.error(
          `下载失败: ${err instanceof Error ? err.message : "未知错误"}`,
        );
      } finally {
        setDownloadLoading(false);
      }
    }, [capture, onCapture, targetRef]);

    return (
      <div className="goose-editor-inline-context-ui absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity z-[9999] pointer-events-none">
        <button
          type="button"
          onClick={handleCopy}
          disabled={copyLoading}
          title="复制为 PNG"
          className="pointer-events-auto flex items-center justify-center w-7 h-7 rounded-lg border border-border/50 shadow-sm backdrop-blur-sm transition-colors cursor-pointer bg-background/80 hover:bg-background/95"
        >
          {copyLoading ? (
            <Loader2 className="animate-spin" size={14} />
          ) : (
            <Copy size={14} />
          )}
        </button>
        <button
          type="button"
          onClick={handleDownload}
          disabled={downloadLoading}
          title="下载为 PNG"
          className="pointer-events-auto flex items-center justify-center w-7 h-7 rounded-lg border border-border/50 shadow-sm backdrop-blur-sm transition-colors cursor-pointer bg-background/80 hover:bg-background/95"
        >
          {downloadLoading ? (
            <Loader2 className="animate-spin" size={14} />
          ) : (
            <Download size={14} />
          )}
        </button>
      </div>
    );
  },
);

DatavizToolbar.displayName = "DatavizToolbar";
