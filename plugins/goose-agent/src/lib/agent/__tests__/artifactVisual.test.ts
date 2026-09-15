import { afterEach, describe, expect, it, vi } from "vitest";
import type { AISettingsLike } from "@/lib/ai-provider";
import {
  clearImagesApiCapabilityCache,
  executeGenerateImage,
  executeShowDiagramNormalized,
  executeShowHtml,
  getImagesApiCapability,
  imagesApiCacheKey,
  resolveDiagramSource,
  setImagesApiCapability,
} from "../tools/artifactVisual";
import type { AgentToolContext } from "../tools/types";

const baseCtx: AgentToolContext = {
  permissionMode: "workspace-write",
  workspaceRoot: null,
  loadedSkills: [],
};

function openaiSettings(
  overrides: Partial<AISettingsLike> = {},
): AISettingsLike {
  return {
    enabled: true,
    selectedModelId: "dall-e-3",
    workspaceReasoningLevel: "medium",
    customProviderId: "custom-openai",
    customProtocol: "openai",
    customOpenAIResponsesBaseURL: "",
    customOpenAIBaseURL: "https://images-cache-test.example/v1",
    customClaudeBaseURL: "",
    customOpenAIResponsesApiKey: "",
    customOpenAIApiKey: "sk-test",
    customClaudeApiKey: "",
    customModelOptions: [],
    preferredAuthMode: "api_key",
    oauthSession: null,
    ...overrides,
  };
}

const originalFetch = globalThis.fetch;

afterEach(() => {
  clearImagesApiCapabilityCache();
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("resolveDiagramSource / showDiagram", () => {
  it("accepts source | mermaid | code aliases", () => {
    expect(resolveDiagramSource({ source: "a" })).toBe("a");
    expect(resolveDiagramSource({ mermaid: "b" })).toBe("b");
    expect(resolveDiagramSource({ code: "  c  " })).toBe("c");
    expect(resolveDiagramSource({})).toBe("");
  });

  it("executeShowDiagramNormalized errors without source", async () => {
    const r = (await executeShowDiagramNormalized({})) as {
      ok: boolean;
      error: string;
    };
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/source|mermaid|code/);
  });

  it("executeShowDiagramNormalized returns diagram payload", async () => {
    const r = (await executeShowDiagramNormalized({
      mermaid: "graph TD; A-->B",
      title: "流",
    })) as {
      ok: boolean;
      kind: string;
      source: string;
      title?: string;
    };
    expect(r.ok).toBe(true);
    expect(r.kind).toBe("diagram");
    expect(r.source).toContain("A-->B");
    expect(r.title).toBe("流");
  });
});

describe("executeShowHtml", () => {
  it("requires html content", async () => {
    const r = (await executeShowHtml({}, baseCtx)) as {
      ok: boolean;
      error: string;
    };
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/html/);
  });

  it("returns html artifact without writing when no savePath", async () => {
    const r = (await executeShowHtml(
      { html: "<p>hi</p>", title: "预览" },
      baseCtx,
    )) as {
      ok: boolean;
      kind: string;
      html: string;
      filename: string;
    };
    expect(r.ok).toBe(true);
    expect(r.kind).toBe("html");
    expect(r.html).toContain("<p>hi</p>");
    expect(r.filename).toMatch(/\.html$/i);
  });

  it("accepts content alias for html", async () => {
    const r = (await executeShowHtml(
      { content: "<div>x</div>" },
      baseCtx,
    )) as { ok: boolean; html: string };
    expect(r.ok).toBe(true);
    expect(r.html).toContain("<div>x</div>");
  });
});

describe("images API capability cache", () => {
  it("normalizes cache key", () => {
    expect(imagesApiCacheKey("https://api.example.com/v1/")).toBe(
      "https://api.example.com/v1",
    );
    expect(imagesApiCacheKey("HTTPS://API.EXAMPLE.COM/V1")).toBe(
      "https://api.example.com/v1",
    );
  });

  it("get/set/clear work", () => {
    expect(getImagesApiCapability("https://x/v1")).toBeUndefined();
    setImagesApiCapability("https://x/v1/", "unsupported");
    expect(getImagesApiCapability("https://x/v1")).toBe("unsupported");
    clearImagesApiCapabilityCache();
    expect(getImagesApiCapability("https://x/v1")).toBeUndefined();
  });
});

describe("executeGenerateImage", () => {
  it("errors without prompt", async () => {
    const r = (await executeGenerateImage({}, baseCtx)) as {
      ok: boolean;
      error: string;
    };
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/prompt/);
  });

  it("errors without aiSettings", async () => {
    const r = (await executeGenerateImage(
      { prompt: "a cat" },
      baseCtx,
    )) as { ok: boolean; error: string };
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/AI 配置|凭证/);
  });

  it("errors on claude protocol without fetch", async () => {
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as typeof fetch;
    const settings = openaiSettings({
      customProviderId: "custom-claude",
      customProtocol: "claude",
      customClaudeBaseURL: "https://api.anthropic.com",
      customClaudeApiKey: "sk-ant-test",
      customOpenAIApiKey: "",
    });
    const r = (await executeGenerateImage(
      { prompt: "a cat" },
      { ...baseCtx, aiSettings: settings },
    )) as { ok: boolean; error: string };
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Claude|Anthropic/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("short-circuits when endpoint cached as unsupported", async () => {
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as typeof fetch;
    const settings = openaiSettings();
    setImagesApiCapability(
      "https://images-cache-test.example/v1",
      "unsupported",
    );

    const r = (await executeGenerateImage(
      { prompt: "a cat" },
      { ...baseCtx, aiSettings: settings },
    )) as { ok: boolean; error: string; imagesApi?: string };

    expect(r.ok).toBe(false);
    expect(r.imagesApi).toBe("unsupported");
    expect(r.error).toMatch(/Images API|生图/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("marks unsupported on 404 and does not cache 401", async () => {
    clearImagesApiCapabilityCache();
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as typeof fetch;
    const settings = openaiSettings({
      customOpenAIBaseURL: "https://images-auth-test.example/v1",
    });

    fetchSpy.mockResolvedValueOnce({
      ok: false,
      status: 401,
      json: async () => ({ error: { message: "bad key" } }),
      text: async () => "",
    });
    const authFail = (await executeGenerateImage(
      { prompt: "x" },
      { ...baseCtx, aiSettings: settings },
    )) as { ok: boolean; error: string };
    expect(authFail.ok).toBe(false);
    expect(authFail.error).toMatch(/鉴权|401/);
    expect(
      getImagesApiCapability("https://images-auth-test.example/v1"),
    ).toBeUndefined();

    fetchSpy.mockResolvedValueOnce({
      ok: false,
      status: 404,
      json: async () => ({}),
      text: async () => "",
    });
    const notFound = (await executeGenerateImage(
      { prompt: "y" },
      { ...baseCtx, aiSettings: settings },
    )) as { ok: boolean; imagesApi?: string };
    expect(notFound.ok).toBe(false);
    expect(notFound.imagesApi).toBe("unsupported");
    expect(getImagesApiCapability("https://images-auth-test.example/v1")).toBe(
      "unsupported",
    );

    // 二次调用应短路，不再 fetch
    fetchSpy.mockClear();
    const second = (await executeGenerateImage(
      { prompt: "z" },
      { ...baseCtx, aiSettings: settings },
    )) as { ok: boolean; imagesApi?: string };
    expect(second.ok).toBe(false);
    expect(second.imagesApi).toBe("unsupported");
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
