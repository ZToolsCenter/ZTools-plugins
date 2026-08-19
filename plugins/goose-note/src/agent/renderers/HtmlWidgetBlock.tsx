import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSettings } from "@/stores/useSettings";
import { DatavizToolbar } from "./DatavizToolbar";
import { HOST_FONTS_CSS, buildDesignSystemCss } from "./htmlWidget/iframeHost";
import { RESIZE_SCRIPT, STORAGE_SHIM, UPDATE_LISTENER_SCRIPT } from "./htmlWidget/widgetRuntime";
import { HTML_TO_IMAGE_CDN, CAPTURE_SCRIPT, requestCapture, type CapturePromise } from "./htmlWidget/screenshotBridge";
import { useResolvedTheme } from "@/hooks/useResolvedTheme";

const MIN_HEIGHT = 60;
const DEFAULT_HEIGHT = 200;

/** iframe→host 合法消息类型白名单（sandbox srcdoc，origin 为 opaque 'null'，靠 source+type 双重校验） */
const ALLOWED_IFRAME_MSG_TYPES = new Set([
  "iframe-height",
  "iframe-editor-zoom",
  "screenshot-result",
]);

export interface HtmlWidgetBlockProps {
  html: string;
  streaming?: boolean;
}

export const HtmlWidgetBlock = React.memo(
  React.forwardRef<HTMLDivElement, HtmlWidgetBlockProps>(
    function HtmlWidgetBlock({ html }, ref) {
      const theme = useSettings((state) => state.theme);
      const increaseEditorFontSize = useSettings((state) => state.increaseEditorFontSize);
      const decreaseEditorFontSize = useSettings((state) => state.decreaseEditorFontSize);
      const resetEditorFontSize = useSettings((state) => state.resetEditorFontSize);
      const isDark = useResolvedTheme(theme) === "dark";
      const [height, setHeight] = useState(DEFAULT_HEIGHT);
      const iframeRef = useRef<HTMLIFrameElement>(null);
      const lastSentHtmlRef = useRef<string>("");
      const postMessageRafRef = useRef<ReturnType<typeof requestAnimationFrame> | null>(null);
      const capturePromiseRef = useRef<CapturePromise | null>(null);

      // iframeKey only changes on theme switch — NOT on every html change.
      // This prevents the iframe from being destroyed & recreated on every render.
      const iframeKey = `html-widget-${isDark ? "dark" : "light"}`;

      // iframe shell is stable; streamed HTML is pushed by postMessage to avoid iframe reload flicker.
      const srcdoc = useMemo(() => {
        const colorSchemeMeta = `<meta name="color-scheme" content="${isDark ? "dark" : "light"}">`;
        return `<!DOCTYPE html><html><head><meta charset="utf-8">${colorSchemeMeta}<style>${HOST_FONTS_CSS}</style><style>${buildDesignSystemCss(isDark)}</style><script src="${HTML_TO_IMAGE_CDN}"></script></head><body><div id="vis-container"></div>${STORAGE_SHIM}${UPDATE_LISTENER_SCRIPT}${CAPTURE_SCRIPT}${RESIZE_SCRIPT}</body></html>`;
      }, [isDark]);

      const handleMessage = useCallback(
        (event: MessageEvent) => {
          if (
            !event.data ||
            typeof event.data !== "object" ||
            event.source !== iframeRef.current?.contentWindow
          ) {
            return;
          }

          // 非白名单 type 忽略（srcdoc sandbox iframe origin 为 opaque 'null'，
          // source 校验已是主防线；type 白名单作为次要加固）
          if (!ALLOWED_IFRAME_MSG_TYPES.has(event.data.type)) {
            return;
          }

          if (
            event.data.type === "iframe-height" &&
            typeof event.data.height === "number"
          ) {
            const clamped = Math.max(MIN_HEIGHT, event.data.height);
            setHeight(clamped);
            return;
          }

          if (
            event.data.type === "iframe-editor-zoom" &&
            (typeof event.data.key === "string" || typeof event.data.code === "string")
          ) {
            const key = typeof event.data.key === "string" ? event.data.key : "";
            const code = typeof event.data.code === "string" ? event.data.code : "";

            if (
              key === "+" ||
              key === "=" ||
              code === "Equal" ||
              code === "NumpadAdd"
            ) {
              increaseEditorFontSize();
            } else if (
              key === "-" ||
              code === "Minus" ||
              code === "NumpadSubtract"
            ) {
              decreaseEditorFontSize();
            } else if (
              key === "0" ||
              code === "Digit0" ||
              code === "Numpad0"
            ) {
              resetEditorFontSize();
            }
          }

          if (event.data.type === "screenshot-result") {
            const promise = capturePromiseRef.current;
            if (!promise) return;
            capturePromiseRef.current = null;
            if (typeof event.data.dataUrl === "string") {
              promise.resolve(event.data.dataUrl);
            } else {
              promise.reject(new Error(event.data.error || "截图失败"));
            }
            return;
          }
        },
        [decreaseEditorFontSize, increaseEditorFontSize, resetEditorFontSize],
      );

      useEffect(() => {
        window.addEventListener("message", handleMessage);
        return () => window.removeEventListener("message", handleMessage);
      }, [handleMessage]);

      useEffect(() => {
        setHeight(DEFAULT_HEIGHT);
      }, [iframeKey]);

      useEffect(() => {
        if (html === lastSentHtmlRef.current) return;

        if (postMessageRafRef.current !== null) {
          cancelAnimationFrame(postMessageRafRef.current);
        }

        postMessageRafRef.current = requestAnimationFrame(() => {
          postMessageRafRef.current = null;
          const iframe = iframeRef.current;
          if (!iframe?.contentWindow) return;
          lastSentHtmlRef.current = html;
          iframe.contentWindow.postMessage({ type: "update-html", html }, "*");
        });

        return () => {
          if (postMessageRafRef.current !== null) {
            cancelAnimationFrame(postMessageRafRef.current);
            postMessageRafRef.current = null;
          }
        };
      }, [html]);

      useEffect(() => {
        const iframe = iframeRef.current;
        if (!iframe) return;

        const handleLoad = () => {
          if (iframe.contentWindow) {
            lastSentHtmlRef.current = "";
            iframe.contentWindow.postMessage({ type: "update-html", html }, "*");
          }
        };

        iframe.addEventListener("load", handleLoad);
        return () => iframe.removeEventListener("load", handleLoad);
      }, [iframeKey, html]);

      const handleCapture = useCallback(() => {
        return requestCapture(iframeRef, capturePromiseRef);
      }, []);

      return (
        <div ref={ref} className="group relative">
          <DatavizToolbar onCapture={handleCapture} />
          <iframe
            key={iframeKey}
            ref={iframeRef}
            srcDoc={srcdoc}
            sandbox="allow-scripts"
            scrolling="no"
            style={{
              border: "none",
              width: "100%",
              height: `${height}px`,
              display: "block",
              background: isDark ? "#2E2E2D" : "#ffffff",
            }}
          />
        </div>
      );
    },
  ),
);
