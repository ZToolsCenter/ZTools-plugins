import { mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PinWindowState } from '../src/core/storage';
import type { BrowserWindowOptions, ZToolsApi } from '../src/types/ztools';
import LauncherView from '../src/views/LauncherView.vue';

describe('LauncherView', () => {
  afterEach(() => {
    window.localStorage.clear();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
    delete window.ztools;
  });

  it('does not render a visible loading or retry interface', () => {
    const wrapper = mount(LauncherView);

    expect(wrapper.text()).toBe('');
    expect(wrapper.find('button').exists()).toBe(false);
  });

  it('creates a pin window from the native screenshot result and exits plugin selection', async () => {
    vi.stubGlobal('crypto', { randomUUID: () => 'pin-native' });
    vi.setSystemTime(new Date('2026-06-08T06:00:00.000Z'));
    const createdWindows: Array<{ url: string; options: BrowserWindowOptions }> = [];
    const outPluginCalls: boolean[] = [];
    window.ztools = {
      onPluginEnter: () => {},
      onPluginReady: () => {},
      hideMainWindow: () => {},
      outPlugin: (isKill?: boolean) => {
        outPluginCalls.push(Boolean(isKill));
      },
      screenCapture: (callback) => {
        callback('data:image/png;base64,native', { x: 20, y: 1488, width: 800, height: 112 });
      },
      screenToDipRect: (rect) => ({ x: rect.x / 2, y: rect.y / 2, width: rect.width / 2, height: rect.height / 2 }),
      getAllDisplays: () => [],
      desktopCaptureSources: () => [],
      createBrowserWindow: (url, options) => {
        createdWindows.push({ url, options });
        return {
          close: () => {},
          focus: () => {},
          setAlwaysOnTop: () => {},
        };
      },
    } satisfies ZToolsApi;

    mount(LauncherView);
    await vi.dynamicImportSettled();

    expect(createdWindows[0]?.url).toContain('#/pin?id=pin-native');
    expect(createdWindows[0]?.options).toMatchObject({ x: 7, y: 741, width: 406, height: 62 });
    expect(JSON.parse(window.localStorage.getItem('pin-window:pin-native')!)).toMatchObject({
      imageDataUrl: 'data:image/png;base64,native',
      originalBounds: { x: 10, y: 744, width: 400, height: 56 },
      currentBounds: { x: 10, y: 744, width: 400, height: 56 },
    });
    expect(outPluginCalls).toEqual([false]);
  });

  it('opens pin windows from storage requests in the launcher process', async () => {
    const createdWindows: Array<{ url: string; options: BrowserWindowOptions }> = [];
    window.ztools = {
      onPluginEnter: () => {},
      onPluginReady: () => {},
      getAllDisplays: () => [],
      desktopCaptureSources: () => [],
      createBrowserWindow: (url, options) => {
        createdWindows.push({ url, options });
        return {
          close: () => {},
          focus: () => {},
          setAlwaysOnTop: () => {},
        };
      },
    } satisfies ZToolsApi;
    const state: PinWindowState = {
      id: 'pin-1',
      imageDataUrl: 'data:image/png;base64,cropped',
      originalBounds: { x: 120, y: 90, width: 320, height: 180 },
      currentBounds: { x: 120, y: 90, width: 320, height: 180 },
      scale: 1,
      createdAt: 1780898400000,
      lastActiveAt: 1780898400000,
    };
    window.localStorage.setItem('pin-window:pin-1', JSON.stringify(state));
    mount(LauncherView);

    window.dispatchEvent(
      new StorageEvent('storage', {
        key: 'pin-window-request:pin-1',
        newValue: JSON.stringify({ pinWindowId: 'pin-1' }),
      }),
    );

    expect(createdWindows[0]?.url).toContain('#/pin?id=pin-1');
    expect(createdWindows[0]?.options).toMatchObject({ x: 117, y: 87, width: 326, height: 186 });
  });

  it('keeps native screenshot bounds in DIP when ztools does not provide a converter', async () => {
    vi.stubGlobal('crypto', { randomUUID: () => 'pin-native' });
    vi.setSystemTime(new Date('2026-06-08T06:00:00.000Z'));
    vi.spyOn(window, 'devicePixelRatio', 'get').mockReturnValue(2);
    const createdWindows: Array<{ url: string; options: BrowserWindowOptions }> = [];
    window.ztools = {
      onPluginEnter: () => {},
      onPluginReady: () => {},
      hideMainWindow: () => {},
      outPlugin: () => {},
      screenCapture: (callback) => {
        callback('data:image/png;base64,native', { x: 20, y: 1488, width: 800, height: 112 });
      },
      getAllDisplays: () => [],
      desktopCaptureSources: () => [],
      createBrowserWindow: (url, options) => {
        createdWindows.push({ url, options });
        return {
          close: () => {},
          focus: () => {},
          setAlwaysOnTop: () => {},
        };
      },
    } satisfies ZToolsApi;

    mount(LauncherView);
    await vi.dynamicImportSettled();

    expect(createdWindows[0]?.options).toMatchObject({ x: 7, y: 741, width: 406, height: 62 });
    expect(JSON.parse(window.localStorage.getItem('pin-window:pin-native')!)).toMatchObject({
      originalBounds: { x: 10, y: 744, width: 400, height: 56 },
      currentBounds: { x: 10, y: 744, width: 400, height: 56 },
    });
  });

  it('moves an opened pin window through its BrowserWindow proxy', async () => {
    const win = createWindowProxy();
    const { storageHandler, parentHandlers } = mountLauncherWithParentHandlers({
      createBrowserWindow: () => win,
    });
    window.localStorage.setItem('pin-window:pin-1', JSON.stringify(createPinState('pin-1')));

    storageHandler!(
      new StorageEvent('storage', {
        key: 'pin-window-request:pin-1',
        newValue: JSON.stringify({ pinWindowId: 'pin-1' }),
      }),
    );
    parentHandlers['top-screenshot-pin-bounds']!({
      id: 'pin-1',
      bounds: { x: 127, y: 92, width: 326, height: 186 },
    });

    expect(win.setBounds).toHaveBeenCalledWith({ x: 127, y: 92, width: 326, height: 186 });
  });

  it('exits the plugin after the last pin window closes', async () => {
    const outPluginCalls: boolean[] = [];
    const windows = [createWindowProxy(), createWindowProxy()];
    let index = 0;
    const { storageHandler, parentHandlers } = mountLauncherWithParentHandlers({
      outPlugin: (isKill?: boolean) => outPluginCalls.push(Boolean(isKill)),
      createBrowserWindow: () => windows[index++],
    });
    window.localStorage.setItem('pin-window:pin-1', JSON.stringify(createPinState('pin-1')));
    window.localStorage.setItem('pin-window:pin-2', JSON.stringify(createPinState('pin-2')));

    storageHandler!(
      new StorageEvent('storage', {
        key: 'pin-window-request:pin-1',
        newValue: JSON.stringify({ pinWindowId: 'pin-1' }),
      }),
    );
    storageHandler!(
      new StorageEvent('storage', {
        key: 'pin-window-request:pin-2',
        newValue: JSON.stringify({ pinWindowId: 'pin-2' }),
      }),
    );

    parentHandlers['top-screenshot-pin-closed']!({ id: 'pin-1' });
    expect(outPluginCalls).toEqual([]);

    parentHandlers['top-screenshot-pin-closed']!({ id: 'pin-2' });
    expect(outPluginCalls).toEqual([true]);
  });

  it('ignores close messages for untracked pin windows', async () => {
    const outPluginCalls: boolean[] = [];
    const { parentHandlers } = mountLauncherWithParentHandlers({
      outPlugin: (isKill?: boolean) => outPluginCalls.push(Boolean(isKill)),
    });

    parentHandlers['top-screenshot-pin-closed']!({ id: 'missing-pin' });

    expect(outPluginCalls).toEqual([]);
  });

  it('does not exit twice for duplicate close messages', async () => {
    const outPluginCalls: boolean[] = [];
    const { storageHandler, parentHandlers } = mountLauncherWithParentHandlers({
      outPlugin: (isKill?: boolean) => outPluginCalls.push(Boolean(isKill)),
      createBrowserWindow: () => createWindowProxy(),
    });
    window.localStorage.setItem('pin-window:pin-1', JSON.stringify(createPinState('pin-1')));

    storageHandler!(
      new StorageEvent('storage', {
        key: 'pin-window-request:pin-1',
        newValue: JSON.stringify({ pinWindowId: 'pin-1' }),
      }),
    );
    parentHandlers['top-screenshot-pin-closed']!({ id: 'pin-1' });
    parentHandlers['top-screenshot-pin-closed']!({ id: 'pin-1' });

    expect(outPluginCalls).toEqual([true]);
  });
});

