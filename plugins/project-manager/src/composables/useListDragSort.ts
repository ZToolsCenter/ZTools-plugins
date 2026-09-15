import { ref, watch, nextTick, onBeforeUnmount, type Ref } from 'vue';
import {
  calculateDraggedItemCenterY,
  calculateDraggedItemTranslateY,
  calculateFlipTransforms,
} from '../utils/dragPosition.ts';

/***********************列表手动拖拽排序*********************/

/**
 * 拖拽排序所需的最小条目形态。
 * 只要有稳定的 id，任何列表都能用。
 */
export interface DragSortItem {
  id: string;
}

export interface UseListDragSortOptions<T extends DragSortItem> {
  /**
   * 已排序的源列表。
   * 拖拽进行中会**停止**跟随它，否则外部重排会把手里正在拖的项目抽走。
   */
  items: Ref<T[]>;
  /** 拖拽结束且顺序确实变了才回调，参数是新顺序 */
  onCommit: (ordered: T[]) => void;
}

/**
 * 依赖的 DOM 约定（两个列表必须一致，样式见 styles/theme.css）：
 * - 列表容器带 `.draggable-list`
 * - 每个条目外层带 `.draggable-item` 与 `data-project-id`
 * - 拖拽手柄在条目内，`@mousedown` 转发到 onDragMouseDown
 *
 * 容器的**直接子元素必须与 items 一一对应**：位移与换位判定用的是
 * `containerEl.children` 的下标。不参与排序的卡片（例如子项目列表里的
 * 父项目入口）必须放在容器外面，否则下标会错位。
 */
export function useListDragSort<T extends DragSortItem>(options: UseListDragSortOptions<T>) {
  /** 拖拽期间的本地副本：DOM 顺序跟它，松手后才写回数据源 */
  const draggableList = ref<T[]>([]) as Ref<T[]>;

  const dragState = ref({
    dragging: false,
    projectId: null as string | null,
    pointerOffsetY: 0,
    dragDelta: 0,
    fromIndex: -1,
    currentFromIndex: -1,
    containerEl: null as HTMLElement | null,
  });

  /** FLIP 动画进行中：期间不再触发新的换位，避免动画打断自己 */
  let flipAnimating = false;

  watch(options.items, (nextItems) => {
    if (!dragState.value.dragging) {
      draggableList.value = [...nextItems];
    }
  }, { immediate: true });

  function resetDragState() {
    dragState.value = {
      dragging: false,
      projectId: null,
      pointerOffsetY: 0,
      dragDelta: 0,
      fromIndex: -1,
      currentFromIndex: -1,
      containerEl: null,
    };
  }

  function detachListeners() {
    document.removeEventListener('mousemove', onDragMouseMove);
    document.removeEventListener('mouseup', onDragMouseUp);
  }

  function onDragMouseDown(e: MouseEvent, projectId: string) {
    e.preventDefault();
    const handleEl = e.currentTarget as HTMLElement;
    const itemEl = handleEl.closest('.draggable-item') as HTMLElement | null;
    const listEl = handleEl.closest('.draggable-list') as HTMLElement | null;
    if (!itemEl || !listEl) return;

    const startIndex = draggableList.value.findIndex(item => item.id === projectId);
    if (startIndex < 0) return;

    const itemRect = itemEl.getBoundingClientRect();

    dragState.value = {
      dragging: true,
      projectId,
      pointerOffsetY: e.clientY - itemRect.top,
      dragDelta: 0,
      fromIndex: startIndex,
      currentFromIndex: startIndex,
      containerEl: listEl,
    };

    document.addEventListener('mousemove', onDragMouseMove);
    document.addEventListener('mouseup', onDragMouseUp);
  }

  function onDragMouseMove(e: MouseEvent) {
    const state = dragState.value;
    if (!state.dragging || !state.containerEl) return;

    // 按当前 DOM 基准位置计算位移，避免换位后叠加初始位移导致元素远离鼠标。
    const items = Array.from(state.containerEl.children) as HTMLElement[];
    const draggedItem = items[state.currentFromIndex];
    if (!draggedItem) return;

    state.dragDelta = calculateDraggedItemTranslateY({
      pointerClientY: e.clientY,
      listClientTop: state.containerEl.getBoundingClientRect().top,
      pointerOffsetY: state.pointerOffsetY,
      itemOffsetTop: draggedItem.offsetTop,
    });

    let targetIndex = state.currentFromIndex;
    const draggedCenter = calculateDraggedItemCenterY({
      itemOffsetTop: draggedItem.offsetTop,
      itemHeight: draggedItem.offsetHeight,
      translateY: state.dragDelta,
    });

    for (let i = 0; i < items.length; i++) {
      if (i === state.currentFromIndex) continue;
      const itemTop = items[i].offsetTop;
      const itemHeight = items[i].offsetHeight;
      const itemCenter = itemTop + itemHeight / 2;

      if (state.currentFromIndex < i && draggedCenter > itemCenter) {
        targetIndex = i;
      } else if (state.currentFromIndex > i && draggedCenter < itemCenter) {
        targetIndex = i;
      }
    }

    if (targetIndex !== state.currentFromIndex && !flipAnimating) {
      animateReorder(state.currentFromIndex, targetIndex);
      state.currentFromIndex = targetIndex;
    }
  }

  function animateReorder(fromIdx: number, toIdx: number) {
    const listEl = dragState.value.containerEl;
    if (!listEl) return;
    flipAnimating = true;

    // 按项目 ID 记录换位前位置，用于 FLIP 动画。
    const children = Array.from(listEl.children) as HTMLElement[];
    const oldPositions = children
      .map(el => ({ id: el.dataset.projectId ?? '', top: el.offsetTop }))
      .filter(item => item.id);

    // 更新列表顺序，让 DOM 进入换位后的真实布局。
    const [moved] = draggableList.value.splice(fromIdx, 1);
    draggableList.value.splice(toIdx, 0, moved);

    // DOM 更新后，让非拖拽元素从旧位置平滑移动到新位置。
    void nextTick(() => {
      const newChildren = Array.from(listEl.children) as HTMLElement[];
      const transforms = calculateFlipTransforms({
        oldPositions,
        newPositions: newChildren
          .map(el => ({ id: el.dataset.projectId ?? '', top: el.offsetTop }))
          .filter(item => item.id),
        excludedId: dragState.value.projectId,
      });

      newChildren.forEach((el) => {
        const translateY = transforms.get(el.dataset.projectId ?? '');
        if (translateY !== undefined) {
          el.style.transition = 'none';
          el.style.transform = `translateY(${translateY}px)`;
          requestAnimationFrame(() => {
            requestAnimationFrame(() => {
              el.style.transition = 'transform 0.18s ease';
              el.style.transform = '';
              el.addEventListener('transitionend', () => {
                el.style.transition = '';
                el.style.transform = '';
              }, { once: true });
            });
          });
        }
      });

      setTimeout(() => { flipAnimating = false; }, 200);
    });
  }

  function onDragMouseUp() {
    detachListeners();

    const state = dragState.value;
    const reordered = state.dragging && state.currentFromIndex !== state.fromIndex;
    const ordered = [...draggableList.value];

    resetDragState();

    if (reordered) {
      options.onCommit(ordered);
    }
  }

  // 拖拽途中组件被卸载（例如项目被删、页面切走）时别把全局监听留在 document 上
  onBeforeUnmount(() => {
    detachListeners();
  });

  return {
    draggableList,
    dragState,
    onDragMouseDown,
  };
}
