import OpenAI from "openai";
import { ChatCompletionMessageParam } from "openai/resources";

import {
  useOpenAIConfigStore,
  AIRouteType,
  DEFAULT_ROUTE_API_KEY,
  DEFAULT_ROUTE_PROXY_URL,
} from "@/store/useOpenAIConfigStore.ts";
import toast from "@/utils/toast.tsx";

// 检查 utools 是否可用
const isUtoolsAvailable = typeof window !== "undefined" && "utools" in window;

/**
 * OpenAI 服务
 * 提供与 OpenAI API 通信的基础功能
 */
export class OpenAIService {
  private openai: OpenAI | null = null;
  private routeType: AIRouteType = "default";
  maxTokens: number = 10000;

  // 添加config公共属性，用于存储和恢复配置
  public config = {
    routeType: "default" as AIRouteType,
    model: "",
    temperature: 0.7,
  };

  /**
   * 初始化OpenAI服务
   */
  constructor() {
    // 空构造函数，通过 syncConfig 初始化
  }

  /**
   * 从store同步配置
   */
  public syncConfig(): void {
    const openaiStore = useOpenAIConfigStore.getState();

    this.routeType = openaiStore.routeType;
    this.config = {
      routeType: openaiStore.routeType,
      model: openaiStore.getCurrentModel(),
      temperature: openaiStore.getCurrentRouteConfig().temperature,
    };
    this.initOpenAI();
  }

  /**
   * 获取当前线路的 API Key
   */
  private getCurrentApiKey(): string {
    return useOpenAIConfigStore.getState().getCurrentApiKey();
  }

  /**
   * 获取当前线路的 API 地址
   */
  private getCurrentProxyUrl(): string {
    return useOpenAIConfigStore.getState().getCurrentProxyUrl();
  }

  /**
   * 获取当前线路的模型
   */
  private getCurrentModel(): string {
    return useOpenAIConfigStore.getState().getCurrentModel();
  }

  /**
   * 获取当前线路的温度参数
   */
  private getCurrentTemperature(): number {
    const config = useOpenAIConfigStore.getState().getCurrentRouteConfig();

    return config.temperature;
  }

  /**
   * 初始化OpenAI客户端
   */
  private initOpenAI(): void {
    // 如果是 utools 线路，不需要初始化 OpenAI 客户端
    if (this.routeType === "utools") {
      if (!isUtoolsAvailable) {
        toast.error("uTools API 不可用，请确保在 uTools 环境中运行");
        this.openai = null;
      }

      return;
    }

    const apiKey = this.getCurrentApiKey();
    const proxyUrl = this.getCurrentProxyUrl();

    if (!apiKey) {
      this.openai = null;

      return;
    }

    // 根据不同的线路类型进行初始化
    switch (this.routeType) {
      case "default":
        // 默认线路使用内置的代理
        this.openai = new OpenAI({
          apiKey: DEFAULT_ROUTE_API_KEY,
          baseURL: DEFAULT_ROUTE_PROXY_URL,
          dangerouslyAllowBrowser: true,
        });
        break;

      case "ssooai":
        // SSOOAI线路使用SSOOAI的API密钥和地址
        const ssooaiApiKey = useOpenAIConfigStore.getState().ssooaiRoute.apiKey;
        const ssooaiProxyUrl =
          useOpenAIConfigStore.getState().ssooaiRoute.proxyUrl;

        if (!ssooaiApiKey) {
          this.openai = null;

          return;
        }

        this.openai = new OpenAI({
          apiKey: ssooaiApiKey,
          baseURL: ssooaiProxyUrl,
          dangerouslyAllowBrowser: true,
        });
        break;

      case "custom":
        this.openai = new OpenAI({
          apiKey,
          baseURL: proxyUrl,
          dangerouslyAllowBrowser: true,
        });
        break;
    }
  }

  /**
   * 验证服务是否已准备好
   */
  private validateService(): boolean {
    // 如果是 utools 线路，检查 utools 是否可用
    if (this.routeType === "utools") {
      if (!isUtoolsAvailable) {
        toast.error("uTools API 不可用，请确保在 uTools 环境中运行");

        return false;
      }

      return true;
    }

    if (!this.openai) {
      const apiKey = this.getCurrentApiKey();

      if (!apiKey) {
        if (this.routeType === "custom") {
          toast.error("请在设置中输入您的 API 密钥");
        } else {
          // 默认线路应该总是有 API Key
          toast.error("API 密钥配置错误");
        }
      } else {
        this.initOpenAI();
        if (!this.openai) {
          toast.error("OpenAI 服务初始化失败");

          return false;
        }
      }

      return false;
    }

    return true;
  }

