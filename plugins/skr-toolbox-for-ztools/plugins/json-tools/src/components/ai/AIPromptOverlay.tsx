import React, { useRef, useEffect, useMemo, useState } from "react";
import { Button, Chip, Select, SelectItem } from "@heroui/react";
import { Icon } from "@iconify/react";

import {
  AIRouteType,
  useOpenAIConfigStore,
} from "@/store/useOpenAIConfigStore";

// 定义模型选项类型
interface ModelOption {
  value: string;
  label: string;
  tag?: {
    text: string;
    type: "free" | "paid" | "energy" | "private";
  };
}

// 快捷指令类型定义
export interface QuickPrompt {
  id: string;
  label: string;
  icon?: string;
  prompt: string;
  color?:
    | "primary"
    | "secondary"
    | "success"
    | "warning"
    | "danger"
    | "default";
  handler?: () => void; // 可选的自定义处理函数
}

interface AIPromptOverlayProps {
  isOpen: boolean;
  prompt: string;
  placeholderText?: string;
  tipText?: string;
  tipIcon?: string;
  quickPrompts?: QuickPrompt[]; // 新增：快捷指令数组
  onPromptChange: (prompt: string) => void;
  onSubmit: () => void;
  onClose: () => void;
  onQuickPromptClick?: (quickPrompt: QuickPrompt) => void; // 新增：自定义快捷指令点击处理函数
}

