import { expect, test } from "playwright/test";
import {
  fileUrlToLocalPath,
  loadPdfFontDataUrl,
  resolvePdfFontPlan,
  resolvePdfFontUrl,
  resetPdfFontLoadCache,
  toPdfFontDataUrl,
  PDF_CANGER_WOFF2_URLS,
  PDF_CJK_FONT_URLS,
  PDF_DM_MONO_WOFF2_URLS,
  PDF_FONT_FAMILY,
  PDF_FONT_RELATIVE_PATHS,
  PDF_HARMONYOS_WOFF2_URLS,
} from "../../src/lib/pdfExport/fontConfig";
import { REMOTE_FONT_SOURCES } from "../../src/lib/fontLoader";

test("file:// 插件页把相对 fonts/ 解析到同目录，而不是磁盘根 /fonts/", () => {
  const href = "file:///Users/eachann/Library/Application%20Support/uTools/plugins/goose-note/index.html";
  const url = resolvePdfFontUrl(PDF_FONT_RELATIVE_PATHS[0], href);
  expect(url).toBe(
    "file:///Users/eachann/Library/Application%20Support/uTools/plugins/goose-note/fonts/NotoSansSC-Regular.ttf",
  );
  expect(url.includes("file:///fonts/")).toBeFalsy();
});

