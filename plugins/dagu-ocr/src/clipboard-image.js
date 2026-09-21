// 图片写入剪贴板：宿主 copyImage 优先，浏览器 Clipboard API 兜底。
// 主窗口（识别/翻译结果页）与截图覆盖层共用这一份实现。

export function dataUrlToBlob(dataUrl) {
  const [header, encoded] = String(dataUrl).split(',');
  const mime = header.match(/:(.*?);/)?.[1] || 'image/png';
  const binary = atob(encoded || '');
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return new Blob([bytes], { type: mime });
}

export async function copyImageDataUrl(win, dataUrl) {
  const api = win?.ztools || win?.utools || null;
  if (typeof api?.copyImage === 'function') {
    try {
      if (api.copyImage(dataUrl) !== false) return true;
    } catch (error) {
      console.warn('[clipboard] 宿主复制图片失败:', error);
    }
  }
  try {
    const clipboard = win?.navigator?.clipboard;
    const ClipboardItemCtor = win?.ClipboardItem;
    if (clipboard?.write && typeof ClipboardItemCtor === 'function') {
      await clipboard.write([new ClipboardItemCtor({ 'image/png': dataUrlToBlob(dataUrl) })]);
      return true;
    }
  } catch (error) {
    console.warn('[clipboard] 浏览器剪贴板写入失败:', error);
  }
  return false;
}
