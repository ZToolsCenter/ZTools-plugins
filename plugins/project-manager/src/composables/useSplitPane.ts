import { ref, onUnmounted } from 'vue';

export interface SplitPaneOptions {
  /** Initial size in pixels */
  initial: number;
  /** Minimum size in pixels */
  min: number;
  /** Maximum size in pixels */
  max: number;
  /** Drag direction */
  direction: 'horizontal' | 'vertical';
  /** If true, dragging in the positive direction decreases size (e.g. bottom panel: drag down = shrink) */
  reverse?: boolean;
}

export function useSplitPane(options: SplitPaneOptions) {
  const size = ref(options.initial);
  const isDragging = ref(false);
  let startPos = 0;
  let startSize = 0;

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
    const newSize = Math.min(options.max, Math.max(options.min, startSize + (options.reverse ? -delta : delta)));
    size.value = newSize;
  }

  function onMouseUp() {
    isDragging.value = false;
    document.removeEventListener('mousemove', onMouseMove);
    document.removeEventListener('mouseup', onMouseUp);
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
  }

  onUnmounted(() => {
    document.removeEventListener('mousemove', onMouseMove);
    document.removeEventListener('mouseup', onMouseUp);
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
  });

  return {
    size,
    isDragging,
    onMouseDown,
  };
}
