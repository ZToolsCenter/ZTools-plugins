/** Keep a source renderer alive until an HTML drag reaches its drop/end event. */
export function createShelfDragLifecycle(closeShelf: () => void, hasFocus: () => boolean) {
  let dragging = false;
  let blurred = false;

  function start(event: DragEvent): void {
    if (event.defaultPrevented || !(event.target instanceof Element)) return;
    if (event.target.closest("[data-pb-item-id]") === null) return;
    dragging = true;
    blurred = false;
  }

  function end(): void {
    if (!dragging) return;
    dragging = false;
    const shouldClose = blurred && !hasFocus();
    blurred = false;
    if (shouldClose) closeShelf();
  }

  function deferBlur(): boolean {
    if (!dragging) return false;
    blurred = true;
    return true;
  }

  return { start, end, deferBlur, get active() { return dragging; } };
}
