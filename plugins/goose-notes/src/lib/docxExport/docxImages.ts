import { blobToBase64 } from "../imageStorage/utils";

let imageStoragePromise: Promise<{
  imageStorage: { load: (ref: string) => Promise<Blob | null> };
}> | null = null;

export const getImageStorage = async () => {
  if (!imageStoragePromise) {
    imageStoragePromise = import("../imageStorage");
  }
  return imageStoragePromise;
};

export function parseBase64Image(
  src: string,
): { data: string; mimeType: string; extension: string } | null {
  const match = src.match(/^data:(image\/([a-zA-Z+]+));base64,(.+)$/);
  if (!match) return null;
  return {
    mimeType: match[1],
    extension: match[2] === "jpeg" ? "jpg" : match[2],
    data: match[3],
  };
}

export interface ImageBufferResult {
  buffer: Uint8Array;
  type: "png" | "jpg" | "gif" | "bmp";
}

export function mimeToImageType(mimeType: string): ImageBufferResult["type"] {
  if (mimeType.includes("png")) return "png";
  if (mimeType.includes("jpeg") || mimeType.includes("jpg")) return "jpg";
  if (mimeType.includes("gif")) return "gif";
  if (mimeType.includes("bmp")) return "bmp";
  return "png";
}

export async function resolveImageToBuffer(
  src: string,
  imageMap: Map<string, string>,
): Promise<ImageBufferResult | null> {
  if (imageMap.has(src)) {
    const base64 = imageMap.get(src)!;
    try {
      const binary = atob(base64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
      }
      return { buffer: bytes, type: "png" };
    } catch {
      return null;
    }
  }

  let finalSrc = src;

  if (src.startsWith("uuid:") || src.startsWith("att:")) {
    const { imageStorage } = await getImageStorage();
    const blob = await imageStorage.load(src);
    if (blob) {
      const base64Full = await blobToBase64(blob);
      finalSrc = base64Full;
    }
  }

  if (finalSrc.startsWith("data:image")) {
    const parsed = parseBase64Image(finalSrc);
    if (parsed) {
      imageMap.set(src, parsed.data);
      try {
        const binary = atob(parsed.data);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) {
          bytes[i] = binary.charCodeAt(i);
        }
        return { buffer: bytes, type: mimeToImageType(parsed.mimeType) };
      } catch {
        return null;
      }
    }
  }

  return null;
}
