import { onBeforeUnmount, ref, shallowRef, watch, type Ref } from "vue";

import { createPointerReorderSession, type PointerReorderFinish, type PointerReorderSession } from "./pointer-reorder-session";

export type PinboardReorderRequest = Readonly<{
  id: string;
  beforeId?: string;
  afterId?: string;
}>;
export type PinboardReorderTarget = Readonly<{ id: string; position: "before" | "after" }>;
type Slot = Readonly<{ id: string; left: number; width: number }>;
type Active = Readonly<{
  id: string;
  ids: readonly string[];
  slots: readonly Slot[];
  scrollLeft: number;
  gap: number;
  source: HTMLElement;
  preview: HTMLElement;
  target?: PinboardReorderTarget | undefined;
}>;

export function usePinboardReorder(
  strip: Ref<HTMLElement | undefined>,
  ids: Ref<readonly string[]>,
  onReorder: (value: PinboardReorderRequest) => void,
) {
  const active = shallowRef<Active>();
  const offsets = ref<Record<string, number>>({});
  let session: PointerReorderSession | undefined;
  let sequence: string | undefined;
  let clickTimer: number | undefined;
  let suppressUntil = 0;
  let lastPointer: Pick<PointerEvent, "clientX" | "clientY"> | undefined;

  function detachGestureListeners(): void {
    strip.value?.removeEventListener("scroll", onStripScroll);
    window.removeEventListener("resize", cancel);
    lastPointer = undefined;
  }

  function clearClickSuppression(): void {
    document.removeEventListener("click", suppressClick, true);
    document.removeEventListener("pointerdown", resetClickSuppression, true);
    if (clickTimer !== undefined) window.clearTimeout(clickTimer);
    clickTimer = undefined;
    suppressUntil = 0;
  }

  function armClickSuppression(): void {
    clearClickSuppression();
    suppressUntil = performance.now() + 450;
    document.addEventListener("click", suppressClick, true);
    document.addEventListener("pointerdown", resetClickSuppression, true);
    clickTimer = window.setTimeout(clearClickSuppression, 450);
  }

  function suppressClick(event: MouseEvent): void {
    if (event.detail === 0 || performance.now() > suppressUntil) {
      clearClickSuppression();
      return;
    }
    clearClickSuppression();
    event.preventDefault();
    event.stopImmediatePropagation();
  }

  function resetClickSuppression(): void {
    clearClickSuppression();
  }

  function orderFor(state: Active): string[] {
    const target = state.target;
    const next = state.ids.filter((id) => id !== state.id);
    if (target === undefined) return [...state.ids];
    const index = next.indexOf(target.id);
    if (index < 0) return [...state.ids];
    next.splice(index + (target.position === "after" ? 1 : 0), 0, state.id);
    return next;
  }

  function updateOffsets(state: Active): void {
    if (state.target === undefined || state.slots.length === 0) {
      offsets.value = {};
      return;
    }
    let left = state.slots[0]!.left;
    const nextOffsets: Record<string, number> = {};
    for (const id of orderFor(state)) {
      const slot = state.slots.find((entry) => entry.id === id);
      if (slot === undefined) continue;
      const delta = left - slot.left;
      if (Math.abs(delta) > 0.5) nextOffsets[id] = delta;
      left += slot.width + state.gap;
    }
    offsets.value = nextOffsets;
  }

  function setTarget(target: PinboardReorderTarget | undefined): void {
    const state = active.value;
    if (state === undefined) return;
    if (state.target?.id === target?.id && state.target?.position === target?.position) return;
    const next = { ...state, target };
    active.value = next;
    updateOffsets(next);
  }

  function movePreview(state: Active, x: number, y: number): void {
    const sourceSlot = state.slots.find((slot) => slot.id === state.id);
    const height = state.source.getBoundingClientRect().height;
    state.preview.style.left = `${x - (sourceSlot?.width ?? 0) / 2}px`;
    state.preview.style.top = `${y - height / 2}px`;
  }

  function update(event: Pick<PointerEvent, "clientX" | "clientY">): void {
    lastPointer = event;
    const state = active.value;
    const element = strip.value;
    if (state === undefined || element === undefined) return;
    movePreview(state, event.clientX, event.clientY);
    const bounds = element.getBoundingClientRect();
    if (
      event.clientY < bounds.top || event.clientY > bounds.bottom ||
      event.clientX < bounds.left || event.clientX > bounds.right
    ) {
      setTarget(undefined);
      return;
    }
    const scrollDelta = element.scrollLeft - state.scrollLeft;
    for (const slot of state.slots) {
      if (event.clientX < slot.left - scrollDelta + slot.width / 2) {
        setTarget(slot.id === state.id ? undefined : { id: slot.id, position: "before" });
        return;
      }
    }
    const last = state.slots.at(-1);
    setTarget(last === undefined || last.id === state.id
      ? undefined
      : { id: last.id, position: "after" });
  }

  function onStripScroll(): void {
    const pointer = lastPointer;
    if (active.value === undefined || pointer === undefined) {
      cancel();
      return;
    }
    update(pointer);
  }

  function finish(result: PointerReorderFinish): void {
    session = undefined;
    sequence = undefined;
    detachGestureListeners();
    const state = active.value;
    if (state === undefined) return;
    const nextOrder = orderFor(state);
    const nextIndex = nextOrder.indexOf(state.id);
    const stripElement = strip.value;
    const pointer = result.event;
    const bounds = stripElement?.getBoundingClientRect();
    const inside = pointer !== undefined && bounds !== undefined &&
      pointer.clientX >= bounds.left && pointer.clientX <= bounds.right &&
      pointer.clientY >= bounds.top && pointer.clientY <= bounds.bottom;
    const canCommit = result.dragged && !result.cancelled && inside &&
      ids.value.join("\0") === state.ids.join("\0") &&
      state.target !== undefined &&
      nextOrder.some((id, index) => id !== state.ids[index]);

    active.value = undefined;
    offsets.value = {};
    state.preview.remove();
    if (result.dragged) armClickSuppression();
    if (canCommit && nextIndex >= 0) {
      onReorder({
        id: state.id,
        ...(nextIndex > 0 ? { beforeId: nextOrder[nextIndex - 1] } : {}),
        ...(nextIndex + 1 < nextOrder.length ? { afterId: nextOrder[nextIndex + 1] } : {}),
      });
    }
  }

  function start(event: PointerEvent, id: string, handle: HTMLElement): void {
    if (event.button !== 0 || !event.isPrimary || !ids.value.includes(id)) return;
    resetClickSuppression();
    session?.cancel();
    const element = strip.value;
    if (element === undefined) return;
    const snapshot = [...ids.value];
    const slots: Slot[] = snapshot.flatMap((pinboardId) => {
      const slot = [...element.querySelectorAll<HTMLElement>(".pinboard-chip")]
        .find((candidate) => candidate.dataset.pbPinboardId === pinboardId);
      if (slot === undefined) return [];
      const bounds = slot.getBoundingClientRect();
      return [{ id: pinboardId, left: bounds.left, width: bounds.width }];
    });
    if (slots.length < 2) return;
    event.preventDefault();
    sequence = snapshot.join("\0");
    const style = window.getComputedStyle(element);
    const gap = Number.parseFloat(style.columnGap || style.gap) || 0;

    const pointerSession = createPointerReorderSession(event, handle, {
      threshold: 5,
      onStart: (pointer) => {
        if (
          sequence !== snapshot.join("\0") ||
          ids.value.join("\0") !== sequence ||
          strip.value !== element
        ) {
          pointerSession.cancel();
          return;
        }
        const source = [...element.querySelectorAll<HTMLElement>(".pinboard-chip")]
          .find((candidate) => candidate.dataset.pbPinboardId === id);
        if (source === undefined) return;
        const preview = createPreview(source);
        const state: Active = {
          id,
          ids: snapshot,
          slots,
          scrollLeft: element.scrollLeft,
          gap,
          source,
          preview,
        };
        active.value = state;
        movePreview(state, pointer.clientX, pointer.clientY);
        update(pointer);
        element.addEventListener("scroll", onStripScroll, { passive: true });
      },
      onMove: update,
      onFinish: finish,
    });
    session = pointerSession;
    element.addEventListener("scroll", onStripScroll, { passive: true });
    window.addEventListener("resize", cancel);
  }

  function cancel(): void {
    const current = session;
    session = undefined;
    sequence = undefined;
    detachGestureListeners();
    current?.cancel();
    const state = active.value;
    state?.preview.remove();
    active.value = undefined;
    offsets.value = {};
  }

  watch(() => ids.value.join("\0"), (next) => {
    if (sequence !== undefined && next !== sequence) cancel();
  });

  onBeforeUnmount(() => {
    cancel();
    clearClickSuppression();
  });

  return { active, offsets, start, cancel, resetClickSuppression };
}

