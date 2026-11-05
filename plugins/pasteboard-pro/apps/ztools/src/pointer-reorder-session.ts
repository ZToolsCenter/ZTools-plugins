export type PointerReorderFinish = Readonly<{
  dragged: boolean;
  cancelled: boolean;
  event: PointerEvent | undefined;
}>;

export type PointerReorderSession = Readonly<{
  cancel: () => void;
  isDragging: () => boolean;
}>;

type PointerReorderSessionOptions = Readonly<{
  onStart: (event: PointerEvent) => void;
  onMove: (event: PointerEvent) => void;
  onFinish: (result: PointerReorderFinish) => void;
  threshold?: number;
}>;

/** Owns one handle gesture from pointerdown through a single terminal event. */
export function createPointerReorderSession(
  startEvent: PointerEvent,
  captureTarget: HTMLElement,
  options: PointerReorderSessionOptions,
): PointerReorderSession {
  const threshold = Math.max(1, options.threshold ?? 5);
  const startX = startEvent.clientX;
  const startY = startEvent.clientY;
  let dragged = false;
  let closed = false;
  let lastEvent: PointerEvent | undefined = startEvent;

  const belongsToSession = (event: PointerEvent): boolean =>
    event.pointerId === startEvent.pointerId;

  const finish = (cancelled: boolean, event?: PointerEvent): void => {
    if (closed) return;
    closed = true;
    if (event !== undefined) lastEvent = event;
    document.removeEventListener("pointermove", onPointerMove, true);
    document.removeEventListener("pointerup", onPointerUp, true);
    document.removeEventListener("pointercancel", onPointerCancel, true);
    document.removeEventListener("visibilitychange", onVisibilityChange, true);
    captureTarget.removeEventListener("lostpointercapture", onLostPointerCapture, true);
    window.removeEventListener("blur", onWindowBlur, true);
    window.removeEventListener("keydown", onKeydown, true);
    if (captureTarget.hasPointerCapture?.(startEvent.pointerId)) {
      try {
        captureTarget.releasePointerCapture(startEvent.pointerId);
      } catch {
        // The browser may already have released capture while dispatching blur.
      }
    }
    options.onFinish({ dragged, cancelled, event: event ?? lastEvent });
  };

  const update = (event: PointerEvent): void => {
    if (!belongsToSession(event) || closed) return;
    lastEvent = event;
    if (!dragged) {
      const distance = Math.hypot(event.clientX - startX, event.clientY - startY);
      if (distance < threshold) return;
      dragged = true;
      try {
        options.onStart(event);
      } catch (error) {
        finish(true, event);
        throw error;
      }
      if (closed) return;
    }
    event.preventDefault();
    try {
      options.onMove(event);
    } catch (error) {
      finish(true, event);
      throw error;
    }
  };

  function onPointerMove(event: PointerEvent): void {
    update(event);
  }

  function onPointerUp(event: PointerEvent): void {
    if (!belongsToSession(event)) return;
    update(event);
    finish(false, event);
  }

  function onPointerCancel(event: PointerEvent): void {
    if (belongsToSession(event)) finish(true, event);
  }

  function onLostPointerCapture(event: PointerEvent): void {
    if (belongsToSession(event)) finish(true, event);
  }

  function onWindowBlur(event: FocusEvent): void {
    // Capture also sees focus leaving a button inside this document.
    // Closing a focused menu must not cancel an otherwise live pointer gesture.
    if (event.target !== window) return;
    if (dragged) event.stopImmediatePropagation();
    finish(true);
  }

  function onVisibilityChange(): void {
    if (document.hidden) finish(true);
  }

  function onKeydown(event: KeyboardEvent): void {
    if (event.key !== "Escape") return;
    if (dragged) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
    finish(true);
  }

  document.addEventListener("pointermove", onPointerMove, true);
  document.addEventListener("pointerup", onPointerUp, true);
  document.addEventListener("pointercancel", onPointerCancel, true);
  document.addEventListener("visibilitychange", onVisibilityChange, true);
  captureTarget.addEventListener("lostpointercapture", onLostPointerCapture, true);
  window.addEventListener("blur", onWindowBlur, true);
  window.addEventListener("keydown", onKeydown, true);
  try {
    captureTarget.setPointerCapture(startEvent.pointerId);
  } catch {
    // Document-level listeners still complete the gesture without pointer capture.
  }

  return {
    cancel: () => finish(true),
    isDragging: () => dragged && !closed,
  };
}
