import {
  clampShelfBounds,
  type DockEdge,
  type Rect,
} from "@pasteboard-pro/design-tokens";
import type { PasteStackState } from "@pasteboard-pro/core";

export type ShelfDisplay = Readonly<{
  id: string | number;
  workArea: Rect;
}>;

export type SavedShelfPlacement = Readonly<{
  displayId: string | number;
  edge: DockEdge;
}>;

export type BrowserWindowOptions = Readonly<{
  x: number;
  y: number;
  width: number;
  height: number;
  useContentSize: true;
  transparent: boolean;
  backgroundColor: string;
  frame: false;
  hasShadow: boolean;
  alwaysOnTop: true;
  skipTaskbar: true;
  minimizable: false;
  maximizable: false;
  fullscreenable: false;
  resizable: boolean;
  show: false;
  webPreferences: Readonly<{
    preload: string;
    nodeIntegration: false;
    contextIsolation: false;
    backgroundThrottling: false;
  }>;
}>;

export interface BrowserWindowHandle {
  isDestroyed(): boolean;
  isFocused?(): boolean;
  webContents: Readonly<{
    executeJavaScript(script: string): Promise<unknown>;
  }>;
  show(): void;
  focus(): void;
  close(): void;
  setBounds(bounds: Rect): void;
  setContentProtection(enabled: boolean): void;
}

export interface ShelfWindowHost {
  createBrowserWindow(
    url: string,
    options: BrowserWindowOptions,
    onReady?: () => void,
  ): BrowserWindowHandle;
  hideMainWindow(restorePreviousWindow?: boolean): void;
}

export type OpenShelfOptions = Readonly<{
  edge: DockEdge;
  contentProtection: boolean;
}>;

export type AuxiliaryPanel = "privacy" | "sync" | "preview" | "editor";

export type PanelRequest = Readonly<{
  panel: AuxiliaryPanel;
  params?: Readonly<Record<string, string>>;
}>;

const BOTTOM_SHELF_HEIGHT = 280;
const SIDE_SHELF_WIDTH = 380;
const FLOATING_MARGIN = 24;
const FLOATING_SHELF_WIDTH = 1_120;
const PANEL_BACKGROUND = "#F7F7FB";
const PANEL_SIZES: Readonly<Record<AuxiliaryPanel, Readonly<{ width: number; height: number }>>> = {
  privacy: { width: 700, height: 660 },
  sync: { width: 700, height: 660 },
  preview: { width: 820, height: 680 },
  editor: { width: 660, height: 520 },
};

function setWindowBounds(
  handle: BrowserWindowHandle,
  options: BrowserWindowOptions,
): void {
  if (handle.isDestroyed()) return;
  handle.setBounds({
    x: options.x,
    y: options.y,
    width: options.width,
    height: options.height,
  });
}

function scheduleBoundsCorrection(
  handle: BrowserWindowHandle,
  options: BrowserWindowOptions,
): void {
  for (const delay of [50, 250, 750]) {
    const timer = globalThis.setTimeout(() => setWindowBounds(handle, options), delay);
    (timer as unknown as { unref?: () => void }).unref?.();
  }
}

function preferredBounds(display: ShelfDisplay, edge: DockEdge): Rect {
  const { workArea } = display;

  if (edge === "left" || edge === "right") {
    const width = Math.min(SIDE_SHELF_WIDTH, workArea.width);
    return {
      x: edge === "left" ? workArea.x : workArea.x + workArea.width - width,
      y: workArea.y,
      width,
      height: workArea.height,
    };
  }

  if (edge === "top" || edge === "bottom") {
    const height = Math.min(BOTTOM_SHELF_HEIGHT, workArea.height);
    return {
      x: workArea.x,
      y: edge === "top" ? workArea.y : workArea.y + workArea.height - height,
      width: workArea.width,
      height,
    };
  }

  const width = Math.min(FLOATING_SHELF_WIDTH, workArea.width);
  const height = Math.min(BOTTOM_SHELF_HEIGHT, workArea.height);
  return {
    x: workArea.x + (workArea.width - width) / 2,
    y: workArea.y + workArea.height - height - FLOATING_MARGIN,
    width,
    height,
  };
}

