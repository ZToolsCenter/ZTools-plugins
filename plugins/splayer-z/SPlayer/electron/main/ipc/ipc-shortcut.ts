import { ipcMain } from "electron";
import { isShortcutRegistered, registerShortcut, unregisterShortcuts } from "../shortcut";
import mainWindow from "../windows/main-window";

/**
 * 初始化快捷键 IPC 主进程
 * @returns void
 */
const initShortcutIpc = (): void => {
  // 快捷键是否被注册
  ipcMain.handle("is-shortcut-registered", (_, shortcut: string) => isShortcutRegistered(shortcut));

  // 注册快捷键
  ipcMain.handle("register-all-shortcut", (_, allShortcuts: any): string[] | false => {
    const mainWin = mainWindow.getWin();
    if (!mainWin || !allShortcuts) return false;
    // 卸载所有快捷键
    unregisterShortcuts();
    // 注册快捷键
    const failedShortcuts: string[] = [];
    for (const key in allShortcuts) {
      const shortcut = allShortcuts[key].globalShortcut;
      if (!shortcut) continue;
      // 快捷键回调
      const callback = () => mainWin.webContents.send(key);
      const isSuccess = registerShortcut(shortcut, callback);
      if (!isSuccess) failedShortcuts.push(shortcut);
    }
    return failedShortcuts;
  });

  // 卸载所有快捷键
  ipcMain.on("unregister-all-shortcut", () => unregisterShortcuts());
};

export default initShortcutIpc;
