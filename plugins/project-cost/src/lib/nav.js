import { onBeforeUnmount, onMounted } from 'vue';
import { ui } from './ui';

/**
 * 列表键盘导航：J/K（或 ↑/↓）移动选中、Enter 打开。
 * 绑定在 window 上——ZTools 里焦点常在搜索框或空白处，
 * 若挂在列表容器上，用户不点一下列表就按不动。
 */
export function useListNav(getRows, open) {
  function scrollIntoView() {
    requestAnimationFrame(() => {
      const el = document.querySelector('.item.sel');
      if (el) el.scrollIntoView({ block: 'nearest' });
    });
  }

  function onKey(e) {
    if (ui.drawer) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const tag = (e.target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select') {
      // 搜索框里允许 ↓/↑ 直接进入列表
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    }
    const ids = getRows().map((x) => x.p.id);
    if (!ids.length) return;
    const idx = ids.indexOf(ui.selId);

    if (e.key === 'j' || e.key === 'ArrowDown') {
      e.preventDefault();
      ui.selId = ids[Math.min(idx + 1, ids.length - 1)] || ids[0];
      scrollIntoView();
    } else if (e.key === 'k' || e.key === 'ArrowUp') {
      e.preventDefault();
      ui.selId = ids[Math.max(idx - 1, 0)] || ids[0];
      scrollIntoView();
    } else if (e.key === 'Enter' && idx >= 0) {
      e.preventDefault();
      open(ids[idx]);
    }
  }

  onMounted(() => window.addEventListener('keydown', onKey));
  onBeforeUnmount(() => window.removeEventListener('keydown', onKey));
}
