import { expect, test } from "playwright/test";
import { ensurePersistentRemoteFont } from "../../src/lib/fontLoader";

test("已持久化的仓耳今楷直接从 Cache Storage 安装，不再请求 CDN", async () => {
  const globals = globalThis as Record<string, unknown>;
  const originalDocument = globals.document;
  const originalFontFace = globals.FontFace;
  const originalCaches = globals.caches;
  const originalFetch = globalThis.fetch;
  let addedFonts = 0;
  let fetches = 0;

  class FontFaceStub {
    async load() {
      return this;
    }
  }

  globals.document = {
    fonts: {
      add: () => {
        addedFonts += 1;
      },
    },
  };
  globals.FontFace = FontFaceStub;
  globals.caches = {
    open: async () => ({
      match: async () => new Response(new Uint8Array([1, 2, 3])),
      put: async () => undefined,
      delete: async () => true,
    }),
  };
  globalThis.fetch = async () => {
    fetches += 1;
    return new Response(new Uint8Array([4, 5, 6]));
  };

  try {
    await expect(ensurePersistentRemoteFont("仓耳今楷")).resolves.toBe(true);
    expect(fetches).toBe(0);
    expect(addedFonts).toBe(1);
  } finally {
    globals.document = originalDocument;
    globals.FontFace = originalFontFace;
    globals.caches = originalCaches;
    globalThis.fetch = originalFetch;
  }
});
