import { afterEach, describe, expect, it, vi } from "vitest";
import { createPointerReorderSession } from "../src/pointer-reorder-session";

// A synchronous event source lets callback exceptions be asserted directly.
// Browser tests separately cover actual pointer capture and DOM cleanup.
class EventSurface {
  hidden = false;
  captured = new Set<number>();
  listeners = new Map<string, Set<EventListener>>();

  addEventListener(type: string, listener: EventListener): void {
    const entries = this.listeners.get(type) ?? new Set<EventListener>();
    entries.add(listener);
    this.listeners.set(type, entries);
  }
  removeEventListener(type: string, listener: EventListener): void {
    this.listeners.get(type)?.delete(listener);
  }
  send(event: Event): void {
    if (event.target === null) Object.defineProperty(event, "target", { value: this });
    for (const listener of [...(this.listeners.get(event.type) ?? [])]) listener(event);
  }
  setPointerCapture(id: number): void { this.captured.add(id); }
  hasPointerCapture(id: number): boolean { return this.captured.has(id); }
  releasePointerCapture(id: number): void {
    this.captured.delete(id);
    this.send(pointer("lostpointercapture", 0, 0, id));
  }
}

function pointer(type: string, x: number, y = 0, id = 1): PointerEvent {
  return Object.assign(new Event(type, { cancelable: true }), {
    clientX: x, clientY: y, pointerId: id,
  }) as PointerEvent;
}

function harness() {
  const documentSurface = new EventSurface();
  const windowSurface = new EventSurface();
  const handle = new EventSurface();
  vi.stubGlobal("document", documentSurface);
  vi.stubGlobal("window", windowSurface);
  const onStart = vi.fn();
  const onMove = vi.fn();
  const onFinish = vi.fn();
  const session = createPointerReorderSession(
    pointer("pointerdown", 0),
    handle as unknown as HTMLElement,
    { onStart, onMove, onFinish },
  );
  return { documentSurface, windowSurface, handle, session, onStart, onMove, onFinish };
}

afterEach(() => vi.unstubAllGlobals());

describe("pointer reorder session terminal events", () => {
  it("leaves a handle tap as a click and starts only after the movement threshold", () => {
    const h = harness();
    h.documentSurface.send(pointer("pointermove", 3));
    expect(h.onStart).not.toHaveBeenCalled();
    h.documentSurface.send(pointer("pointerup", 3));
    expect(h.onFinish).toHaveBeenCalledWith(expect.objectContaining({ dragged: false, cancelled: false }));
    expect(h.handle.captured.size).toBe(0);
  });

  it("ignores other pointers and finishes the owner once even when capture is released", () => {
    const h = harness();
    h.documentSurface.send(pointer("pointermove", 20, 0, 2));
    h.documentSurface.send(pointer("pointerup", 20, 0, 2));
    expect(h.onStart).not.toHaveBeenCalled();
    expect(h.onFinish).not.toHaveBeenCalled();
    h.documentSurface.send(pointer("pointermove", 6));
    h.documentSurface.send(pointer("pointerup", 14));
    h.session.cancel();
    h.documentSurface.send(pointer("pointermove", 24));
    expect(h.onStart).toHaveBeenCalledTimes(1);
    expect(h.onMove).toHaveBeenCalledTimes(2);
    expect(h.onFinish).toHaveBeenCalledTimes(1);
    expect(h.onFinish).toHaveBeenCalledWith(expect.objectContaining({ dragged: true, cancelled: false }));
    expect(h.session.isDragging()).toBe(false);
  });

  it.each(["pointercancel", "lostpointercapture", "blur", "visibilitychange", "Escape"])(
    "cancels %s and removes the gesture listeners",
    (terminal) => {
      const h = harness();
      h.documentSurface.send(pointer("pointermove", 8));
      if (terminal === "pointercancel") h.documentSurface.send(pointer(terminal, 8));
      if (terminal === "lostpointercapture") h.handle.send(pointer(terminal, 8));
      if (terminal === "blur") h.windowSurface.send(new Event("blur"));
      if (terminal === "visibilitychange") {
        h.documentSurface.hidden = true;
        h.documentSurface.send(new Event("visibilitychange"));
      }
      if (terminal === "Escape") {
        const event = Object.assign(new Event("keydown", { cancelable: true }), { key: "Escape" });
        h.windowSurface.send(event);
        expect(event.defaultPrevented).toBe(true);
      }
      h.documentSurface.send(pointer("pointerup", 12));
      h.session.cancel();
      expect(h.onFinish).toHaveBeenCalledTimes(1);
      expect(h.onFinish).toHaveBeenCalledWith(expect.objectContaining({ dragged: true, cancelled: true }));
      expect(h.onMove).toHaveBeenCalledTimes(1);
      expect(h.handle.captured.size).toBe(0);
    },
  );

  it("ignores a descendant button losing focus while a drag closes its menu", () => {
    const h = harness();
    h.documentSurface.send(pointer("pointermove", 8));
    const childBlur = new Event("blur");
    Object.defineProperty(childBlur, "target", { value: h.handle });
    h.windowSurface.send(childBlur);
    expect(h.session.isDragging()).toBe(true);
    expect(h.onFinish).not.toHaveBeenCalled();
    h.documentSurface.send(pointer("pointerup", 12));
    expect(h.onFinish).toHaveBeenCalledWith(expect.objectContaining({ dragged: true, cancelled: false }));
  });

  it("does not continue a session synchronously cancelled by its start callback", () => {
    const h = harness();
    h.onStart.mockImplementation(() => h.session.cancel());
    h.documentSurface.send(pointer("pointermove", 8));
    expect(h.onMove).not.toHaveBeenCalled();
    expect(h.onFinish).toHaveBeenCalledTimes(1);
  });

  it.each(["start", "move"])("cleans up when the %s callback fails", (stage) => {
    const h = harness();
    const failure = new Error("preview unavailable");
    (stage === "start" ? h.onStart : h.onMove).mockImplementation(() => { throw failure; });
    expect(() => h.documentSurface.send(pointer("pointermove", 8))).toThrow(failure);
    h.documentSurface.send(pointer("pointerup", 12));
    h.windowSurface.send(new Event("blur"));
    expect(h.onFinish).toHaveBeenCalledTimes(1);
    expect(h.onFinish).toHaveBeenCalledWith(expect.objectContaining({ cancelled: true }));
    expect(h.handle.captured.size).toBe(0);
  });
});
