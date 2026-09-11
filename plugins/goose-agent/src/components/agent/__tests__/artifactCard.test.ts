import { describe, expect, it } from "vitest";
import {
  isArtifactToolType,
  kindLabel,
  parseArtifactPayload,
} from "../artifacts/artifactKinds";
import { extractArtifactParts } from "../artifacts/ArtifactCard";
import { resolveDiagramSource } from "@/lib/agent/tools/artifactVisual";

describe("artifact kinds", () => {
  it("recognizes artifact tool types", () => {
    expect(isArtifactToolType("tool-showHtml")).toBe(true);
    expect(isArtifactToolType("showDiagram")).toBe(true);
    expect(isArtifactToolType("tool-writeDocx")).toBe(true);
    expect(isArtifactToolType("tool-readFile")).toBe(false);
  });

  it("parseArtifactPayload maps html / diagram / office", () => {
    const html = parseArtifactPayload("tool-showHtml", {
      ok: true,
      kind: "html",
      title: "T",
      html: "<p>x</p>",
    });
    expect(html?.kind).toBe("html");
    expect(html?.html).toContain("<p>x</p>");

    const diagram = parseArtifactPayload("showDiagram", {
      ok: true,
      source: "graph TD; A-->B",
    });
    expect(diagram?.kind).toBe("diagram");
    expect(diagram?.source).toContain("A-->B");

    const docx = parseArtifactPayload("tool-writeDocx", {
      ok: true,
      kind: "office-docx",
      contentBase64: "AAAA",
      filename: "a.docx",
    });
    expect(docx?.kind).toBe("office-docx");
    expect(docx?.contentBase64).toBe("AAAA");
  });

  it("parseArtifactPayload surfaces errors", () => {
    const err = parseArtifactPayload("tool-generateImage", {
      ok: false,
      error: "端点未暴露 Images API",
    });
    expect(err?.ok).toBe(false);
    expect(err?.error).toMatch(/Images/);
  });

  it("kindLabel is Simplified Chinese", () => {
    expect(kindLabel("html")).toBe("HTML");
    expect(kindLabel("office-docx")).toBe("Word");
    expect(kindLabel("diagram")).toBe("图表");
  });
});

describe("extractArtifactParts", () => {
  it("skips in-flight tool parts", () => {
    const parts = extractArtifactParts([
      {
        type: "tool-showHtml",
        state: "input-available",
        output: undefined,
      },
      {
        type: "tool-showHtml",
        state: "output-available",
        output: { ok: true, kind: "html", html: "<b>1</b>" },
      },
    ]);
    expect(parts).toHaveLength(1);
    expect((parts[0]!.output as { html: string }).html).toContain("<b>1</b>");
  });
});

describe("resolveDiagramSource", () => {
  it("prefers source then mermaid then code", () => {
    expect(resolveDiagramSource({ source: "a", mermaid: "b" })).toBe("a");
    expect(resolveDiagramSource({ mermaid: "b" })).toBe("b");
    expect(resolveDiagramSource({ code: "c" })).toBe("c");
    expect(resolveDiagramSource({})).toBe("");
  });
});

describe("parseArtifactPayload edges", () => {
  it("maps image success and empty image", () => {
    const img = parseArtifactPayload("tool-generateImage", {
      ok: true,
      kind: "image",
      contentBase64: "iVBOR",
      title: "猫",
    });
    expect(img?.kind).toBe("image");
    expect(img?.contentBase64).toBe("iVBOR");

    const empty = parseArtifactPayload("generateImage", {
      ok: true,
      kind: "image",
    });
    expect(empty?.kind).toBe("image");
    expect(empty?.contentBase64).toBeUndefined();
  });

  it("maps table and chart", () => {
    const table = parseArtifactPayload("tool-showTable", {
      ok: true,
      kind: "table",
      columns: ["a"],
      rows: [["1"]],
    });
    expect(table?.kind).toBe("table");
    expect(table?.columns).toEqual(["a"]);

    const chart = parseArtifactPayload("showChart", {
      ok: true,
      kind: "chart",
      categories: ["Q1"],
      series: [{ name: "s", data: [1] }],
    });
    expect(chart?.kind).toBe("chart");
  });

  it("extractArtifactParts includes error outputs", () => {
    const parts = extractArtifactParts([
      {
        type: "tool-generateImage",
        state: "output-error",
        output: { ok: false, error: "端点未暴露" },
      },
    ]);
    expect(parts).toHaveLength(1);
    expect((parts[0]!.output as { error: string }).error).toMatch(/端点/);
  });

  it("maps multi-series chart typeLabel via type field", () => {
    const chart = parseArtifactPayload("tool-showChart", {
      ok: true,
      kind: "chart",
      type: "pie",
      categories: ["A", "B"],
      series: [
        { name: "份额", data: [30, 70] },
        { name: "忽略第二系列于饼图预览", data: [1, 2] },
      ],
    });
    expect(chart?.kind).toBe("chart");
    expect(chart?.chartType).toBe("pie");
    expect(chart?.series?.length).toBe(2);
  });
});
