import React, {
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { loader, Monaco } from "@monaco-editor/react";
import * as monaco from "monaco-editor";
import { editor } from "monaco-editor";
import { Button, cn, useDisclosure, Input } from "@heroui/react";
import { jsonrepair } from "jsonrepair";
import { Icon } from "@iconify/react";
import JSON5 from "json5";
import { jsonquery } from "@jsonquerylang/jsonquery";

import { AIResultHeader } from "./AIResultHeader";

import UtoolsListener from "@/services/utoolsListener";
import toast from "@/utils/toast";
import { useTabStore } from "@/store/useTabStore";
import {
  escapeJson,
  isArrayOrObject,
  json5ParseError,
  JsonErrorInfo,
  jsonParseError,
  removeJsonComments,
  sortJson,
  parseJson,
  stringifyJson,
} from "@/utils/json";
import { updateFoldingDecorations } from "@/components/monacoEditor/decorations/foldingDecoration.ts";
import {
  TimestampDecoratorState,
  clearTimestampCache,
  toggleTimestampDecorators,
  updateTimestampDecorations,
  handleTimestampContentChange,
  setTimestampDecorationEnabled,
} from "@/components/monacoEditor/decorations/timestampDecoration.ts";
import {
  ErrorDecoratorState,
  highlightErrorLine,
} from "@/components/monacoEditor/decorations/errorDecoration.ts";
import {
  Base64DecoratorState,
  updateBase64Decorations,
  handleBase64ContentChange,
  setBase64DecorationEnabled,
  setBase64ProviderEnabled,
} from "@/components/monacoEditor/decorations/base64Decoration.ts";
import {
  UnicodeDecoratorState,
  updateUnicodeDecorations,
  handleUnicodeContentChange,
  setUnicodeDecorationEnabled,
  setUnicodeProviderEnabled,
} from "@/components/monacoEditor/decorations/unicodeDecoration.ts";
import {
  UrlDecoratorState,
  updateUrlDecorations,
  handleUrlContentChange,
  setUrlDecorationEnabled,
  setUrlProviderEnabled,
} from "@/components/monacoEditor/decorations/urlDecoration.ts";
import {
  ImageDecoratorState,
  updateImageDecorations,
  handleImageContentChange,
  setImageDecorationEnabled,
  clearImageCache,
  toggleImageDecorators,
} from "@/components/monacoEditor/decorations/imageDecoration.ts";
import { DecorationManager } from "@/components/monacoEditor/decorations/decorationManager.ts";

import "@/styles/monaco.css";
import ErrorModal from "@/components/monacoEditor/ErrorModal.tsx";
import DraggableMenu from "@/components/monacoEditor/DraggableMenu.tsx";
import AIPromptOverlay, { QuickPrompt } from "@/components/ai/AIPromptOverlay";
import PromptContainer, {
  PromptContainerRef,
} from "@/components/ai/PromptContainer";
import { jsonQuickPrompts } from "@/components/ai/JsonQuickPrompts.tsx";
import { useSettingsStore } from "@/store/useSettingsStore";
import JsonQueryHelp from "@/components/monacoEditor/JsonQueryHelp";

export interface MonacoJsonEditorProps {
  tabTitle?: string;
  tabKey: string;
  height?: number | string;
  value?: string;
  language?: string;
  theme?: string;
  minimap?: boolean;
  isSetting?: boolean; // 是否显示设置按钮
  isMenu?: boolean; // 是否显示悬浮菜单按钮
  showAi?: boolean; // 是否显示AI功能
  customQuickPrompts?: QuickPrompt[]; // 自定义快捷指令
  showTimestampDecorators?: boolean; // 是否显示时间戳装饰器
  showJsonQueryFilter?: boolean; // 是否显示 jsonQuery 过滤功能
  onUpdateValue: (value: string) => void;
  onMount?: () => void;
  ref?: React.Ref<MonacoJsonEditorRef>;
}

export interface MonacoJsonEditorRef {
  focus: () => void;
  layout: () => void;
  copy: () => boolean;
  compress: () => boolean;
  escape: () => boolean;
  format: () => boolean;
  validate: () => boolean;
  clear: () => boolean;
  fieldSort: (type: "asc" | "desc") => boolean;
  moreAction: (key: "unescape" | "del_comment") => boolean;
  saveFile: () => boolean;
  updateValue: (value: string) => void;
  setLanguage: (language: string) => void;
  showAiPrompt: () => void;
  toggleTimestampDecorators: (enabled?: boolean) => boolean; // 切换时间戳装饰器
  toggleBase64Decorators: (enabled?: boolean) => boolean; // 切换Base64装饰器
  toggleUnicodeDecorators: (enabled?: boolean) => boolean; // 切换Unicode装饰器
  toggleUrlDecorators: (enabled?: boolean) => boolean; // 切换URL装饰器
  toggleImageDecorators: (enabled?: boolean) => boolean; // 切换图片装饰器
}

const MonacoJsonEditor: React.FC<MonacoJsonEditorProps> = ({
  value,
  tabKey,
  tabTitle,
  language,
  theme,
  height,
  isMenu = false,
  minimap = false,
  customQuickPrompts,
  showTimestampDecorators = true, // 默认开启时间戳装饰器
  showJsonQueryFilter = false, // s开启 jsonQuery 过滤功能
  onUpdateValue,
  onMount,
  ref,
}) => {
  const { getTabByKey, updateEditorSettings } = useTabStore();
  const errorBottomHeight = 45; // 底部错误详情弹窗的高度
  const containerRef = useRef<HTMLDivElement>(null);
  const rootContainerRef = useRef<HTMLDivElement>(null); // 根容器引用
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null);
  const filterEditorRef = useRef<editor.IStandaloneCodeEditor | null>(null);
  const [parseJsonError, setParseJsonError] = useState<JsonErrorInfo | null>(
    null,
  );
  const parseJsonErrorShow = useRef<boolean>(false);
  const parseJsonErrorTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const editorLayoutTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const errorDecorationsRef =
    useRef<monaco.editor.IEditorDecorationsCollection | null>(null);
  const foldingDecorationsRef =
    useRef<monaco.editor.IEditorDecorationsCollection | null>(null);

  // 从 store 获取当前 tab 的设置
  const currentTab = getTabByKey(tabKey);
  const { base64DecoderEnabled, unicodeDecoderEnabled, urlDecoderEnabled } =
    useSettingsStore();

  const editorSettings = currentTab?.editorSettings || {
    fontSize: 14,
    language: language || "json",
    indentSize: 4,
    timestampDecoratorsEnabled: showTimestampDecorators,
  };

  // 菜单状态
  const [currentLanguage, setCurrentLanguage] = useState(
    editorSettings.language,
  );
  const [fontSize, setFontSize] = useState(editorSettings.fontSize);
  const [indentSize, setIndentSize] = useState(editorSettings.indentSize || 4);

  // 时间戳装饰器相关引用
  const timestampDecorationsRef =
    useRef<monaco.editor.IEditorDecorationsCollection | null>(null);
  const timestampDecorationIdsRef = useRef<Record<string, string[]>>({});
  const timestampUpdateTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const timestampCacheRef = useRef<Record<string, boolean>>({});
  // 时间戳装饰器启用状态，优先从编辑器设置中读取
  const [timestampDecoratorsEnabled, setTimestampDecoratorsEnabled] = useState(
    editorSettings.timestampDecoratorsEnabled !== undefined
      ? editorSettings.timestampDecoratorsEnabled
      : showTimestampDecorators,
  );

  // Base64装饰器使用全局状态
  const [base64DecoratorsEnabled, setBase64DecoratorsEnabled] =
    useState(base64DecoderEnabled);

  // Unicode装饰器使用全局状态
  const [unicodeDecoratorsEnabled, setUnicodeDecoratorsEnabled] = useState(
    unicodeDecoderEnabled,
  );

  // URL装饰器使用全局状态
  const [urlDecoratorsEnabled, setUrlDecoratorsEnabled] =
    useState(urlDecoderEnabled);

  // Base64下划线装饰器相关引用
  const base64UpdateTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const base64DecorationManagerRef = useRef<DecorationManager | null>(null);

  // Unicode下划线装饰器相关引用
  const unicodeUpdateTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const unicodeDecorationManagerRef = useRef<DecorationManager | null>(null);

  // URL下划线装饰器相关引用
  const urlUpdateTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const urlDecorationManagerRef = useRef<DecorationManager | null>(null);

  // 图片装饰器相关引用
  const imageUpdateTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const imageDecorationManagerRef = useRef<DecorationManager | null>(null);
  const imageCacheRef = useRef<Record<string, boolean>>({});
  const [imageDecoratorsEnabled, setImageDecoratorsEnabled] = useState(true); // 默认开启图片装饰器

  // 跟踪是否为首次粘贴状态（用于首次粘贴时自动格式化）
  const [isFirstPaste, setIsFirstPaste] = useState(true);

  // 时间戳装饰器状态
  const timestampDecoratorState: TimestampDecoratorState = {
    editorRef: editorRef,
    decorationsRef: timestampDecorationsRef,
    decorationIdsRef: timestampDecorationIdsRef,
    updateTimeoutRef: timestampUpdateTimeoutRef,
    cacheRef: timestampCacheRef,
    enabled: timestampDecoratorsEnabled,
    hoverProviderId: { current: null },
  };

  // Base64下划线装饰器状态
  const base64DecoratorState: Base64DecoratorState = {
    editorRef: editorRef,
    hoverProviderId: { current: null },
    updateTimeoutRef: base64UpdateTimeoutRef,
    decorationManagerRef: base64DecorationManagerRef,
    enabled: base64DecoratorsEnabled,
  };

  // Unicode下划线装饰器状态
  const unicodeDecoratorState: UnicodeDecoratorState = {
    editorRef: editorRef,
    hoverProviderId: { current: null },
    updateTimeoutRef: unicodeUpdateTimeoutRef,
    decorationManagerRef: unicodeDecorationManagerRef,
    enabled: unicodeDecoratorsEnabled,
  };

  // URL下划线装饰器状态
  const urlDecoratorState: UrlDecoratorState = {
    editorRef: editorRef,
    hoverProviderId: { current: null },
    updateTimeoutRef: urlUpdateTimeoutRef,
    decorationManagerRef: urlDecorationManagerRef,
    enabled: urlDecoratorsEnabled,
  };

  // 图片装饰器状态
  const imageDecoratorState: ImageDecoratorState = {
    editorRef: editorRef,
    hoverProviderId: { current: null },
    updateTimeoutRef: imageUpdateTimeoutRef,
    decorationManagerRef: imageDecorationManagerRef,
    cacheRef: imageCacheRef,
    enabled: imageDecoratorsEnabled,
    theme: theme == "vs-dark" ? "dark" : "light",
    editorPrefix: "normal",
  };

  // 错误高亮装饰器状态
  const errorDecoratorState: ErrorDecoratorState = {
    editorRef: editorRef,
    decorationsRef: errorDecorationsRef,
  };

  // AI相关状态
  const [showAiPrompt, setShowAiPrompt] = useState(false);
  const [aiPrompt, setAiPrompt] = useState("");
  const [showAiResponse, setShowAiResponse] = useState(false);

  // 添加一个引用以便访问PromptContainer组件的方法
  const promptContainerRef = useRef<PromptContainerRef>(null);

  // 为PromptContainer组件准备消息数组
  const [aiMessages, setAiMessages] = useState<
    Array<{ role: "user" | "assistant"; content: string; timestamp: number }>
  >([]);

  // Ai 面板左右推拉相关状态
  const [aiPanelWidth, setAiPanelWidth] = useState(0);
  const [aiPanelIsDragging, setAIPaneIsDragging] = useState(false);
  const aiPanelDragStartX = useRef<number>(0);
  const aiPanelDragStartWidth = useRef<number>(0);

  // jsonQuery 过滤相关状态
  const [jsonQueryFilter, setJsonQueryFilter] = useState<string>("");
  const [showFilterEditor, setShowFilterEditor] = useState<boolean>(false);
  const [filterLeftWidth, setFilterLeftWidth] = useState<number>(50);
  const [isFilterDragging, setIsFilterDragging] = useState<boolean>(false);
  const filterDragStartX = useRef<number>(0);
  const filterDragStartWidth = useRef<number>(0);
  const [filterError, setFilterError] = useState<string | null>(null);
  const [filteredValue, setFilteredValue] = useState<string>("");

  const {
    isOpen: jsonErrorDetailsModel,
    onOpen: openJsonErrorDetailsModel,
    onClose: closeJsonErrorDetailsModel,
  } = useDisclosure();

  // 当前编辑器内容状态（用于避免在渲染时访问ref）
  const [currentEditorValue, setCurrentEditorValue] = useState<string>("");
  // 编辑器是否准备就绪
  const [isEditorReady, setIsEditorReady] = useState<boolean>(false);

  // 使用自定义快捷指令或默认快捷指令
  const finalQuickPrompts = customQuickPrompts || jsonQuickPrompts;

  // 计算编辑器实际高度，当有错误时减去错误信息栏的高度
  const getEditorHeight = () => {
    // 如果height是数字，直接使用；如果是字符串(如100%)，保持原样
    let baseHeight =
      typeof height === "number" ? `${height}px` : height || "100%";

    let totalDeduction = 0;

    // 当显示错误信息时，减去错误栏高度
    if (parseJsonError) {
      totalDeduction += errorBottomHeight;
    }

    // 当显示 jsonQuery 过滤器时，减去过滤器高度
    if (showJsonQueryFilter) {
      totalDeduction += 34; // JSON Query过滤器高度
    }

    // 如果有需要扣除的高度
    if (totalDeduction > 0) {
      return `calc(${baseHeight} - ${totalDeduction}px)`;
    }

    return baseHeight;
  };

  // 处理 jsonQuery 过滤
  const handleJsonQueryFilter = useCallback(() => {
    // 使用 ref 中的最新值，避免闭包问题
    const currentFilter = latestFilterRef.current;

    if (!currentFilter.trim()) {
      setShowFilterEditor(false);
      setFilteredValue("");
      setFilterError(null);

      return;
    }

    const editorValue = editorRef.current?.getValue() || "";

    if (!editorValue.trim()) {
      setFilterError("编辑器内容为空，无法进行过滤");

      return;
    }

    try {
      // 不支持 lossless-json 语法
      const jsonData = JSON.parse(editorValue);

      const filteredData = jsonquery(jsonData, currentFilter);

      const formattedResult = stringifyJson(filteredData, 2);

      setFilteredValue(formattedResult);
      setShowFilterEditor(true);
      setFilterError(null);
    } catch (error) {
      console.error("jsonQuery 过滤错误:", error);
      console.error("过滤表达式:", currentFilter);
      setFilterError(
        `过滤失败: ${error instanceof Error ? error.message : String(error)}`,
      );
      setShowFilterEditor(false);
    }
  }, [jsonQueryFilter]);

  // 处理 jsonQuery 输入变化
  const handleJsonQueryChange = useCallback(
    (value: string) => {
      setJsonQueryFilter(value);

      // 防抖处理
      if (filterUpdateTimeoutRef.current) {
        clearTimeout(filterUpdateTimeoutRef.current);
      }

      filterUpdateTimeoutRef.current = setTimeout(() => {
        // 使用最新的过滤值进行过滤，避免闭包问题
        if (value.trim()) {
          handleJsonQueryFilter();
        } else {
          setShowFilterEditor(false);
          setFilteredValue("");
          setFilterError(null);
        }
      }, 300); // 减少防抖时间，提高响应速度
    },
    [handleJsonQueryFilter],
  );

  // jsonQuery 过滤器拖拽处理函数
  const handleFilterDragStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      filterDragStartX.current = e.clientX;
      filterDragStartWidth.current = filterLeftWidth;
      setIsFilterDragging(true);
    },
    [filterLeftWidth],
  );

  const handleFilterMouseMove = useCallback(
    (e: MouseEvent) => {
      if (!isFilterDragging || !rootContainerRef.current) return;

      requestAnimationFrame(() => {
        if (!rootContainerRef.current) return;

        const containerWidth = rootContainerRef.current.offsetWidth;
        const deltaX = e.clientX - filterDragStartX.current;
        const deltaPercentage = (deltaX / containerWidth) * 100;
        let newWidth = filterDragStartWidth.current + deltaPercentage;

        // 限制在最小和最大宽度之间
        newWidth = Math.max(20, Math.min(80, newWidth));

        setFilterLeftWidth(newWidth);
      });
    },
    [isFilterDragging],
  );

  const handleFilterMouseUp = useCallback(() => {
    setIsFilterDragging(false);
  }, []);

  // 添加防抖计时器引用
  const filterUpdateTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // 使用 ref 存储最新的过滤值，避免闭包问题
  const latestFilterRef = useRef<string>("");

  // 更新最新过滤值
  useEffect(() => {
    latestFilterRef.current = jsonQueryFilter;
  }, [jsonQueryFilter]);

  // 处理AI提交
  const handleAiSubmit = async () => {
    if (!aiPrompt.trim()) {
      toast.error("请输入提示词");

      return;
    }

    setShowAiPrompt(false);
    setShowAiResponse(true);

    // 添加用户消息到消息数组
    const userMessage = {
      role: "user" as const,
      content: aiPrompt,
      timestamp: Date.now(),
    };

    setAiMessages([userMessage]);

    // 保存prompt内容用于稍后发送
    const promptToSend = aiPrompt;

    setAiPrompt("");

    // 更新布局
    setTimeout(() => {
      editorRef.current?.layout();

      // 使用setTimeout确保PromptContainer组件已经挂载并初始化
      setTimeout(() => {
        // 直接触发PromptContainer的sendMessage方法
        if (promptContainerRef.current) {
          promptContainerRef.current.sendMessage(promptToSend);
        } else {
          // 如果还没有获取到ref，添加一个思考中的消息
          setAiMessages((prev) => [
            ...prev,
            {
              role: "assistant",
              content: "思考中...",
              timestamp: Date.now(),
            },
          ]);
        }
      }, 100);
    }, 300);
  };

  // 关闭AI响应
  const closeAiResponse = () => {
    setShowAiResponse(false);
    // 清空消息历史
    setAiMessages([]);

    // 布局调整
    setTimeout(() => {
      editorRef.current?.layout();
    }, 100);
  };

  // 处理关闭按钮的函数
  const handleCloseAiResponse = () => {
    closeAiResponse();
  };

  // 添加应用代码到编辑器的函数
  const handleApplyCode = (code: string) => {
    if (!code || !editorRef.current) {
      toast.error("无法应用代码到编辑器");

      return;
    }

    try {
      // 尝试解析JSON，确保是有效的JSON
      const jsonObj = parseJson(code);

      // 如果解析成功，格式化并设置到编辑器
      setEditorValue(stringifyJson(jsonObj, indentSize));
      toast.success("已应用代码到编辑器");
    } catch {
      // 如果解析失败，尝试直接设置文本
      try {
        setEditorValue(code);
        toast.success("已应用代码到编辑器");
      } catch {
        toast.error("应用代码失败，格式可能不正确");
      }
    }
  };

  // 错误信息内容监听
  useEffect(() => {
    // 需要显示错误信息时
    if (parseJsonError && !parseJsonErrorShow.current) {
      setTimeout(() => {
        editorRef.current?.layout();
      }, 500);
      parseJsonErrorShow.current = true;
    } else if (parseJsonError == null && parseJsonErrorShow.current) {
      // 需要隐藏错误信息时
      setTimeout(() => {
        editorRef.current?.layout();
      }, 500);
      parseJsonErrorShow.current = false;
    }
  }, [parseJsonError]);

  useEffect(() => {
    if (editorRef.current) {
      editorRef.current.updateOptions({
        theme: theme,
      });
    }
  }, [theme]);

  // 监听主题变化并更新图片装饰器
  useEffect(() => {
    if (editorRef.current && imageDecoratorsEnabled) {
      updateImageDecorations(editorRef.current, imageDecoratorState);
    }
  }, [theme, imageDecoratorsEnabled]);

  // 字体大小和缩进大小变更监听
  useEffect(() => {
    if (editorRef.current) {
      editorRef.current.updateOptions({
        fontSize: fontSize,
        tabSize: indentSize,
        detectIndentation: false, // 关闭自动检测缩进
      });
    }
    editorFormat();
  }, [fontSize, indentSize]);

  // 语言变更处理函数
  const handleLanguageChange = (newLanguage: string) => {
    setCurrentLanguage(newLanguage);

    // 通过ref方法设置语言
    const model = editorRef.current?.getModel();

    if (model) {
      monaco.editor.setModelLanguage(model, newLanguage);
    }
  };

  // 重置设置
  const handleReset = () => {
    setFontSize(14); // 重置字体大小
    setIndentSize(4); // 重置缩进大小
    handleLanguageChange("json"); // 重置语言

    // 重置时启用时间戳装饰器
    if (!timestampDecoratorsEnabled) {
      setTimestampDecoratorsEnabled(true);
      if (editorRef.current) {
        toggleTimestampDecorators(
          editorRef.current,
          timestampDecoratorState,
          true,
        );
      }
    }

    toast.success("已重置编辑器设置");
  };

  // 延迟更新编辑器布局
  const editorDelayLayout = () => {
    if (editorLayoutTimeoutRef.current) {
      clearTimeout(editorLayoutTimeoutRef.current);
    }
    editorLayoutTimeoutRef.current = setTimeout(() => {
      editorRef.current?.layout();
    }, 50);
  };

  useEffect(() => {
    // 添加事件监听器
    window.addEventListener("resize", editorDelayLayout);

    // 清理函数 - 组件卸载时移除事件监听器
    return () => {
      window.removeEventListener("resize", editorDelayLayout);
    };
  }, []); // 空依赖数组表示这个效果只在组件挂载和卸载时运行

  // 语言切换时重新设置编辑器
  useEffect(() => {
    const model = monaco.editor.createModel(
      value as string,
      language || "json",
    );

    if (language !== "json" && language !== "json5") {
      setParseJsonError(null);
    }

    editorRef.current?.setModel(model);
    setCurrentLanguage(language || "json");
  }, [language]);

  // 当错误状态变化时，重新布局编辑器
  useEffect(() => {
    editorRef.current?.layout();
  }, [parseJsonError]);

  // 设置编辑器内容，保留历史, 支持 ctrl + z 撤销
  const setEditorValue = (jsonText: string) => {
    if (!editorRef.current) {
      return;
    }
    const model = editorRef.current.getModel();

    if (!model) {
      return;
    }
    editorRef.current?.executeEdits("", [
      {
        range: model.getFullModelRange(),
        text: jsonText,
        forceMoveMarkers: true,
      },
    ]);

    // 如果清空了编辑器，重置首次粘贴状态
    if (jsonText === "") {
      setIsFirstPaste(true);
    }
  };

  // 获取编辑器行数
  const getEditorLineCount = (): number => {
    if (!editorRef.current) {
      return 0;
    }

    return editorRef.current.getModel()?.getLineCount() || 0;
  };

  // 清空所有装饰器
  const clearAllDecorators = () => {
    if (!editorRef.current) {
      return;
    }

    // 清空时间戳装饰器
    if (timestampDecorationsRef.current) {
      timestampDecorationsRef.current.clear();
    }

    // 清空Base64装饰器
    if (base64DecorationManagerRef.current) {
      base64DecorationManagerRef.current.clearAllDecorations(editorRef.current);
    }

    // 清空Unicode装饰器
    if (unicodeDecorationManagerRef.current) {
      unicodeDecorationManagerRef.current.clearAllDecorations(
        editorRef.current,
      );
    }

    // 清空URL装饰器
    if (urlDecorationManagerRef.current) {
      urlDecorationManagerRef.current.clearAllDecorations(editorRef.current);
    }

    // 清空图片装饰器
    if (imageDecorationManagerRef.current) {
      imageDecorationManagerRef.current.clearAllDecorations(editorRef.current);
    }
  };

  // 监听时间戳装饰器状态变化
  useEffect(() => {
    // 更新状态对象中的启用状态
    timestampDecoratorState.enabled = timestampDecoratorsEnabled;

    if (timestampDecoratorsEnabled) {
      // 检查行数，小于3行时不启用装饰器
      const lineCount = getEditorLineCount();

      if (lineCount >= 3) {
        // 清空缓存并更新装饰器
        clearTimestampCache(timestampDecoratorState);
        setTimeout(() => {
          if (editorRef.current) {
            updateTimestampDecorations(
              editorRef.current,
              timestampDecoratorState,
            );
          }
        }, 0);
      }
    } else {
      // 禁用时清理缓存和装饰器
      if (timestampDecorationsRef.current) {
        timestampDecorationsRef.current.clear();
      }
      clearTimestampCache(timestampDecoratorState);
    }
  }, [timestampDecoratorsEnabled]);

  // 监听Base64装饰器状态变化
  useEffect(() => {
    // 更新状态对象中的启用状态
    base64DecoratorState.enabled = base64DecoratorsEnabled;

    // 更新全局状态
    setBase64ProviderEnabled(base64DecoratorsEnabled);
    setBase64DecorationEnabled(base64DecoratorsEnabled);

    if (base64DecoratorsEnabled) {
      // 检查行数，小于3行时不启用装饰器
      const lineCount = getEditorLineCount();

      if (lineCount >= 3) {
        // 更新装饰器
        setTimeout(() => {
          if (editorRef.current) {
            updateBase64Decorations(editorRef.current, base64DecoratorState);
          }
        }, 0);
      }
    } else {
      // 禁用时清理装饰器
      if (base64DecorationManagerRef.current) {
        base64DecorationManagerRef.current.clearAllDecorations(
          editorRef.current!,
        );
      }
    }
  }, [base64DecoratorsEnabled]);

  // 监听Unicode装饰器状态变化
  useEffect(() => {
    // 更新状态对象中的启用状态
    unicodeDecoratorState.enabled = unicodeDecoratorsEnabled;

    // 更新全局状态
    setUnicodeProviderEnabled(unicodeDecoratorsEnabled);
    setUnicodeDecorationEnabled(unicodeDecoratorsEnabled);

    if (unicodeDecoratorsEnabled) {
      // 检查行数，小于3行时不启用装饰器
      const lineCount = getEditorLineCount();

      if (lineCount >= 3) {
        // 清空缓存并更新装饰器
        setTimeout(() => {
          if (editorRef.current) {
            updateUnicodeDecorations(editorRef.current, unicodeDecoratorState);
          }
        }, 0);
      }
    } else {
      // 禁用时清理装饰器
      if (unicodeDecorationManagerRef.current) {
        unicodeDecorationManagerRef.current.clearAllDecorations(
          editorRef.current!,
        );
      }
    }
  }, [unicodeDecoratorsEnabled]);

  // 监听URL装饰器状态变化
  useEffect(() => {
    // 更新状态对象中的启用状态
    urlDecoratorState.enabled = urlDecoratorsEnabled;

    // 更新全局状态
    setUrlProviderEnabled(urlDecoratorsEnabled);
    setUrlDecorationEnabled(urlDecoratorsEnabled);

    if (urlDecoratorsEnabled) {
      // 检查行数，小于3行时不启用装饰器
      const lineCount = getEditorLineCount();

      if (lineCount >= 3) {
        // 更新装饰器
        setTimeout(() => {
          if (editorRef.current) {
            updateUrlDecorations(editorRef.current, urlDecoratorState);
          }
        }, 0);
      }
    } else {
      // 禁用时清理装饰器
      if (urlDecorationManagerRef.current) {
        urlDecorationManagerRef.current.clearAllDecorations(editorRef.current!);
      }
    }
  }, [urlDecoratorsEnabled]);

  // 监听图片装饰器启用状态变化
  useEffect(() => {
    // 使用toggle函数管理装饰器状态
    if (editorRef.current) {
      toggleImageDecorators(
        editorRef.current,
        imageDecoratorState,
        imageDecoratorsEnabled,
      );
    }
  }, [imageDecoratorsEnabled]);

  // 监听过滤结果变化，更新过滤编辑器内容
  useEffect(() => {
    try {
      if (
        filterEditorRef.current &&
        filteredValue !== filterEditorRef.current.getValue()
      ) {
        if (filteredValue === null || filteredValue === undefined) {
          filterEditorRef.current.setValue("null");

          return;
        }

        filterEditorRef.current.setValue(filteredValue);
      }
    } catch (error) {
      console.error("filterValueChange error", error);
    }
  }, [filteredValue]);

  // 监听主题变化，更新过滤编辑器主题
  useEffect(() => {
    if (filterEditorRef.current) {
      filterEditorRef.current.updateOptions({
        theme: theme || "vs-light",
      });
    }
  }, [theme]);

  // 监听字体大小变化，更新过滤编辑器字体大小
  useEffect(() => {
    if (filterEditorRef.current) {
      filterEditorRef.current.updateOptions({
        fontSize: fontSize,
      });
    }
  }, [fontSize]);

  // 验证编辑器内容
  const editorValueValidate = (val: string): boolean => {
    if (val.trim() === "") {
      setParseJsonError(null);

      return true;
    }

    let jsonErr: JsonErrorInfo | undefined;

    const languageId = editorRef.current?.getModel()?.getLanguageId();

    // 根据语言类型选择不同的解析器
    if (languageId === "json5") {
      jsonErr = json5ParseError(val);
    } else {
      jsonErr = jsonParseError(val);
    }

    if (jsonErr) {
      setParseJsonError(jsonErr);

      return false;
    } else {
      setParseJsonError(null);
    }

    return true;
  };

  // 验证格式并格式化
  const formatValidate = (): boolean => {
    if (!editorRef.current) {
      return false;
    }
    const val = editorRef.current.getValue();
    const isValid = editorValueValidate(val);

    if (!isValid) {
      return false;
    }

    return editorFormat();
  };

  const editorFormat = (): boolean => {
    if (!editorRef.current) {
      return false;
    }

    // 格式化暂时关闭自动检测缩进
    editorRef.current?.updateOptions({
      detectIndentation: false,
    });

    if (editorRef.current.getValue() === "") {
      toast.error("暂无内容!");

      return false;
    }

    // 如果是 JSON5 格式，使用 JSON5 格式化
    if (language === "json5") {
      try {
        const val = editorRef.current.getValue();
        const json5Obj = JSON5.parse(val);
        const formatted = JSON5.stringify(json5Obj, { space: 2 });

        setEditorValue(formatted);

        return true;
      } catch (error) {
        toast.error(`格式化失败: ${(error as Error).message}`);

        return false;
      }
    } else {
      // 对于其他格式，使用 Monaco 内置的格式化功能
      editorRef.current.getAction("editor.action.formatDocument")?.run();
    }

    // 格式化成功 开启自动缩进
    setTimeout(() => {
      editorRef.current?.updateOptions({
        detectIndentation: true, // 开启自动检测缩进
      });
    }, 50);

    return true;
  };

  // 一键定位到错误行
  const goToErrorLine = () => {
    if (!parseJsonError || parseJsonError.line <= 0) {
      toast.error("一键定位失败");

      return;
    }
    closeJsonErrorDetailsModel();

    if (editorRef.current) {
      highlightErrorLine(
        editorRef.current,
        errorDecoratorState,
        parseJsonError.line,
      );
    }
  };

  const autoFix = (): boolean => {
    try {
      const jsonText = editorRef.current?.getValue() || "";

      if (jsonText === "") {
        toast.warning("暂无内容");

        return false;
      }
      const repaired = jsonrepair(jsonText);

      setEditorValue(repaired);

      closeJsonErrorDetailsModel();
      setParseJsonError(null);
      toast.success("修复成功");

      return true;
    } catch (e) {
      console.error("repairJson", e);
      toast.error("修复失败，可能不是有效的 Json 数据");

      return false;
    }
  };

  // 复制到剪贴板
  const copyText = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch (err) {
      console.error("复制失败:", err);
    }
  };

  // 解码 JSON 处理转义
  // return '' 为正常
  const formatModelByUnEscapeJson = (jsonText: string): string => {
    if (jsonText === "") {
      return "暂无数据";
    }
    jsonText = jsonText.trim();
    // 检查 jsonText 是否已经被双引号包裹
    const isQuoted = jsonText.startsWith('"') && jsonText.endsWith('"');
    const jsonStr = isQuoted ? jsonText : `"${jsonText}"`;

    try {
      // 第一次将解析结果为去除转移后字符串
      const unescapedJson = parseJson(jsonStr);
      // 去除转义后的字符串解析为对象
      const unescapedJsonObject = parseJson(unescapedJson);

      // 判断是否为对象或数组
      if (!isArrayOrObject(unescapedJsonObject)) {
        return "不是有效的 JSON 数据，无法进行解码操作";
      }

      setEditorValue(stringifyJson(unescapedJsonObject, indentSize));
    } catch (error) {
      console.error("formatModelByUnEscapeJson", error);
      if (error instanceof SyntaxError) {
        return "不是有效的转义 JSON 字符串，无法进行解码操作";
      }

      return `尝试去除转义失败，${error}`;
    }

    return "";
  };

  // 开始拖动处理
  const handleDragStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      aiPanelDragStartX.current = e.clientX;
      aiPanelDragStartWidth.current = aiPanelWidth;
      setAIPaneIsDragging(true);
    },
    [aiPanelWidth],
  );

  // 拖动AI面板
  const handleMouseAIPanelMove = useCallback(
    (e: MouseEvent) => {
      if (!aiPanelIsDragging || !rootContainerRef.current) return;

      // 使用requestAnimationFrame优化性能
      requestAnimationFrame(() => {
        if (!rootContainerRef.current) return;

        const totalWidth = rootContainerRef.current.offsetWidth;

        if (totalWidth <= 0) return; // 如果宽度无效则避免计算

        const minPanelWidthPx = 200; // 两个面板的最小宽度（像素）

        // 确保最小面板宽度不超过总宽度的一半（减去缓冲区）
        const effectiveMinWidth = Math.min(
          minPanelWidthPx,
          totalWidth / 2 - 10,
        );

        // 基于有效最小宽度计算aiPanelWidth的边界
        // 下限：确保AI面板至少为effectiveMinWidth
        const lowerBound = effectiveMinWidth - 0.4 * totalWidth;
        // 上限：确保编辑器面板至少为effectiveMinWidth
        const upperBound = 0.6 * totalWidth - effectiveMinWidth;

        // 根据拖动偏移量计算潜在的aiPanelWidth
        const deltaX = e.clientX - aiPanelDragStartX.current;
        // 向左拖动时aiPanelWidth增加（deltaX为负）
        let potentialAiPanelWidth = aiPanelDragStartWidth.current - deltaX;

        // 将潜在宽度限制在计算的边界内，确保lowerBound <= upperBound
        if (lowerBound <= upperBound) {
          const clampedAiPanelWidth = Math.max(
            lowerBound,
            Math.min(potentialAiPanelWidth, upperBound),
          );

          setAiPanelWidth(clampedAiPanelWidth);
        } else {
          // 处理边界无效的边缘情况（例如，totalWidth太小）
          // 可选：设置为默认值或中间状态，或者不更新
          console.warn("Invalid resize bounds", {
            totalWidth,
            lowerBound,
            upperBound,
          });
        }

        // 更新编辑器布局
        editorRef.current?.layout();
      });
    },
    [aiPanelIsDragging],
  );

  // 鼠标抬起处理
  const handleMouseAIPanelUp = useCallback(() => {
    setAIPaneIsDragging(false);
  }, []);

  // 添加/移除鼠标事件监听 - AI面板
  useEffect(() => {
    if (aiPanelIsDragging) {
      document.addEventListener("mousemove", handleMouseAIPanelMove);
      document.addEventListener("mouseup", handleMouseAIPanelUp);
      document.body.style.userSelect = "none";
      document.body.style.cursor = "ew-resize";
    } else {
      document.removeEventListener("mousemove", handleMouseAIPanelMove);
      document.removeEventListener("mouseup", handleMouseAIPanelUp);
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
    }

    return () => {
      document.removeEventListener("mousemove", handleMouseAIPanelMove);
      document.removeEventListener("mouseup", handleMouseAIPanelUp);
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
    };
  }, [aiPanelIsDragging, handleMouseAIPanelMove, handleMouseAIPanelUp]);

  // 添加/移除鼠标事件监听 - jsonQuery 过滤器
  useEffect(() => {
    if (isFilterDragging) {
      document.addEventListener("mousemove", handleFilterMouseMove);
      document.addEventListener("mouseup", handleFilterMouseUp);
      document.body.style.userSelect = "none";
      document.body.style.cursor = "ew-resize";
    } else {
      document.removeEventListener("mousemove", handleFilterMouseMove);
      document.removeEventListener("mouseup", handleFilterMouseUp);
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
    }

    return () => {
      document.removeEventListener("mousemove", handleFilterMouseMove);
      document.removeEventListener("mouseup", handleFilterMouseUp);
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
    };
  }, [isFilterDragging, handleFilterMouseMove, handleFilterMouseUp]);

  // 暴露给父组件的方法
  useImperativeHandle(ref, () => ({
    updateValue: (value: string) => {
      setEditorValue(value);
    },
    focus: () => {
      if (editorRef.current) {
        editorRef.current.focus();
      }
    },
    layout: () => {
      if (editorRef.current) {
        editorRef.current.layout();
      }
    },
    showAiPrompt: () => {
      const val = editorRef.current?.getValue() || "";

      if (val.trim() === "") {
        toast.error("编辑器内容为空，请先输入内容");

        return false;
      }

      setCurrentEditorValue(val);
      setShowAiPrompt(true);

      return true;
    },
    copy: () => {
      if (!editorRef.current) {
        return false;
      }

      const val = editorRef.current.getValue();

      copyText(val);

      return true;
    },
    compress: () => {
      if (!editorRef.current) {
        return false;
      }

      const val = editorRef.current.getValue();

      if (val.trim() === "") {
        toast.warning("暂无内容");

        return false;
      }

      const isValid = editorValueValidate(val);

      if (!isValid) {
        return false;
      }

      const compressed = stringifyJson(parseJson(val));

      setEditorValue(compressed);
      toast.success("压缩成功");

      return true;
    },
    escape: () => {
      if (!editorRef.current) {
        return false;
      }

      const val = editorRef.current.getValue();

      if (val.trim() === "") {
        toast.warning("暂无内容");

        return false;
      }

      const isValid = editorValueValidate(val);

      if (!isValid) {
        return false;
      }

      const escaped = escapeJson(val);

      setEditorValue(escaped);
      toast.success("转义成功");

      return true;
    },
    format: () => {
      return formatValidate();
    },
    validate: () => {
      if (!editorRef.current) {
        return false;
      }

      const val = editorRef.current.getValue();

      if (val.trim() === "") {
        return true;
      }

      return editorValueValidate(val);
    },
    clear: () => {
      if (editorRef.current) {
        // 清空编辑器内容
        setEditorValue("");

        // 清空所有装饰器的状态
        if (timestampDecorationsRef.current) {
          timestampDecorationsRef.current.clear();
        }
        if (timestampCacheRef.current) {
          timestampCacheRef.current = {};
        }
        if (timestampDecorationIdsRef.current) {
          timestampDecorationIdsRef.current = {};
        }

        // 清理装饰器管理器中的装饰器
        if (base64DecorationManagerRef.current) {
          base64DecorationManagerRef.current.clearAllDecorations(
            editorRef.current,
          );
        }
        if (unicodeDecorationManagerRef.current) {
          unicodeDecorationManagerRef.current.clearAllDecorations(
            editorRef.current,
          );
        }
        if (urlDecorationManagerRef.current) {
          urlDecorationManagerRef.current.clearAllDecorations(
            editorRef.current,
          );
        }

        return true;
      }

      return false;
    },
    fieldSort: (type: "asc" | "desc"): boolean => {
      if (!editorRef.current) {
        return false;
      }
      const val = editorRef.current.getValue();
      const isValid = editorValueValidate(val);

      if (!isValid) {
        return false;
      }
      const jsonObj = parseJson(val);

      if (type === "asc") {
        setEditorValue(sortJson(jsonObj, "asc"));
      } else if (type === "desc") {
        setEditorValue(sortJson(jsonObj, "desc"));
      }

      return true;
    },
    // 处理更多操作
    moreAction: (key: "unescape" | "del_comment"): boolean => {
      if (!editorRef.current) {
        return false;
      }
      const val = editorRef.current.getValue();

      switch (key) {
        case "unescape":
          const errorMsg = formatModelByUnEscapeJson(val);

          if (errorMsg) {
            toast.error(errorMsg);

            return false;
          }
          break;
        case "del_comment":
          setEditorValue(removeJsonComments(val));

          return true;
        default:
          break;
      }

      return true;
    },
    saveFile: () => {
      // 将 json 内容保存到 tabName.json 文件
      const val = editorRef.current?.getValue() || "";

      if (val.trim() === "") {
        toast.warning("暂无内容");

        return false;
      }
      const fileName = `${tabTitle}.json`;
      const blob = new Blob([val], { type: "text/plain;charset=utf-8" });
      const downloadUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");

      a.href = downloadUrl;
      a.download = fileName;
      a.click();
      URL.revokeObjectURL(downloadUrl);

      return true;
    },
    setLanguage: (newLanguage: string) => {
      const model = editorRef.current?.getModel();

      if (model) {
        monaco.editor.setModelLanguage(model, newLanguage);
      }
    },
    toggleTimestampDecorators: (enabled?: boolean) => {
      // 更新状态
      const newState =
        enabled !== undefined ? enabled : !timestampDecoratorsEnabled;

      setTimestampDecoratorsEnabled(newState);

      // 使用抽离出的函数处理装饰器
      return toggleTimestampDecorators(
        editorRef.current,
        timestampDecoratorState,
        newState,
      );
    },
    toggleBase64Decorators: (enabled?: boolean) => {
      const newState =
        enabled !== undefined ? enabled : !base64DecoratorsEnabled;

      // 更新全局状态
      useSettingsStore.getState().setBase64DecoderEnabled(newState);

      return true;
    },
    toggleUnicodeDecorators: (enabled?: boolean) => {
      const newState =
        enabled !== undefined ? enabled : !unicodeDecoratorsEnabled;

      // 更新全局状态
      useSettingsStore.getState().setUnicodeDecoderEnabled(newState);

      return true;
    },
    toggleUrlDecorators: (enabled?: boolean) => {
      const newState = enabled !== undefined ? enabled : !urlDecoratorsEnabled;

      // 更新全局状态
      useSettingsStore.getState().setUrlDecoderEnabled(newState);

      return true;
    },
    toggleImageDecorators: (enabled?: boolean) => {
      const newState =
        enabled !== undefined ? enabled : !imageDecoratorsEnabled;

      // 更新本地状态
      setImageDecoratorsEnabled(newState);

      return true;
    },
  }));

  // 修改初始化编辑器的函数并调用
  useEffect(() => {
    // 使用 setTimeout 确保在 React 严格模式下只执行一次
    const timeoutId = setTimeout(async () => {
      console.log("initializeEditor", tabKey);
      // 确保只初始化一次
      if (editorRef.current) return;

      // 注意: 这里使用全局初始化的Monaco实例，不再重复加载配置
      const monacoInstance: Monaco = await loader.init();

      if (containerRef.current) {
        const editor = monacoInstance.editor.create(containerRef.current, {
          value: value || "",
          language: language || "json",
          minimap: {
            enabled: minimap, // 启用缩略图
          },
          // fontFamily: `"Arial","Microsoft YaHei","黑体","宋体", sans-serif`, // 字体
          fontSize: fontSize, // 使用状态中的字体大小
          colorDecorators: true, // 颜色装饰器
          readOnly: false, // 是否开启已读功能
          theme: theme || "vs-light", // 主题
          mouseWheelZoom: true, // 启用鼠标滚轮缩放
          formatOnPaste: false, // 粘贴时不自动格式化，使用自定义逻辑
          formatOnType: false, // 输入时自动格式化
          wordBasedSuggestions: "allDocuments", // 启用基于单词的建议
          wordBasedSuggestionsOnlySameLanguage: true, // 仅在相同语言下启用基于单词的建议
          scrollBeyondLastLine: false, // 禁用滚动超出最后一行
          suggestOnTriggerCharacters: true, // 在触发字符时显示建议
          acceptSuggestionOnCommitCharacter: true, // 接受关于提交字符的建议
          acceptSuggestionOnEnter: "smart", // 按Enter键接受建议
          wordWrap: "on", // 自动换行
          autoSurround: "never", // 是否应自动环绕选择
          cursorBlinking: "smooth", // 光标动画样式
          cursorSmoothCaretAnimation:
            UtoolsListener.getInstance().isListenerInitialized() ? "off" : "on", // 是否启用光标平滑插入动画, utools 插件中关闭
          cursorStyle: "line", //  光标样式
          cursorSurroundingLines: 0, // 光标环绕行数 当文字输入超过屏幕时 可以看见右侧滚动条中光标所处位置是在滚动条中间还是顶部还是底部 即光标环绕行数 环绕行数越大 光标在滚动条中位置越居中
          cursorSurroundingLinesStyle: "all", // "default" | "all" 光标环绕样式
          links: false, // 是否点击链接
          folding: true, // 启用代码折叠功能
          tabSize: indentSize, // 设置制表符大小为当前缩进大小
        });

        onMount && onMount();

        editor.focus();

        // 监听折叠状态变化
        editor.onDidChangeHiddenAreas(() => {
          if (editorRef.current) {
            updateFoldingDecorations(
              editorRef.current,
              currentLanguage,
              foldingDecorationsRef,
            );
          }
        });

        // 监听滚动事件
        editor.onDidScrollChange(() => {
          if (timestampUpdateTimeoutRef.current) {
            clearTimeout(timestampUpdateTimeoutRef.current);
          }

          timestampUpdateTimeoutRef.current = setTimeout(() => {
            if (editorRef.current) {
              updateTimestampDecorations(
                editorRef.current,
                timestampDecoratorState,
              );
            }
          }, 200); // 添加防抖

          if (base64UpdateTimeoutRef.current) {
            clearTimeout(base64UpdateTimeoutRef.current);
          }

          base64UpdateTimeoutRef.current = setTimeout(() => {
            if (editorRef.current) {
              updateBase64Decorations(editorRef.current, base64DecoratorState);
            }
          }, 200);

          if (unicodeUpdateTimeoutRef.current) {
            clearTimeout(unicodeUpdateTimeoutRef.current);
          }

          unicodeUpdateTimeoutRef.current = setTimeout(() => {
            if (editorRef.current) {
              updateUnicodeDecorations(
                editorRef.current,
                unicodeDecoratorState,
              );
            }
          }, 200);

          if (urlUpdateTimeoutRef.current) {
            clearTimeout(urlUpdateTimeoutRef.current);
          }

          urlUpdateTimeoutRef.current = setTimeout(() => {
            if (editorRef.current) {
              updateUrlDecorations(editorRef.current, urlDecoratorState);
            }
          }, 200);

          if (imageUpdateTimeoutRef.current) {
            clearTimeout(imageUpdateTimeoutRef.current);
          }

          imageUpdateTimeoutRef.current = setTimeout(() => {
            if (editorRef.current) {
              updateImageDecorations(editorRef.current, imageDecoratorState);
            }
          }, 300);
        });

        // 监听内容变化
        editor.onDidChangeModelContent((e) => {
          const val = editor.getValue();
          const languageId = editorRef.current?.getModel()?.getLanguageId();

          if (languageId === "json" || languageId === "json5") {
            if (parseJsonErrorTimeoutRef.current) {
              clearTimeout(parseJsonErrorTimeoutRef.current);
            }
            // 自动验证 JSON 内容
            parseJsonErrorTimeoutRef.current = setTimeout(() => {
              editorValueValidate(val);
            }, 500);

            // 根据行数控制装饰器
            const lineCount = getEditorLineCount();

            if (lineCount < 3) {
              // 小于3行时，清空所有装饰器
              clearAllDecorators();
            } else {
              // 更新时间戳装饰器
              if (timestampDecoratorsEnabled) {
                handleTimestampContentChange(e, timestampDecoratorState);
              }

              // 更新 Base64 下划线装饰器
              if (base64DecoratorsEnabled) {
                handleBase64ContentChange(e, base64DecoratorState);
              }

              // 更新 Unicode 下划线装饰器
              if (unicodeDecoratorsEnabled) {
                handleUnicodeContentChange(e, unicodeDecoratorState);
              }

              // 更新 URL 下划线装饰器
              if (urlDecoratorsEnabled) {
                handleUrlContentChange(e, urlDecoratorState);
              }

              // 更新图片装饰器
              if (imageDecoratorsEnabled) {
                handleImageContentChange(e, imageDecoratorState);
              }
            }
          }
          onUpdateValue(val);
          setCurrentEditorValue(val);
        });

        // 添加粘贴事件监听：首次粘贴时自动格式化
        editor.onDidPaste(() => {
          if (isFirstPaste && editorRef.current) {
            const currentValue = editorRef.current.getValue();

            // 检查是否为首次粘贴（编辑器为空或只有空白字符）
            if (currentValue && currentValue.trim() !== "") {
              // 延迟执行，等待内容完全粘贴并格式化
              setTimeout(() => {
                if (editorRef.current && isFirstPaste) {
                  // 尝试验证并格式化
                  const val = editorRef.current.getValue();
                  const isValid = editorValueValidate(val);

                  if (isValid) {
                    // 验证成功后进行格式化
                    editorFormat();
                    // 设置为非首次粘贴状态，避免重复格式化
                    setIsFirstPaste(false);
                  }
                }
              }, 100);
            }
          }
        });

        editorRef.current = editor;
        setIsEditorReady(true);

        // 统一初始化所有装饰器
        // 使用 onDidLayoutChange 确保编辑器布局完成后再初始化装饰器
        let hasInitializedDecorations = false;

        const initializeDecorations = () => {
          // 防止重复初始化
          if (hasInitializedDecorations || !editorRef.current) {
            return;
          }

          hasInitializedDecorations = true;

          // 检查行数，少于3行时不启用装饰器（图片装饰器除外）
          const lineCount = getEditorLineCount();

          if (lineCount < 3) {
            return;
          }

          // 统一初始化时间戳装饰器 - 先设置状态再更新
          if (timestampDecoratorsEnabled) {
            // 确保全局状态与本地状态同步
            setTimestampDecorationEnabled(timestampDecoratorsEnabled);
            updateTimestampDecorations(
              editorRef.current,
              timestampDecoratorState,
            );
          }

          // 统一初始化Base64装饰器 - 先设置状态再更新
          if (base64DecoratorsEnabled) {
            // 确保全局状态与本地状态同步
            setBase64ProviderEnabled(base64DecoratorsEnabled);
            setBase64DecorationEnabled(base64DecoratorsEnabled);
            updateBase64Decorations(editorRef.current, base64DecoratorState);
          }

          // 统一初始化Unicode装饰器 - 先设置状态再更新
          if (unicodeDecoratorsEnabled) {
            // 确保全局状态与本地状态同步
            setUnicodeProviderEnabled(unicodeDecoratorsEnabled);
            setUnicodeDecorationEnabled(unicodeDecoratorsEnabled);
            updateUnicodeDecorations(editorRef.current, unicodeDecoratorState);
          }

          // 统一初始化URL装饰器 - 先设置状态再更新
          if (urlDecoratorsEnabled) {
            // 确保全局状态与本地状态同步
            setUrlProviderEnabled(urlDecoratorsEnabled);
            setUrlDecorationEnabled(urlDecoratorsEnabled);
            updateUrlDecorations(editorRef.current, urlDecoratorState);
          }

          // 初始化图片装饰器 - 图片装饰器对行数没有严格要求
          if (imageDecoratorsEnabled) {
            // 确保全局状态与本地状态同步
            setImageDecorationEnabled(imageDecoratorsEnabled);
            updateImageDecorations(editorRef.current, imageDecoratorState);
          }
        };

        // utools 加载慢，延迟初始化
        setTimeout(() => {
          if (!hasInitializedDecorations) {
            initializeDecorations();

            return;
          }
        }, 1000);
      }
    }, 0);

    return () => {
      clearTimeout(timeoutId);
      // 清理过滤编辑器
      if (filterEditorRef.current) {
        filterEditorRef.current.dispose();
        filterEditorRef.current = null;
      }
      // 清理防抖计时器
      if (filterUpdateTimeoutRef.current) {
        clearTimeout(filterUpdateTimeoutRef.current);
      }
    };
  }, []); // 空依赖数组表示这个效果只在组件挂载和卸载时运行

  // 同步设置到store
  useEffect(() => {
    updateEditorSettings(tabKey, {
      fontSize: fontSize,
      language: currentLanguage,
      indentSize: indentSize,
      timestampDecoratorsEnabled: timestampDecoratorsEnabled,
    });
  }, [
    fontSize,
    currentLanguage,
    indentSize,
    timestampDecoratorsEnabled,
    tabKey,
    updateEditorSettings,
  ]);

  // 添加对全局状态变化的监听，并更新相关函数调用

  // 使用useSettingsStore的state更新
  useEffect(() => {
    // 同步全局状态到本地状态
    setBase64DecoratorsEnabled(base64DecoderEnabled);
    // 更新装饰器状态
    if (editorRef.current) {
      setBase64DecorationEnabled(base64DecoderEnabled);
      setBase64ProviderEnabled(base64DecoderEnabled);
      // 检查行数，小于3行时不更新装饰器
      const lineCount = getEditorLineCount();

      if (lineCount >= 3) {
        // 更新装饰
        updateBase64Decorations(editorRef.current, base64DecoratorState);
      }
    }
  }, [base64DecoderEnabled]);

  useEffect(() => {
    // 同步全局状态到本地状态
    setUnicodeDecoratorsEnabled(unicodeDecoderEnabled);
    // 更新装饰器状态
    if (editorRef.current) {
      setUnicodeDecorationEnabled(unicodeDecoderEnabled);
      setUnicodeProviderEnabled(unicodeDecoderEnabled);
      // 检查行数，小于3行时不更新装饰器
      const lineCount = getEditorLineCount();

      if (lineCount >= 3) {
        // 更新装饰
        updateUnicodeDecorations(editorRef.current, unicodeDecoratorState);
      }
    }
  }, [unicodeDecoderEnabled]);

  useEffect(() => {
    // 同步全局状态到本地状态
    setUrlDecoratorsEnabled(urlDecoderEnabled);
    // 更新装饰器状态
    if (editorRef.current) {
      setUrlDecorationEnabled(urlDecoderEnabled);
      setUrlProviderEnabled(urlDecoderEnabled);
      // 检查行数，小于3行时不更新装饰器
      const lineCount = getEditorLineCount();

      if (lineCount >= 3) {
        // 更新装饰
        updateUrlDecorations(editorRef.current, urlDecoratorState);
      }
    }
  }, [urlDecoderEnabled]);

  // 图片装饰器清理useEffect
  useEffect(() => {
    return () => {
      // 组件卸载时清理图片装饰器缓存
      if (imageDecorationManagerRef.current && editorRef.current) {
        clearImageCache(imageDecoratorState);
      }
    };
  }, [imageDecoratorState]);

  return (
    <div
      ref={rootContainerRef}
      className="flex flex-col relative w-full h-full"
      style={{ height }}
    >
      <AIPromptOverlay
        isOpen={showAiPrompt}
        placeholderText="输入您的问题..."
        prompt={aiPrompt}
        quickPrompts={finalQuickPrompts}
        onClose={() => setShowAiPrompt(false)}
        onPromptChange={setAiPrompt}
        onSubmit={handleAiSubmit}
      />

      <div
        className={cn(
          "w-full h-full overflow-hidden",
          showAiResponse || showFilterEditor ? "flex flex-row" : "",
        )}
        style={{ height: getEditorHeight() }}
      >
        {showAiResponse ? (
          <>
            {/* 左侧编辑器区域 */}
            <div
              className="h-full overflow-hidden border-r border-default-200 dark:border-default-100/20 monaco-editor-container"
              style={{ width: `calc(60% - ${aiPanelWidth}px)` }}
            >
              <div ref={containerRef} className="h-full w-full" />
            </div>

            {/* 拖动条 */}
            <div
              className="w-2 h-full cursor-ew-resize bg-gradient-to-b from-blue-50/80 via-indigo-50/80 to-blue-50/80 dark:from-neutral-900/80 dark:via-neutral-800/80 dark:to-neutral-900/80 dark:border-neutral-800 backdrop-blur-sm flex items-center justify-center"
              role="button"
              style={{ touchAction: "none" }}
              tabIndex={-1}
              onMouseDown={handleDragStart}
            >
              <div className="h-24 w-1 bg-gray-300 dark:bg-gray-600 rounded-full" />
            </div>

            {/* 右侧AI响应区域 */}
            <div
              className="h-full overflow-hidden flex flex-col bg-white/95 dark:bg-neutral-900/95 ai-panel"
              style={{ width: `calc(40% + ${aiPanelWidth}px)` }}
            >
              {/* AI标题栏 */}
              <AIResultHeader onClose={handleCloseAiResponse} />

              {/* AI面板 */}
              <div className="flex-1 h-full overflow-hidden">
                <PromptContainer
                  ref={promptContainerRef}
                  className="h-full"
                  editorContent={currentEditorValue}
                  initialMessages={aiMessages}
                  showAttachButtons={false}
                  useDirectApi={true}
                  onApplyCode={handleApplyCode}
                />
              </div>
            </div>
          </>
        ) : showFilterEditor ? (
          <>
            {/* jsonQuery 过滤模式 - 双编辑器布局 */}
            <div
              className="h-full overflow-hidden border-r border-default-200 dark:border-default-100/20 monaco-editor-container"
              style={{ width: `${filterLeftWidth}%` }}
            >
              <div ref={containerRef} className="h-full w-full" />
            </div>

            {/* jsonQuery 过滤器拖动条 */}
            <div
              className="w-2 h-full cursor-ew-resize bg-gradient-to-b from-indigo-50/80 via-emerald-50/80 to-indigo-50/80 dark:from-neutral-900/80 dark:via-neutral-800/80 dark:to-neutral-900/80 dark:border-neutral-800 backdrop-blur-sm flex items-center justify-center"
              role="button"
              style={{ touchAction: "none" }}
              tabIndex={-1}
              onMouseDown={handleFilterDragStart}
            >
              <div className="h-24 w-1 bg-indigo-400 dark:bg-indigo-600 rounded-full" />
            </div>

            {/* 右侧过滤结果编辑器 */}
            <div
              className="h-full overflow-hidden flex flex-col bg-white/95 dark:bg-neutral-900/95 filter-result-panel"
              style={{ width: `${100 - filterLeftWidth}%` }}
            >
              {/* 过滤结果标题栏 */}
              <div className="px-4 py-2 border-b border-default-200 dark:border-default-100/20 bg-indigo-50 dark:bg-indigo-900/20 flex items-center justify-between">
                <div className="flex items-center space-x-2">
                  <Icon
                    className="text-indigo-600 dark:text-indigo-400"
                    icon="mdi:filter"
                    width={16}
                  />
                  <span className="text-sm font-medium text-indigo-700 dark:text-indigo-300">
                    过滤结果
                  </span>
                  {jsonQueryFilter && (
                    <span className="text-xs text-gray-500 dark:text-gray-400">
                      ({jsonQueryFilter})
                    </span>
                  )}
                </div>
                <Button
                  color="default"
                  size="sm"
                  startContent={<Icon icon="mdi:close" width={16} />}
                  variant="light"
                  onPress={() => {
                    setShowFilterEditor(false);
                    setJsonQueryFilter("");
                    setFilteredValue("");
                  }}
                >
                  关闭
                </Button>
              </div>

              {/* 过滤结果编辑器 */}
              <div className="flex-1 h-full overflow-hidden">
                <div
                  ref={(el) => {
                    if (el && !filterEditorRef.current) {
                      filterEditorRef.current = monaco.editor.create(el, {
                        value: filteredValue,
                        language: "json",
                        minimap: { enabled: false },
                        fontSize: fontSize,
                        theme: theme || "vs-light",
                        readOnly: true,
                        scrollBeyondLastLine: false,
                        wordWrap: "on",
                        automaticLayout: true,
                      });
                    } else if (!el && filterEditorRef.current) {
                      filterEditorRef.current.dispose();
                      filterEditorRef.current = null;
                    }
                  }}
                  className="h-full w-full"
                />
              </div>
            </div>
          </>
        ) : (
          // 普通模式：只显示一个编辑器
          <div ref={containerRef} className="w-full h-full" />
        )}
      </div>

      {/* jsonQuery 过滤输入框 */}
      {showJsonQueryFilter && (
        <div className="pl-3 pr-0.5 border-t  border-default-200 dark:border-default-100/20 flex items-center">
          <div className="flex items-center space-x-2 flex-1">
            <Icon className="text-indigo-500" icon="mdi:filter" width={16} />
            <Input
              className="flex-1"
              endContent={
                <div className="flex items-center space-x-1">
                  <JsonQueryHelp />
                  {jsonQueryFilter && (
                    <Button
                      isIconOnly
                      className="min-w-6 w-6 h-6 text-indigo-500"
                      size="sm"
                      variant="light"
                      onPress={() => {
                        setJsonQueryFilter("");
                        setShowFilterEditor(false);
                        setFilteredValue("");
                      }}
                    >
                      <Icon icon="mdi:close" width={14} />
                    </Button>
                  )}
                </div>
              }
              placeholder="JsonQuery 表达式 例如: .posts | filter(.id == 102)"
              radius="none"
              size="sm"
              value={jsonQueryFilter}
              onChange={(e) => handleJsonQueryChange(e.target.value)}
            />
          </div>
          {filterError && (
            <div className="text-red-500 text-xs flex items-center space-x-1">
              <Icon icon="mdi:alert-circle" width={14} />
              <span>{filterError}</span>
            </div>
          )}
        </div>
      )}

      {/* 可拖动悬浮菜单 */}
      {isMenu && isEditorReady && (
        <DraggableMenu
          containerRef={rootContainerRef}
          currentFontSize={fontSize}
          currentIndentSize={indentSize}
          currentLanguage={currentLanguage}
          tabKey={tabKey}
          timestampDecoratorsEnabled={timestampDecoratorsEnabled}
          onFontSizeChange={setFontSize}
          onIndentSizeChange={setIndentSize}
          onLanguageChange={handleLanguageChange}
          onReset={handleReset}
          onTimestampDecoratorsChange={(enabled) => {
            setTimestampDecoratorsEnabled(enabled);
            if (editorRef.current) {
              toggleTimestampDecorators(
                editorRef.current,
                timestampDecoratorState,
                enabled,
              );
            }
          }}
        />
      )}

      {parseJsonError && (
        <div
          className="flex justify-between items-center px-3 text-white text-base transition-all duration-300 shadow-lg"
          style={{
            height: errorBottomHeight,
            backgroundColor: "#ED5241",
            overflow: "hidden",
          }}
        >
          <div className="flex items-center space-x-3">
            <Icon icon="fluent:warning-28-filled" width={24} />
            <p className="">
              第 {parseJsonError?.line || 0} 行，第{" "}
              {parseJsonError?.column || 0} 列错误， {parseJsonError?.message}
            </p>
          </div>
          <div className={"flex items-center space-x-2"}>
            <Button
              className="bg-white/20"
              color="primary"
              size="sm"
              startContent={<Icon icon="hugeicons:view" width={16} />}
              onPress={openJsonErrorDetailsModel}
            >
              查看详情
            </Button>
            <Button
              className="bg-white/20"
              color="primary"
              size="sm"
              startContent={<Icon icon="mynaui:tool" width={16} />}
              onPress={autoFix}
            >
              自动修复
            </Button>
            <Button
              className="bg-white/20"
              color="primary"
              size="sm"
              startContent={<Icon icon="mingcute:location-line" width={16} />}
              onPress={goToErrorLine}
            >
              一键定位
            </Button>
          </div>
        </div>
      )}
      <ErrorModal
        isOpen={jsonErrorDetailsModel}
        parseJsonError={parseJsonError}
        onAutoFix={autoFix}
        onClose={closeJsonErrorDetailsModel}
        onGotoErrorLine={goToErrorLine}
      />
    </div>
  );
};

MonacoJsonEditor.displayName = "MonacoJsonEditor";

export default MonacoJsonEditor;
