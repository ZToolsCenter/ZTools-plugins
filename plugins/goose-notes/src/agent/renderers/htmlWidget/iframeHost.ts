// postMessage 协议定义、设计系统 CSS 生成、iframe 通信相关
import { HOST_FONTS_CSS, HTML_THEME, buildDesignSystemCss } from "./designSystem";

export { HOST_FONTS_CSS, HTML_THEME, buildDesignSystemCss };

/** postMessage 消息类型（host → iframe） */
export type HostToIframeMessage =
  | { type: "update-html"; html: string }
  | { type: "capture-screenshot" };

/** postMessage 消息类型（iframe → host） */
export type IframeToHostMessage =
  | { type: "iframe-height"; height: number }
  | { type: "iframe-editor-zoom"; key: string; code: string }
  | { type: "screenshot-result"; dataUrl: string; error?: undefined }
  | { type: "screenshot-result"; error: string; dataUrl?: undefined };
