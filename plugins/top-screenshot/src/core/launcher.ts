import type { BrowserWindowOptions } from '../types/ztools';
import type { Rect } from './geometry';
import { outerBoundsForImage } from './geometry';
import type { CaptureSession, DisplaySnapshot } from './storage';

const PIN_FRAME_SIZE = 3;

export function canStartCapture(isStarting: boolean): boolean {
  return !isStarting;
}

export function createCaptureSession(id: string, createdAt: number, displays: DisplaySnapshot[]): CaptureSession {
  return {
    id,
    createdAt,
    completed: false,
    displays,
  };
}

export function captureWindowOptions(snapshot: DisplaySnapshot): BrowserWindowOptions {
  return {
    x: snapshot.bounds.x,
    y: snapshot.bounds.y,
    width: snapshot.bounds.width,
    height: snapshot.bounds.height,
    useContentSize: true,
    frame: false,
    transparent: true,
    alwaysOnTop: false,
    skipTaskbar: true,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreen: true,
    fullscreenable: false,
    hasShadow: false,
    backgroundColor: '#00000000',
    webPreferences: {
      zoomFactor: 1,
    },
  };
}

export function pinWindowOptions(imageBounds: Rect): BrowserWindowOptions {
  const outerBounds = outerBoundsForImage(imageBounds, PIN_FRAME_SIZE);

  return {
    x: outerBounds.x,
    y: outerBounds.y,
    width: outerBounds.width,
    height: outerBounds.height,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    movable: true,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    hasShadow: false,
    backgroundColor: '#00000000',
  };
}

export function statusMessageForStartFailure(error: unknown): string {
  return error instanceof Error ? error.message : '截图启动失败';
}