  /**
   * 使用 utools.ai API 发送请求
   */
  private async createUtoolsChatCompletion(
    messages: any[],
    callbacks: {
      onStart?: () => void;
      onProcessing?: (step: string) => void;
      onChunk?: (chunk: string, accumulated: string) => void;
      onComplete?: (final: string) => void;
      onError?: (error: Error) => void;
    },
  ): Promise<boolean> {
    if (!isUtoolsAvailable) {
      callbacks.onError?.(new Error("uTools API 不可用"));

      return false;
    }

    try {
      callbacks.onStart?.();
      callbacks.onProcessing?.("连接到 uTools AI...");

      let accumulated = "";

      // 获取模型和温度参数
      const modelToUse = this.getCurrentModel();

      // 转换消息格式
      const utoolsMessages = messages.map((msg) => ({
        role: msg.role,
        content: msg.content,
      }));

      // 准备 utools.ai 选项参数
      const options = {
        model: modelToUse,
        messages: utoolsMessages,
        // 可以在这里添加其他 utools.ai 支持的参数
      };

      callbacks.onProcessing?.(`AI 正在使用 ${modelToUse} 模型处理数据...`);

      // 创建取消标记
      let isCancelled = false;

      // 创建一个 Promise 来处理 utools.ai 的调用
      const promise = (window as any).utools.ai(
        options,
        (chunk: { content?: string; reasoning_content?: string }) => {
          if (isCancelled) return;

          if (chunk.content) {
            accumulated += chunk.content;
            callbacks.onChunk?.(chunk.content, accumulated);
          }

          // 如果存在推理内容，也可以选择处理
          if (chunk.reasoning_content) {
            callbacks.onProcessing?.("AI 正在推理中...");
          }
        },
      );

      // 添加取消方法
      const cancelablePromise = promise as Promise<any> & {
        abort?: () => void;
      };

      // 处理调用结果
      await cancelablePromise;

      if (!isCancelled) {
        callbacks.onComplete?.(accumulated);
        callbacks.onProcessing?.("处理完成");
      }

      return true;
    } catch (error) {
      console.error("uTools AI 调用出错:", error);
      callbacks.onError?.(error as Error);

      return false;
    }
  }

  /**
   * 发送流式请求到 AI 服务
   * @param messages 消息数组
   * @param callbacks 回调函数，用于处理流式响应
   * @returns 是否成功开始请求
   */
  public async createChatCompletion(
    messages: ChatCompletionMessageParam[],
    callbacks: {
      onStart?: () => void;
      onProcessing?: (step: string) => void;
      onChunk?: (chunk: string, accumulated: string) => void;
      onComplete?: (final: string) => void;
      onError?: (error: Error) => void;
    } = {},
  ): Promise<boolean> {
    // 验证服务是否已初始化
    if (!this.validateService()) {
      return false;
    }

    // 如果是 utools 线路，使用 utools.ai API
    if (this.routeType === "utools") {
      return this.createUtoolsChatCompletion(messages, callbacks);
    }

    // 开始处理
    callbacks.onStart?.();
    callbacks.onProcessing?.("Connecting to OpenAI...");

    // 根据线路类型获取模型和温度
    const modelToUse = this.getCurrentModel();
    const temperature = this.getCurrentTemperature();

    // 使用流式请求
    const stream = await this.openai!.chat.completions.create({
      model: modelToUse,
      messages: messages,
      temperature: temperature,
      stream: true,
    });

    try {
      callbacks.onProcessing?.("AI 正在接收数据...");

      let accumulated = "";

      callbacks.onProcessing?.("AI 正在深度思考...");

      // 处理流
      for await (const chunk of stream) {
        const content = chunk.choices[0]?.delta?.content || "";

        if (content) {
          accumulated += content;
          // 回调处理每个块
          callbacks.onChunk?.(content, accumulated);
        }
      }

      callbacks.onComplete?.(accumulated);
      callbacks.onProcessing?.("处理完成");

      return true;
    } catch (err) {
      stream.controller.abort();
      const error = err as Error;

      callbacks.onError?.(error);

      return false;
    }
  }