function createPreview(source: HTMLElement): HTMLElement {
  const preview = source.cloneNode(true) as HTMLElement;
  const computedStyle = window.getComputedStyle(source);
  preview.removeAttribute("id");
  preview.removeAttribute("role");
  preview.removeAttribute("tabindex");
  for (const attribute of [...preview.attributes]) {
    if (attribute.name.startsWith("data-pb-") || attribute.name.startsWith("aria-")) {
      preview.removeAttribute(attribute.name);
    }
  }
  preview.querySelector(".manage-button")?.remove();
  const sourceButtons = source.querySelectorAll<HTMLButtonElement>("button:not(.manage-button)");
  const previewButtons = preview.querySelectorAll<HTMLButtonElement>("button");
  sourceButtons.forEach((button, index) => {
    const copy = previewButtons[index];
    if (copy === undefined) return;
    const style = window.getComputedStyle(button);
    Object.assign(copy.style, {
      display: style.display,
      flex: style.flex,
      gap: style.gap,
      alignItems: style.alignItems,
      minHeight: style.minHeight,
      padding: style.padding,
      border: style.border,
      borderRadius: style.borderRadius,
      background: style.background,
      color: style.color,
      fontFamily: style.fontFamily,
      fontSize: style.fontSize,
      fontWeight: style.fontWeight,
      lineHeight: style.lineHeight,
    });
  });
  for (const element of preview.querySelectorAll<HTMLElement>("[id], [role], [tabindex], [data-pb-pinboard-id], [aria-label]")) {
    element.removeAttribute("id");
    element.removeAttribute("role");
    element.removeAttribute("tabindex");
    element.removeAttribute("data-pb-pinboard-id");
    element.removeAttribute("aria-label");
  }
  preview.setAttribute("aria-hidden", "true");
  preview.setAttribute("inert", "");
  preview.classList.add("pinboard-reorder-preview");
  preview.setAttribute("data-pb-reorder-preview", "true");
  for (const attribute of source.attributes) {
    if (attribute.name.startsWith("data-v-")) preview.setAttribute(attribute.name, attribute.value);
  }
  const bounds = source.getBoundingClientRect();
  Object.assign(preview.style, {
    position: "fixed",
    left: `${bounds.left}px`,
    top: `${bounds.top}px`,
    width: `${bounds.width}px`,
    height: `${bounds.height}px`,
    zIndex: "2147483647",
    margin: "0",
    pointerEvents: "none",
    userSelect: "none",
    WebkitUserSelect: "none",
    color: computedStyle.color,
    fontFamily: computedStyle.fontFamily,
    fontSize: computedStyle.fontSize,
    fontWeight: computedStyle.fontWeight,
    lineHeight: computedStyle.lineHeight,
    boxShadow: "0 12px 28px rgb(10 16 24 / 28%)",
  });
  for (const name of [...computedStyle]) {
    if (name.startsWith("--pb-")) {
      preview.style.setProperty(name, computedStyle.getPropertyValue(name));
    }
  }
  document.body.append(preview);
  return preview;
}
