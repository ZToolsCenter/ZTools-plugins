import { eventBus } from '../../core/src/index.js';
import { escapeHTML, escapeAttr } from '../../core/src/utils/helpers.js';

/**
 * Toolbar UI component.
 * Renders tool buttons and handles tool switching.
 */
class Toolbar {
  constructor(containerEl, toolManager, host = null) {
    this._el = containerEl;
    this._tm = toolManager;
    this._host = host;
    this._currentTool = 'select';
    this._user = this._getHostUser();
    this._eventBusUnsubscribers = [];

    // SVG 图标模板
    this._icons = {
      select: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 3l7.07 16.97 2.51-7.39 7.39-2.51L3 3z"/><path d="M13 13l6 6"/></svg>`,
      mosaic: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M3 15h18M9 3v18M15 3v18"/></svg>`,
      crop: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 2v14a2 2 0 002 2h14"/><path d="M18 22V8a2 2 0 00-2-2H2"/></svg>`,
      brush: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9.5 19.5c-1.8 1.2-3.7 1.5-5.5 1.5.6-1.4.9-3.3 2.1-5.1"/><path d="M6.8 16.2L17.6 5.4a2.1 2.1 0 013 3L9.8 19.2"/><path d="M15.8 7.2l3 3"/></svg>`,
      eraser: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20.5 13.5l-7 7a3 3 0 01-4.24 0L3.5 14.74a3 3 0 010-4.24l7-7a3 3 0 014.24 0l5.76 5.76a3 3 0 010 4.24z"/><path d="M7 18h10"/><path d="M8.5 5.5l10 10"/></svg>`,
      text: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="4 7 4 4 20 4 20 7"/><line x1="9" y1="20" x2="15" y2="20"/><line x1="12" y1="4" x2="12" y2="20"/></svg>`,
      shape: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="8" height="8"/><circle cx="16" cy="7" r="4"/><polygon points="3,16 8,12 12,16"/><circle cx="16" cy="18" r="3"/></svg>`,
      undo: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 102.13-9.36L1 10"/></svg>`,
      redo: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 11-2.12-9.36L23 10"/></svg>`,
    };

    this._render();
    this._bindEvents();
  }

  _render() {
    const tools = this._tm.getTools();
    let toolsHtml = '';

    let currentGroup = null;

    // Render tool groups in a stable order.
    const groupOrder = ['edit', 'annotate', 'view', 'action'];
    for (const group of groupOrder) {
      const groupTools = tools.filter(t => t.group === group);
      if (groupTools.length === 0) continue;

      if (currentGroup !== null) {
        toolsHtml += '<div class="toolbar__separator"></div>';
      }
      currentGroup = group;

      for (const tool of groupTools) {
        // 导出按钮放在底部
        if (tool.group === 'action') continue;

        const icon = this._icons[tool.icon] || '';
        const isActive = this._currentTool === tool.name;
        toolsHtml += `
          <button class="toolbar__btn ${isActive ? 'toolbar__btn--active' : ''}" 
                  data-tool="${tool.name}" title="${tool.label} (${tool.shortcut || ''})">
            ${icon}
            <span>${tool.label}</span>
          </button>
        `;
      }
    }

    // 撤销 / 重做
    const footerHtml = `
      <div class="toolbar__separator"></div>
      <button class="toolbar__btn" data-tool="undo" title="返回上一步 (Ctrl+Z)">
        ${this._icons.undo}
        <span>返回上一步</span>
      </button>
      <button class="toolbar__btn" data-tool="redo" title="撤销返回上一步 (Ctrl+Y)">
        ${this._icons.redo}
        <span>撤销返回</span>
      </button>
      ${this._renderAccount()}
    `;

    this._el.innerHTML = `
      <div class="toolbar__tools">${toolsHtml}</div>
      <div class="toolbar__footer">${footerHtml}</div>
    `;
  }

