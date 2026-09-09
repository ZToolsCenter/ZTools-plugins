import { ref, computed, watch, onUnmounted, toValue, type MaybeRefOrGetter } from 'vue';
import { useSettingsStore } from '../stores/settings';

export interface SplitPaneOptions {
  /** Initial size in pixels */
  initial: number;
  /** Minimum size in pixels */
  min: number;
  /** Maximum size in pixels, or a getter for dynamic value */
  max: MaybeRefOrGetter<number>;
  /** Drag direction */
  direction: 'horizontal' | 'vertical';
  /** If true, dragging in the positive direction decreases size (e.g. bottom panel: drag down = shrink) */
  reverse?: boolean;
  /** Persist the pane size using settings.layoutState */
  storageKey?: string;
}

export function useSplitPane(options: SplitPaneOptions) {
  const settingsStore = useSettingsStore();
  const max = computed(() => toValue(options.max));

  // ---- Restore stored value ----
  const stored = options.storageKey
    ? settingsStore.settings.layoutState?.[options.storageKey]
    : undefined;

  // Detect format: ratio (0-1) vs legacy pixels (>1)
  const isRatio = typeof stored === 'number' && stored > 0 && stored <= 1;
  const storedRatio = ref(isRatio ? stored : null);

  // If legacy pixels, convert to ratio once max is available
  let legacyPixelValue: number | null = (!isRatio && typeof stored === 'number') ? stored : null;

  // Initial size
  let initialSize: number;
  if (storedRatio.value !== null && max.value > 0) {
    initialSize = Math.round(storedRatio.value * max.value);
  } else if (legacyPixelValue !== null) {
    initialSize = legacyPixelValue;
  } else {
    initialSize = options.initial;
  }
  initialSize = Math.min(max.value || initialSize, Math.max(options.min, initialSize));

  const size = ref(initialSize);
  const isDragging = ref(false);
  let startPos = 0;
  let startSize = 0;
  /**
   * 本实例是否真的改过尺寸。
   *
   * storageKey 是**全局共享**的，而 size 是每实例私有、在实例创建时从
   * settings 读取。多个实例同时存在时（GitView 被 KeepAlive 缓存），
   * 卸载时无条件回写会让一个**陈旧**实例的旧比例覆盖用户最近一次拖动。
   * 所以只有自己动过的实例才有资格在卸载时落盘。
   */
  let hasLocalChange = false;

  // ---- Re-apply ratio when max changes ----
  // This fires when the caller's reactive max changes (e.g. ResizeObserver updates containerWidth → max recomputes)
  watch(max, (newMax, oldMax) => {
    if (newMax <= 0) return;

    // Legacy pixel → ratio conversion (one-time)
    if (legacyPixelValue !== null) {
      const oldMaxForConversion = oldMax > 0 ? oldMax : newMax;
      const convertedRatio = Math.min(1, legacyPixelValue / oldMaxForConversion);
      storedRatio.value = Math.round(convertedRatio * 1000) / 1000;
      legacyPixelValue = null;
      // 一次性格式迁移，属于本实例的真实改动
      hasLocalChange = true;
      persistSize();
    }

    if (!isDragging.value && storedRatio.value !== null) {
      size.value = Math.max(options.min, Math.min(newMax, Math.round(storedRatio.value * newMax)));
    } else if (!isDragging.value) {
      size.value = Math.min(newMax, Math.max(options.min, size.value));
    }
  });

  // ---- Persist as ratio ----
  function persistSize() {
    if (!options.storageKey) return;
    if (!settingsStore.settings.layoutState) {
      settingsStore.settings.layoutState = {};
    }
    const currentMax = max.value;
    if (currentMax > 0) {
      const ratio = Math.round((size.value / currentMax) * 1000) / 1000;
      storedRatio.value = ratio;
      settingsStore.settings.layoutState[options.storageKey] = ratio;
    } else if (storedRatio.value !== null) {
      settingsStore.settings.layoutState[options.storageKey] = storedRatio.value;
    }
  }

  // ---- Drag handlers ----
  function onMouseDown(e: MouseEvent) {
    e.preventDefault();
    isDragging.value = true;
    startPos = options.direction === 'horizontal' ? e.clientX : e.clientY;
    startSize = size.value;
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
    document.body.style.cursor = options.direction === 'horizontal' ? 'col-resize' : 'row-resize';
    document.body.style.userSelect = 'none';
  }

  function onMouseMove(e: MouseEvent) {
    const currentPos = options.direction === 'horizontal' ? e.clientX : e.clientY;
    const delta = currentPos - startPos;
    const currentMax = max.value;
    const newSize = Math.min(currentMax, Math.max(options.min, startSize + (options.reverse ? -delta : delta)));
    size.value = newSize;
  }

  function onMouseUp() {
    isDragging.value = false;
    document.removeEventListener('mousemove', onMouseMove);
    document.removeEventListener('mouseup', onMouseUp);
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
    hasLocalChange = true;
    persistSize();
  }

  onUnmounted(() => {
    document.removeEventListener('mousemove', onMouseMove);
    document.removeEventListener('mouseup', onMouseUp);
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
    // 只有本实例真的拖过才落盘：拖拽途中被卸载时靠这里补上，
    // 而没动过的陈旧实例不许覆盖别人刚拖出来的值
    if (hasLocalChange) persistSize();
  });

  return {
    size,
    isDragging,
    onMouseDown,
  };
}
