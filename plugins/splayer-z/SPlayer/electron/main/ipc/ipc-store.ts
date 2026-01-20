import { ipcMain, dialog } from "electron";
import { writeFile, readFile } from "fs/promises";
import { useStore } from "../store";
import type { StoreType } from "../store";
import { appName, appVersion } from "../utils/config";

/**
 * 初始化 store IPC 主进程
 */
const initStoreIpc = (): void => {
  const store = useStore();
  if (!store) return;

  // 获取配置项
  ipcMain.handle("store-get", (_event, key: keyof StoreType) => {
    return store.get(key as any);
  });

  // 设置配置项
  ipcMain.handle("store-set", (_event, key: keyof StoreType, value: unknown) => {
    store.set(key as any, value as any);
    return true;
  });

  // 判断配置项是否存在
  ipcMain.handle("store-has", (_event, key: keyof StoreType) => {
    return store.has(key as any);
  });

  // 删除配置项
  ipcMain.handle("store-delete", (_event, key: keyof StoreType) => {
    store.delete(key as any);
    return true;
  });

  // 重置配置（支持指定 keys 或全部重置）
  ipcMain.handle("store-reset", (_event, keys?: (keyof StoreType)[]) => {
    if (keys && keys.length > 0) {
      store.reset(...(keys as any));
    } else {
      store.reset();
    }
    return true;
  });

  // 导出配置
  ipcMain.handle("store-export", async (_event, rendererData: any) => {
    console.log("[IPC] store-export called");
    try {
      const now = new Date();
      const filename = `${appName}_Settings_v${appVersion}_${now.getTime()}.json`;

      const { filePath } = await dialog.showSaveDialog({
        title: "导出设置",
        defaultPath: filename,
        filters: [{ name: "JSON", extensions: ["json"] }],
      });

      if (filePath) {
        console.log("[IPC] Exporting to:", filePath);
        const fullData = {
          version: appVersion,
          timestamp: now.getTime(),
          electron: store.store,
          renderer: rendererData,
        };
        const data = JSON.stringify(fullData, null, 2);
        await writeFile(filePath, data, "utf-8");
        return true;
      }
      console.log("[IPC] Export cancelled");
      return false;
    } catch (error) {
      console.error("❌ Export settings failed:", error);
      return false;
    }
  });

  // 导入配置
  ipcMain.handle("store-import", async () => {
    console.log("[IPC] store-import called");
    try {
      const { filePaths } = await dialog.showOpenDialog({
        title: "导入设置",
        filters: [{ name: "JSON", extensions: ["json"] }],
        properties: ["openFile"],
      });

      if (filePaths && filePaths.length > 0) {
        console.log("[IPC] Importing from:", filePaths[0]);
        const data = await readFile(filePaths[0], "utf-8");
        const settings = JSON.parse(data);

        // 恢复 Electron Store 配置
        if (settings.electron) {
          store.store = settings.electron;
        } else if (!settings.renderer) {
          // 兼容旧版导出（如果是纯 electron store 数据）
          store.store = settings;
        }

        return settings;
      }
      console.log("[IPC] Import cancelled");
      return false;
    } catch (error) {
      console.error("❌ Import settings failed:", error);
      return false;
    }
  });
};

export default initStoreIpc;
