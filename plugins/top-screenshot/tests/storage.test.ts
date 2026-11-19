import { describe, expect, expectTypeOf, it } from 'vitest';
import type { Rect } from '../src/core/geometry';
import type { CaptureSession, DisplaySnapshot, PinWindowState } from '../src/core/storage';

function createMemoryStorage(): Storage {
  const data = new Map<string, string>();

  return {
    get length() {
      return data.size;
    },
    clear() {
      data.clear();
    },
    getItem(key) {
      return data.has(key) ? data.get(key)! : null;
    },
    key(index) {
      return Array.from(data.keys())[index] ?? null;
    },
    removeItem(key) {
      data.delete(key);
    },
    setItem(key, value) {
      data.set(key, value);
    },
  };
}

describe('storage', () => {
  it('defines the planned storage shapes', () => {
    expectTypeOf<DisplaySnapshot>().toMatchTypeOf<{
      displayId: string;
      bounds: Rect;
      imageDataUrl: string;
      scaleFactor: number;
    }>();

    expectTypeOf<CaptureSession>().toMatchTypeOf<{
      id: string;
      createdAt: number;
      completed: boolean;
      displays: DisplaySnapshot[];
    }>();

    expectTypeOf<PinWindowState>().toMatchTypeOf<{
      id: string;
      imageDataUrl: string;
      originalBounds: Rect;
      currentBounds: Rect;
      scale: number;
      createdAt: number;
      lastActiveAt: number;
    }>();
  });

  it('saves and loads capture sessions with display snapshots as json in storage', async () => {
    const { loadCaptureSession, saveCaptureSession } = await import('../src/core/storage');
    const storage = createMemoryStorage();
    const bounds: Rect = { x: 10, y: 20, width: 300, height: 200 };
    const session: CaptureSession = {
      id: 'session-1',
      createdAt: 1780660800000,
      completed: false,
      displays: [
        {
          displayId: 'display-1',
          bounds,
          imageDataUrl: 'data:image/png;base64,aaa',
          scaleFactor: 1.25,
        },
      ],
    };

    saveCaptureSession(storage, session);

    expect(storage.length).toBe(1);
    expect(storage.getItem(storage.key(0)!)).toBe(JSON.stringify(session));
    expect(loadCaptureSession(storage, 'session-1')).toEqual(session);
  });

  it('marks an existing capture session as completed', async () => {
    const { loadCaptureSession, markCaptureSessionCompleted, saveCaptureSession } = await import('../src/core/storage');
    const storage = createMemoryStorage();
    const session: CaptureSession = {
      id: 'session-1',
      createdAt: 1780660800000,
      completed: false,
      displays: [
        {
          displayId: 'display-1',
          bounds: { x: 0, y: 0, width: 1920, height: 1080 },
          imageDataUrl: 'data:image/png;base64,bbb',
          scaleFactor: 1,
        },
      ],
    };

    saveCaptureSession(storage, session);
    markCaptureSessionCompleted(storage, 'session-1');

    expect(loadCaptureSession(storage, 'session-1')).toEqual({
      ...session,
      completed: true,
    });
  });

  it('returns null when the stored capture session value is malformed json', async () => {
    const { loadCaptureSession } = await import('../src/core/storage');
    const storage = createMemoryStorage();

    storage.setItem('capture-session:broken-session', '{not valid json');

    expect(loadCaptureSession(storage, 'broken-session')).toBeNull();
  });

  it('finishes capture sessions and identifies their storage events', async () => {
    const { captureSessionKey, finishCaptureSession, isCaptureSessionFinishedEvent, saveCaptureSession } = await import('../src/core/storage');
    const storage = createMemoryStorage();
    const session: CaptureSession = {
      id: 'session-1',
      createdAt: 1780660800000,
      completed: false,
      displays: [],
    };

    saveCaptureSession(storage, session);
    finishCaptureSession(storage, 'session-1');

    expect(storage.getItem(captureSessionKey('session-1'))).toBeNull();
    expect(isCaptureSessionFinishedEvent({ key: captureSessionKey('session-1'), newValue: null }, 'session-1')).toBe(true);
    expect(isCaptureSessionFinishedEvent({ key: captureSessionKey('other'), newValue: null }, 'session-1')).toBe(false);
  });

  it('saves and loads pin windows as json in storage', async () => {
    const { loadPinWindow, savePinWindow } = await import('../src/core/storage');
    const storage = createMemoryStorage();
    const state: PinWindowState = {
      id: 'pin-1',
      imageDataUrl: 'data:image/png;base64,ccc',
      originalBounds: { x: 30, y: 40, width: 250, height: 140 },
      currentBounds: { x: 35, y: 45, width: 375, height: 210 },
      scale: 1.5,
      createdAt: 1780660800000,
      lastActiveAt: 1780661100000,
    };

    savePinWindow(storage, state);

    expect(storage.length).toBe(1);
    expect(storage.getItem(storage.key(0)!)).toBe(JSON.stringify(state));
    expect(loadPinWindow(storage, 'pin-1')).toEqual(state);
  });

  it('returns null when the stored pin window value is malformed json', async () => {
    const { loadPinWindow } = await import('../src/core/storage');
    const storage = createMemoryStorage();

    storage.setItem('pin-window:broken-pin', '{not valid json');

    expect(loadPinWindow(storage, 'broken-pin')).toBeNull();
  });

  it('saves pin window requests and identifies their storage events', async () => {
    const { isPinWindowRequestEvent, pinWindowRequestKey, savePinWindowRequest } = await import('../src/core/storage');
    const storage = createMemoryStorage();

    savePinWindowRequest(storage, 'pin-1');

    expect(storage.getItem(pinWindowRequestKey('pin-1'))).toBe(JSON.stringify({ pinWindowId: 'pin-1' }));
    expect(isPinWindowRequestEvent({ key: pinWindowRequestKey('pin-1'), newValue: JSON.stringify({ pinWindowId: 'pin-1' }) })).toBe(
      'pin-1',
    );
    expect(isPinWindowRequestEvent({ key: pinWindowRequestKey('pin-1'), newValue: null })).toBeNull();
    expect(isPinWindowRequestEvent({ key: 'other', newValue: JSON.stringify({ pinWindowId: 'pin-1' }) })).toBeNull();
  });

  it('removes pin window state after it is no longer needed', async () => {
    const { loadPinWindow, removePinWindow, savePinWindow } = await import('../src/core/storage');
    const storage = createMemoryStorage();
    const state: PinWindowState = {
      id: 'pin-1',
      imageDataUrl: 'data:image/png;base64,ccc',
      originalBounds: { x: 30, y: 40, width: 250, height: 140 },
      currentBounds: { x: 35, y: 45, width: 375, height: 210 },
      scale: 1.5,
      createdAt: 1780660800000,
      lastActiveAt: 1780661100000,
    };

    savePinWindow(storage, state);
    removePinWindow(storage, 'pin-1');

    expect(loadPinWindow(storage, 'pin-1')).toBeNull();
  });
});
