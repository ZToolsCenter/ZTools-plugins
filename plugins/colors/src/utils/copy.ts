import { useMessage } from "./message";

export const copyColor = async (text: string) => {
  const message = useMessage();
  try {
    await navigator.clipboard.writeText(text);
    message.success(`已复制颜色: ${text}`);
  } catch (err) {
    console.error("复制失败:", err);
    message.error("复制失败");
  }
};
