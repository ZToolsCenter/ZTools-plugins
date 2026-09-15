import { expect, test } from "playwright/test";
import {
  extractClipboardImageFiles,
  type ClipboardImageSource,
} from "../../src/components/editor/utils/pasteClipboardImage";

function makeFile(
  name: string,
  type: string,
  bytes: number[] = [0x89, 0x50],
): File {
  return new File([new Uint8Array(bytes)], name, { type });
}

function makeItem(
  kind: string,
  type: string,
  file: File | null,
): {
  kind: string;
  type: string;
  getAsFile: () => File | null;
} {
  return {
    kind,
    type,
    getAsFile: () => file,
  };
}

test("extractClipboardImageFiles: null/empty → []", () => {
  expect(extractClipboardImageFiles(null)).toEqual([]);
  expect(extractClipboardImageFiles(undefined)).toEqual([]);
  expect(extractClipboardImageFiles({})).toEqual([]);
  expect(extractClipboardImageFiles({ items: [], files: [] })).toEqual([]);
});

test("extractClipboardImageFiles: 优先 items（Mac 截图：files 空、file.type 空）", () => {
  const raw = makeFile("", "");
  const source: ClipboardImageSource = {
    items: [makeItem("file", "image/png", raw)],
    files: [],
  };
  const result = extractClipboardImageFiles(source);
  expect(result).toHaveLength(1);
  expect(result[0].type).toBe("image/png");
});

test("extractClipboardImageFiles: items 无图时回退 files", () => {
  const png = makeFile("shot.png", "image/png");
  const txt = makeFile("note.txt", "text/plain");
  const source: ClipboardImageSource = {
    items: [makeItem("string", "text/plain", null)],
    files: [png, txt],
  };
  const result = extractClipboardImageFiles(source);
  expect(result).toHaveLength(1);
  expect(result[0].name).toBe("shot.png");
});

test("extractClipboardImageFiles: items 有图则不扫 files（避免重复）", () => {
  const fromItem = makeFile("a.png", "image/png");
  const fromFiles = makeFile("b.png", "image/png");
  const source: ClipboardImageSource = {
    items: [makeItem("file", "image/png", fromItem)],
    files: [fromFiles],
  };
  const result = extractClipboardImageFiles(source);
  expect(result).toHaveLength(1);
  expect(result[0].name).toBe("a.png");
});

test("extractClipboardImageFiles: 跳过非 file item 与非图片", () => {
  const video = makeFile("clip.mp4", "video/mp4");
  const source: ClipboardImageSource = {
    items: [
      makeItem("string", "text/html", null),
      makeItem("file", "video/mp4", video),
    ],
    files: [],
  };
  expect(extractClipboardImageFiles(source)).toEqual([]);
});

test("extractClipboardImageFiles: file.type 已是 image/* 时不重包", () => {
  const jpeg = makeFile("photo.jpg", "image/jpeg");
  const source: ClipboardImageSource = {
    items: [makeItem("file", "image/jpeg", jpeg)],
  };
  const result = extractClipboardImageFiles(source);
  expect(result).toHaveLength(1);
  expect(result[0]).toBe(jpeg);
});

test("extractClipboardImageFiles: 仅 files 路径按扩展名识别空 type", () => {
  const named = makeFile("paste.webp", "");
  const source: ClipboardImageSource = {
    files: [named],
  };
  const result = extractClipboardImageFiles(source);
  expect(result).toHaveLength(1);
  expect(result[0].name).toBe("paste.webp");
});
