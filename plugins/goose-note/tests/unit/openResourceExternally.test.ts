import { expect, test } from "playwright/test";
import type { EditorPlatform } from "../../src/components/editor/platform/types";
import {
  openResourceExternally,
  resolvePhysicalResourcePath,
} from "../../src/components/editor/utils/openResourceExternally";

function createPlatform(overrides?: { exists?: boolean; open?: boolean }) {
  const written: Array<{ path: string; content: string }> = [];
  const opened: string[] = [];
  const cleaned: string[] = [];
  const platform = {
    fs: {
      isAvailable: () => true,
      existsAsync: async () => overrides?.exists ?? true,
      cleanupTempFiles: async (prefix: string) => void cleaned.push(prefix),
      writeTempFile: async (path: string, content: string) => {
        written.push({ path, content });
        return `/tmp/${path}`;
      },
    },
    shell: {
      openPath: async (path: string) => {
        opened.push(path);
        return overrides?.open ?? true;
      },
    },
  } as unknown as EditorPlatform;
  return { platform, written, opened, cleaned };
}

test("本地资源直接交给系统，不产生临时副本", async () => {
  const { platform, written, opened } = createPlatform();
  const result = await openResourceExternally({
    source: "./assets/photo.png",
    pageLocalFilePath: "/notes/page.md",
    platform,
  });

  expect(result.ok).toBe(true);
  expect(opened).toEqual(["/notes/assets/photo.png"]);
  expect(written).toHaveLength(0);
});

test("数据库图片先写临时文件，再由系统默认应用打开", async () => {
  const { platform, written, opened } = createPlatform();
  const result = await openResourceExternally({
    source: "att:image-1",
    fileName: "截图",
    platform,
    loadInternalResource: async () =>
      new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" }),
  });

  expect(result.ok).toBe(true);
  expect(written).toHaveLength(1);
  expect(written[0].path).toContain("goose-note/opened-resources/");
  expect(written[0].path).toMatch(/截图\.png$/);
  expect(opened).toEqual([`/tmp/${written[0].path}`]);
});

test("系统拒绝打开时返回可恢复错误", async () => {
  const { platform } = createPlatform({ open: false });
  const result = await openResourceExternally({
    source: "/notes/missing-viewer.webp",
    platform,
  });
  expect(result).toEqual({ ok: false, error: "系统默认应用打开失败" });
});

test("物理路径解析覆盖 file URL、绝对路径和相对资源", () => {
  expect(resolvePhysicalResourcePath("file:///tmp/a%20b.png")).toBe(
    "/tmp/a b.png",
  );
  expect(resolvePhysicalResourcePath("/tmp/a.png")).toBe("/tmp/a.png");
  expect(
    resolvePhysicalResourcePath("../assets/a.png", "/notes/sub/page.md"),
  ).toBe("/notes/assets/a.png");
  expect(
    resolvePhysicalResourcePath("att:image-1", "/notes/page.md"),
  ).toBeNull();
});