  _bindEvents() {
    this._el.addEventListener('click', (e) => {
      const account = e.target.closest('.toolbar__account');
      if (account) {
        eventBus.emit('account:open');
        return;
      }

      const btn = e.target.closest('.toolbar__btn');
      if (!btn) return;

      const toolName = btn.dataset.tool;

      if (toolName === 'undo') {
        eventBus.emit('history:undo');
        return;
      }
      if (toolName === 'redo') {
        eventBus.emit('history:redo');
        return;
      }

      // 切换工具
      this._currentTool = toolName;
      this._updateActive();
      this._tm.activateTool(toolName);
    });

    this._el.addEventListener('error', (e) => {
      const avatar = e.target.closest?.('.toolbar__avatar-img');
      if (!avatar) return;
      const fallback = document.createElement('div');
      fallback.className = 'toolbar__avatar toolbar__avatar--fallback';
      fallback.textContent = avatar.dataset.initial || 'U';
      avatar.replaceWith(fallback);
    }, true);

    // 监听工具切换事件（外部触发）
    this._eventBusUnsubscribers.push(
      eventBus.on('tool:changed', (toolName) => {
        this._currentTool = toolName;
        this._updateActive();
      }),
      eventBus.on('history:changed', ({ canUndo, canRedo }) => {
        this._updateHistoryButtons(canUndo, canRedo);
      })
    );
  }

  _updateHistoryButtons(canUndo, canRedo) {
    const undoBtn = this._el.querySelector('[data-tool="undo"]');
    const redoBtn = this._el.querySelector('[data-tool="redo"]');
    if (undoBtn) {
      undoBtn.disabled = !canUndo;
      undoBtn.style.opacity = canUndo ? '' : '0.4';
    }
    if (redoBtn) {
      redoBtn.disabled = !canRedo;
      redoBtn.style.opacity = canRedo ? '' : '0.4';
    }
  }

  _updateActive() {
    const btns = this._el.querySelectorAll('.toolbar__btn');
    btns.forEach(btn => {
      const tool = btn.dataset.tool;
      if (tool === this._currentTool) {
        btn.classList.add('toolbar__btn--active');
      } else {
        btn.classList.remove('toolbar__btn--active');
      }
    });
  }

  _renderAccount() {
    const user = this._user || {};
    const name = user.nickname || user.name || user.userName || user.username || `${this._getHostName()} 用户`;
    const avatar = user.avatar || user.avatarUrl || user.photo || '';
    const initial = this._getInitial(name);
    const title = this._escapeAttr(name);

    if (avatar) {
      return `
        <button class="toolbar__account" type="button" title="${title}" aria-label="打开账户页">
          <img class="toolbar__avatar toolbar__avatar-img" src="${this._escapeAttr(avatar)}" alt="${title}" data-initial="${this._escapeAttr(initial)}" draggable="false">
        </button>
      `;
    }

    return `
      <button class="toolbar__account" type="button" title="${title}" aria-label="打开账户页">
        <div class="toolbar__avatar toolbar__avatar--fallback">${this._escapeHTML(initial)}</div>
      </button>
    `;
  }

  _getHostUser() {
    try {
      const result = this._host?.user?.getCurrentUser?.() || this._host?.getHostUser?.() || null;
      if (result && typeof result.then === 'function') {
        result.then((user) => {
          this._user = user;
          this._render();
        }).catch((e) => console.warn('[Toolbar] 获取宿主用户信息失败:', e));
        return null;
      }
      return result;
    } catch (e) {
      console.warn('[Toolbar] 获取宿主用户信息失败:', e);
    }
    return null;
  }

  _getHostName() {
    return this._host?.platform?.name || this._host?.getHostName?.() || 'uTools';
  }

  _getInitial(name) {
    const text = String(name || '').trim();
    return text ? text.slice(0, 1).toUpperCase() : 'U';
  }

  _escapeAttr(value) {
    return escapeAttr(value);
  }

  _escapeHTML(value) {
    return escapeHTML(value);
  }

  destroy() {
    this._eventBusUnsubscribers.forEach(unsub => unsub());
    this._eventBusUnsubscribers = [];
  }
}

export default Toolbar;
