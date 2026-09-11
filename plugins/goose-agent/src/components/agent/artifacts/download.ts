/**
 * Blob / dataURL 下载与保存辅助（浏览器 + uTools）。
 */

export function triggerBlobDownload(
  blob: Blob,
  filename: string,
): void {
  const url = URL.createObjectURL(blob);
  try {
    const a = document.createElement("a");
    a.href = url;
    a.download = filename || "download";
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
  } finally {
    // 延迟 revoke，避免部分内核下载未启动
    setTimeout(() => URL.revokeObjectURL(url), 2_000);
  }
}

export function base64ToUint8Array(b64: string): Uint8Array {
  const clean = b64.replace(/^data:[^;]+;base64,/, "").replace(/\s/g, "");
  const binary = atob(clean);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

export function downloadBase64(
  contentBase64: string,
  mimeType: string,
  filename: string,
): void {
  const bytes = base64ToUint8Array(contentBase64);
  // 拷贝到独立 ArrayBuffer，满足 BlobPart 类型（避免 SharedArrayBuffer 歧义）
  const ab = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
  const blob = new Blob([ab], {
    type: mimeType || "application/octet-stream",
  });
  triggerBlobDownload(blob, filename);
}

export function downloadText(
  text: string,
  mimeType: string,
  filename: string,
): void {
  const blob = new Blob([text], { type: mimeType || "text/plain;charset=utf-8" });
  triggerBlobDownload(blob, filename);
}

export function downloadSvgMarkup(svg: string, filename: string): void {
  const markup = svg.trim().startsWith("<")
    ? svg
    : `<svg xmlns="http://www.w3.org/2000/svg">${svg}</svg>`;
  downloadText(markup, "image/svg+xml;charset=utf-8", filename);
}
