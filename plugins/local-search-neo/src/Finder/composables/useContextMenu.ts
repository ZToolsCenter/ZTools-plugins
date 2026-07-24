import { onMounted, onUnmounted, ref } from "vue";

export interface ContextMenuItem {
  id: string;
  label: string;
  disabled?: boolean;
  danger?: boolean;
  separator?: boolean;
  action?: () => void | Promise<void>;
}

const MENU_WIDTH = 180;
const MENU_PADDING_Y = 10;
const MENU_ITEM_HEIGHT = 30;
const MENU_SEPARATOR_HEIGHT = 9;
const VIEWPORT_PADDING = 8;

export function useContextMenu() {
  const visible = ref(false);
  const x = ref(0);
  const y = ref(0);
  const items = ref<ContextMenuItem[]>([]);

  function open(event: MouseEvent, menuItems: ContextMenuItem[]) {
    event.preventDefault();
    event.stopPropagation();
    const position = getMenuPosition(event.clientX, event.clientY, menuItems);
    x.value = position.x;
    y.value = position.y;
    items.value = menuItems;
    visible.value = true;
  }

  function close() {
    visible.value = false;
  }

  async function select(item: ContextMenuItem) {
    if (item.disabled || item.separator) return;
    close();

    try {
      await item.action?.();
    } catch (error) {
      console.warn("[local-search-neo] 右键菜单动作执行失败:", error);
    }
  }

  function handleGlobalClick(event: MouseEvent) {
    if (!visible.value || event.button !== 0) return;
    if (event.target instanceof HTMLElement && event.target.closest(".context-menu")) return;
    close();
  }

  onMounted(() => {
    window.addEventListener("click", handleGlobalClick);
  });

  onUnmounted(() => {
    window.removeEventListener("click", handleGlobalClick);
  });

  return {
    visible,
    x,
    y,
    items,
    open,
    close,
    select,
  };
}

function getMenuPosition(clientX: number, clientY: number, menuItems: ContextMenuItem[]) {
  const menuHeight = estimateMenuHeight(menuItems);
  const maxX = window.innerWidth - MENU_WIDTH - VIEWPORT_PADDING;

  return {
    x: clamp(clientX, VIEWPORT_PADDING, maxX),
    y: getMenuY(clientY, menuHeight),
  };
}

function getMenuY(clientY: number, menuHeight: number) {
  const maxY = window.innerHeight - menuHeight - VIEWPORT_PADDING;
  const hasSpaceBelow = clientY + menuHeight <= window.innerHeight - VIEWPORT_PADDING;
  const preferredY = hasSpaceBelow ? clientY : clientY - menuHeight;

  return clamp(preferredY, VIEWPORT_PADDING, maxY);
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(value, max));
}

function estimateMenuHeight(menuItems: ContextMenuItem[]) {
  return menuItems.reduce((height, item) => {
    return height + (item.separator ? MENU_SEPARATOR_HEIGHT : MENU_ITEM_HEIGHT);
  }, MENU_PADDING_Y);
}
