/**
 * 快捷键工具类
 * 用于处理键盘快捷键的解析和监听
 */
import { parseJson, stringifyJson } from "@/utils/json";

export interface ShortcutConfig {
  key: string;
  ctrl?: boolean;
  alt?: boolean;
  shift?: boolean;
  meta?: boolean; // Mac 的 Command 键
}

/**
 * 解析快捷键字符串为配置对象
 * 支持的格式：
 * - "Ctrl+T"
 * - "Cmd+T" 
 * - "Ctrl+Shift+T"
 * - "Alt+T"
 * 等等
 */
export function parseShortcut(shortcutString: string): ShortcutConfig {
  const parts = shortcutString.split('+').map(part => part.trim().toLowerCase());
  const config: ShortcutConfig = {
    key: '',
    ctrl: false,
    alt: false,
    shift: false,
    meta: false
  };

  // 处理修饰键
  parts.forEach(part => {
    switch (part) {
      case 'ctrl':
      case 'control':
        config.ctrl = true;
        break;
      case 'alt':
        config.alt = true;
        break;
      case 'shift':
        config.shift = true;
        break;
      case 'cmd':
      case 'command':
      case 'meta':
        config.meta = true;
        break;
      default:
        // 最后一个非修饰键部分作为主键
        if (!config.key) {
          config.key = part;
        }
    }
  });

  return config;
}

/**
 * 将快捷键配置转换为显示字符串
 */
export function shortcutToString(config: ShortcutConfig): string {
  const modifiers: string[] = [];
  
  if (config.ctrl) modifiers.push('Ctrl');
  if (config.alt) modifiers.push('Alt');
  if (config.shift) modifiers.push('Shift');
  if (config.meta) modifiers.push('Cmd');
  
  modifiers.push(config.key.toUpperCase());
  
  return modifiers.join('+');
}

/**
 * 检查键盘事件是否匹配快捷键配置
 */
export function matchesShortcut(event: KeyboardEvent, config: ShortcutConfig): boolean {
  // 检查修饰键
  if (config.ctrl && !event.ctrlKey) return false;
  if (config.alt && !event.altKey) return false;
  if (config.shift && !event.shiftKey) return false;
  if (config.meta && !event.metaKey) return false;
  
  // 检查是否有多余的修饰键
  if (!config.ctrl && event.ctrlKey) return false;
  if (!config.alt && event.altKey) return false;
  if (!config.shift && event.shiftKey) return false;
  if (!config.meta && event.metaKey) return false;
  
  // 检查主键（不区分大小写）
  const pressedKey = event.key.toLowerCase();
  const configKey = config.key.toLowerCase();
  
  return pressedKey === configKey;
}

/**
 * 快捷键监听器类
 */
export class ShortcutListener {
  private listeners: Map<string, Set<(event: KeyboardEvent) => void>> = new Map();
  private enabled: boolean = true;
  private globalShortcuts: Set<string> = new Set(); // 存储全局快捷键（即使在编辑器中也能使用）

  /**
   * 注册快捷键监听
   */
  addListener(shortcutString: string, callback: (event: KeyboardEvent) => void, options?: { global?: boolean }): void {
    const config = parseShortcut(shortcutString);
    const key = stringifyJson(config);

    if (options?.global) {
      this.globalShortcuts.add(key);
    }
    
    if (!this.listeners.has(key)) {
      this.listeners.set(key, new Set());
    }
    
    this.listeners.get(key)!.add(callback);
  }

  /**
   * 移除快捷键监听
   */
  removeListener(shortcutString: string, callback: (event: KeyboardEvent) => void, options?: { global?: boolean }): void {
    const config = parseShortcut(shortcutString);
    const key = stringifyJson(config);

    if (options?.global) {
      this.globalShortcuts.delete(key);
    }
        
    const callbacks = this.listeners.get(key);
    if (callbacks) {
      callbacks.delete(callback);
      if (callbacks.size === 0) {
        this.listeners.delete(key);
      }
    }
  }

  /**
   * 启用或禁用监听器
   */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  /**
   * 处理键盘事件
   */
  handleEvent(event: KeyboardEvent): void {
    if (!this.enabled) return;
    
    // 遍历所有监听器，检查是否匹配
    for (const [key, callbacks] of this.listeners) {
      const config: ShortcutConfig = parseJson(key);
      if (matchesShortcut(event, config)) {
        // 检查是否在编辑器中
        const target = event.target as HTMLElement;
        const isInEditor = target.tagName === 'INPUT' || 
                          target.tagName === 'TEXTAREA' || 
                          target.isContentEditable;
        
        // 如果在编辑器中，但不是全局快捷键，则跳过
        if (isInEditor && !this.globalShortcuts.has(key)) {
          continue;
        }
        
        event.preventDefault();
        event.stopPropagation();
        
        // 执行所有匹配的回调
        callbacks.forEach(callback => {
          try {
            callback(event);
          } catch (error) {
            console.error('Shortcut callback error:', error);
          }
        });
        
        break; // 找到第一个匹配的就停止
      }
    }
  }

  /**
   * 清除所有监听器
   */
  clear(): void {
    this.listeners.clear();
  }
}

// 创建全局快捷键监听器实例
export const globalShortcutListener = new ShortcutListener();

// 自动注册全局键盘事件监听
if (typeof window !== 'undefined') {
  window.addEventListener('keydown', (event) => {
    globalShortcutListener.handleEvent(event);
  });
}