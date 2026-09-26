import type { Rect } from './geometry';

export type DisplaySnapshot = {
  displayId: string;
  bounds: Rect;
  imageDataUrl: string;
  scaleFactor: number;
};

export type CaptureSession = {
  id: string;
  createdAt: number;
  completed: boolean;
  displays: DisplaySnapshot[];
};

export type PinWindowState = {
  id: string;
  imageDataUrl: string;
  originalBounds: Rect;
  currentBounds: Rect;
  scale: number;
  createdAt: number;
  lastActiveAt: number;
};

export const captureSessionKey = (id: string) => `capture-session:${id}`;
export const pinWindowKey = (id: string) => `pin-window:${id}`;
export const pinWindowRequestKey = (id: string) => `pin-window-request:${id}`;

function readJson<T>(storage: Storage, key: string): T | null {
  const value = storage.getItem(key);

  if (!value) {
    return null;
  }

  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

export function saveCaptureSession(storage: Storage, session: CaptureSession): void {
  storage.setItem(captureSessionKey(session.id), JSON.stringify(session));
}

export function loadCaptureSession(storage: Storage, id: string): CaptureSession | null {
  return readJson<CaptureSession>(storage, captureSessionKey(id));
}

export function markCaptureSessionCompleted(storage: Storage, id: string): void {
  const session = loadCaptureSession(storage, id);

  if (!session) {
    return;
  }

  saveCaptureSession(storage, {
    ...session,
    completed: true,
  });
}

export function finishCaptureSession(storage: Storage, id: string): void {
  storage.removeItem(captureSessionKey(id));
}

export function isCaptureSessionFinishedEvent(event: Pick<StorageEvent, 'key' | 'newValue'>, id: string): boolean {
  return event.key === captureSessionKey(id) && event.newValue === null;
}

export function savePinWindow(storage: Storage, state: PinWindowState): void {
  storage.setItem(pinWindowKey(state.id), JSON.stringify(state));
}

export function loadPinWindow(storage: Storage, id: string): PinWindowState | null {
  return readJson<PinWindowState>(storage, pinWindowKey(id));
}

export function removePinWindow(storage: Storage, id: string): void {
  storage.removeItem(pinWindowKey(id));
}

export function savePinWindowRequest(storage: Storage, pinWindowId: string): void {
  storage.setItem(pinWindowRequestKey(pinWindowId), JSON.stringify({ pinWindowId }));
}

export function isPinWindowRequestEvent(event: Pick<StorageEvent, 'key' | 'newValue'>): string | null {
  if (!event.key?.startsWith('pin-window-request:') || !event.newValue) {
    return null;
  }

  const request = JSON.parse(event.newValue) as { pinWindowId?: string };
  return request.pinWindowId ?? null;
}