export function buildShelfWindowOptions(
  display: ShelfDisplay,
  edge: DockEdge,
  preloadPath = "preload.js",
): BrowserWindowOptions {
  const bounds = clampShelfBounds(preferredBounds(display, edge), display);

  return {
    x: Math.round(bounds.x),
    y: Math.round(bounds.y),
    width: Math.round(bounds.width),
    height: Math.round(bounds.height),
    useContentSize: true,
    transparent: true,
    backgroundColor: "#00000000",
    frame: false,
    hasShadow: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    resizable: edge === "floating",
    show: false,
    webPreferences: {
      preload: preloadPath,
      nodeIntegration: false,
      contextIsolation: false,
      backgroundThrottling: false,
    },
  };
}

export function buildPanelWindowOptions(
  display: ShelfDisplay,
  panel: AuxiliaryPanel,
  preloadPath = "preload.js",
): BrowserWindowOptions {
  const size = PANEL_SIZES[panel];
  const width = Math.min(size.width, display.workArea.width);
  const height = Math.min(size.height, display.workArea.height);

  return {
    x: Math.round(display.workArea.x + (display.workArea.width - width) / 2),
    y: Math.round(display.workArea.y + (display.workArea.height - height) / 2),
    width: Math.round(width),
    height: Math.round(height),
    useContentSize: true,
    transparent: false,
    backgroundColor: PANEL_BACKGROUND,
    frame: false,
    hasShadow: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    resizable: true,
    show: false,
    webPreferences: {
      preload: preloadPath,
      nodeIntegration: false,
      contextIsolation: false,
      backgroundThrottling: false,
    },
  };
}

function sameDisplayId(left: string | number, right: string | number): boolean {
  return String(left) === String(right);
}

export function resolveShelfPlacement(
  displays: readonly ShelfDisplay[],
  saved: SavedShelfPlacement | undefined,
  fallbackDisplayId?: string | number,
): Readonly<{ display: ShelfDisplay; edge: DockEdge }> {
  if (displays.length === 0) {
    throw new RangeError("At least one display is required");
  }

  if (saved !== undefined) {
    const savedDisplay = displays.find((display) =>
      sameDisplayId(display.id, saved.displayId),
    );
    if (savedDisplay !== undefined) {
      return { display: savedDisplay, edge: saved.edge };
    }
  }

  const fallbackDisplay =
    fallbackDisplayId === undefined
      ? undefined
      : displays.find((display) =>
          sameDisplayId(display.id, fallbackDisplayId),
        );

  return { display: fallbackDisplay ?? displays[0]!, edge: "floating" };
}

export class ShelfWindowManager {
  private current: BrowserWindowHandle | undefined;
  private currentEdge: DockEdge | undefined;

  constructor(
    private readonly host: ShelfWindowHost,
    private readonly preloadPath = "preload.js",
  ) {}

  isOpen(): boolean {
    return this.current !== undefined && !this.current.isDestroyed();
  }

  toggle(
    display: ShelfDisplay,
    options: OpenShelfOptions,
  ): BrowserWindowHandle | undefined {
    if (this.isOpen()) {
      this.close();
      return undefined;
    }
    return this.open(display, options);
  }