  /**
   * 测试AI线路连接
   * @param routeType 要测试的线路类型
   * @returns 返回一个Promise，成功则resolve，失败则reject
   */
  public async testConnection(routeType: AIRouteType): Promise<boolean> {
    // 保存当前线路类型
    const currentRouteType = this.routeType;

    try {
      // 临时切换到要测试的线路
      this.routeType = routeType;
      this.initOpenAI();

      // 根据不同线路类型进行测试
      switch (routeType) {
        case "default":
          // 测试默认线路
          if (!this.openai) {
            throw new Error("默认线路初始化失败");
          }

          // 简单测试API可用性
          if (this.openai) {
            await this.openai.models.list();
          } else {
            throw new Error("API客户端初始化失败");
          }

          return true;

        case "ssooai":
          // 测试SSOOAI线路
          const ssooaiApiKey =
            useOpenAIConfigStore.getState().ssooaiRoute.apiKey;
          const ssooaiProxyUrl =
            useOpenAIConfigStore.getState().ssooaiRoute.proxyUrl;

          if (!ssooaiApiKey) {
            throw new Error("请提供SSOOAI API密钥");
          }

          if (!ssooaiProxyUrl) {
            throw new Error("SSOOAI API地址配置错误");
          }

          // 临时创建SSOOAI客户端
          const ssooaiClient = new OpenAI({
            apiKey: ssooaiApiKey,
            baseURL: ssooaiProxyUrl,
            dangerouslyAllowBrowser: true,
          });

          // 测试API可用性
          await ssooaiClient.models.list();

          // 测试成功后，获取模型列表
          await useOpenAIConfigStore.getState().fetchSsooaiModels();

          return true;

        case "utools":
          // 测试utools线路
          if (!isUtoolsAvailable) {
            throw new Error("uTools API 不可用，请确保在 uTools 环境中运行");
          }

          // 检查是否有可用模型
          const utoolsModels = useOpenAIConfigStore.getState().utoolsModels;

          if (!utoolsModels || utoolsModels.length === 0) {
            throw new Error("未找到可用的 uTools 模型");
          }

          // 简单测试一下 utools.ai API 是否可用
          if (!(window as any).utools || !(window as any).utools.ai) {
            throw new Error("uTools AI 功能不可用");
          }

          return true;

        case "custom":
          // 测试自定义线路
          if (!this.openai) {
            const apiKey = useOpenAIConfigStore.getState().customRoute.apiKey;
            const proxyUrl =
              useOpenAIConfigStore.getState().customRoute.proxyUrl;

            if (!apiKey) {
              throw new Error("请提供API密钥");
            }

            if (!proxyUrl) {
              throw new Error("请提供API地址");
            }

            throw new Error("自定义线路初始化失败");
          }

          // 简单测试API可用性
          if (this.openai) {
            await this.openai.models.list();

            // 测试成功后，获取模型列表
            await useOpenAIConfigStore.getState().fetchCustomModels();
          } else {
            throw new Error("API客户端初始化失败");
          }

          return true;

        default:
          throw new Error("未知的线路类型");
      }
    } catch (error) {
      console.error("测试线路失败:", error);
      throw error;
    } finally {
      // 恢复之前的线路类型
      this.routeType = currentRouteType;
      this.initOpenAI();
    }
  }

  /**
   * 创建一个预设的OpenAI服务实例
   * @returns OpenAIService实例
   */
  public static createInstance(): OpenAIService {
    const service = new OpenAIService();

    service.syncConfig();

    return service;
  }

  /**
   * 更新服务配置（用于测试）
   * @param newConfig 新配置
   */
  public updateConfig(newConfig: {
    routeType: AIRouteType;
    model: string;
    temperature?: number;
  }): void {
    this.routeType = newConfig.routeType;
    this.config = {
      ...this.config,
      ...newConfig,
    };
    this.initOpenAI();
  }

  /**
   * 非流式聊天请求（用于测试）
   * @param options 聊天参数
   * @returns 聊天完成结果
   */
  public async chat(options: {
    messages: ChatCompletionMessageParam[];
    temperature?: number;
    max_tokens?: number;
    model?: string;
  }): Promise<any> {
    // 验证服务是否已初始化
    if (!this.validateService()) {
      throw new Error("AI服务未初始化或配置错误");
    }

    const modelToUse = options.model || this.getCurrentModel();
    const temperature = options.temperature || this.getCurrentTemperature();

    try {
      // 为utools线路提供特殊处理
      if (this.routeType === "utools") {
        if (!isUtoolsAvailable) {
          throw new Error("uTools API 不可用");
        }

        return new Promise((resolve, reject) => {
          const utoolsMessages = options.messages.map((msg) => ({
            role: msg.role,
            content: msg.content,
          }));

          const utoolsOptions = {
            model: modelToUse,
            messages: utoolsMessages,
            temperature: temperature,
            max_tokens: options.max_tokens || this.maxTokens,
          };

          try {
            let responseContent = "";
            const promise = (window as any).utools.ai(
              utoolsOptions,
              (chunk: { content?: string }) => {
                if (chunk.content) {
                  responseContent += chunk.content;
                }
              },
            );

            promise
              .then(() => {
                resolve({
                  choices: [
                    {
                      message: {
                        role: "assistant",
                        content: responseContent,
                      },
                    },
                  ],
                });
              })
              .catch((err: Error) => {
                reject(err);
              });
          } catch (error) {
            reject(error);
          }
        });
      }

      // 对于其他线路，使用普通的完成请求
      if (!this.openai) {
        throw new Error("OpenAI客户端未初始化");
      }

      const response = await this.openai.chat.completions.create({
        model: modelToUse,
        messages: options.messages,
        temperature: temperature,
        max_tokens: options.max_tokens || this.maxTokens,
      });

      return response;
    } catch (error) {
      console.error("AI请求失败:", error);
      throw error;
    }
  }
}

// 导出单例实例
export const openAIService = OpenAIService.createInstance();
