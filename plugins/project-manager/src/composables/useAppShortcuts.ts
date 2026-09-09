import { onMounted, onBeforeUnmount, onActivated, onDeactivated } from 'vue';
import { isShortcutEvent, normalizeShortcut } from '../utils/shortcut.ts';

/***********************应用内快捷键*********************/

/** 真正能录入文本的 input type 白名单 */
const TEXT_INPUT_TYPES = new Set([
  'text', 'search', 'password', 'email', 'url', 'tel', 'number',
  'date', 'datetime-local', 'month', 'week', 'time',
]);

/**
 * 焦点是否落在**能录入文本**的元素里。
 *
 * 判据必须收得很紧，不能只看 tagName === 'INPUT'：
 * Element Plus 的 el-segmented 渲染的是隐藏的 `<input type="radio">`
 * （opacity:0 但可聚焦），el-switch / el-radio / el-checkbox 同理；
 * el-select 的焦点承载元素是一个 `readonly` 的 combobox input。
 * 点一下这些控件后 document.activeElement 就长期停在上面，
 * 若把它们当成「正在打字」，之后所有受 inEditable 保护的快捷键都会静默失效——
 * 而用户完全无法把「点过筛选按钮」和「快捷键没反应」联系起来。
 *
 * readonly / disabled 的输入框也不算：焦点在上面时打字没有任何效果，
 * 没有需要保护的输入行为。
 */
export function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;

  if (target.isContentEditable) return true;

  const tag = target.tagName;
  if (tag === 'TEXTAREA') {
    const textarea = target as HTMLTextAreaElement;
    return !textarea.readOnly && !textarea.disabled;
  }
  if (tag === 'INPUT') {
    const input = target as HTMLInputElement;
    if (input.readOnly || input.disabled) return false;
    return TEXT_INPUT_TYPES.has((input.type || 'text').toLowerCase());
  }

  return false;
}

/**
 * 元素当前是否**真的**可见，而不只是存在于 DOM 里。
 *
 * checkVisibility 一次覆盖 display:none / visibility:hidden / content-visibility；
 * Tauri 的 WebView2 与 uTools/ZTools 的 Electron 都是较新 Chromium，基本走不到兜底分支。
 * 不能用 offsetParent 判断——遮罩层是 position: fixed，可见时 offsetParent 也是 null。
 */
function isElementVisible(el: Element): boolean {
  const checkVisibility = (el as Element & { checkVisibility?: () => boolean }).checkVisibility;
  if (typeof checkVisibility === 'function') return checkVisibility.call(el);

  const style = window.getComputedStyle(el);
  return style.display !== 'none' && style.visibility !== 'hidden';
}

/**
 * 当前是否有弹窗打开。
 *
 * 有弹窗时导航键必须让位：Element Plus 的 el-dialog / el-drawer 默认
 * close-on-press-escape 为 true，自己会处理 Esc。若我们也响应，
 * 一次 Esc 会既关弹窗又退一级页面。
 *
 * 必须逐个判可见性，**不能只看元素存不存在**：el-dialog 的遮罩层是
 * `withDirectives(..., [[vShow, visible]])`，而 el-teleport 不做懒渲染，
 * 所以只要模板里写了 el-dialog，`.el-overlay` 从应用启动那一刻就在 DOM 里
 * （只是 display:none）。用 querySelector 判存在会让这里恒为 true，
 * 进而把所有 allowInDialog 为 false 的快捷键全部静默吃掉。
 */
export function isDialogOpen(): boolean {
  // el-dialog 与 el-drawer 的遮罩都是 .el-overlay；ElMessageBox 另有 wrapper
  const overlays = document.querySelectorAll('.el-overlay, .el-message-box__wrapper');
  for (const overlay of overlays) {
    if (isElementVisible(overlay)) return true;
  }
  return false;
}

/** 键位是否带修饰键（Ctrl / Alt / Shift / Meta / CommandOrControl） */
function hasModifier(keys: string): boolean {
  return normalizeShortcut(keys).includes('+');
}

/** 一条快捷键绑定 */
export interface ShortcutBinding {
  /**
   * 键位描述，格式同 utils/shortcut.ts（如 `Ctrl+N`、`Escape`、`Alt+ArrowLeft`）。
   * 支持无修饰键（Escape / F5）；F1～F12 可由 ShortcutRecorder 录制，
   * Escape 这类导航键保持硬编码。
   */
  keys: string | (() => string);
  /** 命中时执行 */
  handler: () => void;
  /**
   * 是否允许在弹窗打开时触发。默认 false。
   * 导航类快捷键必须保持 false，让 el-dialog 自己吃掉 Esc。
   */
  allowInDialog?: boolean;
  /**
   * 是否允许在输入框内触发。
   *
   * 不传时按键位自动决定：**带修饰键**的组合（Ctrl+1 / Ctrl+N）在输入框里
   * 不会和打字冲突，默认放行；**裸键**（Escape / F5）默认拦住——
   * 用户在搜索框按 Esc 是想清空输入，不该把整个工作区退回列表页。
   */
  allowInEditable?: boolean;
  /** 动态启用条件；返回 false 时跳过 */
  enabled?: () => boolean;
}

/**
 * 在组件生命周期内注册一组应用内快捷键。
 *
 * 作用域靠组件生命周期天然划分：写在 ProjectWorkspace 里的绑定只在工作区
 * 挂载期间生效，写在 Dashboard 列表页里的只在列表页生效，不需要额外的
 * 作用域管理，也不用往 store 里加信号。
 */
export function useAppShortcuts(bindings: ShortcutBinding[]) {
  function onKeydown(event: KeyboardEvent) {
    // 输入法组合输入过程中不要拦键
    if (event.isComposing) return;

    const inEditable = isEditableTarget(event.target);
    const dialogOpen = isDialogOpen();

    for (const binding of bindings) {
      if (binding.enabled && !binding.enabled()) continue;

      const keys = typeof binding.keys === 'function' ? binding.keys() : binding.keys;
      if (!keys) continue;

      // 带修饰键的组合在输入框里不会和打字冲突，默认放行；裸键默认拦住
      const allowInEditable = binding.allowInEditable ?? hasModifier(keys);
      if (inEditable && !allowInEditable) continue;
      if (dialogOpen && !binding.allowInDialog) continue;

      if (!isShortcutEvent(event, keys)) continue;

      event.preventDefault();
      binding.handler();
      return;
    }
  }

  function attach() {
    document.addEventListener('keydown', onKeydown);
  }

  function detach() {
    document.removeEventListener('keydown', onKeydown);
  }

  onMounted(attach);
  onBeforeUnmount(detach);

  // 页面被 KeepAlive 缓存时必须摘掉监听。
  // App.vue 用 <KeepAlive> 包着 Dashboard 等几个页面，切到设置页只会 deactivate、
  // **不会**触发 onBeforeUnmount，监听器会留在 document 上——那时按 Ctrl+N
  // 依然会弹出新建项目弹窗、按 F5 依然会刷新项目列表。
  //
  // 反复 attach 是安全的：同一个函数引用重复 addEventListener 是空操作。
  // 不在 KeepAlive 里的组件永远不会触发这两个钩子，行为不变。
  onActivated(attach);
  onDeactivated(detach);
}
