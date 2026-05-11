import {
  Button,
  Input,
  Switch,
  Tooltip,
  Divider,
  Modal,
  ModalContent,
  ModalHeader,
  ModalBody,
  ModalFooter,
  useDisclosure,
  Slider,
} from "@heroui/react";
import { Icon } from "@iconify/react";
import { useTheme } from "next-themes";
import { motion } from "framer-motion";
import { useEffect, useState } from "react";

import SearchableSelect from "@/components/SearchableSelect/SearchableSelect.tsx";
import toast from "@/utils/toast";
import { useSettingsStore, ChatStyle } from "@/store/useSettingsStore.ts";
import { FontSizeSettings } from "@/components/setting/FontSizeSettings.tsx";
import { storage } from "@/lib/indexedDBStore.ts";
import {
  useOpenAIConfigStore,
  AIRouteType,
} from "@/store/useOpenAIConfigStore.ts";
import { openAIService } from "@/services/openAIService.ts";

// 导入解码器控制函数
import { setBase64DecorationEnabled, setBase64ProviderEnabled } from "@/components/monacoEditor/decorations/base64Decoration.ts";
import { setUnicodeDecorationEnabled } from "@/components/monacoEditor/decorations/unicodeDecoration.ts";
import { setTimestampDecorationEnabled } from "@/components/monacoEditor/decorations/timestampDecoration.ts";
import { setUrlDecorationEnabled, setUrlProviderEnabled } from "@/components/monacoEditor/decorations/urlDecoration.ts";
import { parseShortcut } from "@/utils/shortcut.ts";

// 检查 utools 是否可用
const isUtoolsAvailable = typeof window !== "undefined" && "utools" in window;

