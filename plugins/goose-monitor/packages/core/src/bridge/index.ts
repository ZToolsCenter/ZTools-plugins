/* 产品宿主只有 uTools；普通浏览器仅作为本地开发 mock。 */
import type { PlatformBridge } from "../types";
import { UtoolsBridge } from "./utools";

export type HostKind = "utools" | "browser" | "unavailable";

export function detectHostKind(candidate: unknown, allowBrowserMock = false): HostKind {
  if (candidate && typeof candidate === "object") {
    const host = candidate as { utools?: unknown; gooseMonitor?: unknown };
    if (host.utools) return host.gooseMonitor ? "utools" : "unavailable";
  }
  return allowBrowserMock ? "browser" : "unavailable";
}

export function usesEmbeddedSearch(host: HostKind): boolean {
  return host === "browser";
}

export async function detectBridge(): Promise<PlatformBridge> {
  const allowBrowserMock = import.meta.env.MODE === "development";
  const host = detectHostKind(window, allowBrowserMock);
  if (host === "utools") return new UtoolsBridge();
  if (host === "browser" && allowBrowserMock) {
    const { BrowserBridge } = await import("./browser");
    return new BrowserBridge();
  }
  throw new Error("uTools preload 初始化失败，进程数据不可用。请重新加载插件或检查 preload.js。");
}

export type { PlatformBridge };
