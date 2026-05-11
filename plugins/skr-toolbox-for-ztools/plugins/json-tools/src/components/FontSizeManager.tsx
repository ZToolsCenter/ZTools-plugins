import { useFontSizeManager } from "@/hooks/useFontSize";

/**
 * 全局字体大小管理器组件
 * 用于在应用初始化时设置字体大小
 */
export function FontSizeManager() {
  useFontSizeManager();

  return null; // 这个组件不渲染任何内容
}
