import { expect, test } from "playwright/test";
import {
  isRasterPdfImageSrc,
  isVisualCodeLanguage,
  resolveCodeBlockVisual,
  resolvePdfImageDataUrl,
} from "../../src/lib/pdfExport/visualAssets";
import { createPdfBlockMappings } from "../../src/lib/pdfExport/blockMappings";

const PNG_DATA_URL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

function mermaidBlock(text: string, id = "m1") {
  return {
    id,
    type: "codeBlock",
    props: { language: "mermaid" },
    content: [{ type: "text", text, styles: {} }],
  };
}

function mathBlock(text: string, language = "math", id = "x1") {
  return {
    id,
    type: "codeBlock",
    props: { language },
    content: [{ type: "text", text, styles: {} }],
  };
}

function collectText(node: unknown): string {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(collectText).join("");
  if (typeof node === "object" && node !== null && "props" in node) {
    return collectText((node as { props?: { children?: unknown } }).props?.children);
  }
  return "";
}

function findSrc(node: unknown): string | null {
  if (!node || typeof node !== "object") return null;
  if (Array.isArray(node)) {
    for (const item of node) {
      const src = findSrc(item);
      if (src) return src;
    }
    return null;
  }
  const el = node as { props?: { src?: string; children?: unknown } };
  if (typeof el.props?.src === "string") return el.props.src;
  return findSrc(el.props?.children);
}

test("isRasterPdfImageSrc 只认栅格 data URL，拒绝 SVG/http/file", () => {
  expect(isRasterPdfImageSrc(PNG_DATA_URL)).toBeTruthy();
  expect(isRasterPdfImageSrc("data:image/jpeg;base64,AA==")).toBeTruthy();
  expect(isRasterPdfImageSrc("data:image/svg+xml;utf8,<svg></svg>")).toBeFalsy();
  expect(isRasterPdfImageSrc("https://example.com/a.png")).toBeFalsy();
  expect(isRasterPdfImageSrc("file:///Users/a/b.png")).toBeFalsy();
  expect(isRasterPdfImageSrc("./assets/a.png")).toBeFalsy();
});

test("isVisualCodeLanguage 覆盖 mermaid/math/latex", () => {
  expect(isVisualCodeLanguage("mermaid")).toBeTruthy();
  expect(isVisualCodeLanguage("MATH")).toBeTruthy();
  expect(isVisualCodeLanguage("latex")).toBeTruthy();
  expect(isVisualCodeLanguage("tex")).toBeTruthy();
  expect(isVisualCodeLanguage("javascript")).toBeFalsy();
});

test("mermaid 成功时走 PNG，不回源码", async () => {
  const visual = await resolveCodeBlockVisual(mermaidBlock("graph TD; A-->B"), {
    renderMermaidPng: async (source) => {
      expect(source).toBe("graph TD; A-->B");
      return PNG_DATA_URL;
    },
  });
  expect(visual.kind).toBe("png");
  if (visual.kind === "png") {
    expect(visual.src).toBe(PNG_DATA_URL);
    expect(visual.language).toBe("mermaid");
  }
});

test("mermaid 渲染失败 fallback 源码", async () => {
  const visual = await resolveCodeBlockVisual(mermaidBlock("graph TD; A-->B"), {
    renderMermaidPng: async () => {
      throw new Error("boom");
    },
  });
  expect(visual.kind).toBe("source-fallback");
  if (visual.kind === "source-fallback") {
    expect(visual.text).toContain("graph TD");
    expect(visual.language).toBe("mermaid");
  }
});

test("mermaid 返回非 PNG 也 fallback", async () => {
  const visual = await resolveCodeBlockVisual(mermaidBlock("graph TD; A-->B"), {
    renderMermaidPng: async () => "data:image/svg+xml;utf8,<svg></svg>",
  });
  expect(visual.kind).toBe("source-fallback");
});

test("空 mermaid 不渲染、不吐源码", async () => {
  let called = false;
  const visual = await resolveCodeBlockVisual(mermaidBlock("   "), {
    renderMermaidPng: async () => {
      called = true;
      return PNG_DATA_URL;
    },
  });
  expect(called).toBeFalsy();
  expect(visual.kind).toBe("empty");
});