const AIPromptOverlay: React.FC<AIPromptOverlayProps> = ({
  isOpen,
  prompt,
  placeholderText = "输入您的问题...",
  tipText = "提示: 您可以让AI为您处理关于数据修复，数据优化，模拟数据生成等问题",
  tipIcon = "mdi:lightbulb-outline",
  quickPrompts = [], // 默认为空数组
  onPromptChange,
  onSubmit,
  onClose,
  onQuickPromptClick,
}) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const [isUtoolsAvailable] = useState(
    () => typeof window !== "undefined" && "utools" in window,
  );

  // 从 store 中选择性地只获取需要的状态，避免不必要的重新渲染
  const routeType = useOpenAIConfigStore((state) => state.routeType);
  const routeEnabled = useOpenAIConfigStore((state) => state.routeEnabled);
  const defaultModel = useOpenAIConfigStore(
    (state) => state.defaultRoute.model,
  );
  const utoolsModel = useOpenAIConfigStore((state) => state.utoolsRoute.model);
  const ssooaiModel = useOpenAIConfigStore((state) => state.ssooaiRoute?.model);
  const customModel = useOpenAIConfigStore((state) => state.customRoute.model);
  const customApiKey = useOpenAIConfigStore(
    (state) => state.customRoute.apiKey,
  );
  const customProxyUrl = useOpenAIConfigStore(
    (state) => state.customRoute.proxyUrl,
  );
  const utoolsModels = useOpenAIConfigStore((state) => state.utoolsModels);
  const ssooaiModels = useOpenAIConfigStore(
    (state) => state.ssooaiModels || [],
  );
  const customModels = useOpenAIConfigStore((state) => state.customModels);

  // 单独获取更新函数，避免重新渲染
  const updateConfig = useOpenAIConfigStore((state) => state.updateConfig);
  const updateDefaultRouteConfig = useOpenAIConfigStore(
    (state) => state.updateDefaultRouteConfig,
  );
  const updateUtoolsRouteConfig = useOpenAIConfigStore(
    (state) => state.updateUtoolsRouteConfig,
  );
  const updateSsooaiRouteConfig = useOpenAIConfigStore(
    (state) => state.updateSsooaiRouteConfig,
  );
  const updateCustomRouteConfig = useOpenAIConfigStore(
    (state) => state.updateCustomRouteConfig,
  );
  const fetchUtoolsModels = useOpenAIConfigStore(
    (state) => state.fetchUtoolsModels,
  );
  const fetchSsooaiModels = useOpenAIConfigStore(
    (state) => state.fetchSsooaiModels,
  );
  const fetchCustomModels = useOpenAIConfigStore(
    (state) => state.fetchCustomModels,
  );

  // 检查私有线路是否可用（API Key是否已填写）
  const isCustomRouteAvailable = !!customApiKey && !!customProxyUrl;

  // 在组件挂载时获取uTools模型
  useEffect(() => {
    if (isUtoolsAvailable && routeType === "utools") {
      fetchUtoolsModels();
    }
  }, [fetchUtoolsModels, isUtoolsAvailable, routeType]);

  // 在组件挂载或配置更改时获取私有线路模型
  useEffect(() => {
    if (
      routeType === "custom" &&
      isCustomRouteAvailable &&
      customModels.length === 0
    ) {
      fetchCustomModels();
    }
  }, [
    fetchCustomModels,
    routeType,
    isCustomRouteAvailable,
    customModels.length,
  ]);

  // 使用 useMemo 缓存计算结果
  const modelOptions = useMemo((): ModelOption[] => {
    switch (routeType) {
      case "default":
        return [
          {
            value: "gpt-4.1",
            label: "GPT-4.1",
            tag: { text: "免费", type: "free" },
          },
        ];
      case "utools":
        // 添加标签到 uTools 模型
        if (utoolsModels.length > 0) {
          return utoolsModels.map((model) => ({
            ...model,
            tag: { text: "能量", type: "energy" },
          }));
        }

        return [
          {
            value: "deepseek-v3",
            label: "DeepSeek-V3",
            tag: { text: "能量", type: "energy" },
          },
        ];
      case "ssooai":
        // 添加标签到 SSOOAI 模型
        if (ssooaiModels.length > 0) {
          return ssooaiModels.map((model) => ({
            ...model,
            tag: { text: "付费", type: "paid" },
          }));
        }

        return [
          {
            value: "gpt-4.1",
            label: "GPT-4.1",
            tag: { text: "付费", type: "paid" },
          },
        ];
      case "custom":
        // 添加标签到自定义模型
        if (customModels.length > 0) {
          return customModels.map((model) => ({
            ...model,
            tag: { text: "付费", type: "paid" },
          }));
        }

        return [
          {
            value: "gpt-4.1",
            label: "GPT-4.1",
            tag: { text: "付费", type: "paid" },
          },
        ];
      default:
        return [];
    }
  }, [routeType, utoolsModels, ssooaiModels, customModels]);

  // 使用 useMemo 缓存当前选择的模型
  const currentModel = useMemo(() => {
    switch (routeType) {
      case "default":
        return defaultModel;
      case "utools":
        return utoolsModel;
      case "ssooai":
        return ssooaiModel;
      case "custom":
        return customModel;
      default:
        return defaultModel;
    }
  }, [routeType, defaultModel, utoolsModel, ssooaiModel, customModel]);

  // 获取可用的线路列表
  const availableRoutes = useMemo(() => {
    const routes: AIRouteType[] = ["default"]; // 默认线路总是可用的

    if (routeEnabled.utools && isUtoolsAvailable) {
      routes.push("utools");
    }

    if (routeEnabled.ssooai) {
      routes.push("ssooai");
    }

    if (routeEnabled.custom) {
      routes.push("custom");
    }

    return routes;
  }, [routeEnabled, isUtoolsAvailable]);

  // 当routeEnabled变化时，确保当前选择的路由是可用的
  useEffect(() => {
    // 如果当前选择的路由不在可用路由列表中，自动切换到默认路由
    if (!availableRoutes.includes(routeType)) {
      updateConfig({ routeType: "default" });
    }
  }, [availableRoutes, routeType, updateConfig]);

  // 处理线路变更
  const handleRouteChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const newRouteType = e.target.value as AIRouteType;

    // 确保选择的线路是可用的
    if (!availableRoutes.includes(newRouteType)) {
      return;
    }

    // 如果切换到uTools线路，先获取模型列表
    if (newRouteType === "utools" && isUtoolsAvailable) {
      fetchUtoolsModels();
      // 设置默认uTools模型（使用列表中的第一个或fallback）
      const defaultUtoolsModel =
        utoolsModels.length > 0 ? utoolsModels[0].value : "deepseek-v3";

      updateUtoolsRouteConfig({ model: defaultUtoolsModel });
    }

    // 如果切换到SSOOAI线路，获取模型列表
    if (newRouteType === "ssooai") {
      fetchSsooaiModels();
      // 设置默认SSOOAI模型
      const defaultSsooaiModel =
        ssooaiModels.length > 0 ? ssooaiModels[0].value : "gpt-4.1";

      updateSsooaiRouteConfig({ model: defaultSsooaiModel });
    }

    // 如果切换到私有线路，且有API配置，获取模型列表
    if (
      newRouteType === "custom" &&
      isCustomRouteAvailable &&
      customModels.length === 0
    ) {
      fetchCustomModels();
    }

    // 如果切换到私有线路，设置默认模型为gpt-4.1
    if (newRouteType === "custom") {
      updateCustomRouteConfig({ model: "gpt-4.1" });
    }

    // 如果切换到默认线路，设置默认模型
    if (newRouteType === "default") {
      updateDefaultRouteConfig({ model: "gpt-4.1" });
    }

    updateConfig({ routeType: newRouteType });
  };

  // 处理模型变更
  const handleModelChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const newModel = e.target.value;

    switch (routeType) {
      case "default":
        updateDefaultRouteConfig({ model: newModel });
        break;
      case "utools":
        updateUtoolsRouteConfig({ model: newModel });
        break;
      case "ssooai":
        updateSsooaiRouteConfig({ model: newModel });
        break;
      case "custom":
        updateCustomRouteConfig({ model: newModel });
        break;
    }
  };

  // 当组件显示时自动聚焦到输入框
  useEffect(() => {
    if (isOpen && inputRef.current) {
      setTimeout(() => {
        inputRef.current?.focus();
      }, 100);
    }
  }, [isOpen]);

  // 添加ESC键全局监听
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isOpen) {
        onClose();
      }
    };

    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen, onClose]);

  // 点击外部区域关闭
  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (event: MouseEvent) => {
      if (
        overlayRef.current &&
        !overlayRef.current.contains(event.target as Node)
      ) {
        onClose();
      }
    };

    document.addEventListener("mousedown", handleClickOutside);

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [isOpen, onClose]);

  // 处理快捷指令点击
  const handleQuickPromptClick = (quickPrompt: QuickPrompt) => {
    // 如果传入了自定义点击处理函数，则使用它
    if (onQuickPromptClick) {
      onQuickPromptClick(quickPrompt);

      return;
    }

    // 如果有自定义处理函数，则执行它
    if (quickPrompt.handler) {
      quickPrompt.handler();

      return;
    }

    // 否则执行默认行为：替换提示文本
    onPromptChange(quickPrompt.prompt);
    if (inputRef.current) {
      inputRef.current.focus();
    }
  };

  if (!isOpen) return null;

  return (
    <div
      ref={overlayRef}
      aria-label="AI 提示对话框"
      aria-modal="true"
      className="absolute z-50 top-[10px] left-1/2 transform -translate-x-1/2 w-[90%] max-w-2xl"
      role="dialog"
    >
      <div className="flex flex-col rounded-lg shadow-xl bg-gradient-to-r from-blue-200/30 to-indigo-50 dark:from-neutral-800/80 border border-blue-200 dark:border-neutral-700 overflow-hidden backdrop-blur-sm">
        {/* 输入框区域 */}
        <div className="flex items-center p-4 gap-2">
          <div className="flex items-center flex-1 bg-white dark:bg-neutral-800 rounded-md border border-blue-200 dark:border-neutral-700 pl-2 pr-1 py-1 shadow-inner">
            <Icon
              className="text-indigo-500 mx-2"
              icon="hugeicons:ai-chat-02"
              width={20}
            />
            <input
              ref={inputRef}
              aria-label="AI 提示输入"
              className="h-8 flex-1 bg-transparent border-none outline-none text-gray-700 dark:text-gray-200 placeholder-gray-400 dark:placeholder-neutral-500 text-sm"
              placeholder={placeholderText}
              type="text"
              value={prompt}
              onChange={(e) => onPromptChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  onSubmit();
                }
              }}
            />
            {prompt && (
              <Button
                isIconOnly
                aria-label="清除输入"
                className="mr-1 text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300"
                size="sm"
                variant="light"
                onPress={() => onPromptChange("")}
              >
                <Icon icon="mdi:close" width={16} />
              </Button>
            )}
          </div>

          <Button
            isIconOnly
            aria-label="发送提问"
            className="w-12 bg-gradient-to-r from-blue-500 to-indigo-600 order-none"
            color="primary"
            size="sm"
            onPress={onSubmit}
          >
            <Icon icon="tabler:send" width={16} />
          </Button>
        </div>

        {/* AI 配置选择器 */}
        <div className="flex items-center justify-between px-4 py-3 gap-2 border-t border-blue-100 dark:border-neutral-700/50 bg-white/30 dark:bg-neutral-800/30">
          <div className="flex items-center gap-2">
            <div className="text-xs flex items-center text-gray-600 dark:text-gray-300 whitespace-nowrap">
              线路:
            </div>
            <Select
              aria-label="选择 AI 线路"
              className="min-w-[180px]"
              disallowEmptySelection={true}
              selectedKeys={new Set([routeType])}
              selectionMode="single"
              size="sm"
              onChange={handleRouteChange}
            >
              {availableRoutes.map((route) => {
                switch (route) {
                  case "default":
                    return (
                      <SelectItem
                        key="default"
                        startContent={
                          <span className="text-xs px-3 py-0.5 bg-success/20 text-success rounded-full">
                            免 费
                          </span>
                        }
                      >
                        免费线路
                      </SelectItem>
                    );
                  case "utools":
                    return (
                      <SelectItem
                        key="utools"
                        startContent={
                          <span className="text-xs px-1.5 py-0.5 bg-warning/20 text-warning rounded-full">
                            AI 能量
                          </span>
                        }
                      >
                        uTools AI
                      </SelectItem>
                    );
                  case "ssooai":
                    return (
                      <SelectItem
                        key="ssooai"
                        startContent={
                          <div className="flex gap-1">
                            <span className="text-xs px-3 py-0.5 bg-warning/20 text-warning rounded-full">
                              付 费
                            </span>
                          </div>
                        }
                      >
                        SSOOAI
                      </SelectItem>
                    );
                  case "custom":
                    return (
                      <SelectItem
                        key="custom"
                        startContent={
                          <span className="text-xs px-3 py-0.5 bg-primary/20 text-primary rounded-full">
                            私 有
                          </span>
                        }
                      >
                        私有线路
                      </SelectItem>
                    );
                }
              })}
            </Select>
          </div>

          {/* 模型显示与选择 */}
          <div className="flex items-center gap-2">
            <div className="text-xs flex items-center text-gray-600 dark:text-gray-300 whitespace-nowrap">
              模型:
            </div>
            {routeType === "default" ? (
              <div className="flex items-center gap-2">
                <div className="text-xs bg-blue-100/50 dark:bg-blue-900/30 px-3 py-1 rounded-md text-blue-700 dark:text-blue-400">
                  GPT 4.1
                </div>
                <span className="text-xs px-1.5 py-0.5 bg-success/20 text-success-700 rounded-full whitespace-nowrap">
                  <a
                    href="https://api.ssooai.com"
                    rel="noreferrer"
                    target="_blank"
                  >
                    服务提供商：api.ssooai.com
                  </a>
                </span>
              </div>
            ) : routeType === "custom" && !isCustomRouteAvailable ? (
              <div className="text-xs text-red-500">
                未填写API密钥，请在设置中配置
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <Select
                  aria-label="选择 AI 模型"
                  className="min-w-[200px]"
                  disallowEmptySelection={true}
                  isDisabled={routeType === "custom" && !isCustomRouteAvailable}
                  selectedKeys={new Set([currentModel])}
                  selectionMode="single"
                  size="sm"
                  onChange={handleModelChange}
                >
                  {modelOptions.map((model) => (
                    <SelectItem key={model.value}>{model.label}</SelectItem>
                  ))}
                </Select>
                {routeType === "utools" && (
                  <span className="text-xs px-1.5 py-0.5 bg-warning/20 text-warning rounded-full whitespace-nowrap">
                    AI 能量
                  </span>
                )}
                {routeType === "custom" && (
                  <span className="text-xs px-1.5 py-0.5 bg-primary/20 text-primary rounded-full whitespace-nowrap">
                    私 有
                  </span>
                )}
              </div>
            )}
          </div>
        </div>

        {/* 快捷指令区域 */}
        {quickPrompts.length > 0 && (
          <div className="px-4 py-4 flex flex-wrap gap-2 border-t border-blue-100 dark:border-neutral-700/50 bg-white/30 dark:bg-neutral-800/30">
            {quickPrompts.map((prompt) => (
              <Chip
                key={prompt.id}
                className="cursor-pointer hover:scale-105 transition-transform"
                color={prompt.color || "primary"}
                size="sm"
                startContent={
                  prompt.icon && <Icon icon={prompt.icon} width={14} />
                }
                variant="flat"
                onClick={() => handleQuickPromptClick(prompt)}
              >
                {prompt.label}
              </Chip>
            ))}
          </div>
        )}

        <div className="px-4 pb-4 text-xs text-gray-500 dark:text-gray-400 flex items-center">
          <Icon className="mr-1" icon={tipIcon} width={14} />
          <span>{tipText}</span>
        </div>
      </div>
    </div>
  );
};

export default AIPromptOverlay;
