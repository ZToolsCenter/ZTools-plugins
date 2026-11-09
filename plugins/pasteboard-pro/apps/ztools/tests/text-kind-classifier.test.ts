import { describe, expect, it } from "vitest";
import { classifyTextKind, refinePasteItemKind } from "../preload/text-kind-classifier";
import type { PasteItem } from "@pasteboard-pro/core";

describe("text kind classifier", () => {
  it("classifies valid web URLs and bare domains as url", () => {
    expect(classifyTextKind("https://ouranic.cn/")).toBe("url");
    expect(classifyTextKind("https://github.com/EverettFish/holo-card-studio")).toBe("url");
    expect(classifyTextKind("http://localhost:3000/api")).toBe("url");
    expect(classifyTextKind("https://grafana.meitu-int.com/d/qYzpC6z7ks/service-lb-sla?orgId=1")).toBe("url");
    expect(classifyTextKind("  https://example.com/path  ")).toBe("url");
    expect(classifyTextKind("git.meitu.com")).toBe("url");
    expect(classifyTextKind("www.apple.com.cn")).toBe("url");
    expect(classifyTextKind("github.com/vuejs/core")).toBe("url");
  });

  it("classifies CSS hex, rgb, and hsl colors as color", () => {
    expect(classifyTextKind("#5c6ce7")).toBe("color");
    expect(classifyTextKind("#FFF")).toBe("color");
    expect(classifyTextKind("#10b981")).toBe("color");
    expect(classifyTextKind("#5c6ce7ff")).toBe("color");
    expect(classifyTextKind("rgb(255, 0, 128)")).toBe("color");
    expect(classifyTextKind("rgba(92, 108, 231, 0.8)")).toBe("color");
    expect(classifyTextKind("hsl(240, 100%, 50%)")).toBe("color");
    expect(classifyTextKind("hsla(120, 100%, 25%, 0.5)")).toBe("color");
  });

  it("keeps regular and multiline text as text", () => {
    expect(classifyTextKind("你好世界")).toBe("text");
    expect(classifyTextKind("Here is a link:\nhttps://example.com")).toBe("text");
    expect(classifyTextKind("")).toBe("text");
    expect(classifyTextKind("#notacolorhex")).toBe("text");
    expect(classifyTextKind("test.pdf")).toBe("text");
    expect(classifyTextKind("style.css")).toBe("text");
    expect(classifyTextKind("README.md")).toBe("text");
  });

  it("refines historical paste items with kind=text on the fly", () => {
    const historicalUrl: PasteItem = {
      id: "hist-1",
      kind: "text",
      copiedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      sourceDeviceId: "dev-1",
      contentFingerprint: "fp1",
      pinned: false,
      fieldClocks: {},
      payload: { revision: "r1", text: "https://ouranic.cn/" },
    };
    expect(refinePasteItemKind(historicalUrl).kind).toBe("url");

    const historicalBareDomain: PasteItem = {
      id: "hist-1b",
      kind: "text",
      copiedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      sourceDeviceId: "dev-1",
      contentFingerprint: "fp1b",
      pinned: false,
      fieldClocks: {},
      payload: { revision: "r1b", text: "git.meitu.com" },
    };
    expect(refinePasteItemKind(historicalBareDomain).kind).toBe("url");

    const historicalColor: PasteItem = {
      id: "hist-2",
      kind: "text",
      copiedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      sourceDeviceId: "dev-1",
      contentFingerprint: "fp2",
      pinned: false,
      fieldClocks: {},
      payload: { revision: "r2", text: "#5c6ce7" },
    };
    expect(refinePasteItemKind(historicalColor).kind).toBe("color");

    const historicalPlain: PasteItem = {
      id: "hist-3",
      kind: "text",
      copiedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      sourceDeviceId: "dev-1",
      contentFingerprint: "fp3",
      pinned: false,
      fieldClocks: {},
      payload: { revision: "r3", text: "普通文本内容" },
    };
    expect(refinePasteItemKind(historicalPlain).kind).toBe("text");
  });
});
