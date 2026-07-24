/**
 * App — 图片工具箱主入口
 * 跨平台共享的应用初始化逻辑。
 *
 * 各平台 index.js 只需传入 HostAdapter 构造函数即可复用。
 */

import {
  eventBus,
  CanvasManager,
  LayerManager,
  HistoryManager,
  ToolManager,
} from '../runtime/fabric.js';

import Toolbar from '../ui/Toolbar.js';
import OptionsBar from '../ui/OptionsBar.js';
import SidePanelTabs from '../ui/SidePanelTabs.js';
import PropertyPanel from '../ui/PropertyPanel.js';
import LayerPanel from '../ui/LayerPanel.js';
import StatusBar from '../ui/StatusBar.js';
import AccountPage, {
  EDITOR_BARS_LAYOUT_KEY,
  EDITOR_BARS_LAYOUTS,
  EDITOR_SIDE_PANEL_POSITION_KEY,
  EDITOR_SIDE_PANEL_POSITIONS,
} from '../ui/AccountPage.js';
import { initTheme } from '../utils/theme.js';

// ═══════════════════════════════════════
// 应用入口
// ═══════════════════════════════════════

class App {
  constructor(HostAdapter) {
    this.HostAdapter = HostAdapter;
    this.canvasManager = null;
    this.layerManager = null;
    this.historyManager = null;
    this.toolManager = null;

    this.toolbar = null;
    this.optionsBar = null;
    this.sidePanelTabs = null;
    this.propertyPanel = null;
    this.layerPanel = null;
    this.statusBar = null;
    this.accountPage = null;
    this.hostAdapter = null;
    this._destroyed = false;

    this._init();
  }

  _init() {
    // 确保 Fabric.js 已加载
    if (typeof fabric === 'undefined') {
      console.error('[App] Fabric.js 未加载，请检查 CDN');
      document.body.innerHTML = '<div class="loading">Fabric.js 加载失败，请检查网络连接</div>';
      return;
    }

    try {
      initTheme();
      this._applyEditorBarsLayout(this._getEditorBarsLayout());
      this._applyEditorSidePanelPosition(this._getEditorSidePanelPosition());

      // 1. 初始化画布管理器
      this.canvasManager = new CanvasManager('fabric-canvas');
      this.canvasManager.init({
        width: 800,
        height: 600,
        backgroundColor: 'transparent',
        preserveObjectStacking: true,
        selection: true,
        stopContextMenu: true,
        fireRightClick: true,
      });

      // 2. 初始化图层管理器
      this.layerManager = new LayerManager(this.canvasManager);

      // 3. 初始化历史记录
      this.historyManager = new HistoryManager(this.canvasManager, 30);

      // 4. 初始化工具管理器（注入 host adapter）
      this.hostAdapter = new this.HostAdapter();
      this.toolManager = new ToolManager(this.canvasManager, this.historyManager, {
        host: this.hostAdapter,
      });

      // 5. 初始化 UI 组件
      this.toolbar = new Toolbar(
        document.getElementById('toolbar'),
        this.toolManager,
        this.hostAdapter
      );

      this.optionsBar = new OptionsBar(
        document.getElementById('optionsbar'),
        this.toolManager
      );

      this.sidePanelTabs = new SidePanelTabs(
        document.getElementById('panel-area'),
        this.layerManager
      );

      this.propertyPanel = new PropertyPanel(
        document.getElementById('property-panel'),
        this.toolManager,
        this.canvasManager,
        this.layerManager
      );

      this.layerPanel = new LayerPanel(
        document.getElementById('layer-panel'),
        this.layerManager
      );

      this.statusBar = new StatusBar(
        document.getElementById('statusbar'),
        this.canvasManager,
        this.layerManager
      );

      this.accountPage = new AccountPage(
        document.getElementById('account-page'),
        document.getElementById('app'),
        this.sidePanelTabs,
        this.hostAdapter
      );

      // 6. 绑定全局事件
      this._bindGlobalEvents();

      // 7. 默认激活选择工具
      this.toolManager.activateTool('select');

      // 8. 检查是否有外部传入的图片源
      this._checkExternalSource();

      console.log('[App] 图片工具箱初始化完成');
    } catch (err) {
      console.error('[App] 初始化失败:', err);
    }
  }

