import React, {
  useCallback,
  useRef,
  useState,
  useEffect,
  useImperativeHandle,
} from "react";
import { Icon } from "@iconify/react";

import JsonTableOperationBar, {
  JsonTableOperationBarRef,
} from "@/components/jsonTable/JsonTableOperationBar.tsx";
import JsonTable from "@/components/jsonTable/JsonTable.tsx";
import toast from "@/utils/toast";
import clipboard from "@/utils/clipboard";
import { useSidebarStore } from "@/store/useSidebarStore";
import { SidebarKeys } from "@/components/sidebar/Items.tsx";
import { parseJson, stringifyJson } from "@/utils/json";

export interface JsonTableViewRef {
  focus: () => void;
  layout: () => void;
  getSelectedNode: () => any;
  getSelectedPath: () => string | null;
  exportAsCSV: () => string | null;
  exportAsExcel: () => ArrayBuffer | null;
}

interface JsonTableViewProps {
  data: string;
  onCopy: (type?: "default" | "node" | "path") => boolean;
  onDataUpdate?: (data: string) => void;
  onMount?: () => void;
  ref?: React.Ref<JsonTableViewRef>;
}

const JsonTableView: React.FC<JsonTableViewProps> = ({
  data,
  onCopy,
  onDataUpdate,
  onMount,
  ref,
}) => {
  const operationBarRef = useRef<JsonTableOperationBarRef>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set());
  const [hideEmpty, setHideEmpty] = useState(false);
  const [hideNull, setHideNull] = useState(false);
  const [jsonData, setJsonData] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPasting, setIsPasting] = useState(false);
  const [isSwitchingEditor, setIsSwitchingEditor] = useState(false);
  const [lastValidJsonData, setLastValidJsonData] = useState<any>(null);
  const [previousRenderedView, setPreviousRenderedView] =
    useState<React.ReactNode | null>(null);
  const sidebarStore = useSidebarStore();
  const [shouldShowEmpty, setShouldShowEmpty] = useState(false);
  const emptyStateTimerRef = useRef<NodeJS.Timeout | null>(null);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);

  useEffect(() => {
    const handlePasteAction = async () => {
      try {
        setIsPasting(true);
        if (emptyStateTimerRef.current) {
          clearTimeout(emptyStateTimerRef.current);
          emptyStateTimerRef.current = null;
        }
        setShouldShowEmpty(false);

        let text;

        if (clipboard.isSupported()) {
          text = await navigator.clipboard.readText();
        } else {
          text = await clipboard.read(
            "无法读取剪贴板内容, 请从文本编辑器中粘贴。",
          );
        }

        if (!text) {
          setIsPasting(false);
          emptyStateTimerRef.current = setTimeout(() => {
            setShouldShowEmpty(true);
          }, 500);

          return;
        }

        // 尝试解析JSON
        try {
          parseJson(text);

          // 解析成功，更新数据
          if (onDataUpdate) {
            onDataUpdate(text);
            setError(null);
            toast.success("JSON数据已成功粘贴！");
          }
        } catch (parseErr) {
          // 解析失败，设置错误状态
          setError((parseErr as Error).message || "JSON解析错误");
          setJsonData(null);
          setShouldShowEmpty(false);
          toast.error(`无效的JSON数据：${(parseErr as Error).message}`);

          // 如果有onDataUpdate回调，也可以选择更新数据（取决于应用需求）
          if (onDataUpdate) {
            onDataUpdate(text);
          }
        }
      } catch (err) {
        toast.error(`粘贴操作失败：${(err as Error).message}`);
      } finally {
        setIsPasting(false);
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "v") {
        if (!clipboard.isSupported()) {
          e.preventDefault();
        }
        handlePasteAction();
      }
    };

    (window as any).__jsonTablePasteHandler = handlePasteAction;

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      delete (window as any).__jsonTablePasteHandler;
    };
  }, [onDataUpdate]);

  React.useEffect(() => {
    if (emptyStateTimerRef.current) {
      clearTimeout(emptyStateTimerRef.current);
      emptyStateTimerRef.current = null;
    }

    if (!data || data.trim() === "") {
      setJsonData(null);
      if (!isSwitchingEditor) {
        setError(null);
        emptyStateTimerRef.current = setTimeout(() => {
          setShouldShowEmpty(true);
        }, 300);
      }

      return;
    }

    try {
      const parsed = parseJson(data);

      setJsonData(parsed);
      setLastValidJsonData(parsed);
      setError(null);
      setShouldShowEmpty(false);
    } catch (err) {
      setJsonData(null);
      if (!isSwitchingEditor) {
        setError((err as Error).message || "JSON解析错误");
        setShouldShowEmpty(false);
      }
    }
  }, [data, isSwitchingEditor]);

  const handleToggleExpand = useCallback((path: string) => {
    setExpandedPaths((prev) => {
      const next = new Set(prev);

      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }

      return next;
    });
  }, []);

  const handlePaste = useCallback(() => {
    const pasteHandler = (window as any).__jsonTablePasteHandler;

    if (pasteHandler) {
      pasteHandler();
    } else {
      const vEvent = new KeyboardEvent("keydown", {
        key: "v",
        ctrlKey: true,
        bubbles: true,
      });

      window.dispatchEvent(vEvent);
    }
  }, []);

  const handleExpandAll = useCallback(() => {
    if (!jsonData) return;

    const paths = new Set<string>();
    const traverse = (obj: any, path: string = "root") => {
      if (typeof obj === "object" && obj !== null) {
        paths.add(path);
        if (Array.isArray(obj)) {
          obj.forEach((item, index) => {
            traverse(item, `${path}[${index}]`);
          });
        } else {
          Object.entries(obj).forEach(([key, value]) => {
            traverse(value, `${path}.${key}`);
          });
        }
      }
    };

    traverse(jsonData);
    setExpandedPaths(paths);
  }, [jsonData]);

  const handleCollapseAll = useCallback(() => {
    setExpandedPaths(new Set());
  }, []);

  const handleCustomView = useCallback(
    (key: "hideEmpty" | "hideNull" | "showAll") => {
      switch (key) {
        case "hideEmpty":
          setHideEmpty(true);
          setHideNull(false);
          break;
        case "hideNull":
          setHideEmpty(false);
          setHideNull(true);
          break;
        case "showAll":
          setHideEmpty(false);
          setHideNull(false);
          break;
      }
    },
    [],
  );

  const handleSwitchToTextEditor = useCallback(() => {
    if (jsonData) {
      setPreviousRenderedView(
        <JsonTable
          data={jsonData}
          expandedPaths={expandedPaths}
          hideEmpty={hideEmpty}
          hideNull={hideNull}
          onCollapseAll={handleCollapseAll}
          onExpandAll={handleExpandAll}
          onToggleExpand={handleToggleExpand}
        />,
      );
    } else if (error) {
      setPreviousRenderedView(renderErrorState());
    }

    if (emptyStateTimerRef.current) {
      clearTimeout(emptyStateTimerRef.current);
      emptyStateTimerRef.current = null;
    }
    setShouldShowEmpty(false);

    setIsSwitchingEditor(true);

    setTimeout(() => {
      sidebarStore.updateClickSwitchKey(SidebarKeys.textView);
    }, 50);
  }, [sidebarStore, jsonData, error, expandedPaths, hideEmpty, hideNull]);

  const renderEmptyState = () => {
    return (
      <div className="h-full flex flex-col items-center justify-center bg-gradient-to-br from-transparent via-blue-50/30 to-indigo-50/30 dark:from-transparent dark:via-blue-900/10 dark:to-indigo-900/10">
        <div className="relative max-w-2xl w-full mx-auto px-8 py-12">
          <div className="absolute inset-0 -z-10 overflow-hidden">
            <div className="absolute -top-40 -left-20 w-96 h-96 bg-blue-100/50 dark:bg-blue-900/20 rounded-full blur-3xl" />
            <div className="absolute -bottom-40 -right-20 w-96 h-96 bg-indigo-100/50 dark:bg-indigo-900/20 rounded-full blur-3xl" />
          </div>

          <div className="bg-white/80 dark:bg-neutral-900/30 backdrop-blur-sm rounded-2xl shadow-xl border border-gray-100 dark:border-gray-700 p-8 transform transition-all duration-300 hover:shadow-2xl hover:-translate-y-1">
            <div className="json-empty-float mx-auto mb-8 w-32 h-32 relative">
              <div className="absolute inset-0 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-xl opacity-10 dark:opacity-20 blur-xl" />
              <div className="relative flex items-center justify-center w-full h-full">
                <Icon
                  className="w-20 h-20 text-primary/90 drop-shadow-md"
                  icon="mdi:file-document-outline"
                />
              </div>
            </div>

            <h3 className="text-2xl font-bold mb-4 text-center bg-gradient-to-r from-blue-600 to-indigo-600 dark:from-blue-400 dark:to-indigo-400 bg-clip-text text-transparent">
              欢迎使用JSON表格视图
            </h3>

            <div className="space-y-4 mb-8">
              <p className="text-gray-600 dark:text-gray-300 text-center leading-relaxed">
                开始使用前，请粘贴您的JSON数据或按下快捷键导入内容。
              </p>

              <div className="flex items-center justify-center gap-2 px-4 py-2 bg-gray-50 dark:bg-gray-700/50 rounded-lg">
                <kbd className="px-2 py-1 bg-white dark:bg-gray-800 rounded-md border border-gray-200 dark:border-gray-600 font-mono text-xs text-gray-600 dark:text-gray-300 shadow-sm">
                  Ctrl
                </kbd>
                <span className="text-gray-400">+</span>
                <kbd className="px-2 py-1 bg-white dark:bg-gray-800 rounded-md border border-gray-200 dark:border-gray-600 font-mono text-xs text-gray-600 dark:text-gray-300 shadow-sm">
                  V
                </kbd>
                <span className="ml-2 text-gray-500 dark:text-gray-400 text-sm">
                  快速粘贴
                </span>
              </div>
            </div>

            <div className="flex flex-col gap-4 sm:flex-row sm:justify-center">
              <button
                className="group relative px-6 py-3 bg-gradient-to-r from-blue-500 to-indigo-600 text-white rounded-xl hover:from-blue-600 hover:to-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 focus:ring-offset-white dark:focus:ring-offset-gray-800 shadow-md hover:shadow-lg disabled:opacity-70 transition-all duration-300"
                disabled={isPasting}
                onClick={handlePaste}
              >
                <span className="absolute inset-0 w-full h-full json-shimmer-effect rounded-xl" />

                <span className="relative flex items-center justify-center">
                  {isPasting ? (
                    <>
                      <Icon
                        className="-ml-1 mr-2 h-4 w-4 text-white"
                        icon="svg-spinners:ring-resize"
                      />
                      <span>处理中...</span>
                    </>
                  ) : (
                    <>
                      <Icon
                        className="w-5 h-5 mr-2 transition-transform group-hover:rotate-6"
                        icon="flowbite:clipboard-outline"
                      />
                      <span>从剪贴板粘贴</span>
                    </>
                  )}
                </span>
              </button>
            </div>

            <div className="mt-8 text-center">
              <p className="text-xs text-gray-500 dark:text-gray-400">
                支持标准JSON格式 &bull; 自动解析并显示为表格
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  };

  const renderErrorState = () => {
    return (
      <div className="h-full flex flex-col items-center justify-center bg-gradient-to-br from-transparent via-red-50/30 to-pink-50/30 dark:from-transparent dark:via-red-900/10 dark:to-pink-900/10">
        <div className="relative max-w-2xl w-full mx-auto px-8 py-12">
          <div className="absolute inset-0 -z-10 overflow-hidden">
            <div className="absolute -top-40 -left-20 w-96 h-96 bg-red-100/50 dark:bg-red-900/20 rounded-full blur-3xl" />
            <div className="absolute -bottom-40 -right-20 w-96 h-96 bg-pink-100/50 dark:bg-pink-900/20 rounded-full blur-3xl" />
          </div>

          <div className="bg-white/80 dark:bg-neutral-900/70 backdrop-blur-sm rounded-2xl shadow-xl border border-red-100 dark:border-red-900/30 p-8 transform transition-all duration-300">
            <div className="mx-auto mb-6 w-24 h-24 relative flex items-center justify-center">
              <div
                className="absolute inset-0 bg-red-500/10 dark:bg-red-500/20 rounded-full animate-ping opacity-70"
                style={{ animationDuration: "3s" }}
              />
              <Icon
                className="w-14 h-14 text-red-500 drop-shadow-md relative z-10"
                icon="mdi:alert-circle-outline"
              />
            </div>

            <h3 className="text-2xl font-bold mb-3 text-center text-red-600 dark:text-red-400">
              JSON解析失败
            </h3>

            <div className="space-y-4 mb-6">
              <div className="bg-red-50 dark:bg-red-900/20 border border-red-100 dark:border-red-800/30 rounded-lg p-4 overflow-auto max-h-32">
                <pre className="text-red-600 dark:text-red-400 text-sm whitespace-pre-wrap font-mono break-all">
                  {error}
                </pre>
              </div>

              <div className="bg-gray-50 dark:bg-gray-700/50 rounded-lg p-4">
                <h4 className="font-medium text-gray-700 dark:text-gray-300 text-sm mb-2">
                  常见错误检查：
                </h4>
                <ul className="text-gray-600 dark:text-gray-400 text-xs space-y-1 pl-4 list-disc">
                  <li>
                    确保所有括号{" "}
                    <code className="text-red-500">{"{ }, [ ]"}</code> 正确配对
                  </li>
                  <li>
                    检查键名是否使用双引号{" "}
                    <code className="text-red-500">{'"key": value'}</code>
                  </li>
                  <li>确保每个键值对之间使用逗号分隔</li>
                  <li>确认最后一个键值对后没有多余的逗号</li>
                </ul>
              </div>
            </div>

            <div className="flex flex-col gap-4 sm:flex-row sm:justify-between sm:items-center">
              <button
                className="group relative flex-1 px-4 py-2 bg-gradient-to-r from-red-500 to-pink-600 text-white rounded-lg hover:from-red-600 hover:to-pink-700 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2 shadow-md hover:shadow-lg transition-all duration-300 disabled:opacity-70 flex items-center justify-center"
                disabled={isPasting}
                onClick={handlePaste}
              >
                {isPasting ? (
                  <>
                    <Icon
                      className="-ml-1 mr-2 h-4 w-4 text-white"
                      icon="svg-spinners:ring-resize"
                    />
                    <span>处理中...</span>
                  </>
                ) : (
                  <>
                    <Icon className="w-4 h-4 mr-2" icon="mdi:clipboard-text" />
                    <span>尝试重新粘贴</span>
                  </>
                )}
              </button>

              <button
                className="flex-1 px-4 py-2 bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-200 border border-gray-200 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-600 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-gray-500 shadow-sm hover:shadow transition-all duration-300 flex items-center justify-center"
                onClick={handleSwitchToTextEditor}
              >
                <Icon
                  className="w-4 h-4 mr-2 text-blue-500"
                  icon="solar:home-2-linear"
                />
                <span>JSON 解析器查看</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  };

  useEffect(() => {
    const styleElement = document.createElement("style");

    styleElement.textContent = `
      .editor-fade-exit {
        opacity: 1;
        transition: opacity 200ms ease-out;
      }
      .editor-fade-exit-active {
        opacity: 0;
      }
    `;

    document.head.appendChild(styleElement);

    return () => {
      document.head.removeChild(styleElement);
    };
  }, []);

  useEffect(() => {
    return () => {
      setIsSwitchingEditor(false);
      if (emptyStateTimerRef.current) {
        clearTimeout(emptyStateTimerRef.current);
        emptyStateTimerRef.current = null;
      }
    };
  }, []);

  // 添加选择路径的处理函数
  const handlePathSelection = useCallback((path: string) => {
    setSelectedPath(path);
  }, []);

  const currentContent = React.useMemo(() => {
    if (isSwitchingEditor) {
      if (previousRenderedView) {
        return previousRenderedView;
      } else if (lastValidJsonData) {
        return (
          <JsonTable
            data={lastValidJsonData}
            expandedPaths={expandedPaths}
            hideEmpty={hideEmpty}
            hideNull={hideNull}
            onCollapseAll={handleCollapseAll}
            onExpandAll={handleExpandAll}
            onPathChange={handlePathSelection}
            onToggleExpand={handleToggleExpand}
          />
        );
      }

      return null;
    }

    if (error) {
      return renderErrorState();
    }

    if (!jsonData) {
      if (shouldShowEmpty) {
        return renderEmptyState();
      }

      return (
        <div className="h-full flex items-center justify-center bg-transparent">
          <div className="w-10 h-10 text-primary/50">
            <Icon className="w-full h-full" icon="svg-spinners:ring-resize" />
          </div>
        </div>
      );
    }

    return (
      <JsonTable
        data={jsonData}
        expandedPaths={expandedPaths}
        hideEmpty={hideEmpty}
        hideNull={hideNull}
        onCollapseAll={handleCollapseAll}
        onExpandAll={handleExpandAll}
        onPathChange={handlePathSelection}
        onToggleExpand={handleToggleExpand}
      />
    );
  }, [
    jsonData,
    error,
    isSwitchingEditor,
    previousRenderedView,
    lastValidJsonData,
    expandedPaths,
    hideEmpty,
    hideNull,
    shouldShowEmpty,
    handleCollapseAll,
    handleExpandAll,
    handleToggleExpand,
    handlePathSelection,
  ]);

  // 获取选中路径的节点数据
  const getNodeAtPath = useCallback((path: string | null, data: any): any => {
    if (!path || !data) return null;

    try {
      // 处理根路径
      if (path === "root") {
        return data;
      }

      // 移除根路径前缀
      const cleanPath = path.startsWith("root") ? path.substring(4) : path;

      // 解析路径并获取节点
      const parts = cleanPath.split(/\.|\[|\]/).filter(Boolean);
      let current = data;

      for (const part of parts) {
        if (!current) return null;

        // 处理数组索引或对象键
        if (!isNaN(Number(part))) {
          // 数组索引
          current = current[Number(part)];
        } else {
          // 对象键
          current = current[part];
        }
      }

      return current;
    } catch (error) {
      console.error("获取节点数据失败:", error);

      return null;
    }
  }, []);

  // 将JSON数据转换为CSV格式
  const convertToCSV = useCallback(
    (jsonData: any): string | null => {
      if (!jsonData) return null;

      try {
        // 如果选择了特定节点，则只导出该节点
        let dataToExport = jsonData;

        if (selectedPath && selectedPath !== "root") {
          const selectedData = getNodeAtPath(selectedPath, jsonData);

          if (selectedData) {
            dataToExport = selectedData;
            // 在CSV第一行添加路径信息
            const pathInfo = `# 选中路径: ${selectedPath}`;

            // 处理选中的单个基本类型值
            if (typeof selectedData !== "object" || selectedData === null) {
              return `${pathInfo}\n${String(selectedData)}`;
            }
          }
        }

        // 处理对象数组
        if (
          Array.isArray(dataToExport) &&
          dataToExport.length > 0 &&
          typeof dataToExport[0] === "object"
        ) {
          // 获取所有可能的列
          const allKeys = new Set<string>();

          dataToExport.forEach((item) => {
            if (item && typeof item === "object") {
              Object.keys(item).forEach((key) => allKeys.add(key));
            }
          });

          // 创建标题行
          const headers = Array.from(allKeys);
          const csvRows = [headers.join(",")];

          // 创建数据行
          dataToExport.forEach((item) => {
            const row = headers.map((header) => {
              const value = item[header];

              // 处理不同类型的值，确保CSV格式正确
              if (value === null || value === undefined) return "";
              if (typeof value === "object")
                return stringifyJson(value)
                  .replace(/,/g, ";")
                  .replace(/"/g, '""');
              if (typeof value === "string")
                return `"${value.replace(/"/g, '""')}"`;

              return value;
            });

            csvRows.push(row.join(","));
          });

          return csvRows.join("\n");
        }

        // 处理简单对象
        if (typeof dataToExport === "object" && !Array.isArray(dataToExport)) {
          const headers = Object.keys(dataToExport);
          const values = Object.values(dataToExport).map((value) => {
            if (value === null || value === undefined) return "";
            if (typeof value === "object")
              return stringifyJson(value)
                .replace(/,/g, ";")
                .replace(/"/g, '""');
            if (typeof value === "string")
              return `"${value.replace(/"/g, '""')}"`;

            return value;
          });

          return [headers.join(","), values.join(",")].join("\n");
        }

        // 处理简单数组
        if (Array.isArray(dataToExport)) {
          const values = dataToExport.map((value) => {
            if (value === null || value === undefined) return "";
            if (typeof value === "object")
              return stringifyJson(value)
                .replace(/,/g, ";")
                .replace(/"/g, '""');
            if (typeof value === "string")
              return `"${value.replace(/"/g, '""')}"`;

            return value;
          });

          return values.join("\n");
        }

        // 处理简单值
        return String(dataToExport);
      } catch (error) {
        console.error("转换CSV失败:", error);
        toast.error("转换CSV失败：" + (error as Error).message);

        return null;
      }
    },
    [jsonData, selectedPath, getNodeAtPath],
  );

  // 将JSON数据转换为Excel二进制格式
  const convertToExcel = useCallback(
    (jsonData: any): ArrayBuffer | null => {
      // 由于实际生成Excel需要依赖第三方库如xlsx，
      // 这里使用一个简化的实现方式
      try {
        const csv = convertToCSV(jsonData);

        if (!csv) return null;

        // 简单将CSV转为ArrayBuffer，在实际应用中应使用专门的Excel库
        const encoder = new TextEncoder();

        return encoder.encode(csv).buffer;
      } catch (error) {
        console.error("转换Excel失败:", error);
        toast.error("转换Excel失败：" + (error as Error).message);

        return null;
      }
    },
    [convertToCSV],
  );

  useImperativeHandle(ref, () => ({
    focus: () => {
      if (containerRef.current) {
        containerRef.current.focus();
      }
    },
    layout: () => {
      // 表格视图的布局刷新，可以根据需要实现
      // 例如，可能需要重新计算容器尺寸等
    },
    getSelectedNode: () => {
      // 获取选中节点的数据
      return getNodeAtPath(selectedPath, jsonData);
    },
    getSelectedPath: () => {
      // 返回当前选中的路径
      return selectedPath;
    },
    exportAsCSV: () => {
      // 导出为CSV
      return convertToCSV(jsonData);
    },
    exportAsExcel: () => {
      // 导出为Excel格式
      return convertToExcel(jsonData);
    },
  }));

  useEffect(() => {
    if (onMount) {
      onMount();
    }
  }, []);

  // 添加清空JSON数据的方法
  const handleClear = useCallback(() => {
    if (jsonData || error) {
      setJsonData(null);
      setError(null);
      if (onDataUpdate) {
        onDataUpdate("");
      }
      toast.success("JSON数据已清空");
      setShouldShowEmpty(true);

      return true;
    }

    return false;
  }, [jsonData, error, onDataUpdate]);

  return (
    <div
      ref={containerRef}
      className={`h-full flex flex-col ${isSwitchingEditor ? "editor-fade-exit editor-fade-exit-active" : ""}`}
    >
      <JsonTableOperationBar
        ref={operationBarRef}
        onClear={handleClear}
        onCollapse={handleCollapseAll}
        onCopy={onCopy}
        onCustomView={handleCustomView}
        onExpand={handleExpandAll}
      />
      <div className="flex-grow overflow-hidden border border-default-200 bg-white dark:bg-vscode-dark">
        {currentContent}
      </div>
    </div>
  );
};

JsonTableView.displayName = "JsonTableView";

export default JsonTableView;
