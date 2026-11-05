import { describe, expect, it } from 'vitest';
import {
  createPluginWindow,
  findSourceForDisplay,
  getDisplaySnapshots,
  getZTools,
  mapDisplaysToSnapshots,
  requireZTools,
} from '../src/core/ztoolsBridge';
import type { BrowserWindowOptions, DesktopCaptureSource, ZToolsApi, ZToolsDisplay } from '../src/types/ztools';

function source(displayId: string, dataUrl: string): DesktopCaptureSource {
  return {
    id: `screen:${displayId}`,
    name: `Screen ${displayId}`,
    display_id: displayId,
    thumbnail: {
      toDataURL: () => dataUrl,
    },
  };
}

describe('ztoolsBridge', () => {
  it('finds a desktop source by display id', () => {
    const display: ZToolsDisplay = { id: 2, bounds: { x: 0, y: 0, width: 100, height: 100 }, scaleFactor: 1 };

    expect(findSourceForDisplay(display, [source('1', 'a'), source('2', 'b')])?.thumbnail.toDataURL()).toBe('b');
  });

  it('falls back to matching display id as a source id segment', () => {
    const display: ZToolsDisplay = { id: 'fallback', bounds: { x: 0, y: 0, width: 100, height: 100 } };
    const fallbackSource: DesktopCaptureSource = {
      id: 'screen:fallback:0',
      name: 'Fallback Screen',
      thumbnail: {
        toDataURL: () => 'fallback-data',
      },
    };

    expect(findSourceForDisplay(display, [fallbackSource])?.thumbnail.toDataURL()).toBe('fallback-data');
  });

  it('does not match display ids as ambiguous substrings', () => {
    const display: ZToolsDisplay = { id: 1, bounds: { x: 0, y: 0, width: 100, height: 100 } };
    const wrongSource: DesktopCaptureSource = {
      id: 'screen:10:0',
      name: 'Wrong Screen',
      thumbnail: {
        toDataURL: () => 'wrong-data',
      },
    };

    expect(findSourceForDisplay(display, [wrongSource])).toBeNull();
  });

  it('maps displays to snapshots', () => {
    const displays: ZToolsDisplay[] = [
      { id: 1, bounds: { x: 0, y: 0, width: 800, height: 600 }, scaleFactor: 1.25 },
      { id: 2, bounds: { x: 800, y: 0, width: 1024, height: 768 } },
    ];

    expect(mapDisplaysToSnapshots(displays, [source('1', 'data:one'), source('2', 'data:two')])).toEqual([
      {
        displayId: '1',
        bounds: { x: 0, y: 0, width: 800, height: 600 },
        imageDataUrl: 'data:one',
        scaleFactor: 1.25,
      },
      {
        displayId: '2',
        bounds: { x: 800, y: 0, width: 1024, height: 768 },
        imageDataUrl: 'data:two',
        scaleFactor: 1,
      },
    ]);
  });

  it('gets and requires the ztools api from window', () => {
    const api = createApi();
    window.ztools = api;

    expect(getZTools()).toBe(api);
    expect(requireZTools()).toBe(api);

    delete window.ztools;
    expect(getZTools()).toBeNull();
    expect(() => requireZTools()).toThrow('ZTools API is not available in this window.');
  });

  it('returns no snapshots when ztools has no displays', async () => {
    const api = createApi();

    await expect(getDisplaySnapshots(api)).resolves.toEqual([]);
    expect(api.lastDesktopCaptureOptions).toBeNull();
  });

  it('captures all displays with a thumbnail size large enough for scaled displays', async () => {
    const api = createApi({
      displays: [
        { id: 1, bounds: { x: 0, y: 0, width: 800, height: 600 }, scaleFactor: 1.5 },
        { id: 2, bounds: { x: 800, y: 0, width: 1024, height: 768 }, scaleFactor: 1 },
      ],
      sources: [source('1', 'data:one'), source('2', 'data:two')],
    });

    await expect(getDisplaySnapshots(api)).resolves.toEqual([
      {
        displayId: '1',
        bounds: { x: 0, y: 0, width: 800, height: 600 },
        imageDataUrl: 'data:one',
        scaleFactor: 1.5,
      },
      {
        displayId: '2',
        bounds: { x: 800, y: 0, width: 1024, height: 768 },
        imageDataUrl: 'data:two',
        scaleFactor: 1,
      },
    ]);
    expect(api.lastDesktopCaptureOptions).toEqual({
      types: ['screen'],
      thumbnailSize: { width: 1200, height: 900 },
    });
  });

  it('delegates plugin window creation to ztools', () => {
    const api = createApi();
    const options: BrowserWindowOptions = { width: 100, height: 80, alwaysOnTop: true };

    createPluginWindow(api, 'index.html#/pin?id=1', options);

    expect(api.createdWindows).toEqual([{ url: 'index.html#/pin?id=1', options }]);
  });

  it('raises created plugin windows to the floating level and focuses them', () => {
    const api = createApi();
    const options: BrowserWindowOptions = { width: 100, height: 80, alwaysOnTop: false };

    const win = createPluginWindow(api, 'index.html#/pin?id=1', options);
    api.runLastCreateCallback();

    expect(win?.alwaysOnTopCalls).toEqual([{ flag: true, level: 'floating' }]);
    expect(win?.focusCalls).toBe(1);
  });
});

function createApi(input: { displays?: ZToolsDisplay[]; sources?: DesktopCaptureSource[] } = {}): ZToolsApi & {
  createdWindows: Array<{ url: string; options: BrowserWindowOptions }>;
  lastDesktopCaptureOptions: unknown;
  runLastCreateCallback(): void;
} {
  let lastCreateCallback: (() => void) | undefined;
  const api = {
    createdWindows: [] as Array<{ url: string; options: BrowserWindowOptions }>,
    lastDesktopCaptureOptions: null as unknown,
    runLastCreateCallback: () => lastCreateCallback?.(),
    getAllDisplays: () => input.displays ?? [],
    desktopCaptureSources: (options: { types: Array<'screen' | 'window'>; thumbnailSize?: { width: number; height: number } }) => {
      api.lastDesktopCaptureOptions = options;
      return input.sources ?? [];
    },
    createBrowserWindow: (url: string, options: BrowserWindowOptions, callback?: () => void) => {
      const win = {
        alwaysOnTopCalls: [] as Array<{ flag: boolean; level?: string }>,
        focusCalls: 0,
        close: () => {},
        focus() {
          win.focusCalls += 1;
        },
        setAlwaysOnTop(flag: boolean, level?: string) {
          win.alwaysOnTopCalls.push({ flag, level });
        },
      };
      api.createdWindows.push({ url, options });
      lastCreateCallback = callback;
      return win;
    },
  };
  return api;
}
