import type { LocalAiPhase } from "../../types/localAi";

export const localAiPhaseLabels: Record<LocalAiPhase, string> = {
  idle: "等待启用", detecting: "正在检查设备", downloading: "正在下载所需文件",
  verifying: "正在校验文件", installing: "正在准备运行环境", starting: "正在启动本地模型",
  testing: "正在检查实际生成能力", ready: "本地模型已就绪", cancelled: "已取消，可继续重试", error: "准备失败"
};

export function localAiErrorMessage(error: string): string {
  if (/ENOTFOUND|EAI_AGAIN/.test(error)) return "无法解析下载服务器地址。请检查网络连接后重试，已校验的文件会保留。";
  if (/ECONNRESET|ETIMEDOUT|timed out|ECONNREFUSED|^aborted$/i.test(error)) return "连接中断或等待超时。请检查网络后重试，支持继续下载已保留的部分。";
  if (/ENOSPC/.test(error)) return "磁盘空间不足，请清理空间后重试。";
  if (/EACCES|EPERM/.test(error)) return "当前目录或运行程序的权限受限。请检查宿主和系统权限后重试。";
  if (/SHA-256|checksum|digest|verification/.test(error)) return "文件校验未通过，已阻止启用。请重新下载。";
  return error;
}
