import { getUToolsApi } from "./env";

export interface SublistItem {
  title: string;
  description: string;
  icon: string;
  url: string;
}

export const wnd = {
  setExpendHeight: (height: number): boolean => {
    const utools = getUToolsApi();
    if (!utools || typeof utools.setExpendHeight !== "function") return false;
    try {
      return Boolean(utools.setExpendHeight(height));
    } catch (err) {
      console.warn("uTools setExpendHeight failed:", err);
      return false;
    }
  },

  redirect: (label: string | [string, string], payload?: unknown): boolean => {
    const utools = getUToolsApi();
    if (!utools || typeof utools.redirect !== "function") return false;
    return utools.redirect(label, payload);
  },

  setSublistFn: (callback: ((keyword: string) => SublistItem[]) | null): void => {
    const utools = getUToolsApi();
    if (!utools || typeof utools.setSublistFn !== "function") return;
    utools.setSublistFn(callback);
  },

  removeSublistFn: (): void => {
    wnd.setSublistFn(null);
  },

  setSubInput: (fn: ((word: { word: string }) => void) | null, placeholder?: string): void => {
    const utools = getUToolsApi();
    if (!utools) return;
    if (fn === null) {
      utools.removeSubInput?.();
    } else {
      utools.setSubInput?.(fn, placeholder);
    }
  },

  removeSubInput: (): void => {
    const utools = getUToolsApi();
    utools?.removeSubInput?.();
  },

  supportsSublist: (): boolean => {
    const utools = getUToolsApi();
    return Boolean(utools && typeof utools.setSublistFn === "function");
  },
};
