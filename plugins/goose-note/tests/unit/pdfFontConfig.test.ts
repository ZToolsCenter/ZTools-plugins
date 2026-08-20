import { expect, test } from "playwright/test";
import {
  fileUrlToLocalPath,
  resolvePdfFontUrl,
  toPdfFontDataUrl,
  PDF_FONT_RELATIVE_PATHS,
} from "../../src/lib/pdfExport/fontConfig";

test("file:// 插件页把字体解析到同目录 fonts/，而不是磁盘根 /fonts/", () => {
  const href = "file:///Users/eachann/Library/Application%20Support/uTools/plugins/goose-note/index.html";
  const url = resolvePdfFontUrl(PDF_FONT_RELATIVE_PATHS[0], href);
  expect(url).toBe(
    "file:///Users/eachann/Library/Application%20Support/uTools/plugins/goose-note/fonts/NotoSansSC-Regular.ttf",
  );
  expect(url.includes("file:///fonts/")).toBeFalsy();
});

test("http dev server 解析到站点根下的 /fonts/", () => {
  const url = resolvePdfFontUrl(
    PDF_FONT_RELATIVE_PATHS[1],
    "http://localhost:6001/",
  );
  expect(url).toBe("http://localhost:6001/fonts/NotoSansSC-Regular.otf");
});

test("带 hash 的 file:// 页面仍解析到插件目录", () => {
  const url = resolvePdfFontUrl(
    "fonts/NotoSansSC-Regular.otf",
    "file:///Users/x/dist/index.html#/workspace",
  );
  expect(url).toBe("file:///Users/x/dist/fonts/NotoSansSC-Regular.otf");
});

test("fileUrlToLocalPath 处理 Unix 与 Windows 盘符", () => {
  expect(fileUrlToLocalPath("file:///Users/x/dist/fonts/NotoSansSC-Regular.otf")).toBe(
    "/Users/x/dist/fonts/NotoSansSC-Regular.otf",
  );
  expect(fileUrlToLocalPath("file:///C:/plugins/goose-note/fonts/NotoSansSC-Regular.ttf")).toBe(
    "C:/plugins/goose-note/fonts/NotoSansSC-Regular.ttf",
  );
  expect(fileUrlToLocalPath("http://localhost:6001/fonts/x.ttf")).toBeNull();
});

test("注册给 react-pdf 的必须是 base64 data URL", () => {
  const src = toPdfFontDataUrl("AAEC");
  expect(src.startsWith("data:")).toBeTruthy();
  expect(src.includes(";base64,")).toBeTruthy();
});
