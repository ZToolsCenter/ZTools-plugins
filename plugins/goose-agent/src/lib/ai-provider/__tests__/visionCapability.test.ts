import { describe, expect, it, beforeEach } from "vitest";
import {
  modelSupportsVision,
  resolveModelVision,
  VISION_MODEL_ID_HINTS,
} from "../visionCapability";
import {
  __resetModelsDevVisionCatalogForTests,
  __setModelsDevVisionCatalogForTests,
  getModelsDevVisionCatalogSync,
  lookupModelsDevVision,
  mapProviderIdToModelsDev,
  parseModelsDevApiJson,
  type ModelsDevVisionCatalog,
} from "../modelsDevCatalog";

const emptyCatalog: ModelsDevVisionCatalog = {
  version: 1,
  source: "test",
  providers: {},
};

const sampleCatalog: ModelsDevVisionCatalog = {
  version: 1,
  source: "test",
  providers: {
    xai: {
      "grok-4.5": true,
      "grok-4": true,
    },
    openai: {
      "gpt-4o": true,
      "gpt-3.5-turbo": false,
    },
    deepseek: {
      "deepseek-chat": false,
      "deepseek-v4-flash": false,
    },
  },
};

describe("resolveModelVision", () => {
  beforeEach(() => {
    __resetModelsDevVisionCatalogForTests();
  });

  it("returns unknown false for null/empty model id", () => {
    expect(resolveModelVision("xai", null, null, emptyCatalog)).toEqual({
      supported: false,
      source: "unknown",
    });
    expect(resolveModelVision("xai", "   ", null, emptyCatalog).source).toBe(
      "unknown",
    );
  });

  it("honors explicit supportsVision on option (user/live)", () => {
    expect(
      resolveModelVision(
        "xai",
        "grok-4.5",
        { id: "grok-4.5", supportsVision: true },
        emptyCatalog,
      ),
    ).toEqual({ supported: true, source: "user" });
    expect(
      resolveModelVision(
        "openai",
        "gpt-4o",
        { id: "gpt-4o", supportsVision: false },
        sampleCatalog,
      ),
    ).toEqual({ supported: false, source: "user" });
  });

  it("honors customOptions array explicit boolean", () => {
    expect(
      resolveModelVision(
        "custom",
        "my-custom",
        [{ id: "my-custom", supportsVision: true }],
        emptyCatalog,
      ).supported,
    ).toBe(true);
  });

  it("uses models.dev catalog for Grok 4.5", () => {
    const r = resolveModelVision("xai", "grok-4.5", null, sampleCatalog);
    expect(r).toEqual({ supported: true, source: "catalog" });
  });

  it("uses catalog false for deepseek-v4-flash", () => {
    const r = resolveModelVision(
      "deepseek",
      "deepseek-v4-flash",
      null,
      sampleCatalog,
    );
    expect(r).toEqual({ supported: false, source: "catalog" });
  });

  it("falls back to heuristic when catalog misses", () => {
    const r = resolveModelVision("openai", "gpt-4o-mini", null, emptyCatalog);
    expect(r.source).toBe("heuristic");
    expect(r.supported).toBe(true);
  });

  it("unknown models fail closed", () => {
    const r = resolveModelVision(
      "custom-openai",
      "totally-unknown-xyz",
      null,
      emptyCatalog,
    );
    expect(r).toEqual({ supported: false, source: "unknown" });
  });

  it("explicit false overrides positive catalog/heuristic", () => {
    expect(
      resolveModelVision(
        "openai",
        "gpt-4o",
        [{ id: "gpt-4o", supportsVision: false }],
        sampleCatalog,
      ),
    ).toEqual({ supported: false, source: "user" });
  });
});

