import { create } from "zustand";
import { devtools, subscribeWithSelector } from "zustand/middleware";
import { OpenAI } from "openai";

import { storage } from "@/lib/indexedDBStore";

// 检查 utools 是否可用
const isUtoolsAvailable = typeof window !== "undefined" && "utools" in window;

// AI 路由类型
export type AIRouteType = "default" | "utools" | "ssooai" | "custom";

// 默认线路配置
interface DefaultRouteConfig {
  model: string;
  temperature: number;
}

// Utools线路配置
interface UtoolsRouteConfig {
  model: string;
  temperature: number;
}

// SSOOAI线路配置
interface SsooaiRouteConfig {
  model: string;
  apiKey: string;
  proxyUrl: string;
  temperature: number;
}

// 自定义线路配置
interface CustomRouteConfig {
  apiKey: string;
  model: string;
  proxyUrl: string;
  temperature: number;
}

// OpenAI 客户端配置接口
export interface OpenAIConfig {
  routeType: AIRouteType;
  defaultRoute: DefaultRouteConfig;
  utoolsRoute: UtoolsRouteConfig;
  ssooaiRoute: SsooaiRouteConfig;
  customRoute: CustomRouteConfig;
  utoolsModels: Array<{ value: string; label: string }>;
  ssooaiModels: Array<{ value: string; label: string }>;
  customModels: Array<{ value: string; label: string }>;
  // 线路启用状态
  routeEnabled: {
    default: boolean; // 免费线路始终启用
    utools: boolean;
    ssooai: boolean;
    custom: boolean;
  };
}
const defaultOpenAIConfig: OpenAIConfig = {
  routeType: "default",
  defaultRoute: {
    model: "json-tools",
    temperature: 0.7,
  },
  utoolsRoute: {
    model: "deepseek-v3", // 使用默认模型
    temperature: 0.7,
  },
  ssooaiRoute: {
    apiKey: "",
    model: "gpt-4.1",
    proxyUrl: "https://api.ssooai.com/v1",
    temperature: 0.7,
  },
  customRoute: {
    apiKey: "",
    model: "gpt-4.1",
    proxyUrl: "https://api.ssooai.com/v1",
    temperature: 0.7,
  },
  utoolsModels: [],
  ssooaiModels: [],
  customModels: [],
  routeEnabled: {
    default: true, // 免费线路强制启用
    utools: true, // uTools线路默认启用
    ssooai: false,
    custom: false,
  },
};

// 默认线路的固定 API Key
export const DEFAULT_ROUTE_API_KEY =
  "sk-BGoyyv5XIT0geSDjNvih31S89GxezQry9MbNs6MXW9axVKLz";
export const DEFAULT_ROUTE_PROXY_URL = "https://api.ssooai.com/v1";

const BD_OPENAI_CONFIG_KEY = "openai-config";

interface OpenAIConfigStore extends OpenAIConfig {
  updateConfig: (config: Partial<OpenAIConfig>) => void;
  updateDefaultRouteConfig: (config: Partial<DefaultRouteConfig>) => void;
  updateUtoolsRouteConfig: (config: Partial<UtoolsRouteConfig>) => void;
  updateSsooaiRouteConfig: (config: Partial<SsooaiRouteConfig>) => void;
  updateCustomRouteConfig: (config: Partial<CustomRouteConfig>) => void;
  updateRouteEnabled: (routeType: AIRouteType, enabled: boolean) => void;
  resetConfig: () => void;
  syncConfig: () => Promise<void>;
  fetchUtoolsModels: () => Promise<void>;
  fetchSsooaiModels: () => Promise<void>;
  fetchCustomModels: () => Promise<void>;
  addCustomModel: (model: string, label?: string) => void;
  removeCustomModel: (model: string) => void;
  addSsooaiModel: (model: string, label?: string) => void;
  removeSsooaiModel: (model: string) => void;

  // 获取当前线路的配置
  getCurrentRouteConfig: () =>
    | DefaultRouteConfig
    | UtoolsRouteConfig
    | SsooaiRouteConfig
    | CustomRouteConfig;

  // 获取当前线路的有效 API Key
  getCurrentApiKey: () => string;

  // 获取当前线路的有效 API 地址
  getCurrentProxyUrl: () => string;

  // 获取当前线路的有效模型
  getCurrentModel: () => string;
}

