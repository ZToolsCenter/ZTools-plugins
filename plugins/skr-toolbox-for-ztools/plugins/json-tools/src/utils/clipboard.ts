/**
 * 剪贴板工具函数
 * 优先使用现代的Navigator Clipboard API，在不支持或非HTTPS环境下回退到传统方式
 */

import toast from "./toast";

/**
 * 使用document.execCommand方法复制文本到剪贴板
 * @param text 要复制的文本
 * @param successMessage 复制成功时显示的消息 (可选)
 * @param errorMessage 复制失败时显示的消息 (可选)
 * @returns Promise<boolean> 是否复制成功
 */
async function copyWithExecCommand(
  text: string,
  successMessage?: string,
  errorMessage = "复制失败，请手动复制",
): Promise<boolean> {
  try {
    // 创建临时文本区域
    const textArea = document.createElement("textarea");

    textArea.value = text;

    // 设置样式使其不可见
    textArea.style.position = "fixed";
    textArea.style.top = "0";
    textArea.style.left = "0";
    textArea.style.width = "2em";
    textArea.style.height = "2em";
    textArea.style.padding = "0";
    textArea.style.border = "none";
    textArea.style.outline = "none";
    textArea.style.boxShadow = "none";
    textArea.style.background = "transparent";
    textArea.style.opacity = "0";

    document.body.appendChild(textArea);
    textArea.focus();
    textArea.select();

    // 尝试复制
    const successful = document.execCommand("copy");

    document.body.removeChild(textArea);

    if (successful) {
      if (successMessage) toast.success(successMessage);

      return true;
    } else {
      throw new Error("ExecCommand copy failed");
    }
  } catch (err) {
    console.error("Fallback clipboard method failed:", err);
    if (errorMessage) toast.error(errorMessage);

    return false;
  }
}

/**
 * 通过粘贴事件获取剪贴板内容
 * @param errorMessage 读取失败时显示的消息 (可选)
 * @returns Promise<string | null> 读取的文本或null(如果失败)
 */
async function readWithPasteEvent(
  errorMessage = "无法读取剪贴板内容",
): Promise<string | null> {
  return new Promise((resolve) => {
    // 创建一个临时的不可见输入框
    const tempInput = document.createElement("textarea");

    tempInput.style.position = "fixed";
    tempInput.style.opacity = "0";
    tempInput.style.left = "-1000px";
    tempInput.style.top = "-1000px";
    document.body.appendChild(tempInput);

    // 提示用户进行粘贴操作
    toast.warning("请按 Ctrl+V 粘贴内容");

    // 监听粘贴事件
    const handlePaste = (e: ClipboardEvent) => {
      const clipboardData = e.clipboardData || (window as any).clipboardData;
      const text = clipboardData.getData("text");

      // 清理资源
      tempInput.removeEventListener("paste", handlePaste as EventListener);
      document.body.removeChild(tempInput);

      resolve(text || null);
    };

    // 设置超时，如果用户长时间不操作则返回null
    const timeoutId = setTimeout(() => {
      tempInput.removeEventListener("paste", handlePaste as EventListener);
      document.body.removeChild(tempInput);
      toast.error(errorMessage);
      resolve(null);
    }, 10000); // 10秒超时

    // 监听粘贴事件
    tempInput.addEventListener("paste", (e) => {
      clearTimeout(timeoutId);
      handlePaste(e as ClipboardEvent);
    });

    // 聚焦输入框以便接收粘贴事件
    tempInput.focus();
  });
}

/**
 * 将文本复制到剪贴板
 * @param text 要复制的文本
 * @param successMessage 复制成功时显示的消息 (可选)
 * @param errorMessage 复制失败时显示的消息 (可选)
 * @returns Promise<boolean> 是否复制成功
 */
export async function copyToClipboard(
  text: string,
  successMessage = "复制成功！",
  errorMessage = "复制失败，请手动复制",
): Promise<boolean> {
  if (!text) {
    toast.error("没有内容可复制");

    return false;
  }

  // 方法1: 尝试使用现代的Navigator Clipboard API
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      if (successMessage) toast.success(successMessage);

      return true;
    }
    // 如果不是安全上下文，继续尝试其他方法
  } catch (err) {
    console.error("Navigator clipboard API failed:", err);
    // 错误时继续尝试其他方法
  }

  // 方法2: 使用document.execCommand ('copy')
  return copyWithExecCommand(text, successMessage, errorMessage);
}

/**
 * 从剪贴板读取文本
 * @param errorMessage 读取失败时显示的消息 (可选)
 * @returns Promise<string | null> 读取的文本或null(如果失败)
 */
export async function readFromClipboard(
  errorMessage = "无法读取剪贴板内容",
): Promise<string | null> {
  // 方案1: 使用现代的Navigator Clipboard API
  try {
    if (navigator.clipboard && window.isSecureContext) {
      const text = await navigator.clipboard.readText();

      return text;
    } else {
      toast.error(errorMessage);

      return null;
    }
  } catch {
    toast.error(errorMessage);

    return null;
  }
}

/**
 * 简单检测当前环境是否支持剪贴板API
 * @returns {boolean} 是否支持
 */
export function isClipboardSupported(): boolean {
  return !!(navigator.clipboard && window.isSecureContext);
}

export default {
  copy: copyToClipboard,
  copyWithExec: copyWithExecCommand,
  read: readFromClipboard,
  readWithPaste: readWithPasteEvent,
  isSupported: isClipboardSupported,
};
