// ═══════════════════════════════════════════════════════
// @img-toolbox/core — 公共无环境依赖入口
// 这里只导出平台无关的状态和接口；Fabric/browser 运行时见 ./runtime/fabric.js
// ═══════════════════════════════════════════════════════

// ── 基础设施 ──
export { default as eventBus, EventBus } from './EventBus.js';
export { default as EditorContext } from './EditorContext.js';

// ── 状态存储 ──
export { default as HistoryStore } from './HistoryStore.js';
export { default as LayerStore } from './LayerStore.js';
export { default as ToolRegistry } from './ToolRegistry.js';

// ── 接口 ──
export { default as HostAdapter } from './interfaces/HostAdapter.js';
export { default as EditorEngineAdapter } from './interfaces/EditorEngineAdapter.js';
