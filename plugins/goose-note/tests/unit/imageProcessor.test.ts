import { expect, test } from "playwright/test";
import {
  compressIfNeeded,
  convertImageBlobToPng,
  materializeImageBlob,
} from "../../src/lib/imageProcessor";
import { MAX_IMAGE_STORE_BYTES } from "../../src/lib/imageStorage/types";

type MockCanvasState = {
  width: number;
  height: number;
  mimeType: string;
  quality: number | undefined;
};

function pngHeaderBlob(size = 64, type = ""): Blob {
  // 最小 PNG 签名 + 填充，便于文件头识别
  const bytes = new Uint8Array(size);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  return new Blob([bytes.buffer], { type });
}

function webpHeaderBlob(size = 64, type = "image/webp"): Blob {
  const bytes = new Uint8Array(size);
  bytes.set([0x52, 0x49, 0x46, 0x46], 0);
  bytes.set([0x57, 0x45, 0x42, 0x50], 8);
  return new Blob([bytes.buffer], { type });
}

function installCanvasMocks(options: {
  naturalWidth: number;
  naturalHeight: number;
  encodeSize: (state: MockCanvasState) => number;
}) {
  const g = globalThis as {
    document?: { createElement?: (tag: string) => unknown };
    createImageBitmap?: typeof createImageBitmap;
  };
  const originalDocument = g.document;
  const originalCreateObjectURL = URL.createObjectURL;
  const originalRevokeObjectURL = URL.revokeObjectURL;
  const originalCreateImageBitmap = g.createImageBitmap;
  const originalCreateElement = originalDocument?.createElement?.bind(originalDocument);

  const calls: MockCanvasState[] = [];

  URL.createObjectURL = (() => "blob:mock") as typeof URL.createObjectURL;
  URL.revokeObjectURL = (() => undefined) as typeof URL.revokeObjectURL;

  Object.defineProperty(globalThis, "createImageBitmap", {
    configurable: true,
    value: async () => ({
      width: options.naturalWidth,
      height: options.naturalHeight,
      close: () => undefined,
    }),
  });

  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: {
      createElement: (tag: string) => {
        if (tag !== "canvas") {
          if (originalCreateElement) return originalCreateElement(tag);
          throw new Error(`unexpected createElement(${tag})`);
        }

        const state: MockCanvasState = {
          width: 0,
          height: 0,
          mimeType: "",
          quality: undefined,
        };

        return {
          get width() {
            return state.width;
          },
          set width(value: number) {
            state.width = value;
          },
          get height() {
            return state.height;
          },
          set height(value: number) {
            state.height = value;
          },
          getContext: () => ({
            drawImage: () => undefined,
          }),
          toBlob: (
            callback: (blob: Blob | null) => void,
            mimeType?: string,
            quality?: number,
          ) => {
            state.mimeType = mimeType || "image/png";
            state.quality = quality;
            calls.push({ ...state });
            const size = options.encodeSize(state);
            const bytes = new Uint8Array(Math.max(1, Math.floor(size)));
            queueMicrotask(() => {
              callback(new Blob([bytes.buffer], { type: state.mimeType }));
            });
          },
        };
      },
    },
  });

  return {
    calls,
    restore: () => {
      if (originalDocument === undefined) {
        delete (globalThis as { document?: unknown }).document;
      } else {
        Object.defineProperty(globalThis, "document", {
          configurable: true,
          value: originalDocument,
        });
      }

      if (originalCreateImageBitmap === undefined) {
        delete (globalThis as { createImageBitmap?: unknown }).createImageBitmap;
      } else {
        Object.defineProperty(globalThis, "createImageBitmap", {
          configurable: true,
          value: originalCreateImageBitmap,
        });
      }

      URL.createObjectURL = originalCreateObjectURL;
      URL.revokeObjectURL = originalRevokeObjectURL;
    },
  };
}

test("materializeImageBlob detects PNG magic even when type is empty", async () => {
  const raw = pngHeaderBlob(128, "");
  const out = await materializeImageBlob(raw);
  expect(out.type).toBe("image/png");
  expect(out.size).toBe(128);
});

test("materializeImageBlob detects WebP magic", async () => {
  const raw = webpHeaderBlob(256, "application/octet-stream");
  const out = await materializeImageBlob(raw);
  expect(out.type).toBe("image/webp");
});

test("compressIfNeeded skips SVG without re-encoding", async () => {
  const svg = new Blob(["<svg xmlns='http://www.w3.org/2000/svg'></svg>"], {
    type: "image/svg+xml",
  });
  const out = await compressIfNeeded(svg);
  expect(out).toBe(svg);
});

test("compressIfNeeded keeps existing WebP without re-encoding", async () => {
  const mocks = installCanvasMocks({
    naturalWidth: 1200,
    naturalHeight: 800,
    encodeSize: () => {
      throw new Error("should not re-encode webp");
    },
  });

  try {
    const webp = webpHeaderBlob(200 * 1024, "image/webp");
    const out = await compressIfNeeded(webp);
    expect(out.type).toBe("image/webp");
    expect(out.size).toBe(200 * 1024);
    expect(mocks.calls).toEqual([]);
  } finally {
    mocks.restore();
  }
});

test("compressIfNeeded converts raster images only to WebP at 80%", async () => {
  const mocks = installCanvasMocks({
    naturalWidth: 1600,
    naturalHeight: 900,
    encodeSize: (state) => {
      expect(state.mimeType).toBe("image/webp");
      expect(state.quality).toBe(0.8);
      return 2 * 1024 * 1024;
    },
  });

  try {
    const png = pngHeaderBlob(12 * 1024, "image/png");
    const out = await compressIfNeeded(png);
    expect(out.type).toBe("image/webp");
    expect(out.size).toBe(2 * 1024 * 1024);
    expect(out.size).toBeLessThanOrEqual(MAX_IMAGE_STORE_BYTES);
    expect(mocks.calls).toHaveLength(1);
  } finally {
    mocks.restore();
  }
});

test("convertImageBlobToPng converts non-png blobs to PNG", async () => {
  const mocks = installCanvasMocks({
    naturalWidth: 800,
    naturalHeight: 600,
    encodeSize: (state) => {
      expect(state.mimeType).toBe("image/png");
      expect(state.quality).toBeUndefined();
      return 100 * 1024;
    },
  });

  try {
    const webp = webpHeaderBlob(50 * 1024, "image/webp");
    const out = await convertImageBlobToPng(webp);
    expect(out.type).toBe("image/png");
    expect(mocks.calls).toHaveLength(1);
  } finally {
    mocks.restore();
  }
});

test("convertImageBlobToPng keeps PNG as-is", async () => {
  const png = pngHeaderBlob(10 * 1024, "image/png");
  const out = await convertImageBlobToPng(png);
  expect(out.type).toBe("image/png");
  expect(out.size).toBe(10 * 1024);
});
