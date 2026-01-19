import { globalShortcut } from "electron";
import { shortcutLog } from "../logger";

// 注册快捷键并检查
export const registerShortcut = (shortcut: string, callback: () => void): boolean => {
  try {
    const success = globalShortcut.register(shortcut, callback);
    if (!success) {
      shortcutLog.error(`❌ Failed to register shortcut: ${shortcut}`);
      return false;
    } else {
      shortcutLog.info(`✅ Shortcut registered: ${shortcut}`);
      return true;
    }
  } catch (error) {
    shortcutLog.error(`ℹ️ Error registering shortcut ${shortcut}:`, error);
    return false;
  }
};

// 检查快捷键是否被注册
export const isShortcutRegistered = (shortcut: string): boolean => {
  return globalShortcut.isRegistered(shortcut);
};

// 卸载所有快捷键
export const unregisterShortcuts = () => {
  globalShortcut.unregisterAll();
  shortcutLog.info("🚫 All shortcuts unregistered.");
};
