import { expect, test } from "playwright/test";
import {
  AI_PROVIDER_PRESETS,
  DEEPSEEK_BASE_URL,
  GLM_BASE_URL,
  MINIMAX_BASE_URL,
  getAIProviderPreset,
  getCustomAIApiKey,
  getCustomAIBaseURL,
  inferProviderIdFromSettings,
  isDeepSeekProModel,
  resolveActiveProtocol,
  resolveProtocolForProvider,
} from "../../src/lib/ai-provider";
import { normalizeAISettings } from "../../src/stores/settings/types";

test("供应商预设顺序：DeepSeek、GLM、MiniMax 在前", () => {
  expect(AI_PROVIDER_PRESETS.map((item) => item.id).slice(0, 3)).toEqual([
    "deepseek",
    "glm",
    "minimax",
  ]);
  expect(getAIProviderPreset("deepseek").baseURL).toBe(DEEPSEEK_BASE_URL);
  expect(getAIProviderPreset("glm").baseURL).toBe(GLM_BASE_URL);
  expect(getAIProviderPreset("minimax").baseURL).toBe(MINIMAX_BASE_URL);
});

test("DeepSeek 按模型分支协议：Flash → Responses，Pro → 兼容", () => {
  expect(isDeepSeekProModel("deepseek-v4-pro")).toBe(true);
  expect(isDeepSeekProModel("deepseek-v4-flash")).toBe(false);
  expect(resolveProtocolForProvider("deepseek", "deepseek-v4-flash")).toBe(
    "openai-responses",
  );
  expect(resolveProtocolForProvider("deepseek", "deepseek-v4-pro")).toBe(
    "openai",
  );
  expect(resolveProtocolForProvider("glm", "glm-5.2")).toBe("openai");
});

test("DeepSeek 设置解析为固定 Base URL 与双槽 Key 回退", () => {
  const settings = normalizeAISettings({
    enabled: true,
    customProviderId: "deepseek",
    customProtocol: "openai-responses",
    selectedModelId: "deepseek-v4-flash",
    customOpenAIResponsesApiKey: "sk-deepseek",
    customOpenAIApiKey: "",
    customModelOptions: [
      { id: "deepseek-v4-flash", label: "Flash" },
      { id: "deepseek-v4-pro", label: "Pro" },
    ],
  });

  expect(settings.customProviderId).toBe("deepseek");
  expect(getCustomAIBaseURL(settings)).toBe(DEEPSEEK_BASE_URL);
  expect(getCustomAIApiKey(settings)).toBe("sk-deepseek");
  expect(
    resolveActiveProtocol(settings, { selectedModelId: "deepseek-v4-flash" }),
  ).toBe("openai-responses");
  expect(
    resolveActiveProtocol(settings, { selectedModelId: "deepseek-v4-pro" }),
  ).toBe("openai");
});

test("旧配置可从 Base URL 推断供应商", () => {
  expect(
    inferProviderIdFromSettings({
      customProtocol: "openai",
      customOpenAIBaseURL: "https://api.deepseek.com",
    }),
  ).toBe("deepseek");
  expect(
    inferProviderIdFromSettings({
      customProtocol: "openai",
      customOpenAIBaseURL: "https://open.bigmodel.cn/api/paas/v4",
    }),
  ).toBe("glm");
  expect(
    inferProviderIdFromSettings({
      customProtocol: "openai",
      customOpenAIBaseURL: "https://api.minimaxi.com/v1",
    }),
  ).toBe("minimax");
});

test("normalize 保留 customProviderId", () => {
  const normalized = normalizeAISettings({
    customProviderId: "glm",
    customProtocol: "openai",
    customOpenAIBaseURL: GLM_BASE_URL,
    customOpenAIApiKey: "sk-glm",
  });
  expect(normalized.customProviderId).toBe("glm");
  expect(getCustomAIBaseURL(normalized)).toBe(GLM_BASE_URL);
});
