// 截图相关功能：canvas → image 桥接，iframe 截图脚本
import type { MutableRefObject, RefObject } from "react";

/** html-to-image CDN 地址 */
export const HTML_TO_IMAGE_CDN = `https://cdn.jsdelivr.net/npm/html-to-image@1.11.13/dist/html-to-image.min.js`;

/** 截图脚本：监听 capture-screenshot 消息，使用 html-to-image 截图（注入到 iframe 内） */
export const CAPTURE_SCRIPT = `<script data-goose-capture>
(() => {
  window.addEventListener('message', (event) => {
    if (event.source !== window.parent) return;
    if (event.data && event.data.type === 'capture-screenshot') {
      if (typeof htmlToImage === 'undefined') {
        window.parent.postMessage({ type: 'screenshot-result', error: 'html-to-image not loaded' }, '*');
        return;
      }
      const container = document.getElementById('vis-container');
      if (!container) {
        window.parent.postMessage({ type: 'screenshot-result', error: 'vis-container not found' }, '*');
        return;
      }
      htmlToImage.toPng(container, { pixelRatio: 2, backgroundColor: 'transparent' })
        .then((dataUrl) => {
          window.parent.postMessage({ type: 'screenshot-result', dataUrl }, '*');
        })
        .catch((err) => {
          window.parent.postMessage({ type: 'screenshot-result', error: err.message || 'capture failed' }, '*');
        });
    }
  });
})();
<\/script>`;

/** 截图 Promise 句柄类型 */
export interface CapturePromise {
  resolve: (url: string) => void;
  reject: (err: Error) => void;
}

/**
 * 向 iframe 发起截图请求，返回 Promise<dataUrl>
 * @param iframeRef - iframe 元素引用
 * @param capturePromiseRef - 存储 Promise 句柄的 ref
 */
export function requestCapture(
  iframeRef: RefObject<HTMLIFrameElement | null>,
  capturePromiseRef: MutableRefObject<CapturePromise | null>,
): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    capturePromiseRef.current = { resolve, reject };
    const iframe = iframeRef.current;
    if (!iframe?.contentWindow) {
      reject(new Error("iframe not ready"));
      capturePromiseRef.current = null;
      return;
    }
    iframe.contentWindow.postMessage({ type: "capture-screenshot" }, "*");
    window.setTimeout(() => {
      const promise = capturePromiseRef.current;
      if (promise) {
        capturePromiseRef.current = null;
        promise.reject(new Error("截图超时"));
      }
    }, 5000);
  });
}
