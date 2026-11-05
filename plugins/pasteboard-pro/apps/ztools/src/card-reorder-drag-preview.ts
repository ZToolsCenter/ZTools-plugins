export type CardReorderDragPreview = Readonly<{
  element: HTMLElement;
  move: (clientX: number, clientY: number) => void;
  remove: () => void;
}>;

/** A decorative pointer-following clone. It never participates in live-card queries. */
export function createCardReorderDragPreview(
  sourceCard: HTMLElement,
  sourceCount: number,
  clientX: number,
  clientY: number,
): CardReorderDragPreview | undefined {
  const bounds = sourceCard.getBoundingClientRect();
  if (bounds.width <= 0 || bounds.height <= 0) return undefined;

  const preview = document.createElement("div");
  preview.className = "paste-card-drag-group";
  preview.dataset.pbReorderPreview = "true";
  preview.dataset.pbDragPreviewCount = String(sourceCount);
  preview.setAttribute("aria-hidden", "true");
  for (const attribute of sourceCard.attributes) {
    if (attribute.name.startsWith("data-v-")) preview.setAttribute(attribute.name, attribute.value);
  }
  Object.assign(preview.style, {
    position: "fixed",
    zIndex: "10000",
    width: `${bounds.width}px`,
    height: `${bounds.height}px`,
    pointerEvents: "none",
    userSelect: "none",
    WebkitUserSelect: "none",
  });

  const sourceStyle = window.getComputedStyle(sourceCard);
  const inheritedClasses = ["shelf--modern", "shelf--left", "shelf--right", "shelf--compact", "shelf--custom-card-background"]
    .filter((name) => sourceCard.closest(`.${name}`) !== null);
  preview.classList.add(...inheritedClasses);
  for (let index = 0; index < sourceStyle.length; index += 1) {
    const property = sourceStyle.item(index);
    if (!property.startsWith("--pb-")) continue;
    const value = sourceStyle.getPropertyValue(property);
    if (value !== "") preview.style.setProperty(property, value);
  }
  preview.style.color = sourceStyle.color;
  preview.style.fontFamily = sourceStyle.fontFamily;
  preview.style.fontSize = sourceStyle.fontSize;
  preview.style.lineHeight = sourceStyle.lineHeight;
  preview.style.colorScheme = sourceStyle.colorScheme;

  const clone = sourceCard.cloneNode(true) as HTMLElement;
  clone.classList.remove(
    "paste-card--dragging",
    "paste-card--reorder-active",
    "paste-card--shift-backward",
    "paste-card--shift-forward",
  );
  clone.classList.add("paste-card--drag-preview");
  clone.removeAttribute("data-pb-item-id");
  clone.removeAttribute("role");
  clone.removeAttribute("tabindex");
  clone.removeAttribute("id");
  clone.removeAttribute("aria-selected");
  clone.removeAttribute("aria-posinset");
  clone.removeAttribute("aria-setsize");
  clone.setAttribute("draggable", "false");
  clone.setAttribute("aria-hidden", "true");
  clone.inert = true;
  clone.style.removeProperty("--pb-reorder-transform");
  for (const element of clone.querySelectorAll<HTMLElement>("[data-pb-item-id], [data-pb-reorder-handle], [id], [role]")) {
    element.removeAttribute("data-pb-item-id");
    element.removeAttribute("data-pb-reorder-handle");
    element.removeAttribute("id");
    element.removeAttribute("role");
    element.removeAttribute("tabindex");
    if ("inert" in element) element.inert = true;
  }
  Object.assign(clone.style, {
    position: "absolute",
    inset: "0",
    width: `${bounds.width}px`,
    height: `${bounds.height}px`,
    transformOrigin: "top left",
  });
  preview.append(clone);

  if (sourceCount > 1) {
    const count = document.createElement("span");
    count.className = "paste-card-drag-count";
    for (const attribute of sourceCard.attributes) {
      if (attribute.name.startsWith("data-v-")) count.setAttribute(attribute.name, attribute.value);
    }
    count.textContent = `${sourceCount} 项`;
    preview.append(count);
  }

  document.body.append(preview);
  const offsetX = Math.max(0, Math.min(bounds.width, clientX - bounds.left));
  const offsetY = Math.max(0, Math.min(bounds.height, clientY - bounds.top));
  const move = (nextX: number, nextY: number): void => {
    preview.style.left = `${nextX - offsetX}px`;
    preview.style.top = `${nextY - offsetY}px`;
  };
  move(clientX, clientY);
  return { element: preview, move, remove: () => preview.remove() };
}
