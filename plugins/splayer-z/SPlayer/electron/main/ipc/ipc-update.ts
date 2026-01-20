import { ipcMain } from "electron";
import { checkUpdate, startDownloadUpdate } from "../update";
import mainWindow from "../windows/main-window";

const initUpdateIpc = () => {
  // 检查更新
  ipcMain.on("check-update", (_event, showTip) => {
    const mainWin = mainWindow.getWin();
    if (!mainWin) return;
    checkUpdate(mainWin, showTip);
  });

  // 开始下载更新
  ipcMain.on("start-download-update", () => startDownloadUpdate());
};

export default initUpdateIpc;
