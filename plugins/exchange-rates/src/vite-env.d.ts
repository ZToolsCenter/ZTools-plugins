/// <reference types="vite/client" />

declare module "*.vue" {
  import type { DefineComponent } from "vue";
  const component: DefineComponent<object, object, unknown>;
  export default component;
}

declare module "../public/fx-parse.mjs" {
  export function parseLatest(text: string): import("./types").RateBook;
  export function parseCurrencies(currentText: string, allText: string): import("./types").CurrencyInfo[];
  export function parseSeries(text: string): import("./types").SeriesPoint[];
}

interface ZToolsHost {
  isDarkColors(): boolean;
  getThemeInfo(): { isDark?: boolean };
  onThemeChange(callback: (info: { isDark?: boolean }) => void): void;
  onPluginEnter(callback: (payload: unknown) => void): void;
  setExpendHeight(height: number): void;
  showToast(message: string): void;
  dbStorage?: {
    getItem(key: string): unknown;
    setItem(key: string, value: unknown): void;
  };
}

interface Window {
  fx?: import("./types").FxBridge;
  ztools?: ZToolsHost;
}
