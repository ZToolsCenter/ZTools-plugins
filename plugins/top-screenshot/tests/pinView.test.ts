import { mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PinWindowState } from '../src/core/storage';

describe('PinView', () => {
  afterEach(() => {
    window.localStorage.clear();
    vi.restoreAllMocks();
    vi.useRealTimers();
    vi.resetModules();
  });

  it('asks the parent BrowserWindow proxy to move the pin window', async () => {
    vi.setSystemTime(new Date('2026-06-08T06:00:00.000Z'));
    window.location.hash = '#/pin?id=pin-1';
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
    const sendToParent = vi.fn();
    window.ztools = {
      sendToParent,
      getAllDisplays: () => [],
      desktopCaptureSources: () => [],
      createBrowserWindow: () => null,
    };
    const moveToSpy = vi.spyOn(window, 'moveTo').mockImplementation(() => undefined);
    const resizeToSpy = vi.spyOn(window, 'resizeTo').mockImplementation(() => undefined);
    const { default: PinView } = await import('../src/views/PinView.vue');
    const wrapper = mount(PinView);

    await wrapper.find('.pin-window').trigger('mousedown', { button: 0, screenX: 200, screenY: 100 });
    await wrapper.find('.pin-window').trigger('mousemove', { screenX: 210, screenY: 105 });

    expect(JSON.parse(window.localStorage.getItem('pin-window:pin-1')!)).toMatchObject({
      currentBounds: { x: 130, y: 95, width: 320, height: 180 },
    });
    expect(sendToParent).toHaveBeenCalledWith('top-screenshot-pin-bounds', {
      id: 'pin-1',
      bounds: { x: 127, y: 92, width: 326, height: 186 },
    });
    expect(moveToSpy).not.toHaveBeenCalled();
    expect(resizeToSpy).not.toHaveBeenCalled();
  });
});
