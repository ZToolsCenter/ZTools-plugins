import eventBus from './EventBus.js';
import SelectModule from './modules/SelectModule.js';
import MosaicModule from './modules/MosaicModule.js';
import CropModule from './modules/CropModule.js';
import ColorModule from './modules/ColorModule.js';
import BrushModule from './modules/BrushModule.js';
import EraserModule from './modules/EraserModule.js';
import TextModule from './modules/TextModule.js';
import ShapeModule from './modules/ShapeModule.js';
import ExportModule from './modules/ExportModule.js';

/**
 * 工具管理器 — 管理工具栏状态和工具切换
 *
 * 支持两种使用方式：
 * 1. 默认：自动注册内置工具（向后兼容）
 * 2. 注入：通过 tools 数组外部传入工具定义列表
 */
class ToolManager {
  /**
   * @param {import('./CanvasManager.js').default} canvasManager
   * @param {import('./HistoryManager.js').default} historyManager
   * @param {object} [options]
   * @param {Array} [options.tools] - 外部注入的工具定义列表
   * @param {object} [options.host]
   */
  constructor(canvasManager, historyManager, options = {}) {
    this._cm = canvasManager;
    this._hm = historyManager;
    this._modules = {};
    this._currentTool = null;
    this._tools = [];
    this._host = options.host || null;

    if (options.tools) {
      // 外部注入模式：注册传入的工具，不再硬编码内置模块
      options.tools.forEach(t => this.registerTool(t));
    } else {
      // 默认模式：注册内置模块（向后兼容）
      this._registerBuiltinModules();
    }

    // ExportModule 始终单独实例化，不显示在工具栏
    this._modules['export'] = new ExportModule(this._cm, this._hm, {}, this._host);
  }

  /**
   * 注入 host adapter。
   * @param {object} host
   */
  setHost(host) {
    this._host = host;
    this._modules['export']?.setHost(host);
  }

  /**
   * 注册内置模块
   */
  _registerBuiltinModules() {
    this.registerTool({
      name: 'select',
      label: '移动/框选',
      icon: 'select',
      group: 'edit',
      shortcut: 'V',
      module: SelectModule,
    });

    this.registerTool({
      name: 'mosaic',
      label: '马赛克',
      icon: 'mosaic',
      group: 'redact',
      shortcut: 'M',
      module: MosaicModule,
      defaultOptions: { mode: 'mosaic', drawMode: 'rect', mosaicSize: 12, blurRadius: 8, brushSize: 20 },
    });

    this.registerTool({
      name: 'crop',
      label: '剪切',
      icon: 'crop',
      group: 'edit',
      shortcut: 'C',
      module: CropModule,
    });

    this.registerTool({
      name: 'color',
      label: '调色',
      icon: 'color',
      group: 'adjust',
      shortcut: 'A',
      module: ColorModule,
      defaultOptions: { filterScope: 'all' },
    });

    this.registerTool({
      name: 'brush',
      label: '画笔',
      icon: 'brush',
      group: 'annotate',
      shortcut: 'B',
      module: BrushModule,
      defaultOptions: { color: '#d83b31', width: 6 },
    });

    this.registerTool({
      name: 'eraser',
      label: '橡皮擦',
      icon: 'eraser',
      group: 'annotate',
      shortcut: 'E',
      module: EraserModule,
      defaultOptions: { width: 20 },
    });

    this.registerTool({
      name: 'text',
      label: '文字标注',
      icon: 'text',
      group: 'annotate',
      shortcut: 'T',
      module: TextModule,
    });

    this.registerTool({
      name: 'shape',
      label: '图形',
      icon: 'shape',
      group: 'annotate',
      shortcut: 'S',
      module: ShapeModule,
      defaultOptions: { shapeType: 'rect', fill: 'transparent', stroke: 'rgba(216, 59, 49, 1)', strokeWidth: 2 },
    });
  }

  /**
   * 注册工具
   * @param {object} toolDef - { name, label, icon, group, shortcut, module, defaultOptions }
   */
  registerTool(toolDef) {
    this._tools.push(toolDef);

    // 如果有模块类，实例化
    if (toolDef.module) {
      this._modules[toolDef.name] = new toolDef.module(this._cm, this._hm, toolDef.defaultOptions);
    }
  }

  /**
   * 获取所有工具定义
   * @returns {Array}
   */
  getTools() {
    return this._tools;
  }

  /**
   * 激活工具
   * @param {string} toolName
   * @param {object} [options]
   */
  activateTool(toolName, options = {}) {
    // 停用当前工具
    if (this._currentTool && this._modules[this._currentTool]) {
      this._modules[this._currentTool].deactivate();
    }

    const tool = this._tools.find(t => t.name === toolName);
    if (!tool) {
      console.warn(`[ToolManager] 未知工具: ${toolName}`);
      this._currentTool = null;
      eventBus.emit('tool:changed', null);
      return;
    }

    this._currentTool = toolName;

    // 激活新工具的模块
    const module = this._modules[toolName];
    if (module) {
      module.activate(options);
    }

    eventBus.emit('tool:changed', toolName);
  }

  /**
   * 获取当前工具名
   * @returns {string|null}
   */
  getCurrentTool() {
    return this._currentTool;
  }

  /**
   * 获取当前模块实例
   * @returns {BaseModule|null}
   */
  getCurrentModule() {
    return this._currentTool ? this._modules[this._currentTool] : null;
  }

  /**
   * 获取模块实例
   * @param {string} name
   * @returns {BaseModule|null}
   */
  getModule(name) {
    return this._modules[name] || null;
  }

  /**
   * 执行导出
   * @param {string} action - 'file' | 'clipboard'
   */
  async export(action = 'file') {
    const exportModule = this._modules['export'];
    if (!exportModule) return;

    if (action === 'clipboard') {
      await exportModule.exportToClipboard();
    } else {
      await exportModule.exportToFile();
    }
  }

  /**
   * 销毁所有模块
   */
  destroy() {
    Object.values(this._modules).forEach(m => {
      if (m.deactivate) m.deactivate();
      if (m.destroy) m.destroy();
    });
    this._modules = {};
    this._currentTool = null;
  }
}

export default ToolManager;