  open(display: ShelfDisplay, options: OpenShelfOptions): BrowserWindowHandle {
    this.host.hideMainWindow(false);
    const windowOptions = buildShelfWindowOptions(
      display,
      options.edge,
      this.preloadPath,
    );
    if (
      this.current !== undefined &&
      !this.current.isDestroyed() &&
      this.currentEdge === options.edge
    ) {
      setWindowBounds(this.current, windowOptions);
      scheduleBoundsCorrection(this.current, windowOptions);
      this.current.setContentProtection(options.contentProtection);
      this.current.show();
      this.current.focus();
      return this.current;
    }
    if (this.current !== undefined && !this.current.isDestroyed()) {
      this.current.close();
    }
    this.current = undefined;

    const url = `index.html?shelf=1&dock=${encodeURIComponent(options.edge)}&display=${encodeURIComponent(String(display.id))}`;
    let handle: BrowserWindowHandle | undefined;
    let readyBeforeAssignment = false;
    let preloadReloaded = false;
    const finishOpening = (): void => {
      if (handle === undefined) {
        readyBeforeAssignment = true;
        return;
      }
      if (!preloadReloaded) {
        preloadReloaded = true;
        void handle.webContents.executeJavaScript("window.location.reload()");
        return;
      }
      setWindowBounds(handle, windowOptions);
      handle.show();
      handle.focus();
      this.host.hideMainWindow(false);
    };

    handle = this.host.createBrowserWindow(
      url,
      windowOptions,
      finishOpening,
    );
    this.current = handle;
    this.currentEdge = options.edge;
    setWindowBounds(handle, windowOptions);
    scheduleBoundsCorrection(handle, windowOptions);
    handle.setContentProtection(options.contentProtection);
    handle.show();
    handle.focus();

    if (readyBeforeAssignment) {
      finishOpening();
    }

    return handle;
  }

  close(): void {
    if (this.current !== undefined && !this.current.isDestroyed()) {
      this.current.close();
    }
    this.current = undefined;
    this.currentEdge = undefined;
  }

  setContentProtection(enabled: boolean): void {
    if (this.current !== undefined && !this.current.isDestroyed()) {
      this.current.setContentProtection(enabled);
    }
  }

  notifyHistoryChanged(): void {
    if (this.current === undefined || this.current.isDestroyed()) return;
    void this.current.webContents.executeJavaScript(
      "window.dispatchEvent(new CustomEvent('pasteboard-pro:history-changed'))",
    );
  }

  notifyPasteStackChanged(state: PasteStackState): void {
    if (this.current === undefined || this.current.isDestroyed()) return;
    const detail = JSON.stringify(state).replaceAll("<", "\\u003c");
    void this.current.webContents.executeJavaScript(
      `window.dispatchEvent(new CustomEvent('pasteboard-pro:paste-stack-changed', { detail: ${detail} }))`,
    );
  }
}

export class PanelWindowManager {
  private current:
    | Readonly<{ key: string; handle: BrowserWindowHandle }>
    | undefined;

  constructor(
    private readonly host: ShelfWindowHost,
    private readonly preloadPath = "preload.js",
  ) {}

  open(display: ShelfDisplay, request: PanelRequest): BrowserWindowHandle {
    const params = new URLSearchParams({
      panel: request.panel,
      display: String(display.id),
      ...request.params,
    });
    const key = params.toString();
    const windowOptions = buildPanelWindowOptions(
      display,
      request.panel,
      this.preloadPath,
    );
    if (
      this.current !== undefined &&
      this.current.key === key &&
      !this.current.handle.isDestroyed()
    ) {
      setWindowBounds(this.current.handle, windowOptions);
      scheduleBoundsCorrection(this.current.handle, windowOptions);
      this.current.handle.show();
      this.current.handle.focus();
      return this.current.handle;
    }

    if (this.current !== undefined && !this.current.handle.isDestroyed()) {
      this.current.handle.close();
    }

    const url = `index.html?${params.toString()}`;
    let handle: BrowserWindowHandle | undefined;
    let readyBeforeAssignment = false;
    let preloadReloaded = false;
    const finishOpening = (): void => {
      if (handle === undefined) {
        readyBeforeAssignment = true;
        return;
      }
      if (!preloadReloaded) {
        preloadReloaded = true;
        void handle.webContents.executeJavaScript("window.location.reload()");
        return;
      }
      setWindowBounds(handle, windowOptions);
      handle.show();
      handle.focus();
    };

    handle = this.host.createBrowserWindow(
      url,
      windowOptions,
      finishOpening,
    );
    this.current = { key, handle };
    setWindowBounds(handle, windowOptions);
    scheduleBoundsCorrection(handle, windowOptions);
    handle.show();
    handle.focus();

    if (readyBeforeAssignment) {
      finishOpening();
    }

    return handle;
  }
}
