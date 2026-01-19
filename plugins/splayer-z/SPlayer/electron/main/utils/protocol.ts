import mainWindow from "../windows/main-window";
import { processLog } from "../logger";

/**
 * 尝试发送自定义协议 URL 到主窗口
 * @param str 自定义协议字符串
 * @returns 是否成功发送
 */
export const trySendCustomProtocol = (str: string): boolean => {
  try {
    if (str.startsWith("orpheus://")) {
      mainWindow.getWin()!.webContents.send("protocol-url", str);
      return true;
    }
    return false;
  } catch (e) {
    processLog.error("❌ Failed to send protocol url", e);
    return false;
  }
};

/**
 * 从命令行参数中处理自定义协议
 * @param command 命令行参数数组
 * @returns 是否成功处理协议
 */
export const processProtocolFromCommand = (command: string[]): boolean => {
  // 这里第一个参数是程序名称 忽略此 仅遍历参数
  for (let i = 1; i < command.length; i++) {
    const arg = command[i];
    if (trySendCustomProtocol(arg)) return true;
  }
  return false;
};