export const useOpenAIConfigStore = create<OpenAIConfigStore>()(
  subscribeWithSelector(
    devtools(
      (set, get) => {
        // 辅助函数：获取可序列化状态
        const getSerializableState = () => {
          const state = get();

          return {
            routeType: state.routeType,
            defaultRoute: state.defaultRoute,
            utoolsRoute: state.utoolsRoute,
            ssooaiRoute: state.ssooaiRoute,
            customRoute: state.customRoute,
            utoolsModels: state.utoolsModels,
            ssooaiModels: state.ssooaiModels,
            customModels: state.customModels,
          };
        };

        return {
          ...defaultOpenAIConfig,

          updateConfig: (config) => {
            set((state) => ({ ...state, ...config }));
            // 保存到存储，只保存可序列化的数据
            storage
              .setItem(BD_OPENAI_CONFIG_KEY, getSerializableState())
              .catch((err) => console.error("Failed to save config:", err));
          },

          updateDefaultRouteConfig: (config) => {
            set((state) => ({
              ...state,
              defaultRoute: { ...state.defaultRoute, ...config },
            }));
            // 保存到存储，只保存可序列化的数据
            storage
              .setItem(BD_OPENAI_CONFIG_KEY, getSerializableState())
              .catch((err) =>
                console.error("Failed to save default route config:", err),
              );
          },

          updateUtoolsRouteConfig: (config) => {
            set((state) => ({
              ...state,
              utoolsRoute: { ...state.utoolsRoute, ...config },
            }));
            // 保存到存储，只保存可序列化的数据
            storage
              .setItem(BD_OPENAI_CONFIG_KEY, getSerializableState())
              .catch((err) =>
                console.error("Failed to save utools route config:", err),
              );
          },

          updateSsooaiRouteConfig: (config) => {
            set((state) => ({
              ...state,
              ssooaiRoute: { ...state.ssooaiRoute, ...config },
            }));
            // 保存到存储，只保存可序列化的数据
            storage
              .setItem(BD_OPENAI_CONFIG_KEY, getSerializableState())
              .catch((err) =>
                console.error("Failed to save SSOOAI route config:", err),
              );
          },

          updateCustomRouteConfig: (config) => {
            set((state) => ({
              ...state,
              customRoute: { ...state.customRoute, ...config },
            }));
            // 保存到存储，只保存可序列化的数据
            storage
              .setItem(BD_OPENAI_CONFIG_KEY, getSerializableState())
              .catch((err) =>
                console.error("Failed to save custom route config:", err),
              );
          },

          updateRouteEnabled: (routeType: AIRouteType, enabled: boolean) => {
            set((state) => ({
              ...state,
              routeEnabled: {
                ...state.routeEnabled,
                [routeType]: enabled,
              },
            }));
            // 保存到存储，只保存可序列化的数据
            storage
              .setItem(BD_OPENAI_CONFIG_KEY, getSerializableState())
              .catch((err) =>
                console.error("Failed to save route enabled state:", err),
              );
          },

          resetConfig: () => set(defaultOpenAIConfig),

          syncConfig: async () => {
            try {
              const savedConfig = await storage.getItem(BD_OPENAI_CONFIG_KEY);

              if (savedConfig) {
                // 只提取我们需要的可序列化字段
                const serializableConfig = savedConfig as Partial<OpenAIConfig>;

                // 确保只更新有效字段，而不是完全覆盖
                set((state) => ({
                  ...state,
                  routeType: serializableConfig.routeType || state.routeType,
                  defaultRoute:
                    serializableConfig.defaultRoute || state.defaultRoute,
                  utoolsRoute:
                    serializableConfig.utoolsRoute || state.utoolsRoute,
                  ssooaiRoute:
                    serializableConfig.ssooaiRoute || state.ssooaiRoute,
                  customRoute:
                    serializableConfig.customRoute || state.customRoute,
                  utoolsModels:
                    serializableConfig.utoolsModels || state.utoolsModels,
                  ssooaiModels:
                    serializableConfig.ssooaiModels || state.ssooaiModels,
                  customModels:
                    serializableConfig.customModels || state.customModels,
                }));
              }
            } catch (error) {
              console.error("Failed to sync OpenAI config:", error);
            }
          },

          fetchUtoolsModels: async () => {
            try {
              // 检查 uTools 是否可用
              if (!isUtoolsAvailable) {
                console.error("uTools is not available");

                return;
              }

              // 使用 utools.allAiModels API 获取模型列表
              const models = await (window as any).utools.allAiModels();

              if (Array.isArray(models) && models.length > 0) {
                // 将 utools 模型数据转换为应用需要的格式
                const formattedModels = models.map((model) => ({
                  value: model.id,
                  label: `${model.label}${model.cost > 0 ? ` (${model.cost}积分)` : ""}`,
                }));

                set((state) => ({ ...state, utoolsModels: formattedModels }));

                // 如果当前没有选择模型或选择的模型不在列表中，自动选择第一个模型
                const currentModel = get().utoolsRoute.model;

                if (
                  !currentModel ||
                  !formattedModels.find((m) => m.value === currentModel)
                ) {
                  const defaultModel =
                    formattedModels[0]?.value || "deepseek-v3";

                  get().updateUtoolsRouteConfig({ model: defaultModel });
                }
              }
            } catch (error) {
              console.error("Failed to fetch Utools models:", error);
            }
          },

          fetchSsooaiModels: async () => {
            try {
              const state = get();

              // 只有在有API密钥和代理URL时才尝试获取模型列表
              if (!state.ssooaiRoute.apiKey && state.ssooaiRoute.proxyUrl) {
                // 如果没有API密钥但有代理URL，设置一些默认模型
                set((state) => ({ ...state, ssooaiModels: [] }));

                return;
              }

              if (!state.ssooaiRoute.proxyUrl) {
                return;
              }

              // 创建临时OpenAI实例用于获取模型
              const openai = new OpenAI({
                apiKey: state.ssooaiRoute.apiKey || "dummy-key", // 如果没有apiKey使用dummy-key
                baseURL: state.ssooaiRoute.proxyUrl,
                dangerouslyAllowBrowser: true,
              });

              // 获取模型列表
              const response = await openai.models.list();

              if (response.data && Array.isArray(response.data)) {
                // 提取模型信息
                let apiModels = response.data.map((model) => ({
                  value: model.id,
                  label: model.id,
                }));

                // 获取当前存储的自定义模型（手动添加的）
                const currentSsooaiModels = state.ssooaiModels.filter(
                  (model) =>
                    !apiModels.some(
                      (apiModel) => apiModel.value === model.value,
                    ),
                );

                // 合并自定义模型和API模型
                const mergedModels = [...currentSsooaiModels, ...apiModels];

                set({ ssooaiModels: mergedModels });
              }
            } catch (error) {
              console.error("Failed to fetch SSOOAI models:", error);
              // 失败时不清空现有模型，保留手动添加的模型
            }
          },

          fetchCustomModels: async () => {
            try {
              const state = get();

              // 只有在有API密钥和代理URL时才尝试获取模型列表
              if (!state.customRoute.apiKey || !state.customRoute.proxyUrl) {
                return;
              }

              // 创建临时OpenAI实例用于获取模型
              const openai = new OpenAI({
                apiKey: state.customRoute.apiKey,
                baseURL: state.customRoute.proxyUrl,
                dangerouslyAllowBrowser: true,
              });

              // 获取模型列表
              const response = await openai.models.list();

              if (response.data && Array.isArray(response.data)) {
                // 提取模型信息
                let apiModels = response.data.map((model) => ({
                  value: model.id,
                  label: model.id,
                }));

                // 获取当前存储的自定义模型
                const currentCustomModels = state.customModels.filter(
                  (model) =>
                    !apiModels.some(
                      (apiModel) => apiModel.value === model.value,
                    ),
                );

                // 合并自定义模型和API模型
                const mergedModels = [...currentCustomModels, ...apiModels];

                set({ customModels: mergedModels });
              }
            } catch (error) {
              console.error("Failed to fetch custom models:", error);
              // 失败时不清空现有模型，保留手动添加的模型
            }
          },

          addCustomModel: (model: string, label?: string) => {
            // 如果model为空，不添加
            if (!model.trim()) return;

            set((state) => {
              // 检查模型是否已存在
              const modelExists = state.customModels.some(
                (m) => m.value === model,
              );

              if (modelExists) {
                // 如果模型已存在，不需要添加
                return state;
              }

              // 创建新的模型对象
              const newModel = {
                value: model,
                label: label || model, // 如果没有提供标签，就使用模型名称作为标签
              };

              // 添加到列表前面
              return {
                ...state,
                customModels: [newModel, ...state.customModels],
              };
            });

            // 保存到存储，只保存可序列化的数据
            storage
              .setItem(BD_OPENAI_CONFIG_KEY, getSerializableState())
              .catch((err) =>
                console.error("Failed to save custom model:", err),
              );
          },

          removeCustomModel: (model: string) => {
            set((state) => {
              // 过滤掉要删除的模型
              const filteredModels = state.customModels.filter(
                (m) => m.value !== model,
              );

              return {
                ...state,
                customModels: filteredModels,
              };
            });

            // 保存到存储，只保存可序列化的数据
            storage
              .setItem(BD_OPENAI_CONFIG_KEY, getSerializableState())
              .catch((err) =>
                console.error(
                  "Failed to save after removing custom model:",
                  err,
                ),
              );
          },

          addSsooaiModel: (model: string, label?: string) => {
            // 如果model为空，不添加
            if (!model.trim()) return;

            set((state) => {
              // 检查模型是否已存在
              const modelExists = state.ssooaiModels.some(
                (m) => m.value === model,
              );

              if (modelExists) {
                // 如果模型已存在，不需要添加
                return state;
              }

              // 创建新的模型对象
              const newModel = {
                value: model,
                label: label || model, // 如果没有提供标签，就使用模型名称作为标签
              };

              // 添加到列表前面
              return {
                ...state,
                ssooaiModels: [newModel, ...state.ssooaiModels],
              };
            });

            // 保存到存储，只保存可序列化的数据
            storage
              .setItem(BD_OPENAI_CONFIG_KEY, getSerializableState())
              .catch((err) =>
                console.error("Failed to save SSOOAI model:", err),
              );
          },

          removeSsooaiModel: (model: string) => {
            set((state) => {
              // 过滤掉要删除的模型
              const filteredModels = state.ssooaiModels.filter(
                (m) => m.value !== model,
              );

              return {
                ...state,
                ssooaiModels: filteredModels,
              };
            });

            // 保存到存储，只保存可序列化的数据
            storage
              .setItem(BD_OPENAI_CONFIG_KEY, getSerializableState())
              .catch((err) =>
                console.error(
                  "Failed to save after removing SSOOAI model:",
                  err,
                ),
              );
          },

          // 获取当前线路的配置
          getCurrentRouteConfig: () => {
            const state = get();

            switch (state.routeType) {
              case "default":
                return state.defaultRoute;
              case "utools":
                return state.utoolsRoute;
              case "ssooai":
                return state.ssooaiRoute;
              case "custom":
                return state.customRoute;
              default:
                return state.defaultRoute;
            }
          },

          // 获取当前线路的 API Key
          getCurrentApiKey: () => {
            const state = get();

            switch (state.routeType) {
              case "default":
                return DEFAULT_ROUTE_API_KEY;
              case "utools":
                return DEFAULT_ROUTE_API_KEY; // uTools 线路使用默认 API Key
              case "ssooai":
                return state.ssooaiRoute.apiKey || DEFAULT_ROUTE_API_KEY;
              case "custom":
                return state.customRoute.apiKey;
              default:
                return DEFAULT_ROUTE_API_KEY;
            }
          },

          // 获取当前线路的 API 地址
          getCurrentProxyUrl: () => {
            const state = get();

            switch (state.routeType) {
              case "default":
                return DEFAULT_ROUTE_PROXY_URL;
              case "utools":
                return DEFAULT_ROUTE_PROXY_URL; // uTools 线路使用默认 API 地址
              case "ssooai":
                return state.ssooaiRoute.proxyUrl;
              case "custom":
                return state.customRoute.proxyUrl;
              default:
                return DEFAULT_ROUTE_PROXY_URL;
            }
          },

          // 获取当前线路的模型
          getCurrentModel: () => {
            const config = get().getCurrentRouteConfig();

            return config.model;
          },
        };
      },
      {
        name: "OpenAIConfigStore",
        enabled: true,
      },
    ),
  ),
);

// 注意：所有的更新操作已经在各自的方法中包含了保存到存储的逻辑
// 不需要额外的订阅来保存，这可能导致序列化错误
