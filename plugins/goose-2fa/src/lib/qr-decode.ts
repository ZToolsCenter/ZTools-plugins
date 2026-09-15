import jsQR from "jsqr";
import type { PlatformAdapter } from "@/platform/types";

export function decodeQRFromRGBA(
  data: Uint8ClampedArray,
  width: number,
  height: number,
): string | null {
  const result = jsQR(data, width, height);
  return result?.data ?? null;
}

export async function decodeQRFromBase64(base64: string): Promise<string | null> {
  const img = new Image();
  const loaded = new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = reject;
  });

  const src = base64.startsWith("data:")
    ? base64
    : `data:image/png;base64,${base64}`;
  img.src = src;

  try {
    await loaded;
  } catch {
    return null;
  }

  const canvas = document.createElement("canvas");
  canvas.width = img.width;
  canvas.height = img.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  ctx.drawImage(img, 0, 0);
  const imageData = ctx.getImageData(0, 0, img.width, img.height);
  return decodeQRFromRGBA(imageData.data, img.width, img.height);
}

export async function readQRFromClipboard(platform: PlatformAdapter): Promise<string | null> {
  const imgData = await platform.readClipboardImage();
  if (imgData) {
    const clamped = new Uint8ClampedArray(imgData.data);
    return decodeQRFromRGBA(clamped, imgData.width, imgData.height);
  }
  return null;
}
