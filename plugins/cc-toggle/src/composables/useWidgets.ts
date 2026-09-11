// 桌面小组件入口状态（英雄卡按钮）
// 打开状态为内存态；仅小组件打开时轻量轮询 getWidgetStates，感知 × 关闭等外部变化；
// 关闭后停止轮询（按钮高亮只在交互时刷新），避免主窗口常驻轮询开销

import { ref, onMounted, onUnmounted } from 'vue';

const isStatusOpen = ref(false);
let timer: number | null = null;

export function useWidgets() {
  function refresh(): void {
    try {
      const api = window.ztoolsCctoggle;
      const st = api?.getWidgetStates?.() || {};
      isStatusOpen.value = !!(st.status && st.status.open);
    } catch (e) {
      isStatusOpen.value = false;
    }
    // 小组件打开时持续轮询（感知外部关闭）；关闭后停止轮询
    setPolling(isStatusOpen.value);
  }

  function setPolling(on: boolean): void {
    if (on && timer == null) {
      timer = window.setInterval(refresh, 3000);
    } else if (!on && timer != null) {
      window.clearInterval(timer);
      timer = null;
    }
  }

  function toggleStatus(): { success: boolean; error?: string } {
    const api = window.ztoolsCctoggle;
    if (!api?.openWidget) return { success: false, error: 'openWidget API 不可用' };
    // 以实时状态为准（getWidgetStates 即时反映窗口销毁），而非缓存 ref
    const st = api?.getWidgetStates?.() || {};
    const isOpen = !!(st.status && st.status.open);
    const r = isOpen ? api.closeWidget('status') : api.openWidget('status');
    if (!r || r.success !== false) {
      isStatusOpen.value = !isOpen;
      setPolling(isStatusOpen.value);
      return r || { success: true };
    }
    refresh();
    return r;
  }

  onMounted(() => {
    refresh();
    setPolling(isStatusOpen.value);
  });

  onUnmounted(() => {
    if (timer != null) {
      window.clearInterval(timer);
      timer = null;
    }
  });

  return { isStatusOpen, toggleStatus, refresh };
}