test("math/latex 成功时走 PNG", async () => {
  const math = await resolveCodeBlockVisual(mathBlock("E=mc^2"), {
    renderMathPng: async (source) => {
      expect(source).toBe("E=mc^2");
      return PNG_DATA_URL;
    },
  });
  expect(math.kind).toBe("png");

  const latex = await resolveCodeBlockVisual(mathBlock("\\frac{1}{2}", "latex"), {
    renderMathPng: async () => PNG_DATA_URL,
  });
  expect(latex.kind).toBe("png");
});

test("math 渲染失败 fallback LaTeX", async () => {
  const visual = await resolveCodeBlockVisual(mathBlock("E=mc^2"), {
    renderMathPng: async () => null,
  });
  expect(visual.kind).toBe("source-fallback");
  if (visual.kind === "source-fallback") {
    expect(visual.text).toBe("E=mc^2");
  }
});

test("普通代码块不走视觉渲染", async () => {
  const visual = await resolveCodeBlockVisual({
    props: { language: "javascript" },
    content: [{ type: "text", text: "const x = 1" }],
  });
  expect(visual.kind).toBe("code");
});

test("file:// 图片经 gooseFs 收成 data URL", async () => {
  const originalWindow = (globalThis as { window?: unknown }).window;
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      gooseFs: {
        readFileBase64Async: async (path: string) => {
          expect(path).toBe("/Users/x/pic.png");
          return "AAEC";
        },
      },
    },
  });
  try {
    const dataUrl = await resolvePdfImageDataUrl(
      "file:///Users/x/pic.png",
      null,
    );
    expect(dataUrl).toBeTruthy();
    expect(dataUrl?.startsWith("data:")).toBeTruthy();
    expect(dataUrl?.includes("base64,AAEC")).toBeTruthy();
    expect(isRasterPdfImageSrc(dataUrl!)).toBeTruthy();
  } finally {
    if (originalWindow === undefined) {
      delete (globalThis as { window?: unknown }).window;
    } else {
      Object.defineProperty(globalThis, "window", {
        configurable: true,
        value: originalWindow,
      });
    }
  }
});

test("相对路径图片按笔记目录解析", async () => {
  const originalWindow = (globalThis as { window?: unknown }).window;
  const reads: string[] = [];
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      gooseFs: {
        readFileBase64Async: async (path: string) => {
          reads.push(path);
          return "BBCC";
        },
      },
    },
  });
  try {
    const dataUrl = await resolvePdfImageDataUrl(
      "./assets/shot.png",
      "/Users/notes/page.md",
    );
    expect(reads).toEqual(["/Users/notes/assets/shot.png"]);
    expect(dataUrl?.includes("base64,BBCC")).toBeTruthy();
  } finally {
    if (originalWindow === undefined) {
      delete (globalThis as { window?: unknown }).window;
    } else {
      Object.defineProperty(globalThis, "window", {
        configurable: true,
        value: originalWindow,
      });
    }
  }
});

test("mermaid mapping 嵌入 PNG，不出现源文本", async () => {
  const mappings = await createPdfBlockMappings({
    renderMermaidPng: async () => PNG_DATA_URL,
  });
  const element = await mappings.codeBlock(
    mermaidBlock("graph TD; A-->B"),
    { transformInlineContent: () => "" },
    0,
  );
  expect(findSrc(element)).toBe(PNG_DATA_URL);
  expect(collectText(element)).not.toContain("graph TD");
});

test("mermaid mapping 失败时才出现源码", async () => {
  const mappings = await createPdfBlockMappings({
    renderMermaidPng: async () => {
      throw new Error("render failed");
    },
  });
  const element = await mappings.codeBlock(
    mermaidBlock("graph TD; A-->B"),
    { transformInlineContent: () => "" },
    0,
  );
  expect(findSrc(element)).toBeNull();
  expect(collectText(element)).toContain("graph TD; A-->B");
  expect(collectText(element)).toContain("Mermaid");
});

test("video mapping 是文件名占位，不抛错", async () => {
  const mappings = await createPdfBlockMappings();
  const element = mappings.video(
    {
      id: "v1",
      type: "video",
      props: { url: "file:///tmp/a.mp4", name: "演示.mp4" },
    },
    {},
    0,
  );
  expect(collectText(element)).toContain("演示.mp4");
  expect(findSrc(element)).toBeNull();
});
