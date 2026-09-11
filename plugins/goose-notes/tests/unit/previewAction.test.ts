import { expect, test } from "playwright/test";
import {
  PREVIEW_ACTION_TOOLTIP,
  buildPreviewTempFile,
  clampPreviewZoomPercent,
  normalizeSvgIntrinsicSize,
  svgNeedsHtmlShell,
  wrapSvgAsHtml,
} from "../../src/lib/preview/previewAction";

test("预览缩放按 25% 一档，并限制在 25%–400%", () => {
  expect(clampPreviewZoomPercent(100)).toBe(100);
  expect(clampPreviewZoomPercent(112)).toBe(100);
  expect(clampPreviewZoomPercent(118)).toBe(125);
  expect(clampPreviewZoomPercent(10)).toBe(25);
  expect(clampPreviewZoomPercent(999)).toBe(400);
});

test("系统预览临时文件带上 png 后缀并抽出 base64", () => {
  const dataUrl = "data:image/png;base64,aGVsbG8=";
  const result = buildPreviewTempFile(dataUrl, "chart", "token-1");
  expect(result.relativePath).toBe("goose-note/previews/token-1/chart.png");
  expect(result.base64).toBe("aGVsbG8=");
});

test("预览 SVG 补齐缺失的固有尺寸，缩放交给外层", () => {
  // 有像素宽高但缺 viewBox，补上 viewBox
  expect(
    normalizeSvgIntrinsicSize('<svg width="640" height="320"><g/></svg>'),
  ).toContain('viewBox="0 0 640 320"');
  // 只有 viewBox 时补上像素宽高
  const fromViewBox = normalizeSvgIntrinsicSize(
    '<svg viewBox="0 0 640 320"><g/></svg>',
  );
  expect(fromViewBox).toContain('width="640"');
  expect(fromViewBox).toContain('height="320"');
  // 宽高和 viewBox 都在时原样保留
  expect(
    normalizeSvgIntrinsicSize(
      '<svg width="640" height="320" viewBox="0 0 640 320"><g/></svg>',
    ),
  ).toBe('<svg width="640" height="320" viewBox="0 0 640 320"><g/></svg>');
});

test("含 foreignObject 的 SVG 走 HTML 外壳，避免系统预览空白", () => {
  expect(svgNeedsHtmlShell("<svg><g/></svg>")).toBe(false);
  expect(
    svgNeedsHtmlShell(
      '<svg><foreignObject x="0" y="0"><div>label</div></foreignObject></svg>',
    ),
  ).toBe(true);
});

test("HTML 外壳包住 SVG 正文", () => {
  const html = wrapSvgAsHtml("<svg></svg>", { title: "图" });
  expect(html).toContain("<!DOCTYPE html>");
  expect(html).toContain("<svg></svg>");
  expect(html).toContain("<title>图</title>");
});
