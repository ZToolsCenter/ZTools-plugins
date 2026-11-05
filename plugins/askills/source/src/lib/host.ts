export type HostPage = "library" | "projects" | "sources" | "settings";
export type HostInvoke = <T>(
  command: string,
  args?: Record<string, unknown>,
) => Promise<T>;

export interface AskillsHost {
  readonly kind: "ztools";
  invoke: HostInvoke;
  /** Capture this plugin visit; calls remain invalid after exit or reentry. */
  bindInvoke(): HostInvoke;
  onEnter(callback: (page: HostPage) => void): () => void;
  onOut(callback: () => void): () => void;
  isDark(): boolean;
  onThemeChange(callback: () => void): () => void;
}

declare global {
  interface Window {
    askillsHost?: AskillsHost;
  }
}

export function pluginHost(): AskillsHost | undefined {
  return window.askillsHost?.kind === "ztools" ? window.askillsHost : undefined;
}
