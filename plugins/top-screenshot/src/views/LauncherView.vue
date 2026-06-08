<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue';
import { canStartCapture, pinWindowOptions, statusMessageForStartFailure } from '../core/launcher';
import type { Rect } from '../core/geometry';
import { isPinWindowBoundsMessage, PIN_WINDOW_BOUNDS_CHANNEL } from '../core/pinWindowMessages';
import { buildPluginUrl } from '../core/routes';
import { isPinWindowRequestEvent, loadPinWindow, savePinWindow, type PinWindowState } from '../core/storage';
import type { BrowserWindowProxy } from '../types/ztools';
import { createPluginWindow, requireZTools } from '../core/ztoolsBridge';

const isStarting = ref(false);
const pinWindows = new Map<string, BrowserWindowProxy>();
let removeParentMessageListener: (() => void) | null = null;

function createPinState(imageDataUrl: string, bounds: Rect): PinWindowState {
  const id = crypto.randomUUID();
  const now = Date.now();

  return {
    id,
    imageDataUrl,
    originalBounds: bounds,
    currentBounds: bounds,
    scale: 1,
    createdAt: now,
    lastActiveAt: now,
  };
}

function openPinWindow(pinState: PinWindowState): void {
  const api = requireZTools();
  const win = createPluginWindow(
    api,
    buildPluginUrl('pin', { id: pinState.id }, window.location.href.split('#')[0]),
    pinWindowOptions(pinState.currentBounds),
  );

  if (win) {
    pinWindows.set(pinState.id, win);
  }
}

function saveAndOpenPin(imageDataUrl: string, bounds: Rect): void {
  const api = requireZTools();
  const dipBounds = api.screenToDipRect?.(bounds) ?? nativeBoundsToDip(bounds);
  const pinState = createPinState(imageDataUrl, dipBounds);

  savePinWindow(window.localStorage, pinState);
  openPinWindow(pinState);
  api.outPlugin?.(false);
}

function nativeBoundsToDip(bounds: Rect): Rect {
  const scaleFactor = window.devicePixelRatio || 1;

  return {
    x: Math.round(bounds.x / scaleFactor),
    y: Math.round(bounds.y / scaleFactor),
    width: Math.round(bounds.width / scaleFactor),
    height: Math.round(bounds.height / scaleFactor),
  };
}

function onStorage(event: StorageEvent): void {
  const pinWindowId = isPinWindowRequestEvent(event);

  if (!pinWindowId) {
    return;
  }

  const pinState = loadPinWindow(window.localStorage, pinWindowId);

  if (pinState) {
    openPinWindow(pinState);
  }
}

function onParentMessage(...args: unknown[]): void {
  const message = args.at(-1);

  if (!isPinWindowBoundsMessage(message)) {
    return;
  }

  const win = pinWindows.get(message.id);

  if (!win) {
    return;
  }

  if (win.setBounds) {
    win.setBounds(message.bounds);
    return;
  }

  win.setPosition?.(message.bounds.x, message.bounds.y);
  win.setSize?.(message.bounds.width, message.bounds.height);
}

async function startCapture(): Promise<void> {
  if (!canStartCapture(isStarting.value)) {
    return;
  }

  isStarting.value = true;

  try {
    const api = requireZTools();

    api.hideMainWindow?.(false);
    api.screenCapture?.((imageDataUrl, bounds) => {
      isStarting.value = false;

      if (!imageDataUrl || !bounds) {
        api.outPlugin?.(true);
        return;
      }

      saveAndOpenPin(imageDataUrl, bounds);
    });
  } catch (error) {
    console.error(statusMessageForStartFailure(error));
    isStarting.value = false;
    window.ztools?.outPlugin?.(true);
  }
}

onMounted(() => {
  window.addEventListener('storage', onStorage);
  removeParentMessageListener = window.ztools?.onParentMessage?.(PIN_WINDOW_BOUNDS_CHANNEL, onParentMessage) ?? null;

  const api = window.ztools;
  api?.onPluginEnter?.(() => {
    void startCapture();
  });
  api?.onPluginReady?.(() => {
    void startCapture();
  });
  void startCapture();
});

onBeforeUnmount(() => {
  window.removeEventListener('storage', onStorage);
  removeParentMessageListener?.();
});
</script>

<template></template>