describe("modelSupportsVision (compat)", () => {
  beforeEach(() => {
    __setModelsDevVisionCatalogForTests(sampleCatalog);
  });

  it("returns false for null/empty", () => {
    expect(modelSupportsVision(null)).toBe(false);
    expect(modelSupportsVision(undefined)).toBe(false);
    expect(modelSupportsVision("")).toBe(false);
  });

  it("honors customOptions supportsVision true/false", () => {
    expect(
      modelSupportsVision("my-custom", [
        { id: "my-custom", supportsVision: true },
      ]),
    ).toBe(true);
    expect(
      modelSupportsVision("my-custom", [
        { id: "my-custom", supportsVision: false },
      ]),
    ).toBe(false);
  });

  it("matches customOptions via canonical provider/model id", () => {
    expect(
      modelSupportsVision(
        "deepseek/deepseek-chat",
        [{ id: "deepseek-chat", supportsVision: true }],
        "deepseek",
      ),
    ).toBe(true);
    expect(
      modelSupportsVision(
        "deepseek/deepseek-chat",
        [{ id: "deepseek-chat", supportsVision: false }],
        "deepseek",
      ),
    ).toBe(false);
  });

  it("Grok 4.5 true via catalog when providerId=xai", () => {
    expect(modelSupportsVision("grok-4.5", null, "xai", sampleCatalog)).toBe(
      true,
    );
  });

  it("matches common vision model id hints without catalog", () => {
    __setModelsDevVisionCatalogForTests(emptyCatalog);
    const positives = [
      "gpt-4o",
      "gpt-4.1",
      "claude-sonnet-4",
      "gemini-2.0-flash",
      "qwen2.5-vl",
      "llama-4-scout",
    ];
    for (const id of positives) {
      expect(modelSupportsVision(id, null, null, emptyCatalog), id).toBe(true);
    }
  });

  it("rejects deepseek and plain chat models without vision", () => {
    __setModelsDevVisionCatalogForTests(emptyCatalog);
    const negatives = [
      "deepseek-chat",
      "deepseek-coder",
      "deepseek-reasoner",
      "deepseek-r1",
      "deepseek-v3",
      "gpt-3.5-turbo",
      "text-embedding-3-small",
      "unknown-model-xyz",
    ];
    for (const id of negatives) {
      expect(modelSupportsVision(id, null, null, emptyCatalog), id).toBe(false);
    }
  });

  it("exports non-empty VISION_MODEL_ID_HINTS", () => {
    expect(VISION_MODEL_ID_HINTS.length).toBeGreaterThan(5);
  });
});

describe("modelsDevCatalog", () => {
  beforeEach(() => {
    __resetModelsDevVisionCatalogForTests();
  });

  it("mapProviderIdToModelsDev routes presets", () => {
    expect(mapProviderIdToModelsDev("xai")).toEqual(["xai"]);
    expect(mapProviderIdToModelsDev("custom-claude")).toEqual(["anthropic"]);
    expect(mapProviderIdToModelsDev("custom-openai")[0]).toBe("openai");
  });

  it("parseModelsDevApiJson extracts image modalities", () => {
    const parsed = parseModelsDevApiJson({
      xai: {
        models: {
          "grok-4.5": {
            modalities: { input: ["text", "image", "pdf"], output: ["text"] },
          },
          "text-only": {
            modalities: { input: ["text"], output: ["text"] },
          },
        },
      },
    });
    expect(parsed.providers.xai?.["grok-4.5"]).toBe(true);
    expect(parsed.providers.xai?.["text-only"]).toBe(false);
  });

  it("lookupModelsDevVision finds grok-4.5 on xai", () => {
    expect(lookupModelsDevVision("xai", "grok-4.5", sampleCatalog)).toBe(true);
    expect(lookupModelsDevVision("xai", "missing", sampleCatalog)).toBe(
      undefined,
    );
  });

  it("getModelsDevVisionCatalogSync falls back to snapshot with grok-4.5", () => {
    const cat = getModelsDevVisionCatalogSync();
    expect(lookupModelsDevVision("xai", "grok-4.5", cat)).toBe(true);
  });
});
