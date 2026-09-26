import { enableAutoUnmount, mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PinWindowState } from '../src/core/storage';

enableAutoUnmount(afterEach);

describe('PinView', () => {
  afterEach(() => {
    window.localStorage.clear();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
    vi.resetModules();
  });

  it('asks the parent BrowserWindow proxy to move the pin window', async () => {
    vi.setSystemTime(new Date('2026-06-08T06:00:00.000Z'));
    window.location.hash = '#/pin?id=pin-1';
    const state: PinWindowState = createPinState();
    window.localStorage.setItem('pin-window:pin-1', JSON.stringify(state));
    const sendToParent = vi.fn();
    window.ztools = createZTools(sendToParent);
    const moveToSpy = vi.spyOn(window, 'moveTo').mockImplementation(() => undefined);
    const resizeToSpy = vi.spyOn(window, 'resizeTo').mockImplementation(() => undefined);
    const { default: PinView } = await import('../src/views/PinView.vue');
    const wrapper = mount(PinView);

    await wrapper.find('.pin-window').trigger('mousedown', { button: 0, screenX: 200, screenY: 100 });
    window.dispatchEvent(new MouseEvent('mousemove', { screenX: 210, screenY: 105 }));

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

  it('continues dragging when pointer movement leaves the pin element', async () => {
    vi.setSystemTime(new Date('2026-06-08T06:00:00.000Z'));
    window.location.hash = '#/pin?id=pin-1';
    window.localStorage.setItem('pin-window:pin-1', JSON.stringify(createPinState()));
    const sendToParent = vi.fn();
    window.ztools = createZTools(sendToParent);
    const { default: PinView } = await import('../src/views/PinView.vue');
    const wrapper = mount(PinView);

    await wrapper.find('.pin-window').trigger('mousedown', { button: 0, screenX: 200, screenY: 100 });
    window.dispatchEvent(new MouseEvent('mousemove', { screenX: 230, screenY: 115 }));

    expect(JSON.parse(window.localStorage.getItem('pin-window:pin-1')!)).toMatchObject({
      currentBounds: { x: 150, y: 105, width: 320, height: 180 },
    });
    expect(sendToParent).toHaveBeenCalledWith('top-screenshot-pin-bounds', {
      id: 'pin-1',
      bounds: { x: 147, y: 102, width: 326, height: 186 },
    });
  });

  it('notifies the parent when the pin window closes', async () => {
    window.location.hash = '#/pin?id=pin-1';
    window.localStorage.setItem('pin-window:pin-1', JSON.stringify(createPinState()));
    const sendToParent = vi.fn();
    window.ztools = createZTools(sendToParent);
    const closeSpy = vi.spyOn(window, 'close').mockImplementation(() => undefined);
    const { default: PinView } = await import('../src/views/PinView.vue');
    mount(PinView);

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));

    expect(window.localStorage.getItem('pin-window:pin-1')).toBeNull();
    expect(sendToParent).toHaveBeenCalledWith('top-screenshot-pin-closed', { id: 'pin-1' });
    expect(closeSpy).toHaveBeenCalledTimes(1);
  });

  it('sends one close notification when close triggers beforeunload', async () => {
    window.location.hash = '#/pin?id=pin-1';
    window.localStorage.setItem('pin-window:pin-1', JSON.stringify(createPinState()));
    const sendToParent = vi.fn();
    window.ztools = createZTools(sendToParent);
    vi.spyOn(window, 'close').mockImplementation(() => {
      window.dispatchEvent(new Event('beforeunload'));
    });
    const { default: PinView } = await import('../src/views/PinView.vue');
    mount(PinView);

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));

    expect(sendToParent).toHaveBeenCalledTimes(1);
    expect(sendToParent).toHaveBeenCalledWith('top-screenshot-pin-closed', { id: 'pin-1' });
  });

  it('uses transform for wheel zoom while resizing the BrowserWindow in the next frame', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-08T06:00:00.000Z'));
    window.location.hash = '#/pin?id=pin-1';
    const state = createPinState();
    window.localStorage.setItem('pin-window:pin-1', JSON.stringify(state));
    const setItemSpy = vi.spyOn(window.localStorage.__proto__, 'setItem');
    const sendToParent = vi.fn();
    window.ztools = createZTools(sendToParent);
    const callbacks: FrameRequestCallback[] = [];
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callbacks.push(callback);
      return callbacks.length;
    });
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    const { default: PinView } = await import('../src/views/PinView.vue');
    const wrapper = mount(PinView);

    await wrapper.find('.pin-window').trigger('wheel', { deltaY: -100 });
    await wrapper.find('.pin-window').trigger('wheel', { deltaY: -100 });

    expect((wrapper.find('.pin-frame').attributes('style') ?? '')).toContain('width: 320px; height: 180px;');
    expect(wrapper.find('.pin-image').attributes('style')).toContain('width: 320px; height: 180px;');
    expect(wrapper.find('.pin-image').attributes('style')).toContain('transform: scale(1)');
    expect(setItemSpy).toHaveBeenCalledTimes(0);
    expect(sendToParent).not.toHaveBeenCalledWith('top-screenshot-pin-bounds', expect.anything());

    callbacks[0](16);
    await wrapper.vm.$nextTick();

    expect((wrapper.find('.pin-frame').attributes('style') ?? '')).toContain('width: 384px; height: 216px;');
    expect(wrapper.find('.pin-image').attributes('style')).toContain('width: 320px; height: 180px;');
    expect(wrapper.find('.pin-image').attributes('style')).toContain('transform: scale(1.2)');
    expect(JSON.parse(window.localStorage.getItem('pin-window:pin-1')!)).toMatchObject({
      currentBounds: { x: 88, y: 72, width: 384, height: 216 },
      scale: 1.2,
    });
    expect(setItemSpy).toHaveBeenCalledTimes(1);
    expect(sendToParent).toHaveBeenCalledWith('top-screenshot-pin-bounds', {
      id: 'pin-1',
      bounds: { x: 85, y: 69, width: 390, height: 222 },
    });
  });

  it('keeps the frame layout at the scaled size when zoomed to minimum', async () => {
    vi.useFakeTimers();
    window.location.hash = '#/pin?id=pin-1';
    window.localStorage.setItem(
      'pin-window:pin-1',
      JSON.stringify({
        ...createPinState(),
        currentBounds: { x: 230.4, y: 129.6, width: 99.2, height: 55.8 },
        scale: 0.31,
      }),
    );
    const sendToParent = vi.fn();
    window.ztools = createZTools(sendToParent);
    const callbacks: FrameRequestCallback[] = [];
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callbacks.push(callback);
      return callbacks.length;
    });
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    const { default: PinView } = await import('../src/views/PinView.vue');
    const wrapper = mount(PinView);

    await wrapper.find('.pin-window').trigger('wheel', { deltaY: 100 });
    callbacks[0](16);
    await wrapper.vm.$nextTick();

    expect((wrapper.find('.pin-frame').attributes('style') ?? '')).toContain('width: 96px; height: 54px;');
    expect(wrapper.find('.pin-image').attributes('style')).toContain('width: 320px; height: 180px;');
    expect(wrapper.find('.pin-image').attributes('style')).toContain('transform: scale(0.3)');
    expect(sendToParent).toHaveBeenCalledWith('top-screenshot-pin-bounds', {
      id: 'pin-1',
      bounds: { x: 229, y: 128, width: 102, height: 60 },
    });
  });

  it('does not flush stale wheel bounds after an immediate drag move', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-08T06:00:00.000Z'));
    window.location.hash = '#/pin?id=pin-1';
    window.localStorage.setItem('pin-window:pin-1', JSON.stringify(createPinState()));
    const sendToParent = vi.fn();
    window.ztools = createZTools(sendToParent);
    const callbacks: FrameRequestCallback[] = [];
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callbacks.push(callback);
      return callbacks.length;
    });
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    const { default: PinView } = await import('../src/views/PinView.vue');
    const wrapper = mount(PinView);

    await wrapper.find('.pin-window').trigger('wheel', { deltaY: -100 });
    await wrapper.find('.pin-window').trigger('mousedown', { button: 0, screenX: 200, screenY: 100 });
    window.dispatchEvent(new MouseEvent('mousemove', { screenX: 210, screenY: 105 }));

    expect(sendToParent).toHaveBeenCalledTimes(1);
    expect(sendToParent).toHaveBeenCalledWith('top-screenshot-pin-bounds', {
      id: 'pin-1',
      bounds: { x: 111, y: 83, width: 358, height: 204 },
    });
    expect(JSON.parse(window.localStorage.getItem('pin-window:pin-1')!)).toMatchObject({
      currentBounds: { x: 114, y: 86, width: 352, height: 198 },
      scale: 1.1,
    });

    callbacks[0](16);

    expect(sendToParent).toHaveBeenCalledTimes(1);
  });
});

function createPinState(): PinWindowState {
  return {
    id: 'pin-1',
    imageDataUrl: 'data:image/png;base64,cropped',
    originalBounds: { x: 120, y: 90, width: 320, height: 180 },
    currentBounds: { x: 120, y: 90, width: 320, height: 180 },
    scale: 1,
    createdAt: 1780898400000,
    lastActiveAt: 1780898400000,
  };
}

function createZTools(sendToParent: (channel: string, ...args: unknown[]) => void) {
  return {
    sendToParent,
    getAllDisplays: () => [],
    desktopCaptureSources: () => [],
    createBrowserWindow: () => null,
  };
}
