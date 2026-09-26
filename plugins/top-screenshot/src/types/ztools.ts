import type { Rect } from '../core/geometry';

export type ZToolsDisplay = {
  id: number | string;
  bounds: Rect;
  scaleFactor?: number;
};

export type ScreenCaptureCallback = (imageDataUrl: string | null, bounds?: Rect) => void;

export type DesktopCaptureSource = {
  id: string;
  name: string;
  display_id?: string;
  thumbnail: {
    toDataURL(): string;
  };
};

export type BrowserWindowProxy = {
  close(): void;
  focus?(): void;
  show?(): void;
  setAlwaysOnTop?(flag: boolean, level?: string): void;
  setBounds?(bounds: Rect): void;
  setPosition?(x: number, y: number): void;
  setSize?(width: number, height: number): void;
};

export type BrowserWindowOptions = {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  frame?: boolean;
  transparent?: boolean;
  alwaysOnTop?: boolean;
  skipTaskbar?: boolean;
  resizable?: boolean;
  movable?: boolean;
  minimizable?: boolean;
  maximizable?: boolean;
  fullscreenable?: boolean;
  hasShadow?: boolean;
  backgroundColor?: string;
  fullscreen?: boolean;
  useContentSize?: boolean;
  webPreferences?: {
    preload?: string;
    zoomFactor?: number;
    devTools?: boolean;
  };
};

export type ZToolsApi = {
  onPluginEnter?(callback: () => void): void;
  onPluginReady?(callback: () => void): void;
  hideMainWindow?(isRestorePreWindow?: boolean): void;
  outPlugin?(isKill?: boolean): void;
  sendToParent?(channel: string, ...args: unknown[]): void;
  onParentMessage?(channel: string, callback: (...args: unknown[]) => void): () => void;
  screenCapture?(callback: ScreenCaptureCallback): void;
  screenToDipRect?(rect: Rect): Rect;
  getAllDisplays(): ZToolsDisplay[];
  desktopCaptureSources(options: {
    types: Array<'screen' | 'window'>;
    thumbnailSize?: { width: number; height: number };
  }): Promise<DesktopCaptureSource[]> | DesktopCaptureSource[];
  createBrowserWindow(url: string, options: BrowserWindowOptions, callback?: () => void): BrowserWindowProxy | null;
};

declare global {
  interface Window {
    ztools?: ZToolsApi;
  }
}
