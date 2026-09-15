const MODIFIER_ALIASES: Record<string, string> = {
  command: 'Meta',
  cmd: 'Meta',
  meta: 'Meta',
  win: 'Meta',
  windows: 'Meta',
  commandorcontrol: 'CommandOrControl',
  cmdorctrl: 'CommandOrControl',
  cmdorcontrol: 'CommandOrControl',
  control: 'Ctrl',
  ctrl: 'Ctrl',
  option: 'Alt',
  alt: 'Alt',
  shift: 'Shift',
};

const MODIFIER_ORDER = ['CommandOrControl', 'Ctrl', 'Meta', 'Alt', 'Shift'];

const KEY_ALIASES: Record<string, string> = {
  ' ': 'Space',
  spacebar: 'Space',
  esc: 'Escape',
  escape: 'Escape',
  arrowup: 'ArrowUp',
  arrowdown: 'ArrowDown',
  arrowleft: 'ArrowLeft',
  arrowright: 'ArrowRight',
  pageup: 'PageUp',
  pagedown: 'PageDown',
  backspace: 'Backspace',
  delete: 'Delete',
  enter: 'Enter',
  tab: 'Tab',
  home: 'Home',
  end: 'End',
  insert: 'Insert',
};

export const DEFAULT_QUICK_SEARCH_APP_SHORTCUT = 'Ctrl+K';
export const DEFAULT_QUICK_SEARCH_GLOBAL_SHORTCUT = 'CommandOrControl+Shift+K';

/***********************应用内常用操作的默认键位*********************/
/** 方案约定的项目列表快捷键，可在设置页修改。 */
export const DEFAULT_FOCUS_SEARCH_SHORTCUT = 'Ctrl+F';
export const DEFAULT_NEW_PROJECT_SHORTCUT = 'Ctrl+N';
export const DEFAULT_REFRESH_PROJECTS_SHORTCUT = 'F5';

/** 左侧菜单快捷键，依次映射项目、Node、端口、提交日历、设置。 */
export const DEFAULT_SIDEBAR_MENU_SHORTCUTS = [
  'Ctrl+1',
  'Ctrl+2',
  'Ctrl+3',
  'Ctrl+4',
  'Ctrl+5',
] as const;

/**
 * 上一版临时改用的 Alt 默认键位。
 * Windows 端关闭 WebView2 浏览器加速键后，需迁移回产品方案约定的键位。
 */
export const SUPERSEDED_SHORTCUT_DEFAULTS: Record<string, string> = {
  focusSearchShortcut: 'Alt+S',
  newProjectShortcut: 'Alt+N',
  refreshProjectsShortcut: 'Alt+R',
};

/** 上一版数字导航临时使用的 Alt 默认键位，仅用于兼容迁移。 */
export const SUPERSEDED_SIDEBAR_MENU_SHORTCUTS = [
  'Alt+1',
  'Alt+2',
  'Alt+3',
  'Alt+4',
  'Alt+5',
] as const;

function normalizeKeyName(key: string) {
  const directAlias = KEY_ALIASES[key.toLowerCase()];
  if (directAlias) return directAlias;
  const trimmed = key.trim();
  if (!trimmed) return '';
  const alias = KEY_ALIASES[trimmed.toLowerCase()];
  if (alias) return alias;
  if (/^f\d{1,2}$/i.test(trimmed)) return trimmed.toUpperCase();
  if (trimmed.length === 1) return trimmed.toUpperCase();
  return trimmed[0].toUpperCase() + trimmed.slice(1).toLowerCase();
}

export function isModifierKey(key: string) {
  return ['Control', 'Meta', 'Alt', 'Shift'].includes(key);
}

function getKeyboardEventKey(event: KeyboardEvent) {
  return normalizeKeyName(event.key);
}

/***********************快捷键标准化*********************/

export function normalizeShortcut(shortcut: string) {
  const parts = shortcut
    .split('+')
    .map(part => part.trim())
    .filter(Boolean);

  const modifiers = new Set<string>();
  let key = '';

  for (const part of parts) {
    const modifier = MODIFIER_ALIASES[part.toLowerCase()];
    if (modifier) {
      modifiers.add(modifier);
    } else {
      key = normalizeKeyName(part);
    }
  }

  if (!key) return '';

  return [...MODIFIER_ORDER.filter(modifier => modifiers.has(modifier)), key].join('+');
}

export function formatShortcut(shortcut: string) {
  return normalizeShortcut(shortcut).replace('Meta', 'Cmd');
}

export function shortcutFromKeyboardEvent(event: KeyboardEvent) {
  if (isModifierKey(event.key)) return '';

  const key = getKeyboardEventKey(event);
  if (!key || key === '+') return '';

  const modifiers: string[] = [];
  if (event.ctrlKey) modifiers.push('Ctrl');
  if (event.metaKey) modifiers.push('Meta');
  if (event.altKey) modifiers.push('Alt');
  if (event.shiftKey) modifiers.push('Shift');
  // 可配置的刷新默认使用裸 F5，因此允许录制功能键；普通裸键与 Esc 仍拒绝。
  if (modifiers.length === 0) {
    return /^F(?:[1-9]|1[0-2])$/.test(key) ? key : '';
  }

  return normalizeShortcut([...modifiers, key].join('+'));
}

/***********************键盘事件匹配*********************/

export function isShortcutEvent(event: KeyboardEvent, shortcut: string) {
  const normalized = normalizeShortcut(shortcut);
  if (!normalized) return false;

  const parts = normalized.split('+');
  const key = parts[parts.length - 1];
  const modifiers = new Set(parts.slice(0, -1));
  const usesCommandOrControl = modifiers.has('CommandOrControl');

  return getKeyboardEventKey(event).toLowerCase() === key.toLowerCase()
    && (usesCommandOrControl ? event.ctrlKey !== event.metaKey : event.ctrlKey === modifiers.has('Ctrl'))
    && (usesCommandOrControl ? event.ctrlKey !== event.metaKey : event.metaKey === modifiers.has('Meta'))
    && event.altKey === modifiers.has('Alt')
    && event.shiftKey === modifiers.has('Shift');
}