test("http dev server 解析相对路径不会变成磁盘根", () => {
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

test("CJK 字体钉 jsdelivr 版本，备用 gh raw，不用 woff2", () => {
  expect(PDF_CJK_FONT_URLS[0]).toBe(
    "https://cdn.jsdelivr.net/gh/notofonts/noto-cjk@Sans2.004/Sans/SubsetOTF/SC/NotoSansSC-Regular.otf",
  );
  expect(PDF_CJK_FONT_URLS[1]).toBe(
    "https://raw.githubusercontent.com/notofonts/noto-cjk/Sans2.004/Sans/SubsetOTF/SC/NotoSansSC-Regular.otf",
  );
  for (const url of PDF_CJK_FONT_URLS) {
    expect(url.includes(".woff2")).toBeFalsy();
  }
});

const emptyCustomFonts = {
  default: { font: null },
  serif: { font: null },
  mono: { font: null },
};

test("default / 空 / HarmonyOS / ui-sans-serif 选鸿蒙单文件 woff2", () => {
  const harmonyUrl = PDF_HARMONYOS_WOFF2_URLS[0];
  expect(harmonyUrl.includes("d6dc229cd882dc0983dc5ce7cf28fb85047a4a76")).toBeTruthy();
  expect(harmonyUrl.endsWith(".woff2")).toBeTruthy();
  expect(harmonyUrl.includes("HarmonyOS")).toBeTruthy();
  expect(harmonyUrl.includes("Regular.css")).toBeFalsy();

  const fromEmpty = resolvePdfFontPlan("default", emptyCustomFonts);
  expect(fromEmpty.embed).toBe("harmony");
  expect(fromEmpty.bodyUrls).toEqual([...PDF_HARMONYOS_WOFF2_URLS]);
  expect(fromEmpty.bodyFallbackUrls).toEqual([...PDF_CJK_FONT_URLS]);

  const fromHarmony = resolvePdfFontPlan("default", {
    ...emptyCustomFonts,
    default: { font: "HarmonyOS Sans SC" },
  });
  expect(fromHarmony.embed).toBe("harmony");

  const fromUiSans = resolvePdfFontPlan("default", {
    ...emptyCustomFonts,
    default: { font: "ui-sans-serif, HarmonyOS Sans SC" },
  });
  expect(fromUiSans.embed).toBe("harmony");
  expect(fromUiSans.bodyUrls[0]).toBe(harmonyUrl);
});

test("serif / 仓耳 选仓耳今楷单文件 woff2", () => {
  expect(PDF_CANGER_WOFF2_URLS[0]).toBe(REMOTE_FONT_SOURCES["仓耳今楷"]);
  expect(PDF_CANGER_WOFF2_URLS[0].endsWith(".woff2")).toBeTruthy();

  const fromEmpty = resolvePdfFontPlan("serif", emptyCustomFonts);
  expect(fromEmpty.embed).toBe("canger");
  expect(fromEmpty.bodyUrls).toEqual([...PDF_CANGER_WOFF2_URLS]);
  expect(fromEmpty.bodyFallbackUrls).toEqual([...PDF_CJK_FONT_URLS]);
  expect(fromEmpty.pageFontFamily).toBe("仓耳今楷");

  const fromName = resolvePdfFontPlan("default", {
    ...emptyCustomFonts,
    default: { font: '"仓耳今楷", serif' },
  });
  expect(fromName.embed).toBe("canger");
  expect(fromName.bodyUrls[0]).toBe(PDF_CANGER_WOFF2_URLS[0]);
});

test("mono / DM Mono 选 DM Mono + CJK（鸿蒙，失败走 Noto）", () => {
  expect(PDF_DM_MONO_WOFF2_URLS[0]).toBe(
    "https://cdn.jsdelivr.net/npm/@fontsource/dm-mono@5.1.0/files/dm-mono-latin-400-normal.woff2",
  );

  const fromEmpty = resolvePdfFontPlan("mono", emptyCustomFonts);
  expect(fromEmpty.embed).toBe("dm-mono");
  expect(fromEmpty.monoUrls).toEqual([...PDF_DM_MONO_WOFF2_URLS]);
  expect(fromEmpty.bodyUrls).toEqual([...PDF_HARMONYOS_WOFF2_URLS]);
  expect(fromEmpty.bodyFallbackUrls).toEqual([...PDF_CJK_FONT_URLS]);
  expect(fromEmpty.pageFontFamily).toEqual(["DM Mono", "HarmonyOS Sans SC"]);

  const fromName = resolvePdfFontPlan("mono", {
    ...emptyCustomFonts,
    mono: { font: "DM Mono" },
  });
  expect(fromName.embed).toBe("dm-mono");
});

test("未知系统字体走 Noto，不假装嵌入苹方/雅黑", () => {
  for (const font of ["苹方", "PingFang SC", "微软雅黑", "Microsoft YaHei"]) {
    const plan = resolvePdfFontPlan("default", {
      ...emptyCustomFonts,
      default: { font },
    });
    expect(plan.embed).toBe("noto");
    expect(plan.bodyFamily).toBe(PDF_FONT_FAMILY);
    expect(plan.bodyUrls).toEqual([...PDF_CJK_FONT_URLS]);
    expect(plan.pageFontFamily).toBe(PDF_FONT_FAMILY);
  }

  const serifSystem = resolvePdfFontPlan("serif", {
    ...emptyCustomFonts,
    serif: { font: "Georgia" },
  });
  expect(serifSystem.embed).toBe("noto");
  expect(serifSystem.bodyUrls).toEqual([...PDF_CJK_FONT_URLS]);
});

test("远程字体同会话只拉一次并转成 data URL", async () => {
  resetPdfFontLoadCache();
  const originalFetch = globalThis.fetch;
  let calls = 0;
  const payload = new Uint8Array(120_000);
  payload.fill(1);
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    calls += 1;
    const href = String(input);
    expect(href).toBe(PDF_CJK_FONT_URLS[0]);
    return new Response(payload, { status: 200 });
  }) as typeof fetch;

  try {
    const first = await loadPdfFontDataUrl();
    const second = await loadPdfFontDataUrl();
    expect(first).toBeTruthy();
    expect(first?.startsWith("data:font/otf;base64,")).toBeTruthy();
    expect(second).toBe(first);
    expect(calls).toBe(1);
  } finally {
    globalThis.fetch = originalFetch;
    resetPdfFontLoadCache();
  }
});

test("过小响应不缓存为成功", async () => {
  resetPdfFontLoadCache();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response("tiny", { status: 200 })) as typeof fetch;
  try {
    expect(await loadPdfFontDataUrl()).toBeNull();
  } finally {
    globalThis.fetch = originalFetch;
    resetPdfFontLoadCache();
  }
});

test("主源失败则走备用 URL", async () => {
  resetPdfFontLoadCache();
  const originalFetch = globalThis.fetch;
  const seen: string[] = [];
  const payload = new Uint8Array(120_000);
  payload.fill(2);
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const href = String(input);
    seen.push(href);
    if (href === PDF_CJK_FONT_URLS[0]) {
      return new Response("nope", { status: 404 });
    }
    return new Response(payload, { status: 200 });
  }) as typeof fetch;

  try {
    const src = await loadPdfFontDataUrl();
    expect(seen).toEqual([...PDF_CJK_FONT_URLS]);
    expect(src?.startsWith("data:")).toBeTruthy();
  } finally {
    globalThis.fetch = originalFetch;
    resetPdfFontLoadCache();
  }
});
