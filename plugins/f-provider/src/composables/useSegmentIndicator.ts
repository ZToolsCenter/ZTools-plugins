import {
  ref,
  reactive,
  nextTick,
  watch,
  onMounted,
  onUnmounted,
  type Ref,
} from "vue";

/**
 * 分段控件滑动高亮：在容器内放置绝对定位的指示条，通过 transform/width
 * 平滑滑动到当前激活项的位置。
 *
 * - 激活项变化时滑动到位；
 * - 容器由隐藏（v-show / display:none）变为可见时先吸附（无动画）再恢复动画，
 *   避免从 0 偏移 / 0 宽滑入产生突兀位移；
 * - 窗口尺寸变化时重新测量。
 *
 * 测量用 getBoundingClientRect 差值（项.left - 容器.left），与容器 padding、
 * 与单位（% / px）均无关，稳健。display:none 时 rect 全为 0，无法测量，需等
 * 可见后再测——故传入 visible 的场景下仅在可见时测量。
 *
 * @param activeIndex 当前激活项索引（响应式，-1 表示无激活项）
 * @param visible 可见性 ref；缺省视为始终可见
 */
export function useSegmentIndicator(
  activeIndex: Ref<number>,
  visible?: Ref<boolean>,
) {
  /** 容器元素（v-for 按钮所在行） */
  const containerRef = ref<HTMLElement | null>(null);
  /** 各按钮元素，按 v-for 索引收集 */
  const itemsRef = ref<Array<HTMLElement | null>>([]);
  /** 指示条相对容器左边缘的偏移与宽度；ready 表示已完成首次有效测量 */
  const pos = reactive({ x: 0, w: 0, ready: false });
  /** 首次 / 每次由隐藏转可见时为 true，禁用过渡以吸附到位 */
  const noAnim = ref(true);

  /** v-for 函数 ref：按索引收集按钮元素（卸载时 el 为 null） */
  function setItemRef(el: any, index: number) {
    itemsRef.value[index] = (el as HTMLElement) ?? null;
  }

  function isVisible() {
    return !visible || visible.value;
  }

  /** 测量当前激活项相对容器的偏移与宽度并写入 pos */
  function measure() {
    const c = containerRef.value;
    const el =
      activeIndex.value >= 0 ? itemsRef.value[activeIndex.value] : null;
    if (!c || !el) return;
    const cr = c.getBoundingClientRect();
    const ir = el.getBoundingClientRect();
    // display:none 时 rect 全为 0，跳过（等可见后再测）
    if (!cr.width || !ir.width) return;
    pos.x = ir.left - cr.left;
    pos.w = ir.width;
    pos.ready = true;
  }

  /** 吸附后恢复动画：先置 noAnim=true 完成测量，下一帧再放开过渡 */
  function snapThenEnable() {
    noAnim.value = true;
    measure();
    requestAnimationFrame(() => {
      noAnim.value = false;
    });
  }

  // 激活项变化：可见时测量并滑动（noAnim 此时为 false）
  watch(activeIndex, async () => {
    if (!isVisible()) return;
    await nextTick();
    measure();
  });

  // 隐藏→可见：先吸附（无动画），下一帧再恢复动画
  if (visible) {
    watch(visible, async (show) => {
      if (!show) return;
      await nextTick();
      snapThenEnable();
    });
  }

  function onResize() {
    if (!isVisible()) return;
    measure();
  }

  onMounted(() => {
    void nextTick().then(() => {
      if (!isVisible()) return;
      snapThenEnable();
    });
    window.addEventListener("resize", onResize);
  });

  onUnmounted(() => {
    window.removeEventListener("resize", onResize);
  });

  return { containerRef, setItemRef, pos, noAnim };
}
