import type { AccountData, VaultGroup } from "@/lib/types";
import type { PlatformAdapter, SubInputHandler } from "./types";

/** uTools 适配器，委托 window.goose2fa */
export function createUToolsAdapter(): PlatformAdapter {
  const api = window.goose2fa!;

  return {
    loadAccounts(): AccountData[] {
      return api.loadAccounts();
    },

    saveAccounts(accounts: AccountData[]): void {
      api.saveAccounts(accounts);
    },

    loadGroups(): VaultGroup[] {
      return api.loadGroups?.() ?? [];
    },

    saveGroups(groups: VaultGroup[]): void {
      api.saveGroups?.(groups);
    },

    copyText(text: string): void {
      api.copyText(text);
    },

    readClipboardText(): string {
      return api.readClipboardText();
    },

    readClipboardImage() {
      return api.readClipboardImage();
    },

    captureScreen(): Promise<string | null> {
      return new Promise((resolve) => {
        const ok = api.captureScreen((base64) => {
          resolve(base64 ?? null);
        });
        if (!ok) resolve(null);
      });
    },

    saveToFile(content: string, defaultName: string): boolean {
      return api.saveToFile?.(content, defaultName) ?? false;
    },

    readFromFile(): string | null {
      return api.readFromFile?.() ?? null;
    },

    hideWindow(): void {
      api.hideWindow();
    },

    showWindow(): void {
      api.showWindow();
    },

    showNotification(text: string): void {
      api.showNotification(text);
    },

    setSubInput(handler: SubInputHandler, placeholder: string, initial?: string): void {
      api.setSubInput?.(handler, placeholder, initial);
    },

    removeSubInput(): void {
      api.removeSubInput?.();
    },

    pasteText(text: string): boolean {
      return api.pasteText?.(text) ?? false;
    },

    typeString(text: string): boolean {
      return api.typeString?.(text) ?? false;
    },

    outPlugin(): void {
      api.outPlugin?.();
    },
  };
}
