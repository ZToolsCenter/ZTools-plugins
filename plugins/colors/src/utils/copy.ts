import { showSuccess } from "./notification";

export const copyColor = async (text: string) => {
  try {
    await navigator.clipboard.writeText(text);
    showSuccess(`已复制颜色: ${text}`);
  } catch (err) {
    console.error("复制失败:", err);
    showSuccess("复制失败");
  }
};