export default function SettingsPage() {
  const {
    editDataSaveLocal,
    expandSidebar,
    chatStyle,
    // monacoEditorCDN,
    setEditDataSaveLocal,
    setExpandSidebar,
    setChatStyle,
    setMonacoEditorCDN,
    // 解码器设置相关状态
    timestampDecoderEnabled,
    base64DecoderEnabled,
    unicodeDecoderEnabled,
    urlDecoderEnabled,
    setTimestampDecoderEnabled,
    setBase64DecoderEnabled,
    setUnicodeDecoderEnabled,
    setUrlDecoderEnabled,
    // 编辑器默认设置
    defaultIndentSize,
    setDefaultIndentSize,
    // 快捷键设置
    newTabShortcut,
    closeTabShortcut,
    setNewTabShortcut,
    setCloseTabShortcut,
  } = useSettingsStore();

  const {
    routeType,
    utoolsRoute,
    ssooaiRoute,
    customRoute,
    utoolsModels,
    ssooaiModels,
    customModels,
    routeEnabled,
    updateConfig,
    updateUtoolsRouteConfig,
    updateSsooaiRouteConfig,
    updateCustomRouteConfig,
    updateRouteEnabled,
    fetchUtoolsModels,
    fetchSsooaiModels,
    fetchCustomModels,
    syncConfig,
    addCustomModel,
    removeCustomModel,
    addSsooaiModel,
    removeSsooaiModel,
  } = useOpenAIConfigStore();

  const { theme, setTheme } = useTheme();
  const [activeTab, setActiveTab] = useState("general");
  const [testingRoute, setTestingRoute] = useState<AIRouteType | null>(null);
  const [testResult, setTestResult] = useState<{
    success: boolean;
    message: string;
  } | null>(null);
  const [newModelName, setNewModelName] = useState("");
  const [newModelLabel, setNewModelLabel] = useState("");
  const { isOpen, onOpen, onClose } = useDisclosure();

  // 添加模型模式，用于区分是在SSOOAI线路还是自定义线路添加模型
  const [addModelMode, setAddModelMode] = useState<"ssooai" | "custom">(
    "custom",
  );

  // 增加状态来保存要测试的模型
  const [testModelUtools, setTestModelUtools] = useState<string>("");
  const [testModelSsooai, setTestModelSsooai] = useState<string>("gpt-4.1");
  const [testModelCustom, setTestModelCustom] = useState<string>("gpt-4.1");

  // 添加状态跟踪当前正在配置的线路类型
  const [configuringRoute, setConfiguringRoute] = useState<AIRouteType | null>(
    null,
  );

  // 初始化时同步配置
  useEffect(() => {
    // 从存储加载配置
    syncConfig();
  }, [syncConfig]);

  // 初始化时获取 Utools 模型列表和自定义模型列表
  useEffect(() => {
    if (routeType === "utools") {
      fetchUtoolsModels();
    } else if (routeType === "ssooai" && ssooaiRoute.apiKey) {
      // 只有在填写API密钥后才获取SSOOAI模型列表
      fetchSsooaiModels();
    } else if (
      routeType === "custom" &&
      customRoute.apiKey &&
      customRoute.proxyUrl
    ) {
      // 当选择私有线路且有API信息时，尝试获取模型列表
      useOpenAIConfigStore.getState().fetchCustomModels();
    }
  }, [
    routeType,
    fetchUtoolsModels,
    fetchSsooaiModels,
    ssooaiRoute.apiKey,
    customRoute.apiKey,
    customRoute.proxyUrl,
  ]);

  // 当配置更改时，同步到 openAIService
  useEffect(() => {
    openAIService.syncConfig();
  }, [routeType]);

  // 在useEffect中设置默认测试模型
  useEffect(() => {
    if (utoolsModels.length > 0 && !testModelUtools) {
      setTestModelUtools(utoolsModels[0].value);
    }
  }, [utoolsModels, testModelUtools]);

  useEffect(() => {
    if (ssooaiModels.length > 0 && !testModelSsooai) {
      setTestModelSsooai(ssooaiModels[0].value);
    }
  }, [ssooaiModels, testModelSsooai]);

  useEffect(() => {
    if (customModels.length > 0 && !testModelCustom) {
      setTestModelCustom(customModels[0].value);
    }
  }, [customModels, testModelCustom]);

  const handleSettingChange = (key: string, value: any) => {
    switch (key) {
      case "editDataSaveLocal":
        setEditDataSaveLocal(value);
        if (!value) {
          removeStore();
        }
        break;
      case "expandSidebar":
        setExpandSidebar(value);
        break;
      case "chatStyle":
        setChatStyle(value);
        toast.success("聊天窗口样式已更改");
        break;
      case "monacoEditorCDN":
        setMonacoEditorCDN(value);
        toast.success("编辑器加载方式已更改，请重新加载或刷新后生效");
        reloadApp();
        break;
      case "timestampDecoderEnabled":
        setTimestampDecorationEnabled(value);
        setTimestampDecoderEnabled(value);
        toast.success(`时间戳解码器已${value ? '启用' : '禁用'}`);
        break;
      case "base64DecoderEnabled":
        setBase64DecorationEnabled(value);
        setBase64ProviderEnabled(value);
        setBase64DecoderEnabled(value);
        toast.success(`Base64解码器已${value ? '启用' : '禁用'}`);
        break;
      case "unicodeDecoderEnabled":
        setUnicodeDecorationEnabled(value);
        setUnicodeDecoderEnabled(value);
        toast.success(`Unicode解码器已${value ? '启用' : '禁用'}`);
        break;
      case "urlDecoderEnabled":
        setUrlDecorationEnabled(value);
        setUrlProviderEnabled(value);
        setUrlDecoderEnabled(value);
        toast.success(`URL解码器已${value ? '启用' : '禁用'}`);
        break;
      case "newTabShortcut":
        setNewTabShortcut(value);
        toast.success(`新建标签页快捷键已设置为 ${value}`);
        break;
      case "closeTabShortcut":
        setCloseTabShortcut(value);
        toast.success(`关闭标签页快捷键已设置为 ${value}`);
        break;
      case "defaultIndentSize":
        setDefaultIndentSize(value);
        toast.success(`默认缩进大小已设置为 ${value} 个空格`);
        break;
    }
  };

  // 处理快捷键配置更改
  const handleShortcutChange = (shortcutType: string, newShortcut: string) => {
    try {
      // 验证快捷键格式
      const config = parseShortcut(newShortcut);
      if (!config.key) {
        toast.error("无效的快捷键格式");
        return;
      }
      
      if (shortcutType === "newTab") {
        setNewTabShortcut(newShortcut);
        toast.success(`新建标签页快捷键已设置为 ${newShortcut}`);
      } else if (shortcutType === "closeTab") {
        setCloseTabShortcut(newShortcut);
        toast.success(`关闭标签页快捷键已设置为 ${newShortcut}`);
      }
    } catch (error) {
      toast.error("快捷键格式错误，请使用如 Ctrl+Shift+T 的格式");
    }
  };

  // 更新 AI 线路类型
  const handleRouteTypeChange = (routeType: AIRouteType) => {
    updateConfig({ routeType });

    // 当切换到某个线路时，自动启用该线路
    if (routeType !== "default") {
      // 免费线路始终启用
      updateRouteEnabled(routeType, true);
    }

    // 重置测试状态
    setTestingRoute(null);
    setTestResult(null);

    // 如果切换到 utools 线路，尝试获取模型列表
    if (routeType === "utools") {
      if (!isUtoolsAvailable) {
        toast.error("uTools API 不可用，请确保在 uTools 环境中运行");
      } else {
        fetchUtoolsModels();
      }
    }

    openAIService.syncConfig();
  };

  // 配置线路的处理函数
  const handleConfigureRoute = (routeType: AIRouteType) => {
    setConfiguringRoute(routeType);
    handleRouteTypeChange(routeType);
  };

  // 关闭配置的处理函数
  const handleCloseConfig = () => {
    setConfiguringRoute(null);
  };

  // 更新 Utools 线路配置
  const handleUtoolsRouteConfigChange = (
    config: Partial<{
      model: string;
    }>,
  ) => {
    updateUtoolsRouteConfig(config);

    if (routeType === "utools") {
      openAIService.syncConfig();
    }
  };

  // 更新 SSOOAI 线路配置
  const handleSsooaiRouteConfigChange = (
    config: Partial<{
      apiKey: string;
      model: string;
      proxyUrl: string;
    }>,
  ) => {
    updateSsooaiRouteConfig(config);

    // 如果更新了API密钥，自动获取模型列表
    if (config.apiKey && routeType === "ssooai") {
      fetchSsooaiModels();
    }

    if (routeType === "ssooai") {
      openAIService.syncConfig();
    }
  };

  // 更新自定义线路配置
  const handleCustomRouteConfigChange = (
    config: Partial<{
      apiKey: string;
      model: string;
      proxyUrl: string;
    }>,
  ) => {
    updateCustomRouteConfig(config);

    if (routeType === "custom") {
      openAIService.syncConfig();
    }
  };

  const removeStore = () => {
    // 清除所有本地存储
    storage.clear();

    // 重置 Zustand stores 到默认状态
    useSettingsStore.setState({
      editDataSaveLocal: false,
      expandSidebar: false,
      monacoEditorCDN: "local",
      chatStyle: "bubble",
      timestampDecoderEnabled: true,
      base64DecoderEnabled: true,
      unicodeDecoderEnabled: true,
      urlDecoderEnabled: true,
      defaultIndentSize: 4,
      newTabShortcut: "Ctrl+Shift+T",
      closeTabShortcut: "Ctrl+Shift+W",
    });

    // 重置 OpenAI 配置
    useOpenAIConfigStore.getState().resetConfig();

    toast.success("所有设置已重置，请重新加载或刷新页面");
  };

  const reloadApp = () => {
    // 重载应用的逻辑
    location.reload();
  };

  // 测试AI线路连接
  const testRouteConnection = async (
    routeType: AIRouteType,
    testModel?: string,
  ) => {
    setTestingRoute(routeType);
    setTestResult(null);

    try {
      // 根据线路类型使用不同的模型进行测试
      let modelToTest;

      if (routeType === "default") {
        // 默认线路使用 json-tools 模型
        modelToTest = "json-tools";
      } else if (routeType === "utools" && testModel) {
        // uTools线路使用选择的模型
        modelToTest = testModel;
      } else if (routeType === "ssooai" && testModel) {
        // SSOOAI线路使用选择的模型
        modelToTest = testModel;
      } else if (routeType === "custom" && testModel) {
        // 私有线路使用选择的模型
        modelToTest = testModel;
      } else {
        throw new Error("请选择要测试的模型");
      }

      console.log(`测试连接 - 路由类型: ${routeType}, 模型: ${modelToTest}`);

      // 保存原始配置
      const originalConfig = { ...openAIService.config };

      // 创建测试配置
      const testConfig = {
        routeType,
        model: modelToTest,
      };

      // 更新配置用于测试
      openAIService.updateConfig(testConfig);

      // 发起简短请求以测试连接
      const response = await openAIService.chat({
        messages: [{ role: "user", content: "say 1" }],
        model: modelToTest, // 显式指定模型
      });

      // 检查响应
      if (response && response.choices && response.choices[0]?.message) {
        setTestResult({ success: true, message: "连接成功，线路畅通！" });
      } else {
        throw new Error("API 返回结果异常");
      }

      // 恢复原始配置
      openAIService.updateConfig(originalConfig);
    } catch (error) {
      console.error("测试连接失败:", error);
      setTestResult({
        success: false,
        message: error instanceof Error ? error.message : "未知错误，连接失败",
      });
    } finally {
      setTestingRoute(null);
    }
  };

  // 渲染测试结果
  const renderTestResult = () => {
    if (!testResult) return null;

    return (
      <div
        className={`mt-3 p-3 rounded-xl text-sm ${
          testResult.success
            ? "bg-success/15 text-success border border-success/20"
            : "bg-danger/15 text-danger border border-danger/20"
        } shadow-sm`}
      >
        <div className="flex items-center gap-2.5">
          <Icon
            icon={
              testResult.success
                ? "solar:check-circle-bold"
                : "solar:close-circle-bold"
            }
            width={18}
          />
          <span className="font-medium">{testResult.message}</span>
        </div>
      </div>
    );
  };

  // 添加自定义模型
  const handleAddCustomModel = () => {
    if (!newModelName.trim()) {
      toast.error("请输入模型名称");

      return;
    }

    if (addModelMode === "custom") {
      // 使用OpenAIConfigStore的方法添加模型
      addCustomModel(newModelName, newModelLabel || undefined);

      // 自动保存设置
      handleCustomRouteConfigChange({ model: customRoute.model });
    } else if (addModelMode === "ssooai") {
      // 添加SSOOAI模型
      addSsooaiModel(newModelName, newModelLabel || undefined);

      // 自动保存设置
      handleSsooaiRouteConfigChange({ model: ssooaiRoute.model });
    }

    // 清空输入框
    setNewModelName("");
    setNewModelLabel("");

    // 关闭弹窗
    onClose();

    toast.success(`已添加模型 ${newModelName}`);
  };

  // 删除自定义模型
  const handleRemoveCustomModel = (modelValue: string) => {
    // 检查是否删除的是当前选中的模型
    const isCurrentModel = modelValue === customRoute.model;

    // 使用OpenAIConfigStore的方法删除模型
    removeCustomModel(modelValue);

    // 如果删除的是当前选中的模型，需要选择其他模型或清空
    if (isCurrentModel && customModels.length > 1) {
      // 选择第一个可用模型
      const nextModel = customModels.find(
        (model) => model.value !== modelValue,
      );

      if (nextModel) {
        handleCustomRouteConfigChange({ model: nextModel.value });
      } else {
        handleCustomRouteConfigChange({ model: "" });
      }
    } else {
      // 自动保存设置
      handleCustomRouteConfigChange({ model: customRoute.model });
    }

    toast.success(`已删除模型 ${modelValue}`);
  };

  // 删除SSOOAI模型
  const handleRemoveSsooaiModel = (modelValue: string) => {
    // 检查是否删除的是当前选中的模型
    const isCurrentModel = modelValue === ssooaiRoute.model;

    // 使用OpenAIConfigStore的方法删除模型
    removeSsooaiModel(modelValue);

    // 如果删除的是当前选中的模型，需要选择其他模型或清空
    if (isCurrentModel && ssooaiModels.length > 1) {
      // 选择第一个可用模型
      const nextModel = ssooaiModels.find(
        (model) => model.value !== modelValue,
      );

      if (nextModel) {
        handleSsooaiRouteConfigChange({ model: nextModel.value });
      } else {
        handleSsooaiRouteConfigChange({ model: "" });
      }
    } else {
      // 自动保存设置
      handleSsooaiRouteConfigChange({ model: ssooaiRoute.model });
    }

    toast.success(`已删除模型 ${modelValue}`);
  };

  // 设置项配置
  const settingItems = [
    {
      id: "darkMode",
      title: "深色模式",
      description: "切换深色主题以保护眼睛",
      icon: "solar:moon-bold",
      isSelected: theme === "dark",
      onChange: (value: boolean) => setTheme(value ? "dark" : "light"),
    },
    {
      id: "localStorage",
      title: "本地存储",
      description: "将编辑器数据存储在本地，关闭后刷新页面数据将丢失",
      icon: "solar:database-bold",
      isSelected: editDataSaveLocal,
      onChange: (value: boolean) =>
        handleSettingChange("editDataSaveLocal", value),
    },
    {
      id: "expandTab",
      title: "展开Tab栏",
      description: "设置Tab栏是否默认展开",
      icon: "solar:square-top-down-bold",
      isSelected: expandSidebar,
      onChange: (value: boolean) => handleSettingChange("expandSidebar", value),
    },
  ];

  // 侧边栏菜单项
  const menuItems = [
    { key: "general", label: "通用设置", icon: "solar:settings-bold" },
    { key: "shortcuts", label: "快捷键", icon: "solar:keyboard-bold" },
    { key: "appearance", label: "外观设置", icon: "catppuccin:folder-themes" },
    { key: "decoders", label: "自动解码", icon: "solar:code-bold" },
    { key: "ai", label: "AI 助手", icon: "hugeicons:ai-chat-02" },
    { key: "about", label: "关于", icon: "solar:info-circle-bold" },
  ];

  // 渲染侧边栏菜单
  const renderSidebar = () => (
    <div className="w-40 sm:w-40 md:w-48 h-full bg-background/80 dark:bg-default-100/30 border-r border-default-200 shadow-md flex-shrink-0 backdrop-blur-sm">
      <div className="p-4 md:p-5">
        <h2 className="text-lg md:text-xl font-bold text-default-900 flex items-center gap-2">
          <div className="p-2.5 bg-primary/15 rounded-xl shadow-sm">
            <Icon
              className="text-primary"
              icon="solar:settings-bold"
              width={22}
            />
          </div>
          <span>设置</span>
        </h2>
        <p className="text-xs md:text-sm text-default-500 mt-2 ml-1">
          自定义您的应用体验
        </p>
      </div>
      <Divider className="my-1 opacity-50" />
      <div className="p-2">
        {menuItems.map((item) => (
          <button
            key={item.key}
            className={`w-full flex items-center gap-2 md:gap-3 px-4 md:px-5 py-3 md:py-3.5 my-1 rounded-xl cursor-pointer transition-all text-left ${
              activeTab === item.key
                ? "bg-primary/15 text-primary font-medium shadow-sm"
                : "hover:bg-default-100/70 text-default-700"
            }`}
            onClick={() => setActiveTab(item.key)}
          >
            <Icon className="flex-shrink-0" icon={item.icon} width={19} />
            <span className="truncate">{item.label}</span>
          </button>
        ))}
      </div>
    </div>
  );

  // 渲染通用设置内容
  const renderGeneralSettings = () => (
    <div className="h-full">
      <div className="mb-6 md:mb-8">
        <h2 className="text-xl md:text-2xl font-bold text-default-900 flex items-center gap-2.5">
          <div className="p-2 rounded-xl bg-primary/15 shadow-sm">
            <Icon
              className="text-primary"
              icon="solar:settings-bold"
              width={22}
            />
          </div>
          通用设置
        </h2>
        <p className="text-sm md:text-base text-default-500 mt-2 ml-1">
          管理应用的基本设置和偏好
        </p>
      </div>

      <div className="bg-background/80 backdrop-blur-sm rounded-2xl overflow-hidden border border-default-200 shadow-sm">
        <div className="divide-y divide-default-200">
          {settingItems.map((item) => (
            <div
              key={item.id}
              className="flex items-center justify-between p-5 hover:bg-default-100/40 transition-colors"
            >
              <div className="flex items-start gap-4">
                <div className="p-3 rounded-xl bg-primary/15 text-primary shadow-sm">
                  <Icon icon={item.icon} width={22} />
                </div>
                <div>
                  <p className="text-default-900 font-medium">{item.title}</p>
                  <p className="text-sm text-default-500 mt-1">
                    {item.description}
                  </p>
                </div>
              </div>
              <Switch
                className="ml-4"
                color="primary"
                isSelected={item.isSelected}
                size="lg"
                onValueChange={item.onChange}
              />
            </div>
          ))}

          {/* 默认缩进大小设置 */}
          <div className="flex items-center justify-between p-5 hover:bg-default-100/40 transition-colors">
            <div className="flex items-start gap-4">
              <div className="p-3 rounded-xl bg-orange-500/15 text-orange-500 shadow-sm">
                <Icon icon="fluent:text-indent-increase-16-filled" width={22} />
              </div>
              <div className="flex-1">
                <p className="text-default-900 font-medium">默认缩进大小</p>
                <p className="text-sm text-default-500 mt-1">
                  设置新标签页的JSON缩进空格数量
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3 ml-4">
              <span className="text-sm text-default-600 w-8 text-center">{defaultIndentSize}</span>
              <Slider
                aria-label="调整默认缩进大小"
                className="w-32"
                maxValue={8}
                minValue={1}
                step={1}
                value={defaultIndentSize}
                onChange={(value) => handleSettingChange("defaultIndentSize", value as number)}
              />
            </div>
          </div>

          {/* 重置应用 */}
          <div className="p-5">
            <div className="flex items-start justify-between">
              <div className="flex items-start gap-4">
                <div className="p-3 rounded-xl bg-danger/15 text-danger shadow-sm">
                  <Icon icon="solar:restart-bold" width={22} />
                </div>
                <div>
                  <p className="text-default-900 font-medium">重置应用</p>
                  <p className="text-sm text-default-500 mt-1">
                    重置应用，清除本地存储，刷新页面后将重新加载应用
                  </p>
                </div>
              </div>
              <Tooltip content="此操作将清除所有本地数据">
                <Button
                  color="danger"
                  radius="full"
                  startContent={<Icon icon="solar:refresh-bold" />}
                  variant="flat"
                  onPress={() => {
                    removeStore();
                  }}
                >
                  重置应用
                </Button>
              </Tooltip>
            </div>
          </div>
        </div>
      </div>
    </div>
  );

  // 渲染快捷键设置内容
  const renderShortcutsSettings = () => (
    <div className="h-full">
      <div className="mb-6 md:mb-8">
        <h2 className="text-xl md:text-2xl font-bold text-default-900 flex items-center gap-2.5">
          <div className="p-2 rounded-xl bg-primary/15 shadow-sm">
            <Icon
              className="text-primary"
              icon="solar:keyboard-bold"
              width={22}
            />
          </div>
          快捷键设置
        </h2>
        <p className="text-sm md:text-base text-default-500 mt-2 ml-1">
          自定义应用的快捷键操作
        </p>
      </div>

      <div className="bg-background/80 backdrop-blur-sm rounded-2xl overflow-hidden border border-default-200 shadow-sm">
        <div className="divide-y divide-default-200">
          {/* 新建标签页快捷键 */}
          <div className="flex items-center justify-between p-5 hover:bg-default-100/40 transition-colors">
            <div className="flex items-start gap-4">
              <div className="p-3 rounded-xl bg-green-500/15 text-green-500 shadow-sm">
                <Icon icon="solar:document-add-bold" width={22} />
              </div>
              <div>
                <p className="text-default-900 font-medium">新建标签页</p>
                <p className="text-sm text-default-500 mt-1">
                  快速创建新的空白标签页
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <Input
                className="w-40"
                placeholder="Ctrl+Shift+T"
                size="sm"
                value={newTabShortcut}
                variant="bordered"
                onChange={(e) => handleShortcutChange("newTab", e.target.value)}
                onKeyDown={(e) => {
                  // 支持用户通过按键设置快捷键
                  if (e.ctrlKey || e.altKey || e.shiftKey || e.metaKey) {
                    e.preventDefault();
                    const modifiers = [];
                    if (e.ctrlKey) modifiers.push('Ctrl');
                    if (e.altKey) modifiers.push('Alt');
                    if (e.shiftKey) modifiers.push('Shift');
                    if (e.metaKey) modifiers.push('Cmd');
                    
                    const key = e.key.toUpperCase();
                    const shortcut = [...modifiers, key].join('+');
                    handleShortcutChange("newTab", shortcut);
                  }
                }}
              />
              <div className="text-xs text-default-500 bg-default-100 px-2 py-1 rounded">
                按组合键设置
              </div>
            </div>
          </div>

          {/* 关闭标签页快捷键 */}
          <div className="flex items-center justify-between p-5 hover:bg-default-100/40 transition-colors">
            <div className="flex items-start gap-4">
              <div className="p-3 rounded-xl bg-red-500/15 text-red-500 shadow-sm">
                <Icon icon="solar:close-circle-bold" width={22} />
              </div>
              <div>
                <p className="text-default-900 font-medium">关闭标签页</p>
                <p className="text-sm text-default-500 mt-1">
                  快速关闭当前活动的标签页
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <Input
                className="w-40"
                placeholder="Ctrl+Shift+W"
                size="sm"
                value={closeTabShortcut}
                variant="bordered"
                onChange={(e) => handleShortcutChange("closeTab", e.target.value)}
                onKeyDown={(e) => {
                  // 支持用户通过按键设置快捷键
                  if (e.ctrlKey || e.altKey || e.shiftKey || e.metaKey) {
                    e.preventDefault();
                    const modifiers = [];
                    if (e.ctrlKey) modifiers.push('Ctrl');
                    if (e.altKey) modifiers.push('Alt');
                    if (e.shiftKey) modifiers.push('Shift');
                    if (e.metaKey) modifiers.push('Cmd');
                    
                    const key = e.key.toUpperCase();
                    const shortcut = [...modifiers, key].join('+');
                    handleShortcutChange("closeTab", shortcut);
                  }
                }}
              />
              <div className="text-xs text-default-500 bg-default-100 px-2 py-1 rounded">
                按组合键设置
              </div>
            </div>
          </div>

          {/* 快捷键说明 */}
          <div className="p-5">
            <div className="p-4 rounded-xl bg-primary/10 border border-primary/20 flex items-start gap-3">
              <Icon
                className="text-primary mt-0.5 flex-shrink-0"
                icon="solar:info-circle-bold"
                width={20}
              />
              <div className="text-sm text-default-700">
                <p className="font-medium mb-1 text-primary">关于快捷键</p>
                <p>
                  • 支持的修饰键：Ctrl、Alt、Shift、Cmd（Mac）
                </p>
                <p>
                  • 支持的主键：字母键（A-Z）、数字键（0-9）
                </p>
                <p>
                  • 示例格式：Ctrl+Shift+T、Cmd+Shift+T、Ctrl+T
                </p>
                <p>
                  • 在输入框中按下组合键可自动设置
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );

  // 渲染 AI 设置内容
  const renderAISettings = () => (
    <div className="h-full">
      <div className="mb-4">
        <h2 className="text-xl md:text-2xl font-bold text-default-900 flex items-center gap-2.5">
          <div className="p-2 rounded-xl bg-primary/15 shadow-sm">
            <Icon className="text-primary" icon="solar:robot-bold" width={22} />
          </div>
          AI 设置
        </h2>
      </div>

      <div className="mb-6 p-5 rounded-2xl bg-background/80 border border-default-200 shadow-sm backdrop-blur-sm">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-lg font-medium flex items-center gap-2.5">
            <div className="p-1.5 rounded-lg bg-primary/15">
              <Icon icon="solar:square-switch-bold" width={18} />
            </div>
            线路管理
          </h3>
        </div>
        <p className="text-sm mb-5 text-default-600">
          启用或禁用不同的AI线路，点击配置按钮设置线路参数。免费线路始终开启，无法关闭。
        </p>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          {/* 免费线路 - 始终启用 */}
          <div className="flex items-center justify-between p-5 rounded-2xl bg-gradient-to-br from-[#00C9A7]/20 to-[#00B597]/5 backdrop-blur-sm border border-[#00C9A7]/20 dark:border-[#00C9A7]/15 transition-all hover:bg-gradient-to-br hover:from-[#00C9A7]/25 hover:to-[#00B597]/10 hover:border-[#00C9A7]/30">
            <div className="flex items-center gap-4">
              <div className="p-3 rounded-xl bg-[#00C9A7]/10 text-[#00C9A7]">
                <Icon icon="solar:chat-round-dots-bold-duotone" width={22} />
              </div>
              <div>
                <div className="font-semibold text-[#333] dark:text-white">
                  免费线路
                </div>
                <div className="text-xs text-[#666] dark:text-gray-300 mt-1">
                  由{" "}
                  <a
                    className="text-primary hover:underline"
                    href="https://api.ssooai.com"
                    rel="noopener noreferrer"
                    target="_blank"
                  >
                    SSOOAI
                  </a>{" "}
                  提供基础AI问答服务，无需配置
                </div>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <Switch
                classNames={{
                  wrapper: "group-data-[selected=true]:bg-[#00C9A7]",
                }}
                isDisabled={true}
                isSelected={true}
                size="sm"
              />
            </div>
          </div>

          {/* SSOOAI线路 */}
          <div className="flex items-center justify-between p-5 rounded-2xl bg-gradient-to-br from-[#3D5AFE]/20 to-[#304FFE]/5 backdrop-blur-sm border border-[#3D5AFE]/20 dark:border-[#3D5AFE]/15 transition-all hover:bg-gradient-to-br hover:from-[#3D5AFE]/25 hover:to-[#304FFE]/10 hover:border-[#3D5AFE]/30">
            <div className="flex items-center gap-4">
              <div className="p-3 rounded-xl bg-[#3D5AFE]/10 text-[#3D5AFE]">
                <Icon icon="solar:magic-stick-3-bold-duotone" width={22} />
              </div>
              <div>
                <div className="font-semibold text-[#333] dark:text-white">
                  SSOOAI
                </div>
                <div className="text-xs text-[#666] dark:text-gray-300 mt-1">
                  高性能AI服务，支持多种高级模型
                </div>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <Button
                className="bg-[#3D5AFE] text-white hover:bg-[#304FFE]"
                radius="full"
                size="sm"
                variant="solid"
                onPress={() => handleConfigureRoute("ssooai")}
              >
                配置
              </Button>
              <Switch
                classNames={{
                  wrapper: "group-data-[selected=true]:bg-[#3D5AFE]",
                }}
                isSelected={routeEnabled.ssooai}
                size="sm"
                onValueChange={(enabled) =>
                  updateRouteEnabled("ssooai", enabled)
                }
              />
            </div>
          </div>

          {/* uTools线路 */}
          <div className="flex items-center justify-between p-5 rounded-2xl bg-gradient-to-br from-[#FFAB00]/20 to-[#FF9100]/5 backdrop-blur-sm border border-[#FFAB00]/20 dark:border-[#FFAB00]/15 transition-all hover:bg-gradient-to-br hover:from-[#FFAB00]/25 hover:to-[#FF9100]/10 hover:border-[#FFAB00]/30">
            <div className="flex items-center gap-4">
              <div className="p-3 rounded-xl bg-[#FFAB00]/10 text-[#FFAB00]">
                <Icon icon="solar:atom-bold-duotone" width={22} />
              </div>
              <div>
                <div className="font-semibold text-[#333] dark:text-white">
                  uTools AI
                </div>
                <div className="text-xs text-[#666] dark:text-gray-300 mt-1">
                  uTools 官方的 AI 智能助手
                </div>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <Switch
                classNames={{
                  wrapper: "group-data-[selected=true]:bg-[#FFAB00]",
                }}
                isDisabled={!isUtoolsAvailable}
                isSelected={isUtoolsAvailable && routeEnabled.utools}
                size="sm"
                onValueChange={(enabled) =>
                  updateRouteEnabled("utools", enabled)
                }
              />
            </div>
          </div>

          {/* 私有线路 */}
          <div className="flex items-center justify-between p-5 rounded-2xl bg-gradient-to-br from-[#E91E63]/20 to-[#D81B60]/5 backdrop-blur-sm border border-[#E91E63]/20 dark:border-[#E91E63]/15 transition-all hover:bg-gradient-to-br hover:from-[#E91E63]/25 hover:to-[#D81B60]/10 hover:border-[#E91E63]/30">
            <div className="flex items-center gap-4">
              <div className="p-3 rounded-xl bg-[#E91E63]/10 text-[#E91E63]">
                <Icon icon="solar:key-bold-duotone" width={22} />
              </div>
              <div>
                <div className="font-semibold text-[#333] dark:text-white">
                  私有线路
                </div>
                <div className="text-xs text-[#666] dark:text-gray-300 mt-1">
                  自定义API连接，支持各类模型
                </div>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <Button
                className="bg-[#E91E63] text-white hover:bg-[#D81B60]"
                radius="full"
                size="sm"
                variant="solid"
                onPress={() => handleConfigureRoute("custom")}
              >
                配置
              </Button>
              <Switch
                classNames={{
                  wrapper: "group-data-[selected=true]:bg-[#E91E63]",
                }}
                isSelected={routeEnabled.custom}
                size="sm"
                onValueChange={(enabled) =>
                  updateRouteEnabled("custom", enabled)
                }
              />
            </div>
          </div>
        </div>
      </div>

      <div className="mb-6 p-5 rounded-2xl bg-primary/10 border border-primary/20 shadow-sm backdrop-blur-sm">
        <div className="flex items-center gap-2.5 mb-2">
          <Icon className="text-primary" icon="solar:star-bold" width={22} />
          <span className="font-medium text-primary">推荐使用 SSOOAI API</span>
        </div>
        <p className="text-sm text-default-700">
          <a
            className="text-primary hover:underline font-medium"
            href="https://api.ssooai.com"
            rel="noopener noreferrer"
            target="_blank"
          >
            SSOOAI
          </a>{" "}
          提供稳定、高效且价格实惠的 API 服务，支持多种先进模型，包括
          ChatGPT、DeepSeek、Claude 4 等。 访问{" "}
          <a
            className="text-primary hover:underline font-medium"
            href="https://api.ssooai.com"
            rel="noopener noreferrer"
            target="_blank"
          >
            https://api.ssooai.com
          </a>{" "}
          获取 API 密钥，
          体验更快的响应速度和更高的稳定性。新用户可享受充值优惠！
        </p>
      </div>

      {/* 线路配置区域 */}
      {configuringRoute && (
        <div className="space-y-5">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-lg font-medium flex items-center gap-2.5">
              <div className="p-1.5 rounded-lg bg-primary/15">
                <Icon icon="solar:settings-bold" width={18} />
              </div>
              {configuringRoute === "default"
                ? "免费线路"
                : configuringRoute === "ssooai"
                  ? "SSOOAI"
                  : configuringRoute === "utools"
                    ? "uTools AI"
                    : "私有线路"}
              配置
            </h3>
            <Button
              isIconOnly
              className="min-w-8 h-8"
              color="default"
              radius="full"
              size="sm"
              variant="flat"
              onPress={handleCloseConfig}
            >
              <Icon icon="solar:close-circle-bold" width={16} />
            </Button>
          </div>

          {/* 免费线路配置 */}
          {configuringRoute === "default" && (
            <div className="p-5 bg-background rounded-2xl border border-default-200 shadow-sm backdrop-blur-sm">
              <div className="mb-3 text-sm text-default-600 flex items-center gap-2">
                <Icon
                  className="text-primary"
                  icon="solar:star-bold"
                  width={18}
                />
                默认模型: <span className="font-medium">GPT 4.1</span>{" "}
                <span className="text-xs text-primary">
                  (由{" "}
                  <a
                    className="text-primary hover:underline"
                    href="https://api.ssooai.com"
                    rel="noopener noreferrer"
                    target="_blank"
                  >
                    SSOOAI
                  </a>{" "}
                  提供)
                </span>
              </div>
              <div className="flex items-center justify-end gap-2 mt-4">
                <Button
                  color="primary"
                  isDisabled={testingRoute !== null}
                  isLoading={testingRoute === "default"}
                  radius="full"
                  size="sm"
                  startContent={
                    testingRoute !== "default" && (
                      <Icon icon="solar:test-tube-bold" />
                    )
                  }
                  variant="flat"
                  onPress={() => testRouteConnection("default")}
                >
                  测试连接
                </Button>
              </div>
              {testingRoute === "default" ||
              (testResult && configuringRoute === "default")
                ? renderTestResult()
                : null}
            </div>
          )}

          {/* SSOOAI线路配置 */}
          {configuringRoute === "ssooai" && (
            <div className="p-5 bg-background rounded-2xl border border-default-200 shadow-sm backdrop-blur-sm">
              <div className="p-4 mb-5 rounded-xl bg-primary/10 border border-primary/20 shadow-inner">
                <div className="flex items-center gap-2.5">
                  <Icon
                    className="text-primary"
                    icon="solar:star-bold"
                    width={20}
                  />
                  <span className="font-medium">SSOOAI API 服务</span>
                </div>
                <p className="text-xs mt-2 text-default-700">
                  SSOOAI 提供更稳定的 API 服务和多种先进模型。 访问{" "}
                  <a
                    className="text-primary hover:underline font-medium"
                    href="https://api.ssooai.com"
                    rel="noopener noreferrer"
                    target="_blank"
                  >
                    https://api.ssooai.com
                  </a>{" "}
                  注册并获取 API 密钥。
                </p>
              </div>

              <div className="mb-4">
                <label
                  className="block mb-2 text-sm font-medium"
                  htmlFor="ssooai-api-key"
                >
                  API 密钥
                </label>
                <Input
                  className="w-full"
                  id="ssooai-api-key"
                  placeholder="输入您的 SSOOAI API 密钥"
                  size="sm"
                  type="password"
                  value={ssooaiRoute.apiKey}
                  variant="bordered"
                  onChange={(e) =>
                    handleSsooaiRouteConfigChange({
                      apiKey: e.target.value,
                    })
                  }
                />
              </div>

              <div className="flex items-center justify-end gap-3 mt-4">
                <SearchableSelect
                  className="w-60"
                  items={ssooaiModels}
                  placeholder="选择模型"
                  selectedValue={testModelSsooai}
                  onChange={(value) => setTestModelSsooai(value)}
                />
                <Button
                  color="primary"
                  isDisabled={testingRoute !== null || !ssooaiRoute.apiKey || !testModelSsooai}
                  isLoading={testingRoute === "ssooai"}
                  radius="full"
                  size="sm"
                  startContent={
                    testingRoute !== "ssooai" && (
                      <Icon icon="solar:test-tube-bold" />
                    )
                  }
                  variant="flat"
                  onPress={() => testRouteConnection("ssooai", testModelSsooai)}
                >
                  测试连接
                </Button>
              </div>
              {testingRoute === "ssooai" ||
              (testResult && configuringRoute === "ssooai")
                ? renderTestResult()
                : null}

              {/* 模型列表管理 */}
              <div className="mt-5 border-t border-default-200 pt-4">
                <div className="flex justify-between items-center mb-3">
                  <h4 className="text-sm font-medium flex items-center gap-2">
                    <Icon
                      className="text-primary"
                      icon="solar:layers-bold"
                      width={16}
                    />
                    模型列表
                  </h4>
                  <div className="flex gap-2">
                    <Button
                      color="primary"
                      radius="full"
                      size="sm"
                      startContent={<Icon icon="solar:add-circle-bold" />}
                      variant="flat"
                      onPress={() => {
                        // 设置模式为SSOOAI并打开添加模型弹窗
                        setAddModelMode("ssooai");
                        setNewModelName("");
                        setNewModelLabel("");
                        onOpen();
                      }}
                    >
                      添加模型
                    </Button>
                    <Button
                      isIconOnly
                      color="default"
                      radius="full"
                      size="sm"
                      variant="flat"
                      onPress={() => {
                        // 刷新模型列表但不清空
                        fetchSsooaiModels();
                        toast.success("正在刷新模型列表");
                      }}
                    >
                      <Icon icon="solar:refresh-bold" width={18} />
                    </Button>
                  </div>
                </div>

                <div className="max-h-96 overflow-y-auto rounded-xl border border-default-200 shadow-inner">
                  {ssooaiModels.length === 0 ? (
                    <div className="p-4 text-sm text-default-500 text-center">
                      暂无模型，请刷新或检查API密钥
                    </div>
                  ) : (
                    <div className="relative">
                      <table className="w-full">
                        <thead className="bg-default-100 sticky top-0 z-10 shadow-sm">
                          <tr className="text-xs text-default-500">
                            <th className="p-3 text-left">名称</th>
                            <th className="p-3 text-left">显示名称</th>
                            <th className="p-3 text-center">操作</th>
                          </tr>
                        </thead>
                        <tbody>
                          {ssooaiModels.map((item, index) => (
                            <tr
                              key={item.value}
                              className={`text-sm hover:bg-default-100/50 transition-colors ${
                                index % 2 === 0
                                  ? "bg-default-50/80"
                                  : "bg-default-100/20"
                              }`}
                            >
                              <td className="p-3">{item.value}</td>
                              <td className="p-3">{item.label}</td>
                              <td className="p-3 text-center">
                                <Button
                                  isIconOnly
                                  className="min-w-0 h-7 w-7"
                                  color="danger"
                                  radius="full"
                                  size="sm"
                                  variant="light"
                                  onPress={() =>
                                    handleRemoveSsooaiModel(item.value)
                                  }
                                >
                                  <Icon
                                    icon="solar:trash-bin-minimalistic-bold"
                                    width={14}
                                  />
                                </Button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Utools线路配置 */}
          {configuringRoute === "utools" && isUtoolsAvailable && (
            <div className="p-5 bg-background rounded-2xl border border-default-200 shadow-sm backdrop-blur-sm">
              <div className="mb-4">
                <label
                  className="block mb-2 text-sm font-medium flex items-center gap-2"
                  htmlFor="utools-model"
                >
                  <Icon
                    className="text-primary"
                    icon="solar:layers-bold"
                    width={16}
                  />
                  选择模型
                </label>
                <SearchableSelect
                  className="w-full"
                  id="utools-model"
                  items={utoolsModels}
                  placeholder="选择 uTools 模型"
                  selectedValue={utoolsRoute.model}
                  onChange={(value) =>
                    handleUtoolsRouteConfigChange({
                      model: value,
                    })
                  }
                />
              </div>
              <div className="flex items-center justify-end gap-3 mt-4">
                <SearchableSelect
                  className="w-64"
                  items={utoolsModels}
                  placeholder="选择模型"
                  selectedValue={testModelUtools}
                  onChange={(value) => setTestModelUtools(value)}
                />
                <Button
                  color="primary"
                  isDisabled={
                    testingRoute !== null ||
                    !isUtoolsAvailable ||
                    !testModelUtools
                  }
                  isLoading={testingRoute === "utools"}
                  radius="full"
                  size="sm"
                  startContent={
                    testingRoute !== "utools" && (
                      <Icon icon="solar:test-tube-bold" />
                    )
                  }
                  variant="flat"
                  onPress={() => testRouteConnection("utools", testModelUtools)}
                >
                  测试连接
                </Button>
              </div>
              {testingRoute === "utools" ||
              (testResult && configuringRoute === "utools")
                ? renderTestResult()
                : null}
              <div className="mt-4 p-3 bg-warning/10 border border-warning/20 rounded-xl text-xs text-default-700">
                <div className="flex items-center gap-2">
                  <Icon
                    className="text-warning"
                    icon="solar:info-circle-bold"
                    width={16}
                  />
                  <span className="font-medium">提示</span>
                </div>
                <p className="mt-1 ml-6">
                  Utools 官方线路由 Utools
                  团队维护，提供更稳定的服务和更多模型选择，但需要付费使用。
                </p>
              </div>
            </div>
          )}

          {/* 私有线路配置 */}
          {configuringRoute === "custom" && (
            <div className="p-5 bg-background rounded-2xl border border-default-200 shadow-sm backdrop-blur-sm">
              {/* SSOOAI API*/}
              <div className="p-4 mb-5 rounded-xl bg-primary/10 border border-primary/20 shadow-inner">
                <div className="flex items-center gap-2.5">
                  <Icon
                    className="text-primary"
                    icon="solar:bookmark-square-bold"
                    width={20}
                  />
                  <span className="font-medium">SSOOAI API</span>
                </div>
                <p className="text-xs mt-2 text-default-700">
                  推荐使用 SSOOAI API 作为私有线路，填入 API 地址：
                  <code className="bg-default-100 px-2 py-1 rounded-md ml-1 font-mono">
                    https://api.ssooai.com/v1
                  </code>
                  ， 注册即可获得免费额度。高稳定性、低延迟、更实惠的价格！
                </p>
              </div>

              <div className="mb-4">
                <label
                  className="block mb-2 text-sm font-medium flex items-center gap-2"
                  htmlFor="api-url"
                >
                  <Icon
                    className="text-primary"
                    icon="solar:link-bold"
                    width={16}
                  />
                  API 地址
                </label>
                <Input
                  className="w-full"
                  id="api-url"
                  placeholder="输入 API 地址，例如: https://api.ssooai.com/v1"
                  size="sm"
                  value={customRoute.proxyUrl}
                  variant="bordered"
                  onChange={(e) =>
                    handleCustomRouteConfigChange({
                      proxyUrl: e.target.value,
                    })
                  }
                />
              </div>

              <div className="mb-4">
                <label
                  className="block mb-2 text-sm font-medium flex items-center gap-2"
                  htmlFor="api-key"
                >
                  <Icon
                    className="text-primary"
                    icon="solar:key-bold"
                    width={16}
                  />
                  API 密钥
                </label>
                <Input
                  className="w-full"
                  id="api-key"
                  placeholder="输入您的 API 密钥"
                  size="sm"
                  type="password"
                  value={customRoute.apiKey}
                  variant="bordered"
                  onChange={(e) =>
                    handleCustomRouteConfigChange({
                      apiKey: e.target.value,
                    })
                  }
                />
              </div>

              <div className="flex items-center justify-end gap-3 mt-4">
                <SearchableSelect
                  className="w-60"
                  items={customModels}
                  placeholder="选择模型"
                  selectedValue={testModelCustom}
                  onChange={(value) => setTestModelCustom(value)}
                />
                <Button
                  color="primary"
                  isDisabled={
                    testingRoute !== null ||
                    !customRoute.apiKey ||
                    !customRoute.proxyUrl ||
                    !testModelCustom
                  }
                  isLoading={testingRoute === "custom"}
                  radius="full"
                  size="sm"
                  startContent={
                    testingRoute !== "custom" && (
                      <Icon icon="solar:test-tube-bold" />
                    )
                  }
                  variant="flat"
                  onPress={() => testRouteConnection("custom", testModelCustom)}
                >
                  测试连接
                </Button>
              </div>
              {testingRoute === "custom" ||
              (testResult && configuringRoute === "custom")
                ? renderTestResult()
                : null}

              {/* 模型列表管理 */}
              <div className="mt-5 border-t border-default-200 pt-4">
                <div className="flex justify-between items-center mb-3">
                  <h4 className="text-sm font-medium flex items-center gap-2">
                    <Icon
                      className="text-primary"
                      icon="solar:layers-bold"
                      width={16}
                    />
                    模型列表
                  </h4>
                  <div className="flex gap-2">
                    <Button
                      color="primary"
                      radius="full"
                      size="sm"
                      startContent={<Icon icon="solar:add-circle-bold" />}
                      variant="flat"
                      onPress={() => {
                        // 设置模式为Custom并打开添加模型弹窗
                        setAddModelMode("custom");
                        setNewModelName("");
                        setNewModelLabel("");
                        onOpen();
                      }}
                    >
                      添加模型
                    </Button>
                    <Button
                      isIconOnly
                      color="default"
                      radius="full"
                      size="sm"
                      variant="flat"
                      onPress={() => {
                        // 刷新模型列表但不清空
                        fetchCustomModels();
                        toast.success("正在刷新模型列表");
                      }}
                    >
                      <Icon icon="solar:refresh-bold" width={18} />
                    </Button>
                  </div>
                </div>

                <div className="max-h-96 overflow-y-auto rounded-xl border border-default-200 shadow-inner">
                  {customModels.length === 0 ? (
                    <div className="p-4 text-sm text-default-500 text-center">
                      暂无模型，请刷新或检查API密钥
                    </div>
                  ) : (
                    <div className="relative">
                      <table className="w-full">
                        <thead className="bg-default-100 sticky top-0 z-10 shadow-sm">
                          <tr className="text-xs text-default-500">
                            <th className="p-3 text-left">名称</th>
                            <th className="p-3 text-left">显示名称</th>
                            <th className="p-3 text-center">操作</th>
                          </tr>
                        </thead>
                        <tbody>
                          {customModels.map((item, index) => (
                            <tr
                              key={item.value}
                              className={`text-sm hover:bg-default-100/50 transition-colors ${
                                index % 2 === 0
                                  ? "bg-default-50/80"
                                  : "bg-default-100/20"
                              }`}
                            >
                              <td className="p-3">{item.value}</td>
                              <td className="p-3">{item.label}</td>
                              <td className="p-3 text-center">
                                <Button
                                  isIconOnly
                                  className="min-w-0 h-7 w-7"
                                  color="danger"
                                  radius="full"
                                  size="sm"
                                  variant="light"
                                  onClick={() =>
                                    handleRemoveCustomModel(item.value)
                                  }
                                >
                                  <Icon
                                    icon="solar:trash-bin-minimalistic-bold"
                                    width={14}
                                  />
                                </Button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );

  // 渲染外观设置内容
  const renderAppearanceSettings = () => (
    <div className="h-full">
      <div className="mb-6 md:mb-8">
        <h2 className="text-xl md:text-2xl font-bold text-default-900 flex items-center gap-2.5">
          <div className="p-2 rounded-xl bg-primary/15 shadow-sm">
            <Icon className="text-primary" icon="solar:brush-bold" width={22} />
          </div>
          外观设置
        </h2>
        <p className="text-sm md:text-base text-default-500 mt-2 ml-1">
          自定义应用的外观和显示方式
        </p>
      </div>

      {/* 聊天窗口样式设置 */}
      <div className="p-6 rounded-2xl bg-background/80 backdrop-blur-sm border border-default-200 shadow-sm">
        <div className="mb-5">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-lg bg-primary/15 shadow-sm">
              <Icon
                className="text-primary"
                icon="solar:chat-round-dots-bold"
                width={20}
              />
            </div>
            <h3 className="text-lg font-medium text-default-900">
              聊天窗口样式
            </h3>
          </div>
          <p className="text-sm text-default-500 mt-2 ml-8">
            选择您喜欢的聊天界面显示风格
          </p>
        </div>

        <div className="flex flex-col sm:flex-row gap-5 sm:gap-8 mt-4 md:mt-6 ml-4 md:ml-8">
          <div
            aria-label="选择对话模式聊天样式"
            className={`flex flex-col items-center gap-3 cursor-pointer transition-all duration-300 ${
              chatStyle === "bubble"
                ? "scale-105 opacity-100"
                : "opacity-70 hover:opacity-90 hover:scale-102"
            }`}
            role="button"
            tabIndex={0}
            onClick={() =>
              handleSettingChange("chatStyle", "bubble" as ChatStyle)
            }
            onKeyDown={(e) =>
              e.key === "Enter" &&
              handleSettingChange("chatStyle", "bubble" as ChatStyle)
            }
          >
            <div
              className={`border p-3 sm:p-4 rounded-xl w-32 sm:w-40 h-28 sm:h-32 flex items-center justify-center transition-all duration-300 ${
                chatStyle === "bubble"
                  ? "border-primary/50 bg-primary/10 shadow-md"
                  : "border-default-200 bg-default-50/50 hover:border-default-300"
              }`}
            >
              <div className="flex flex-col gap-3 w-full">
                <div className="w-full h-4 rounded-full bg-primary/30" />
                <div className="w-3/4 h-4 ml-auto rounded-full bg-default-200" />
                <div className="w-full h-4 rounded-full bg-primary/30" />
              </div>
            </div>
            <p
              className={`text-sm font-medium ${
                chatStyle === "bubble" ? "text-primary" : "text-default-600"
              }`}
            >
              气泡模式
            </p>
          </div>

          <div
            aria-label="选择文档模式聊天样式"
            className={`flex flex-col items-center gap-3 cursor-pointer transition-all duration-300 ${
              chatStyle === "document"
                ? "scale-105 opacity-100"
                : "opacity-70 hover:opacity-90 hover:scale-102"
            }`}
            role="button"
            tabIndex={0}
            onClick={() =>
              handleSettingChange("chatStyle", "document" as ChatStyle)
            }
            onKeyDown={(e) =>
              e.key === "Enter" &&
              handleSettingChange("chatStyle", "document" as ChatStyle)
            }
          >
            <div
              className={`border p-3 sm:p-4 rounded-xl w-32 sm:w-40 h-28 sm:h-32 flex items-center justify-center transition-all duration-300 ${
                chatStyle === "document"
                  ? "border-primary/50 bg-primary/10 shadow-md"
                  : "border-default-200 bg-default-50/50 hover:border-default-300"
              }`}
            >
              <div className="flex flex-col gap-3 w-full">
                <div className="w-full h-3 rounded-sm bg-primary/30" />
                <div className="w-full h-3 rounded-sm bg-default-200" />
                <div className="w-3/4 h-3 rounded-sm bg-primary/30" />
                <div className="w-full h-3 rounded-sm bg-default-200" />
              </div>
            </div>
            <p
              className={`text-sm font-medium ${
                chatStyle === "document" ? "text-primary" : "text-default-600"
              }`}
            >
              文档模式
            </p>
          </div>
        </div>
      </div>

      {/* 字体大小设置 */}
      <div className="mt-6">
        <FontSizeSettings />
      </div>
    </div>
  );

  // 渲染解码器设置内容
  const renderDecoderSettings = () => (
    <div className="h-full">
      <div className="mb-6 md:mb-8">
        <h2 className="text-xl md:text-2xl font-bold text-default-900 flex items-center gap-2.5">
          <div className="p-2 rounded-xl bg-primary/15 shadow-sm">
            <Icon className="text-primary" icon="solar:code-bold" width={22} />
          </div>
          解码器设置
        </h2>
        <p className="text-sm md:text-base text-default-500 mt-2 ml-1">
          管理编辑器中各种解码器的显示和行为
        </p>
      </div>

      <div className="bg-background/80 backdrop-blur-sm rounded-2xl overflow-hidden border border-default-200 shadow-sm">
        <div className="divide-y divide-default-200">
          {/* 时间戳解码器 */}
          <div className="flex items-center justify-between p-5 hover:bg-default-100/40 transition-colors">
            <div className="flex items-start gap-4">
              <div className="p-3 rounded-xl bg-blue-500/15 text-blue-500 shadow-sm">
                <Icon icon="solar:clock-circle-bold" width={22} />
              </div>
              <div>
                <p className="text-default-900 font-medium">时间戳解码器</p>
                <p className="text-sm text-default-500 mt-1">
                  自动识别并转换时间戳为人类可读的日期时间格式
                </p>
              </div>
            </div>
            <Switch
              className="ml-4"
              color="primary"
              isSelected={timestampDecoderEnabled}
              size="lg"
              onValueChange={(value) => handleSettingChange("timestampDecoderEnabled", value)}
            />
          </div>

          {/* Base64解码器 */}
          <div className="flex items-center justify-between p-5 hover:bg-default-100/40 transition-colors">
            <div className="flex items-start gap-4">
              <div className="p-3 rounded-xl bg-indigo-500/15 text-indigo-500 shadow-sm">
                <Icon icon="ph:binary-fill" width={22} />
              </div>
              <div>
                <p className="text-default-900 font-medium">Base64 解码器</p>
                <p className="text-sm text-default-500 mt-1">
                  自动识别并解码 Base64 编码的字符串
                </p>
              </div>
            </div>
            <Switch
              className="ml-4"
              color="primary"
              isSelected={base64DecoderEnabled}
              size="lg"
              onValueChange={(value) => handleSettingChange("base64DecoderEnabled", value)}
            />
          </div>

          {/* Unicode解码器 */}
          <div className="flex items-center justify-between p-5 hover:bg-default-100/40 transition-colors">
            <div className="flex items-start gap-4">
              <div className="p-3 rounded-xl bg-purple-500/15 text-purple-500 shadow-sm">
                <Icon icon="solar:global-bold" width={22} />
              </div>
              <div>
                <p className="text-default-900 font-medium">Unicode 解码器</p>
                <p className="text-sm text-default-500 mt-1">
                  自动识别并转换 Unicode 转义序列为可读字符
                </p>
              </div>
            </div>
            <Switch
              className="ml-4"
              color="primary"
              isSelected={unicodeDecoderEnabled}
              size="lg"
              onValueChange={(value) => handleSettingChange("unicodeDecoderEnabled", value)}
            />
          </div>

          {/* URL解码器 */}
          <div className="flex items-center justify-between p-5 hover:bg-default-100/40 transition-colors">
            <div className="flex items-start gap-4">
              <div className="p-3 rounded-xl bg-amber-500/15 text-amber-500 shadow-sm">
                <Icon icon="solar:link-bold" width={22} />
              </div>
              <div>
                <p className="text-default-900 font-medium">URL 解码器</p>
                <p className="text-sm text-default-500 mt-1">
                  自动识别并转换URL编码序列为可读字符
                </p>
              </div>
            </div>
            <Switch
              className="ml-4"
              color="primary"
              isSelected={urlDecoderEnabled}
              size="lg"
              onValueChange={(value) => handleSettingChange("urlDecoderEnabled", value)}
            />
          </div>

          {/* 解码器信息提示 */}
          <div className="p-5">
            <div className="p-4 rounded-xl bg-primary/10 border border-primary/20 flex items-start gap-3">
              <Icon
                className="text-primary mt-0.5 flex-shrink-0"
                icon="solar:info-circle-bold"
                width={20}
              />
              <div className="text-sm text-default-700">
                <p className="font-medium mb-1 text-primary">关于解码器</p>
                <p>
                  解码器可以自动识别并转换特定格式的数据，使其更易读。这些设置在所有编辑器中全局生效。
                </p>
                <p>如果程序出现卡顿等性能问题，可以尝试关闭部分解码器。</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );

  // 渲染关于内容
  const renderAboutContent = () => (
    <div className="h-full">
      <div className="mb-6 md:mb-8">
        <h2 className="text-xl md:text-2xl font-bold text-default-900 flex items-center gap-2.5">
          <div className="p-2 rounded-xl bg-primary/15 shadow-sm">
            <Icon
              className="text-primary"
              icon="solar:info-circle-bold"
              width={22}
            />
          </div>
          关于 JSON Tools
        </h2>
        <p className="text-sm md:text-base text-default-500 mt-2 ml-1">
          了解更多关于应用的信息
        </p>
      </div>

      <div className="rounded-2xl bg-background/80 backdrop-blur-sm border border-default-200 overflow-hidden shadow-sm">
        <div className="flex flex-col items-center text-center p-8 bg-gradient-to-b from-primary/10 to-background">
          <div className="p-3 rounded-full bg-primary/15 shadow-md mb-4">
            <img
              alt="JSON Tools Logo"
              className="w-24 h-24 drop-shadow-lg"
              src="./logo.png"
            />
          </div>
          <h3 className="text-2xl font-bold text-default-900">JSON Tools</h3>
          <p className="text-default-600 mt-3">强大的 JSON 处理工具集</p>
          <div className="bg-primary/15 px-4 py-1.5 rounded-full text-sm text-primary font-medium mt-4 shadow-sm">
            专业版
          </div>
        </div>

        <Divider className="opacity-50" />

        <div className="p-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <h4 className="text-lg font-medium text-default-900 mb-4 flex items-center gap-2.5">
                <div className="p-1.5 rounded-lg bg-primary/15">
                  <Icon
                    className="text-primary"
                    icon="solar:star-bold"
                    width={18}
                  />
                </div>
                功能特点
              </h4>
              <ul className="space-y-3 text-default-700">
                <li className="flex items-center gap-2.5 p-2 hover:bg-default-100/50 rounded-lg transition-colors">
                  <div className="p-1 rounded-full bg-success/15">
                    <Icon
                      className="text-success"
                      icon="solar:check-circle-bold"
                      width={16}
                    />
                  </div>
                  <span>JSON 格式化与验证</span>
                </li>
                <li className="flex items-center gap-2.5 p-2 hover:bg-default-100/50 rounded-lg transition-colors">
                  <div className="p-1 rounded-full bg-success/15">
                    <Icon
                      className="text-success"
                      icon="solar:check-circle-bold"
                      width={16}
                    />
                  </div>
                  <span>智能 AI 辅助修复</span>
                </li>
                <li className="flex items-center gap-2.5 p-2 hover:bg-default-100/50 rounded-lg transition-colors">
                  <div className="p-1 rounded-full bg-success/15">
                    <Icon
                      className="text-success"
                      icon="solar:check-circle-bold"
                      width={16}
                    />
                  </div>
                  <span>数据格式转换</span>
                </li>
              </ul>
            </div>

            <div>
              <h4 className="text-lg font-medium text-default-900 mb-4 flex items-center gap-2.5">
                <div className="p-1.5 rounded-lg bg-primary/15">
                  <Icon
                    className="text-primary"
                    icon="solar:headphones-round-bold"
                    width={18}
                  />
                </div>
                技术支持
              </h4>
              <div className="space-y-3">
                <a
                  className="flex items-center gap-2.5 p-2 text-primary hover:bg-primary/10 rounded-lg transition-colors"
                  href="https://github.com/fevrax/json-tools"
                  rel="noopener noreferrer"
                  target="_blank"
                >
                  <div className="p-1 rounded-full bg-default-100">
                    <Icon icon="mdi:github" width={16} />
                  </div>
                  <span className="font-medium">GitHub 仓库</span>
                </a>
                <a
                  className="flex items-center gap-2.5 p-2 text-primary hover:bg-primary/10 rounded-lg transition-colors"
                  href="https://github.com/fevrax/json-tools/issues"
                  rel="noopener noreferrer"
                  target="_blank"
                >
                  <div className="p-1 rounded-full bg-default-100">
                    <Icon icon="solar:chat-square-code-bold" width={16} />
                  </div>
                  <span className="font-medium">问题反馈</span>
                </a>
                <a
                  className="flex items-center gap-2.5 p-2 text-primary hover:bg-primary/10 rounded-lg transition-colors"
                  href="https://yourdocs.com"
                  rel="noopener noreferrer"
                  target="_blank"
                >
                  <div className="p-1 rounded-full bg-default-100">
                    <Icon icon="solar:document-bold" width={16} />
                  </div>
                  <span className="font-medium">使用文档</span>
                </a>
              </div>
            </div>
          </div>
        </div>

        <Divider className="opacity-50" />

        <div className="text-center p-5 text-sm text-default-600 bg-default-50/50">
          <p>© {new Date().getFullYear()} JSON Tools. 保留所有权利。</p>
          <p className="mt-1">基于 React、TypeScript 和 HeroUI 构建</p>
        </div>
      </div>
    </div>
  );

  // 根据当前活动标签渲染内容
  const renderContent = () => {
    switch (activeTab) {
      case "general":
        return renderGeneralSettings();
      case "shortcuts":
        return renderShortcutsSettings();
      case "ai":
        return renderAISettings();
      case "appearance":
        return renderAppearanceSettings();
      case "decoders":
        return renderDecoderSettings();
      case "about":
        return renderAboutContent();
      default:
        return renderGeneralSettings();
    }
  };

  return (
    <div className="w-full h-full flex-1 bg-default-50/80 dark:bg-default-50/5 backdrop-blur-sm">
      <div className="flex flex-row h-full overflow-hidden">
        {/* 侧边栏 */}
        {renderSidebar()}

        {/* 主内容区域 */}
        <div className="flex-1 p-3 sm:p-4 md:p-5 overflow-y-auto">
          <motion.div
            key={activeTab}
            animate={{ opacity: 1, y: 0 }}
            className="w-full max-w-5xl mx-auto pb-6 md:pb-8"
            initial={{ opacity: 0, y: 10 }}
            transition={{ duration: 0.3 }}
          >
            {renderContent()}
          </motion.div>
        </div>
      </div>

      {/* 添加自定义模型的弹窗 */}
      <Modal backdrop="blur" isOpen={isOpen} onClose={onClose}>
        <ModalContent className="p-1">
          <ModalHeader className="flex items-center gap-2 pb-2">
            <div className="p-1.5 rounded-lg bg-primary/15">
              <Icon
                className="text-primary"
                icon="solar:add-circle-bold"
                width={18}
              />
            </div>
            添加{addModelMode === "ssooai" ? "SSOOAI" : "自定义"}模型
          </ModalHeader>
          <ModalBody>
            <div className="mb-4">
              <label
                className="block mb-2 text-sm font-medium flex items-center gap-2"
                htmlFor="new-model-name"
              >
                <Icon
                  className="text-primary"
                  icon="solar:code-bold"
                  width={16}
                />
                模型名称 <span className="text-danger">*</span>
              </label>
              <Input
                className="w-full"
                id="new-model-name"
                placeholder="输入模型名称，例如: gpt-4-0613"
                value={newModelName}
                variant="bordered"
                onChange={(e) => setNewModelName(e.target.value)}
              />
              <p className="text-xs text-default-500 mt-1 ml-5">
                该名称用于API请求，必须准确填写
              </p>
            </div>
            <div>
              <label
                className="block mb-2 text-sm font-medium flex items-center gap-2"
                htmlFor="new-model-label"
              >
                <Icon
                  className="text-primary"
                  icon="solar:text-bold"
                  width={16}
                />
                显示名称
              </label>
              <Input
                className="w-full"
                id="new-model-label"
                placeholder="输入显示名称，例如: GPT-4 (8K)"
                value={newModelLabel}
                variant="bordered"
                onChange={(e) => setNewModelLabel(e.target.value)}
              />
              <p className="text-xs text-default-500 mt-1 ml-5">
                显示在界面上的友好名称，可选
              </p>
            </div>
          </ModalBody>
          <ModalFooter>
            <Button
              className="px-4"
              color="default"
              radius="full"
              variant="flat"
              onPress={onClose}
            >
              取消
            </Button>
            <Button
              className="px-4"
              color="primary"
              isDisabled={!newModelName.trim()}
              radius="full"
              startContent={<Icon icon="solar:add-circle-bold" width={18} />}
              onPress={handleAddCustomModel}
            >
              添加模型
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </div>
  );
}
