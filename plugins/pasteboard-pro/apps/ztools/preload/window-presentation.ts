import {
  clampShelfBounds,
  type DockEdge,
  type Rect,
} from "@pasteboard-pro/design-tokens";

import type {
  AuxiliaryPanel,
  BrowserWindowOptions,
  ShelfDisplay,
} from "./window";
import type { ShelfUiVersion } from "./window-preferences";

const CLASSIC_SHELF_HEIGHT = 280;
const MODERN_HORIZONTAL_SHELF_HEIGHT = 360;
const SIDE_SHELF_WIDTH = 380;
const FLOATING_MARGIN = 24;
const FLOATING_SHELF_WIDTH = 1_120;
const PANEL_BACKGROUND = "#F7F7FB";
const PANEL_SIZES: Readonly<Record<AuxiliaryPanel, Readonly<{ width: number; height: number }>>> = {
  privacy: { width: 700, height: 660 },
  sync: { width: 700, height: 660 },
  preview: { width: 820, height: 680 },
  editor: { width: 660, height: 520 },
  whatsnew: { width: 560, height: 660 },
};

function shelfAnchorArea(
  display: ShelfDisplay,
  edge: DockEdge,
  uiVersion: ShelfUiVersion,
): Rect {
  return edge === "bottom" && uiVersion === "modern"
    ? display.bounds ?? display.workArea
    : display.workArea;
}

function preferredBounds(
  display: ShelfDisplay,
  edge: DockEdge,
  uiVersion: ShelfUiVersion,
): Rect {
  const workArea = display.workArea;

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
    const area = shelfAnchorArea(display, edge, uiVersion);
    const requestedHeight =
      uiVersion === "modern"
        ? MODERN_HORIZONTAL_SHELF_HEIGHT
        : CLASSIC_SHELF_HEIGHT;
    const height = Math.min(requestedHeight, area.height);
    return {
      x: area.x,
      y: edge === "top" ? area.y : area.y + area.height - height,
      width: area.width,
      height,
    };
  }

  const width = Math.min(FLOATING_SHELF_WIDTH, workArea.width);
  const height = Math.min(CLASSIC_SHELF_HEIGHT, workArea.height);
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
  uiVersion: ShelfUiVersion = "classic",
): BrowserWindowOptions {
  const bounds = clampShelfBounds(
    preferredBounds(display, edge, uiVersion),
    { workArea: shelfAnchorArea(display, edge, uiVersion) },
  );

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
