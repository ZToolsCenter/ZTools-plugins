<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue';
import {
  imageBoundsForOriginalSize,
  outerBoundsForImage,
  rectCenter,
  scaleFromWheelDelta,
  translateRect,
  type Point,
  type Rect,
} from '../core/geometry';
import { PIN_WINDOW_BOUNDS_CHANNEL } from '../core/pinWindowMessages';
import { loadPinWindow, removePinWindow, savePinWindow, type PinWindowState } from '../core/storage';

const FRAME_SIZE = 3;

const params = new URLSearchParams(window.location.hash.split('?')[1] ?? '');
const pinId = params.get('id') ?? '';
const loaded = loadPinWindow(window.localStorage, pinId);
const pinState = ref<PinWindowState | null>(loaded);
const dragStart = ref<Point | null>(null);
const dragStartBounds = ref<Rect | null>(null);

const imageStyle = computed(() => {
  if (!pinState.value) {
    return {};
  }

  return {
    width: `${pinState.value.currentBounds.width}px`,
    height: `${pinState.value.currentBounds.height}px`,
  };
});

function persist(nextState: PinWindowState): void {
  pinState.value = nextState;
  savePinWindow(window.localStorage, nextState);
}

function applyWindowBounds(imageBounds: Rect): void {
  const outerBounds = outerBoundsForImage(imageBounds, FRAME_SIZE);

  if (pinState.value && window.ztools?.sendToParent) {
    window.ztools.sendToParent(PIN_WINDOW_BOUNDS_CHANNEL, {
      id: pinState.value.id,
      bounds: outerBounds,
    });
    return;
  }

  window.moveTo(outerBounds.x, outerBounds.y);
  window.resizeTo(outerBounds.width, outerBounds.height);
}

function activate(): void {
  if (!pinState.value) {
    return;
  }

  persist({ ...pinState.value, lastActiveAt: Date.now() });
}

function onWheel(event: WheelEvent): void {
  if (!pinState.value) {
    return;
  }

  event.preventDefault();
  const nextScale = scaleFromWheelDelta(pinState.value.scale, event.deltaY);
  if (nextScale === pinState.value.scale) {
    return;
  }

  const center = rectCenter(pinState.value.currentBounds);
  const nextImageBounds = imageBoundsForOriginalSize(center, pinState.value.originalBounds, nextScale);
  const nextState = {
    ...pinState.value,
    currentBounds: nextImageBounds,
    scale: nextScale,
    lastActiveAt: Date.now(),
  };

  persist(nextState);
  applyWindowBounds(nextImageBounds);
}

function onMouseDown(event: MouseEvent): void {
  if (!pinState.value || event.button !== 0) {
    return;
  }

  dragStart.value = { x: event.screenX, y: event.screenY };
  dragStartBounds.value = pinState.value.currentBounds;
  activate();
}

function onMouseMove(event: MouseEvent): void {
  if (!pinState.value || !dragStart.value || !dragStartBounds.value) {
    return;
  }

  const deltaX = event.screenX - dragStart.value.x;
  const deltaY = event.screenY - dragStart.value.y;
  const nextImageBounds = translateRect(dragStartBounds.value, deltaX, deltaY);
  const nextState = {
    ...pinState.value,
    currentBounds: nextImageBounds,
    lastActiveAt: Date.now(),
  };

  persist(nextState);
  applyWindowBounds(nextImageBounds);
}

function onMouseUp(): void {
  dragStart.value = null;
  dragStartBounds.value = null;
}

function closePinWindow(): void {
  removePinWindow(window.localStorage, pinId);
  window.close();
}

function onKeyDown(event: KeyboardEvent): void {
  if (event.key === 'Escape') {
    closePinWindow();
  }
}

window.addEventListener('keydown', onKeyDown);
window.addEventListener('blur', onMouseUp);
window.addEventListener('beforeunload', () => removePinWindow(window.localStorage, pinId));
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeyDown);
  window.removeEventListener('blur', onMouseUp);
});
</script>

<template>
  <main
    v-if="pinState"
    class="pin-window"
    tabindex="0"
    @mousedown="onMouseDown"
    @mousemove="onMouseMove"
    @mouseup="onMouseUp"
    @wheel="onWheel"
  >
    <div class="pin-frame">
      <img class="pin-image" :src="pinState.imageDataUrl" :style="imageStyle" alt="置顶截图" draggable="false" />
    </div>
  </main>
  <main v-else class="pin-window pin-window-empty">截图数据不存在</main>
</template>
