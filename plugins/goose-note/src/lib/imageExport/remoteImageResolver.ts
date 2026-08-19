// ── Remote Image Resolver ──────────────────────────────────────
// Resolves image URLs (att:/uuid:, http/https) to base64 data URLs
// for safe use during html-to-image SVG serialization.
// Object URLs (blob:) cannot be resolved inside SVG foreignObject context,
// so we must use inline data URLs.

import type { PartialBlock } from "@blocknote/core";
import type { BlockNoteContent } from "@/components/editor/utils/blocknote-content";
import { imageStorage } from "../imageStorage";
import { blobToBase64 } from "../imageStorage/utils";

type ExportResolvableBlock = PartialBlock & {
  props?: Record<string, unknown>;
  children?: BlockNoteContent;
  content?: unknown;
};

type GooseFsBridge = {
  fetchRemoteImage?: (url: string, timeoutMs?: number) => Promise<string | null>;
};

// ponytail: withResolvers 需 ES2024 lib，项目锁 ES2022
function loadImageViaCanvas(url: string, timeoutMs = 8000): Promise<string | null> {
  return new Promise<string | null>((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    const timer = setTimeout(() => {
      img.src = "";
      resolve(null);
    }, timeoutMs);
    img.onload = () => {
      clearTimeout(timer);
      try {
        const w = img.naturalWidth || img.width;
        const h = img.naturalHeight || img.height;
        if (!w || !h) {
          resolve(null);
          return;
        }
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          resolve(null);
          return;
        }
        ctx.drawImage(img, 0, 0);
        resolve(canvas.toDataURL("image/png"));
      } catch {
        resolve(null);
      }
    };
    img.onerror = () => {
      clearTimeout(timer);
      resolve(null);
    };
    img.src = url;
  });
}

async function resolveSingleUrl(url: string): Promise<string | null> {
  if (url.startsWith("data:")) return url;

  if (url.startsWith("att:") || url.startsWith("uuid:")) {
    try {
      const blob = await imageStorage.load(url);
      if (blob) return blobToBase64(blob);
    } catch {
      /* fallthrough */
    }
    return null;
  }
  if (url.startsWith("http:") || url.startsWith("https:")) {
    const bridge = (window as Window & { gooseFs?: GooseFsBridge }).gooseFs?.fetchRemoteImage;
    if (typeof bridge === "function") {
      try {
        const dataUrl = await bridge(url, 8000);
        if (typeof dataUrl === "string" && dataUrl.startsWith("data:")) {
          return dataUrl;
        }
      } catch {
        /* fallthrough to renderer fetch */
      }
    }
    try {
      const controller = new AbortController();
      const tid = setTimeout(() => controller.abort(), 8000);
      const res = await fetch(url, {
        mode: "cors",
        credentials: "omit",
        signal: controller.signal,
      });
      clearTimeout(tid);
      if (res.ok) {
        const blob = await res.blob();
        return blobToBase64(blob);
      }
    } catch {
      /* fallthrough to canvas */
    }
    try {
      const dataUrl = await loadImageViaCanvas(url);
      if (dataUrl) return dataUrl;
    } catch {
      /* give up */
    }
    return null;
  }
  return null;
}

export async function resolveImageUrls(blocks: BlockNoteContent): Promise<void> {
  const tasks: Promise<void>[] = [];

  for (const raw of blocks) {
    const block = raw as ExportResolvableBlock;
    const blockType = block.type as string | undefined;
    if (blockType === "image" || blockType === "imageResize" || blockType === "file") {
      const props = block.props;
      const url = props?.url ?? props?.src;
      if (typeof url === "string") {
        tasks.push(
          resolveSingleUrl(url).then((resolved) => {
            if (resolved) {
              block.props = { ...props, url: resolved };
            }
          }),
        );
      }
    }
    if (Array.isArray(block.content)) {
      for (const item of block.content) {
        if (typeof item === "string" || item == null || typeof item !== "object") continue;
        const inline = item as Record<string, unknown>;
        const attrs = inline.attrs as Record<string, unknown> | undefined;
        const inlineProps = inline.props as Record<string, unknown> | undefined;
        const inlineSrc = attrs?.src ?? inlineProps?.url ?? inlineProps?.src;
        if (inline.type === "image" && typeof inlineSrc === "string") {
          tasks.push(
            resolveSingleUrl(inlineSrc).then((resolved) => {
              if (resolved) {
                inline.attrs = { ...(attrs ?? {}), src: resolved };
              }
            }),
          );
        }
      }
    }
    if (Array.isArray(block.children)) {
      tasks.push(resolveImageUrls(block.children));
    }
  }

  await Promise.all(tasks);
}