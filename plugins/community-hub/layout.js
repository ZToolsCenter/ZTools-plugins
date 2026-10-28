'use strict';
window.CommunityLayout = {
  mount({ state, save }) {
    const sidebar = document.getElementById('sidebar');
    const handle = document.getElementById('sidebar-resize');
    const toggle = document.getElementById('sidebar-toggle');
    let dragging = null;
    function apply() {
      document.body.classList.toggle('sidebar-hidden', state.sidebarHidden);
      const width = state.sidebarWidth === null ? null : ReaderCore.sidebarWidth(state.sidebarWidth, innerWidth);
      if (width === null) document.documentElement.style.removeProperty('--sidebar-width');
      else document.documentElement.style.setProperty('--sidebar-width', width + 'px');
      handle.setAttribute('aria-valuenow', String(width ?? (innerWidth <= 700 ? 153 : 199)));
      handle.setAttribute('aria-valuemax', String(ReaderCore.sidebarWidth(360, innerWidth)));
      toggle.setAttribute('aria-expanded', String(!state.sidebarHidden));
      const label = state.sidebarHidden ? '显示社区栏' : '隐藏社区栏'; toggle.title = label + ' · Ctrl B'; toggle.setAttribute('aria-label', label);
      if (state.sidebarHidden && sidebar.contains(document.activeElement)) toggle.focus();
    }
    function setWidth(value) { state.sidebarWidth = ReaderCore.sidebarWidth(value, innerWidth); apply(); }
    function end(event) {
      if (!dragging || event.pointerId !== dragging.pointerId) return;
      dragging = null; document.body.classList.remove('resizing-sidebar'); save();
    }
    handle.addEventListener('pointerdown', event => {
      if (event.button !== 0 || state.sidebarHidden) return;
      event.preventDefault(); dragging = { pointerId: event.pointerId, x: event.clientX, width: sidebar.getBoundingClientRect().width };
      handle.setPointerCapture(event.pointerId); document.body.classList.add('resizing-sidebar');
    });
    handle.addEventListener('pointermove', event => { if (dragging && event.pointerId === dragging.pointerId) setWidth(dragging.width + event.clientX - dragging.x); });
    handle.addEventListener('pointerup', end); handle.addEventListener('pointercancel', end); handle.addEventListener('lostpointercapture', end);
    handle.addEventListener('dblclick', () => { state.sidebarWidth = null; apply(); save(); });
    handle.addEventListener('keydown', event => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault(); const width = sidebar.getBoundingClientRect().width;
      setWidth(event.key === 'Home' ? 153 : event.key === 'End' ? 360 : width + (event.key === 'ArrowRight' ? 10 : -10)); save();
    });
    function toggleSidebar() { state.sidebarHidden = !state.sidebarHidden; apply(); save(); }
    toggle.onclick = toggleSidebar;
    window.addEventListener('resize', apply);
    apply();
    return { toggle: toggleSidebar };
  }
};
