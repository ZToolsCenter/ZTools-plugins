export const maxPastedImageBytes = 50 * 1024 * 1024;

const imageDataUrlPattern = /^data:image\/([a-zA-Z0-9+.-]+);base64,(.+)$/;

function imageTooLargeMessage(maxBytes: number): string {
  return `图片数据过大，请导入小于 ${Math.round(maxBytes / 1024 / 1024)}MB 的图片文件`;
}

export function imageDataUrlToBuffer(
  payload: string,
  options: { maxBytes?: number } = {}
): { ext: string; buffer: Buffer } {
  const match = payload.match(imageDataUrlPattern);
  if (!match) {
    throw new Error("不支持的图片数据");
  }

  const maxBytes = options.maxBytes ?? maxPastedImageBytes;
  const base64 = match[2].replace(/\s/g, "");
  const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
  const estimatedBytes = Math.floor((base64.length * 3) / 4) - padding;
  if (estimatedBytes > maxBytes) {
    throw new Error(imageTooLargeMessage(maxBytes));
  }

  const buffer = Buffer.from(base64, "base64");
  if (buffer.byteLength > maxBytes) {
    throw new Error(imageTooLargeMessage(maxBytes));
  }

  const ext = match[1].toLowerCase() === "jpeg" ? "jpg" : match[1].toLowerCase();
  return { ext, buffer };
}
