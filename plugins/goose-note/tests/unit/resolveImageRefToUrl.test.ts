import { expect, test } from "playwright/test";
import {
  clearResolvedImageObjectUrlCache,
  resolveImageRefToUrl,
} from "../../src/lib/imageStorage/resolveUrl";

test.afterEach(() => {
  clearResolvedImageObjectUrlCache();
  delete (globalThis as { window?: unknown }).window;
});

test("resolveImageRefToUrl isolates relative asset cache by page path", async () => {
  const reads: string[] = [];
  const originalCreateObjectURL = URL.createObjectURL;
  let createdObjectUrlCount = 0;

  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      gooseFs: {
        readFileBase64Async: async (path: string) => {
          reads.push(path);
          return path.includes("/b/") ? "YmJi" : "YQ==";
        },
      },
    },
  });

  URL.createObjectURL = (() => {
    createdObjectUrlCount += 1;
    return `blob:test-${createdObjectUrlCount}`;
  }) as typeof URL.createObjectURL;

  try {
    const firstUrl = await resolveImageRefToUrl(
      "./assets/shared.png",
      "C:/notes/a/page.md",
    );
    const secondUrl = await resolveImageRefToUrl(
      "./assets/shared.png",
      "C:/notes/b/page.md",
    );

    expect(firstUrl).toBe("blob:test-1");
    expect(secondUrl).toBe("blob:test-2");
    expect(reads).toEqual([
      "C:/notes/a/assets/shared.png",
      "C:/notes/b/assets/shared.png",
    ]);
  } finally {
    URL.createObjectURL = originalCreateObjectURL;
  }
});

test("clearResolvedImageObjectUrlCache revokes cached object urls", async () => {
  const revoked: string[] = [];
  const originalCreateObjectURL = URL.createObjectURL;
  const originalRevokeObjectURL = URL.revokeObjectURL;

  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      gooseFs: {
        readFileBase64Async: async () => "YQ==",
      },
    },
  });

  URL.createObjectURL = (() => "blob:cached") as typeof URL.createObjectURL;
  URL.revokeObjectURL = ((url: string) => {
    revoked.push(url);
  }) as typeof URL.revokeObjectURL;

  try {
    await resolveImageRefToUrl("./assets/one.png", "C:/notes/a/page.md");
    clearResolvedImageObjectUrlCache();
    expect(revoked).toEqual(["blob:cached"]);
  } finally {
    URL.createObjectURL = originalCreateObjectURL;
    URL.revokeObjectURL = originalRevokeObjectURL;
  }
});

test("resolveImageRefToUrl keeps local MP4 video MIME", async () => {
  const originalCreateObjectURL = URL.createObjectURL;
  let resolvedMime = "";

  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      gooseFs: {
        readFileBase64Async: async () => "AAAAEA==",
      },
    },
  });

  URL.createObjectURL = ((blob: Blob) => {
    resolvedMime = blob.type;
    return "blob:local-video";
  }) as typeof URL.createObjectURL;

  try {
    const url = await resolveImageRefToUrl(
      "./assets/clip.mp4",
      "C:/notes/page.md",
    );
    expect(url).toBe("blob:local-video");
    expect(resolvedMime).toBe("video/mp4");
  } finally {
    URL.createObjectURL = originalCreateObjectURL;
  }
});
