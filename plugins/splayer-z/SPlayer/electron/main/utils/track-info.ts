import { ipcMain } from "electron";
import mainWindow from "../windows/main-window";

/**
 * 从渲染进程获取当前播放信息
 * @returns Promise<any>
 */
export const getTrackInfoFromRenderer = async (): Promise<any> => {
  return new Promise((resolve, reject) => {
    const mainWin = mainWindow.getWin();
    if (!mainWin || mainWin.isDestroyed() || mainWin.webContents.isDestroyed()) {
      return reject(new Error("主窗口未找到"));
    }

    // 设置超时，防止无限等待
    const timeout = setTimeout(() => {
      ipcMain.removeListener("return-track-info", listener);
      reject(new Error("获取播放信息超时"));
    }, 2000);

    const listener = (_event: any, data: any) => {
      clearTimeout(timeout);
      resolve(data);
    };

    // 监听一次性回复
    ipcMain.once("return-track-info", listener);

    // 发送请求
    mainWin.webContents.send("request-track-info");
  });
};
