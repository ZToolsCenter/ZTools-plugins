import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { applyAppearanceFonts } from "@/lib/appearance/applyAppearance";
import { applyWindowHeight } from "@/lib/platform/windowHeight";
import { STORAGE_PREFIX } from "@/lib/storage";
import { PlatformProvider } from "@/platform/context";
import type { PlatformAdapter } from "@/platform/types";
import { normalizeAppearanceSettings } from "@/stores/settings";
/** 编译烟测：确保 @heroui/react 可解析（v3 无需 Provider） */
import { Button } from "@/lib/heroui";
import "./index.css";

void Button;

/**
 * React 首屏前同步应用持久化外观，避免字体/字号 FOUC；并同步窗口高度。
 * 与 gaStorage 同源（uTools gooseAgent.storageGet / localStorage ga:settings）。
 * 空/损坏/缺字段时静默跳过，CSS 默认值兜底。
 */
function applyPersistedAppearanceEarly(): void {
  try {
    let raw: unknown = null;
    if (typeof window !== "undefined" && window.gooseAgent?.storageGet) {
      raw = window.gooseAgent.storageGet("settings");
    } else {
      const text = localStorage.getItem(`${STORAGE_PREFIX}settings`);
      if (text == null) return;
      raw = JSON.parse(text);
    }
    if (raw == null) return;
    if (typeof raw === "string") {
      try {
        raw = JSON.parse(raw);
      } catch {
        return;
      }
    }
    if (!raw || typeof raw !== "object") return;
    // zustand persist: { state: {...}, version } 或 merge 后的扁平对象
    const bag = raw as {
      state?: { appearance?: unknown };
      appearance?: unknown;
    };
    const appearanceRaw =
      bag.state && typeof bag.state === "object"
        ? bag.state.appearance
        : bag.appearance;
    if (appearanceRaw == null || typeof appearanceRaw !== "object") return;
    const appearance = normalizeAppearanceSettings(
      appearanceRaw as Parameters<typeof normalizeAppearanceSettings>[0],
    );
    applyAppearanceFonts(appearance);
    applyWindowHeight(appearance.windowHeight);
  } catch {
    // ignore corrupt / private mode
  }
}

applyPersistedAppearanceEarly();

async function createAdapter(): Promise<PlatformAdapter> {
  if (window.gooseAgent) {
    const { createUToolsAdapter } = await import("./platform/utools");
    return createUToolsAdapter();
  }
  const { createWebAdapter } = await import("./platform/web");
  return createWebAdapter();
}

/** 非 uTools 预览：安装 gooseFs web mock / 空实现降级 */
async function ensureGooseFsForWeb(): Promise<void> {
  if (window.gooseFs) return;
  const { installWebGooseFs } = await import("@/lib/fs/web-mock");
  installWebGooseFs();
}

async function bootstrap() {
  if (!window.gooseAgent) {
    await ensureGooseFsForWeb();
  }

  const adapter = await createAdapter();

  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <PlatformProvider adapter={adapter}>
        <App />
      </PlatformProvider>
    </StrictMode>,
  );
}

bootstrap();
