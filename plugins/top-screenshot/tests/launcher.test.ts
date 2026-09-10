import { describe, expect, it } from 'vitest';
import { canStartCapture, captureWindowOptions, createCaptureSession, pinWindowOptions, statusMessageForStartFailure } from '../src/core/launcher';
import type { DisplaySnapshot } from '../src/core/storage';

const display: DisplaySnapshot = {
  displayId: '1',
  bounds: { x: 10, y: 20, width: 800, height: 600 },
  imageDataUrl: 'data:image/png;base64,screen',
  scaleFactor: 1,
};

describe('launcher', () => {
  it('creates a pending capture session from display snapshots', () => {
    expect(createCaptureSession('capture-1', 1780660800000, [display])).toEqual({
      id: 'capture-1',
      createdAt: 1780660800000,
      completed: false,
      displays: [display],
    });
  });

  it('creates a fullscreen capture overlay window so the real taskbar is covered', () => {
    expect(captureWindowOptions(display)).toEqual({
      x: 10,
      y: 20,
      width: 800,
      height: 600,
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
    });
  });

  it('creates transparent always-on-top pin window options around the selected image', () => {
    expect(pinWindowOptions({ x: 120, y: 90, width: 320, height: 180 })).toEqual({
      x: 117,
      y: 87,
      width: 326,
      height: 186,
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
    });
  });

  it('only blocks starts while a capture session is currently starting', () => {
    expect(canStartCapture(false)).toBe(true);
    expect(canStartCapture(true)).toBe(false);
  });

  it('formats unknown start failures for display', () => {
    expect(statusMessageForStartFailure('bad')).toBe('截图启动失败');
    expect(statusMessageForStartFailure(new Error('missing ztools'))).toBe('missing ztools');
  });
});
