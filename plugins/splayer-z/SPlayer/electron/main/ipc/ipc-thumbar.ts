import { ipcMain } from "electron";
import { getThumbar } from "../thumbar";

const initThumbarIpc = (): void => {
  // 更新工具栏
  ipcMain.on("play-status-change", (_, playStatus: boolean) => {
    const thumbar = getThumbar();
    if (!thumbar) {
      return;
    }
    thumbar.updateThumbar(playStatus);
  });
};

export default initThumbarIpc;