  _bindGlobalEvents() {
    // ═══ 图片导入 ═══

    // 拖拽导入
    document.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.stopPropagation();
    });

    document.addEventListener('drop', (e) => {
      e.preventDefault();
      e.stopPropagation();

      const files = e.dataTransfer.files;
      if (files.length > 0) {
        const file = files[0];
        if (file.type.startsWith('image/')) {
          this._loadImage(file);
        }
      }
    });

    // 粘贴导入
    document.addEventListener('paste', (e) => {
      const items = e.clipboardData?.items;
      if (!items) return;

      for (const item of items) {
        if (item.type.startsWith('image/')) {
          const file = item.getAsFile();
          if (file) {
            this._loadImage(file);
          }
          break;
        }
      }
    });

    // 文件选择对话框（宿主 API）
    document.getElementById('welcome-btn')?.addEventListener('click', () => {
      if (typeof window.showOpenImageDialog === 'function') {
        const result = window.showOpenImageDialog();
        if (result && result.length > 0) {
          const dataURL = window.readImageFile(result[0]);
          if (dataURL) {
            this._loadImage(dataURL);
          }
        }
      } else {
        // 降级方案：浏览器 file input
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'image/png,image/jpeg,image/webp,image/bmp,image/gif,image/svg+xml';
        input.onchange = (e) => {
          const file = e.target.files[0];
          if (file) this._loadImage(file);
        };
        input.click();
      }
    });

    // 点击欢迎图标导入
    document.getElementById('welcome-drop')?.addEventListener('click', () => {
      document.getElementById('welcome-btn')?.click();
    });

    // ═══ 缩放控制 ═══
    document.getElementById('zoom-in')?.addEventListener('click', () => {
      this.canvasManager?.zoomIn();
      this._updateZoomLabel();
    });

    document.getElementById('zoom-out')?.addEventListener('click', () => {
      this.canvasManager?.zoomOut();
      this._updateZoomLabel();
    });

    document.getElementById('zoom-value')?.addEventListener('click', () => {
      this.canvasManager?.resetZoom();
      this._updateZoomLabel();
    });

    // 滚轮缩放
    document.getElementById('canvas-area')?.addEventListener('wheel', (e) => {
      if (!this.canvasManager?.canvas) return;
      e.preventDefault();
      const delta = e.deltaY > 0 ? -0.05 : 0.05;
      this.canvasManager.zoomIn(delta);
      this._updateZoomLabel();
    }, { passive: false });

    eventBus.on('canvas:zoomIn', () => {
      this.canvasManager?.zoomIn();
      this._updateZoomLabel();
    });
    eventBus.on('canvas:zoomOut', () => {
      this.canvasManager?.zoomOut();
      this._updateZoomLabel();
    });

    // ═══ 导出 ═══
    eventBus.on('export:requested', async (format) => {
      if (format === 'clipboard') {
        await this.toolManager?.export('clipboard');
      } else {
        const exportModule = this.toolManager?.getModule('export');
        if (exportModule) {
          await exportModule.exportToFile();
        }
      }
    });

    // ═══ 撤销 / 重做 ═══
    eventBus.on('history:undo', () => {
      this.historyManager?.undo();
    });
    eventBus.on('history:redo', () => {
      this.historyManager?.redo();
    });

    // ═══ 编辑器布局偏好 ═══
    eventBus.on('sidePanel:layoutChanged', (layout) => {
      this.sidePanelTabs?.applyLayout(layout, false);
    });

    eventBus.on('editorBars:layoutChanged', (layout) => {
      this._applyEditorBarsLayout(layout);
    });

    eventBus.on('editorSidePanel:positionChanged', (position) => {
      this._applyEditorSidePanelPosition(position);
    });

    // ═══ 快捷键 ═══
    document.addEventListener('keydown', (e) => {
      // Ctrl+Z 撤销
      if (e.ctrlKey && !e.shiftKey && e.key === 'z') {
        e.preventDefault();
        this.historyManager?.undo();
        return;
      }

      // Ctrl+Shift+Z 或 Ctrl+Y 重做
      if ((e.ctrlKey && e.shiftKey && e.key === 'z') || (e.ctrlKey && !e.shiftKey && e.key === 'y')) {
        e.preventDefault();
        this.historyManager?.redo();
        return;
      }

      // Delete 删除选中物件
      if (e.key === 'Delete' || e.key === 'Backspace') {
        const active = this.canvasManager?.getActiveObject();
        if (active && active.isEditing) return;
        if (active && active.excludeFromHistory) return;
        this.historyManager?.saveState();
        this.canvasManager?.removeActiveObject();
        return;
      }

      // 工具快捷键
      if (!e.ctrlKey && !e.metaKey) {
        const activeElement = document.activeElement;
        const tagName = activeElement?.tagName?.toUpperCase();
        if (tagName === 'INPUT' || tagName === 'TEXTAREA' || tagName === 'SELECT') return;
        if (activeElement?.isContentEditable) return;

        const active = this.canvasManager?.getActiveObject();
        if (active && active.isEditing) return;

        const tools = this.toolManager?.getTools() || [];
        const tool = tools.find(t => t.shortcut === e.key.toUpperCase());
        if (tool) {
          e.preventDefault();
          this.toolManager?.activateTool(tool.name);
        }
      }
    });

    // ═══ 画布操作后自动保存历史 ═══
    eventBus.on('canvas:objectModified', (target) => {
      if (target?.excludeFromHistory) return;

      if (this._saveTimer) clearTimeout(this._saveTimer);
      this._saveTimer = setTimeout(() => {
        this.historyManager?.saveState();
      }, 300);
    });

    eventBus.on('layer:reorderWillChange', () => {
      this.historyManager?.saveState();
    });

    // ═══ 工具自动切换 ═══
    eventBus.on('tool:requestChange', (toolName) => {
      this.toolManager?.activateTool(toolName);
    });

    // ═══ Toast ═══
    eventBus.on('toast:show', ({ message, type }) => {
      this._showToast(message, type);
    });

    // ═══ 插件重复进入 ═══
    this.hostAdapter?.onPluginEnter(({ code, type, payload, from }) => {
      console.log('[App] onPluginEnter:', { code, type, from, payload });
      if (code === 'image-edit') {
        const source = this._getExternalImageSource(type, payload);
        console.log('[App] 外部图片源:', source ? 'ok' : 'empty', { type, from });
        if (source) {
          if (window.__imageSource === source) {
            window.__imageSource = null;
          }
          this._loadImage(source);
        } else if (type === 'img' && window.__imageSource) {
          const source = window.__imageSource;
          if (source) {
            window.__imageSource = null;
            this._loadImage(source);
          }
        }

        this.hostAdapter?.setWindowHeight(560);
      }
    });
  }

  destroy() {
    if (this._destroyed) return;
    this._destroyed = true;

    if (this._saveTimer) {
      clearTimeout(this._saveTimer);
      this._saveTimer = null;
    }

    [
      this.accountPage,
      this.toolbar,
      this.optionsBar,
      this.sidePanelTabs,
      this.propertyPanel,
      this.layerPanel,
      this.statusBar,
    ].forEach(component => component?.destroy?.());

    this.toolManager?.destroy?.();
    this.canvasManager?.destroy?.();
  }

  _showToast(message, type = 'success') {
    const existing = document.querySelector('.toast');
    if (existing) existing.remove();

    const icons = {
      success: '<svg class="toast__icon" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="7" stroke="currentColor" stroke-width="1.5"/><path d="M5 8l2 2 4-4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>',
      error: '<svg class="toast__icon" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="7" stroke="currentColor" stroke-width="1.5"/><path d="M8 5v4M8 11h0" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>',
    };

    const toast = document.createElement('div');
    toast.className = `toast toast--${type}`;
    toast.innerHTML = icons[type] || '';
    const textEl = document.createElement('span');
    textEl.textContent = message;
    toast.appendChild(textEl);
    document.body.appendChild(toast);

    toast.addEventListener('animationend', () => {
      if (toast.parentNode) toast.parentNode.removeChild(toast);
    });
  }

  async _loadImage(source) {
    try {
      document.getElementById('welcome')?.classList.add('hidden');
      document.getElementById('canvas-container')?.classList.remove('hidden');
      document.getElementById('zoom-control')?.classList.remove('hidden');

      await this.canvasManager.loadImage(source);
      this.canvasManager.fitToCanvas(40);

      this.layerManager.syncLayers();

      this.historyManager.clear();
      this.historyManager.saveState();

      this.hostAdapter?.setWindowHeight(560);
    } catch (err) {
      console.error('[App] 图片加载失败:', err);
      document.getElementById('welcome')?.classList.remove('hidden');
      document.getElementById('canvas-container')?.classList.add('hidden');
      document.getElementById('zoom-control')?.classList.add('hidden');
      eventBus.emit('toast:show', { message: '图片加载失败，请重试', type: 'error' });
    }
  }

  _getExternalImageSource(type, payload) {
    if (typeof window.getImageSourceFromPluginPayload === 'function') {
      try {
        const source = window.getImageSourceFromPluginPayload(type, payload);
        if (source) return source;
      } catch (e) {
        console.error('[App] 解析外部图片 payload 失败:', e);
      }
    }

    if (type !== 'file' && type !== 'files') return null;

    const files = Array.isArray(payload) ? payload : [payload];
    const fileInfo = files.find(item => item && item.path);
    if (!fileInfo || typeof window.readImageFile !== 'function') return null;

    try {
      return window.readImageFile(fileInfo.path);
    } catch (e) {
      console.error('[App] 文件匹配读取失败:', e);
      return null;
    }
  }

  _checkExternalSource() {
    let attempts = 0;
    const maxAttempts = 30;

    const check = () => {
      if (window.__imageSource) {
        const source = window.__imageSource;
        window.__imageSource = null;
        console.log('[App] _checkExternalSource 发现图片源，开始加载');
        if (source) {
          this._loadImage(source);
        }
        return;
      }
      attempts++;
      if (attempts < maxAttempts) {
        setTimeout(check, 100);
      } else {
        console.log('[App] _checkExternalSource 超时（3s），未发现外部图片源');
      }
    };

    setTimeout(check, 100);
  }

  _updateZoomLabel() {
    const label = document.getElementById('zoom-value');
    if (label && this.canvasManager) {
      label.textContent = Math.round(this.canvasManager.zoomLevel * 100) + '%';
    }
  }

  _getEditorBarsLayout() {
    const saved = localStorage.getItem(EDITOR_BARS_LAYOUT_KEY);
    return Object.values(EDITOR_BARS_LAYOUTS).includes(saved) ? saved : EDITOR_BARS_LAYOUTS.PRESETS_TOP;
  }

  _applyEditorBarsLayout(layout) {
    const normalized = Object.values(EDITOR_BARS_LAYOUTS).includes(layout)
      ? layout
      : EDITOR_BARS_LAYOUTS.PRESETS_TOP;

    document.getElementById('app')?.classList.toggle(
      'app--bars-swapped',
      normalized === EDITOR_BARS_LAYOUTS.STATUS_TOP
    );
  }

  _getEditorSidePanelPosition() {
    const saved = localStorage.getItem(EDITOR_SIDE_PANEL_POSITION_KEY);
    return Object.values(EDITOR_SIDE_PANEL_POSITIONS).includes(saved) ? saved : EDITOR_SIDE_PANEL_POSITIONS.RIGHT;
  }

  _applyEditorSidePanelPosition(position) {
    const normalized = Object.values(EDITOR_SIDE_PANEL_POSITIONS).includes(position)
      ? position
      : EDITOR_SIDE_PANEL_POSITIONS.RIGHT;

    document.getElementById('app')?.classList.toggle(
      'app--panel-left',
      normalized === EDITOR_SIDE_PANEL_POSITIONS.LEFT
    );
  }
}

export default App;
