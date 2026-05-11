import { TOOLS } from '../config/tools.js'

export function renderSideNav(activeTool, collapsed = false) {
  return `
    <aside class="sidebar ${collapsed ? 'sidebar--collapsed' : ''}">
      <nav class="sidebar__nav" data-scroll-role="sidebar-nav">
        ${TOOLS.map((tool) => `
          <button type="button" class="nav-item ${tool.id === activeTool ? 'is-active' : ''}" data-action="activate-tool" data-tool-id="${tool.id}" data-tooltip="${tool.label}" aria-label="${tool.label}">
            <span class="material-symbols-outlined">${tool.icon}</span>
            <span class="nav-item__label">${tool.label}</span>
          </button>
        `).join('')}
      </nav>
    </aside>
  `
}
