import { mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CaptureSession } from '../src/core/storage';
import type { BrowserWindowOptions, ZToolsApi } from '../src/types/ztools';

vi.mock('../src/core/crop', () => ({
  cropImageDataUrl: vi.fn(async () => 'data:image/png;base64,cropped'),
}));

describe('CaptureView', () => {
  beforeEach(() => {
    window.location.hash = '#/capture?sessionId=session-1&displayId=display-1';
    window.localStorage.clear();
    vi.stubGlobal('crypto', { randomUUID: () => 'pin-1' });
    vi.setSystemTime(new Date('2026-06-08T06:00:00.000Z'));
  });

  afterEach(() => {
    window.localStorage.clear();
    vi.unstubAllGlobals();
    vi.useRealTimers();
    delete window.ztools;
  });

  it('does not render the captured screen image behind the selection overlay', async () => {
    const session: CaptureSession = {
      id: 'session-1',
      createdAt: 1780898400000,
      completed: false,
      displays: [
        {
          displayId: 'display-1',
          bounds: { x: 100, y: 80, width: 800, height: 600 },
          imageDataUrl: 'data:image/png;base64,screen',
          scaleFactor: 1,
        },
      ],
    };
    window.localStorage.setItem('capture-session:session-1', JSON.stringify(session));

    const { default: CaptureView } = await import('../src/views/CaptureView.vue');
    const wrapper = mount(CaptureView);

    expect(wrapper.find('.capture-image').exists()).toBe(false);
  });

  it('saves a pin request for the launcher instead of creating a child window from capture', async () => {
    vi.useFakeTimers();
    const session: CaptureSession = {
      id: 'session-1',
      createdAt: 1780898400000,
      completed: false,
      displays: [
        {
          displayId: 'display-1',
          bounds: { x: 100, y: 80, width: 800, height: 600 },
          imageDataUrl: 'data:image/png;base64,screen',
          scaleFactor: 1,
        },
      ],
    };
    window.localStorage.setItem('capture-session:session-1', JSON.stringify(session));

    const createdWindows: Array<{ url: string; options: BrowserWindowOptions }> = [];
    window.ztools = {
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
    const closeSpy = vi.spyOn(window, 'close').mockImplementation(() => undefined);
    const { default: CaptureView } = await import('../src/views/CaptureView.vue');
    const wrapper = mount(CaptureView);

    await wrapper.find('.capture-view').trigger('mousedown', { clientX: 10, clientY: 20 });
    await wrapper.find('.capture-view').trigger('mousemove', { clientX: 110, clientY: 90 });
    await wrapper.find('.capture-view').trigger('mouseup');
    await vi.runAllTimersAsync();

    expect(createdWindows).toEqual([]);
    expect(JSON.parse(window.localStorage.getItem('pin-window:pin-1')!)).toMatchObject({ id: 'pin-1' });
    expect(JSON.parse(window.localStorage.getItem('pin-window-request:pin-1')!)).toEqual({ pinWindowId: 'pin-1' });
    expect(closeSpy).toHaveBeenCalledTimes(1);
  });
});
