<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue';
import { cropImageDataUrl } from '../core/crop';
import { isValidSelection, normalizeRect, type Point, type Rect } from '../core/geometry';
import {
  finishCaptureSession,
  isCaptureSessionFinishedEvent,
  loadCaptureSession,
  savePinWindow,
  savePinWindowRequest,
  type PinWindowState,
} from '../core/storage';

const params = new URLSearchParams(window.location.hash.split('?')[1] ?? '');
const sessionId = params.get('sessionId') ?? '';
const displayId = params.get('displayId') ?? '';
const session = loadCaptureSession(window.localStorage, sessionId);
const snapshot = session?.displays.find((display) => display.displayId === displayId) ?? null;

const dragStart = ref<Point | null>(null);
const dragEnd = ref<Point | null>(null);
const isCapturing = ref(false);

const selection = computed<Rect | null>(() => {
  if (!dragStart.value || !dragEnd.value) {
    return null;
  }

  return normalizeRect(dragStart.value, dragEnd.value);
});

function pointFromMouse(event: MouseEvent): Point {
  return { x: event.clientX, y: event.clientY };
}

function onMouseDown(event: MouseEvent): void {
  dragStart.value = pointFromMouse(event);
  dragEnd.value = pointFromMouse(event);
}

function onMouseMove(event: MouseEvent): void {
  if (!dragStart.value) {
    return;
  }

  dragEnd.value = pointFromMouse(event);
}

async function onMouseUp(): Promise<void> {
  if (!snapshot || !selection.value || !isValidSelection(selection.value) || isCapturing.value) {
    finishAndCloseCapture();
    return;
  }

  isCapturing.value = true;

  try {
    const imageDataUrl = await cropImageDataUrl(snapshot.imageDataUrl, selection.value, snapshot.scaleFactor);
    const imageBounds = {
      x: snapshot.bounds.x + selection.value.x,
      y: snapshot.bounds.y + selection.value.y,
      width: selection.value.width,
      height: selection.value.height,
    };
    const id = crypto.randomUUID();
    const now = Date.now();
    const pinState: PinWindowState = {
      id,
      imageDataUrl,
      originalBounds: imageBounds,
      currentBounds: imageBounds,
      scale: 1,
      createdAt: now,
      lastActiveAt: now,
    };

    savePinWindow(window.localStorage, pinState);
    savePinWindowRequest(window.localStorage, pinState.id);
    finishAndCloseCapture();
  } catch {
    finishAndCloseCapture();
  }
}

function finishAndCloseCapture(): void {
  finishCaptureSession(window.localStorage, sessionId);
  closeCaptureWindow();
}

function closeCaptureWindow(): void {
  window.close();
}

function onKeyDown(event: KeyboardEvent): void {
  if (event.key === 'Escape') {
    finishAndCloseCapture();
  }
}

function onStorage(event: StorageEvent): void {
  if (isCaptureSessionFinishedEvent(event, sessionId)) {
    closeCaptureWindow();
  }
}

window.addEventListener('keydown', onKeyDown);
window.addEventListener('storage', onStorage);
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeyDown);
  window.removeEventListener('storage', onStorage);
});
</script>

<template>
  <main class="capture-view" tabindex="0" @mousedown="onMouseDown" @mousemove="onMouseMove" @mouseup="onMouseUp">
    <div
      v-if="selection"
      class="selection-box"
      :style="{
        left: `${selection.x}px`,
        top: `${selection.y}px`,
        width: `${selection.width}px`,
        height: `${selection.height}px`,
      }"
    />
    <p v-if="!snapshot" class="capture-error">没有找到当前显示器截图。</p>
  </main>
</template>
