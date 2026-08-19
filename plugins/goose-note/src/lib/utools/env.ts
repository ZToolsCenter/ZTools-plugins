export const isUTools = (): boolean =>
  typeof window !== "undefined" && typeof (window as any).utools !== "undefined";

export const isElectron = (): boolean =>
  typeof window !== "undefined" && typeof (window as any).electron !== "undefined";

export const isBrowser = (): boolean => !isUTools() && !isElectron();

export type RuntimeKind = "utools" | "electron" | "browser";

export const getRuntime = (): RuntimeKind => {
  if (isUTools()) return "utools";
  if (isElectron()) return "electron";
  return "browser";
};

export const getUToolsApi = (): any =>
  isUTools() ? (window as any).utools : null;