function createPinState(id: string): PinWindowState {
  return {
    id,
    imageDataUrl: 'data:image/png;base64,cropped',
    originalBounds: { x: 120, y: 90, width: 320, height: 180 },
    currentBounds: { x: 120, y: 90, width: 320, height: 180 },
    scale: 1,
    createdAt: 1780898400000,
    lastActiveAt: 1780898400000,
  };
}

function createWindowProxy() {
  return {
    close: vi.fn(),
    focus: vi.fn(),
    setAlwaysOnTop: vi.fn(),
    setBounds: vi.fn(),
  };
}

function mountLauncherWithParentHandlers(overrides: Partial<ZToolsApi>) {
  let storageHandler: ((event: StorageEvent) => void) | null = null;
  const parentHandlers: Record<string, ((message: unknown) => void) | undefined> = {};
  const addEventListenerSpy = vi.spyOn(window, 'addEventListener').mockImplementation((type, listener) => {
    if (type === 'storage') {
      storageHandler = listener as (event: StorageEvent) => void;
    }
  });

  window.ztools = {
    onPluginEnter: () => {},
    onPluginReady: () => {},
    onParentMessage: (channel, callback) => {
      parentHandlers[channel] = callback as (message: unknown) => void;
      return () => undefined;
    },
    getAllDisplays: () => [],
    desktopCaptureSources: () => [],
    createBrowserWindow: () => null,
    ...overrides,
  } satisfies ZToolsApi;

  mount(LauncherView);
  addEventListenerSpy.mockRestore();

  return { storageHandler, parentHandlers };
}
