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
import { PIN_WINDOW_BOUNDS_CHANNEL, PIN_WINDOW_CLOSED_CHANNEL } from '../core/pinWindowMessages';
import { loadPinWindow, removePinWindow, savePinWindow, type PinWindowState } from '../core/storage';

const FRAME_SIZE = 3;

const params = new URLSearchParams(window.location.hash.split('?')[1] ?? '');
const pinId = params.get('id') ?? '';
const loaded = loadPinWindow(window.localStorage, pinId);
const pinState = ref<PinWindowState | null>(loaded);
const dragStart = ref<Point | null>(null);
const dragStartBounds = ref<Rect | null>(null);
let pendingPinState: PinWindowState | null = null;
let pendingWindowBounds: Rect | null = null;
let pendingWindowFrame = 0;
let hasNotifiedClosed = false;

const frameStyle = computed(() => {
  if (!pinState.value) {
    return {};
  }

  return {
    width: `${pinState.value.currentBounds.width}px`,
    height: `${pinState.value.currentBounds.height}px`,
  };
});

const imageStyle = computed(() => {
  if (!pinState.value) {
    return {};
  }

  return {
    width: `${pinState.value.originalBounds.width}px`,
    height: `${pinState.value.originalBounds.height}px`,
    transform: `scale(${pinState.value.scale})`,
  };
});

function currentPinState(): PinWindowState | null {
  return pendingPinState ?? pinState.value;
}

function persist(nextState: PinWindowState): void {
  pinState.value = nextState;
  savePinWindow(window.localStorage, nextState);
}

function applyWindowBounds(imageBounds: Rect): void {
  clearScheduledWindowBounds();
  applyOuterWindowBounds(outerBoundsForImage(imageBounds, FRAME_SIZE));
}

function scheduleWheelUpdate(nextState: PinWindowState): void {
  pendingPinState = nextState;
  pendingWindowBounds = outerBoundsForImage(nextState.currentBounds, FRAME_SIZE);

  if (pendingWindowFrame) {
    return;
  }

  pendingWindowFrame = requestAnimationFrame(flushWheelUpdate);
}

function clearScheduledWindowBounds(): void {
  if (pendingWindowFrame) {
    cancelAnimationFrame(pendingWindowFrame);
    pendingWindowFrame = 0;
  }

  pendingPinState = null;
  pendingWindowBounds = null;
}

function flushWheelUpdate(): void {
  pendingWindowFrame = 0;

  if (!pendingPinState || !pendingWindowBounds) {
    return;
  }

  const nextState = pendingPinState;
  const outerBounds = pendingWindowBounds;
  pendingPinState = null;
  pendingWindowBounds = null;

  persist(nextState);
  applyOuterWindowBounds(outerBounds);
}

function applyOuterWindowBounds(outerBounds: Rect): void {
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
  const currentState = currentPinState();

  if (!currentState) {
    return;
  }

  event.preventDefault();
  const nextScale = scaleFromWheelDelta(currentState.scale, event.deltaY);
  if (nextScale === currentState.scale) {
    return;
  }

  const center = rectCenter(currentState.currentBounds);
  const nextImageBounds = imageBoundsForOriginalSize(center, currentState.originalBounds, nextScale);
  const nextState = {
    ...currentState,
    currentBounds: nextImageBounds,
    scale: nextScale,
    lastActiveAt: Date.now(),
  };

  scheduleWheelUpdate(nextState);
}

function onMouseDown(event: MouseEvent): void {
  const currentState = currentPinState();

  if (!currentState || event.button !== 0) {
    return;
  }

  dragStart.value = { x: event.screenX, y: event.screenY };
  dragStartBounds.value = currentState.currentBounds;
  activate();
}

function onMouseMove(event: MouseEvent): void {
  const currentState = currentPinState();

  if (!currentState || !dragStart.value || !dragStartBounds.value) {
    return;
  }

  const deltaX = event.screenX - dragStart.value.x;
  const deltaY = event.screenY - dragStart.value.y;
  const nextImageBounds = translateRect(dragStartBounds.value, deltaX, deltaY);
  const nextState = {
    ...currentState,
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
  notifyPinClosed();
  window.close();
}

function notifyPinClosed(): void {
  if (!pinId || hasNotifiedClosed) {
    return;
  }

  hasNotifiedClosed = true;
  window.ztools?.sendToParent?.(PIN_WINDOW_CLOSED_CHANNEL, { id: pinId });
}

function onBeforeUnload(): void {
  removePinWindow(window.localStorage, pinId);
  notifyPinClosed();
}

function onKeyDown(event: KeyboardEvent): void {
  if (event.key === 'Escape') {
    closePinWindow();
  }
}

window.addEventListener('keydown', onKeyDown);
window.addEventListener('mousemove', onMouseMove);
window.addEventListener('mouseup', onMouseUp);
window.addEventListener('blur', onMouseUp);
window.addEventListener('beforeunload', onBeforeUnload);
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeyDown);
  window.removeEventListener('mousemove', onMouseMove);
  window.removeEventListener('mouseup', onMouseUp);
  window.removeEventListener('blur', onMouseUp);
  window.removeEventListener('beforeunload', onBeforeUnload);

  clearScheduledWindowBounds();
});
</script>

<template>
  <main
    v-if="pinState"
    class="pin-window"
    tabindex="0"
    @mousedown="onMouseDown"
    @wheel="onWheel"
  >
    <div class="pin-frame" :style="frameStyle">
      <img class="pin-image" :src="pinState.imageDataUrl" :style="imageStyle" alt="置顶截图" draggable="false" />
    </div>
  </main>
  <main v-else class="pin-window pin-window-empty">截图数据不存在</main>
</template>
