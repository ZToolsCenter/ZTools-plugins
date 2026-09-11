import type { AccountData, VaultGroup } from "@/lib/types";
import type { ClipboardImageData, PlatformAdapter } from "./types";

const ACCOUNTS_KEY = "goose-2fa-accounts";
const GROUPS_KEY = "goose-2fa-groups";

function readJsonArray<T>(key: string): T[] {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/** Web 兜底适配器，全部使用浏览器 API */
export function createWebAdapter(): PlatformAdapter {
  return {
    loadAccounts(): AccountData[] {
      return readJsonArray<AccountData>(ACCOUNTS_KEY);
    },

    saveAccounts(accounts: AccountData[]): void {
      localStorage.setItem(ACCOUNTS_KEY, JSON.stringify(accounts));
    },

    loadGroups(): VaultGroup[] {
      return readJsonArray<VaultGroup>(GROUPS_KEY);
    },

    saveGroups(groups: VaultGroup[]): void {
      localStorage.setItem(GROUPS_KEY, JSON.stringify(groups));
    },

    async copyText(text: string): Promise<void> {
      await navigator.clipboard.writeText(text);
    },

    async readClipboardText(): Promise<string> {
      try {
        return await navigator.clipboard.readText();
      } catch {
        return "";
      }
    },

    async readClipboardImage(): Promise<ClipboardImageData | null> {
      try {
        const items = await navigator.clipboard.read();
        for (const item of items) {
          for (const type of item.types) {
            if (type.startsWith("image/")) {
              const blob = await item.getType(type);
              const bitmap = await createImageBitmap(blob);
              const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
              const ctx = canvas.getContext("2d");
              if (!ctx) continue;
              ctx.drawImage(bitmap, 0, 0);
              const imageData = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
              return {
                width: imageData.width,
                height: imageData.height,
                data: Array.from(imageData.data),
              };
            }
          }
        }
      } catch {
        // Clipboard API 不可用或被拒绝
      }
      return null;
    },

    async captureScreen(): Promise<string | null> {
      let stream: MediaStream | null = null;
      try {
        stream = await navigator.mediaDevices.getDisplayMedia({
          video: { displaySurface: "monitor" } as MediaTrackConstraints,
          audio: false,
        });

        const video = document.createElement("video");
        video.srcObject = stream;
        video.muted = true;
        video.playsInline = true;

        await new Promise<void>((resolve, reject) => {
          video.onloadeddata = () => resolve();
          video.onerror = () => reject(new Error("video error"));
          video.play().catch(reject);
        });

        const canvas = document.createElement("canvas");
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        const ctx = canvas.getContext("2d");
        if (!ctx) return null;

        ctx.drawImage(video, 0, 0);
        stream.getTracks().forEach((t) => t.stop());
        stream = null;

        // 转为 base64 PNG（不含 data:image/png;base64, 前缀）
        const dataUrl = canvas.toDataURL("image/png");
        return dataUrl.replace(/^data:image\/png;base64,/, "");
      } catch {
        return null;
      } finally {
        stream?.getTracks().forEach((t) => t.stop());
      }
    },

    saveToFile(content: string, defaultName: string): boolean {
      const blob = new Blob([content], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = defaultName;
      a.click();
      URL.revokeObjectURL(url);
      return true;
    },

    readFromFile(): Promise<string | null> {
      return new Promise((resolve) => {
        const input = document.createElement("input");
        input.type = "file";
        input.accept = ".json,.txt";
        input.onchange = () => {
          const file = input.files?.[0];
          if (!file) {
            resolve(null);
            return;
          }
          const reader = new FileReader();
          reader.onload = () => {
            resolve(typeof reader.result === "string" ? reader.result : null);
          };
          reader.onerror = () => resolve(null);
          reader.readAsText(file);
        };
        input.click();
      });
    },

    hideWindow(): void {
      // Web 环境无窗口管理
    },

    showWindow(): void {
      // Web 环境无窗口管理
    },

    showNotification(text: string): void {
      if ("Notification" in window && Notification.permission === "granted") {
        new Notification(text);
      }
    },
  };
}
