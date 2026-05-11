import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { cn } from "@heroui/react";
import { useTheme } from "next-themes";
import { Content } from "vanilla-jsoneditor-cn";

import { useTabStore } from "@/store/useTabStore";
import DynamicTabs, {
  DynamicTabsRef,
} from "@/components/dynamicTabs/DynamicTabs.tsx";
import MonacoJsonEditor, {
  MonacoJsonEditorRef,
} from "@/components/monacoEditor/MonacoJsonEditor.tsx";
import { useSidebarStore } from "@/store/useSidebarStore";
import { useSettingsStore } from "@/store/useSettingsStore";
// eslint-disable-next-line import/order
import VanillaJsonEditor, {
  VanillaJsonEditorRef,
} from "@/components/vanillaJsonEditor/VanillaJsonEditor.tsx";

import "vanilla-jsoneditor-cn/themes/jse-theme-dark.css";
import MonacoDiffEditor, {
  MonacoDiffEditorRef,
} from "@/components/monacoEditor/MonacoDiffEditor.tsx";
import MonacoDiffOperationBar, {
  MonacoDiffOperationBarRef,
} from "@/components/monacoEditor/operationBar/MonacoDiffOperationBar.tsx";
import MonacoOperationBar from "@/components/monacoEditor/operationBar/MonacoOperationBar.tsx";
import "@/styles/index.css";
import { SidebarKeys } from "@/components/sidebar/Items.tsx";
import JsonTableView, {
  JsonTableViewRef,
} from "@/components/jsonTable/JsonTableView.tsx";
import clipboard from "@/utils/clipboard";
import toast from "@/utils/toast";
import { stringifyJson } from "@/utils/json";
import UtoolsListener from "@/services/utoolsListener";

export default function IndexPage() {
  const { theme } = useTheme();
  const monacoJsonEditorRefs = useRef<Record<string, MonacoJsonEditorRef>>({});
  const monacoDiffEditorRefs = useRef<Record<string, MonacoDiffEditorRef>>({});
  const vanillaJsonEditorRefs = useRef<Record<string, VanillaJsonEditorRef>>(
    {},
  );
  // 添加JsonTableView的引用
  const jsonTableViewRefs = useRef<Record<string, JsonTableViewRef>>({});

  const {
    tabs,
    activeTabKey,
    activeTab,
    getTabByKey,
    setTabContent,
    setTabModifiedValue,
    syncTabStore,
    setTabVanillaContent,
    setTabVanillaMode,
    vanilla2JsonContent,
    setMonacoVersion,
    setVanillaVersion,
    jsonContent2VanillaContent,
  } = useTabStore();

  const sidebarStore = useSidebarStore();
  const tabRef = useRef<DynamicTabsRef>(null);
  const monacoDiffOperationBarRef = useRef<MonacoDiffOperationBarRef>(null);

  const monacoUpdateContentTimeoutId = useRef<Record<string, NodeJS.Timeout>>(
    {},
  );
  const vanillaUpdateContentTimeoutId = useRef<Record<string, NodeJS.Timeout>>(
    {},
  );

  // 使用Map来分别存储每种编辑器类型的加载状态
  const [loadedEditors, setLoadedEditors] = useState<{
    monaco: Set<string>;
    diff: Set<string>;
    vanilla: Set<string>;
    table: Set<string>; // 将table从可选改为必需
  }>({
    monaco: new Set(),
    diff: new Set(),
    vanilla: new Set(),
    table: new Set(), // 初始化table集合
  });

  const closeTabHandle = (keys: string[]) => {
    if (keys.length === 0) {
      return;
    }
    // 删除 monacoJsonEditorRefs 中对象
    keys.forEach((key) => {
      delete monacoJsonEditorRefs.current[key];
      delete monacoDiffEditorRefs.current[key];
      delete vanillaJsonEditorRefs.current[key];
      delete jsonTableViewRefs.current[key]; // 添加删除JsonTableView引用
    });

    // 删除 loadedEditors 中对象
    setLoadedEditors((prev) => ({
      ...prev,
      monaco: new Set([...prev.monaco].filter((key) => !keys.includes(key))),
      diff: new Set([...prev.diff].filter((key) => !keys.includes(key))),
      vanilla: new Set([...prev.vanilla].filter((key) => !keys.includes(key))),
      table: new Set([...prev.table].filter((key) => !keys.includes(key))), // 添加处理table集合
    }));
  };

  // MonacoJsonEditor 更新内容后同步
  const monacoEditorUpdateContent = (key: string, content: string) => {
    clearTimeout(monacoUpdateContentTimeoutId.current[key]);
    monacoUpdateContentTimeoutId.current[key] = setTimeout(() => {
      setTabContent(key, content);
    }, 200);
  };

  // VanillaJsonEditor 更新内容后同步
  const vanillaEditorUpdateContent = (key: string, content: Content) => {
    clearTimeout(vanillaUpdateContentTimeoutId.current[key]);
    vanillaUpdateContentTimeoutId.current[key] = setTimeout(() => {
      setTabVanillaContent(key, content);
    }, 200);
  };

  const [editorLoading, setEditorLoading] = useState<{
    [key: string]: boolean;
  }>({});

  const renderMonacoJsonEditor = () => {
    return (
      <>
        <MonacoOperationBar
          onAiClick={() => {
            return monacoJsonEditorRefs.current[activeTabKey].showAiPrompt();
          }}
          onClear={() => {
            return monacoJsonEditorRefs.current[activeTabKey].clear();
          }}
          onCopy={() => {
            return monacoJsonEditorRefs.current[activeTabKey].copy();
          }}
          onCompress={() => {
            return monacoJsonEditorRefs.current[activeTabKey].compress();
          }}
          onEscape={() => {
            return monacoJsonEditorRefs.current[activeTabKey].escape();
          }}
          onFieldSort={(type) => {
            return monacoJsonEditorRefs.current[activeTabKey].fieldSort(type);
          }}
          onFormat={() => {
            return monacoJsonEditorRefs.current[activeTabKey].format();
          }}
          onMore={(key) => {
            return monacoJsonEditorRefs.current[activeTabKey].moreAction(key);
          }}
          onSaveFile={() => {
            return monacoJsonEditorRefs.current[activeTabKey].saveFile();
          }}
        />
        <div className="editor-container flex-grow overflow-hidden">
          {tabs.map((tab) => {
            // 如果已加载过该 tab，或者该 tab 恰好为当前激活 tab，则渲染
            const shouldRender = loadedEditors.monaco.has(tab.key);
            const isVisible = tab.key === activeTabKey;

            // 如果当前 tab 未加载且正是 activeTab，则将其加入 loaded 集合
            if (!shouldRender && isVisible) {
              setLoadedEditors((prev) => ({
                ...prev,
                monaco: new Set([...prev.monaco, tab.key]),
              }));
            }

            // 保持一个包裹容器常驻 DOM
            // 如果 shouldRender 为 true 才真正挂载编辑器，否则空占位
            return (
              <div
                key={tab.key}
                className={cn(
                  "editor-wrapper w-full h-full",
                  "editor-transition",
                  isVisible && "visible",
                  !editorLoading[tab.key] && "loaded",
                )}
              >
                {shouldRender && (
                  <MonacoJsonEditor
                    key={tab.key}
                    ref={(ref) => {
                      if (ref) {
                        monacoJsonEditorRefs.current[tab.key] = ref;
                      }
                    }}
                    height="100%"
                    isMenu={true}
                    language={tab.editorSettings?.language || "json"}
                    minimap={true}
                    showAi={true}
                    showJsonQueryFilter={true}
                    tabKey={tab.key}
                    tabTitle={tab.title}
                    theme={theme === "dark" ? "vs-dark" : "vs-light"}
                    value={tab.content}
                    onMount={() => {
                      setEditorLoading((prev) => ({
                        ...prev,
                        [tab.key]: false,
                      }));
                    }}
                    onUpdateValue={(value) => {
                      monacoEditorUpdateContent(tab.key, value);
                    }}
                  />
                )}
              </div>
            );
          })}
        </div>
      </>
    );
  };

  // MonacoDiffEditor 渲染函数
  const renderMonacoDiffEditor = () => {
    return (
      <div className="w-full h-full flex flex-col">
        <MonacoDiffOperationBar
          ref={monacoDiffOperationBarRef}
          onAiClick={() => {
            monacoDiffEditorRefs.current[activeTabKey].showAiPrompt();
          }}
          onClear={(type) => {
            return monacoDiffEditorRefs.current[activeTabKey].clear(type);
          }}
          onCopy={(type) => {
            return monacoDiffEditorRefs.current[activeTabKey].copy(type);
          }}
          onFieldSort={(type, sort: "asc" | "desc") => {
            return monacoDiffEditorRefs.current[activeTabKey].fieldSort(
              type,
              sort,
            );
          }}
          onFormat={(type) => {
            return monacoDiffEditorRefs.current[activeTabKey].format(type);
          }}
        />
        <div className="editor-container flex-grow overflow-hidden">
          {tabs.map((tab) => {
            const shouldRender = loadedEditors.diff.has(tab.key);
            const isVisible = tab.key === activeTabKey;

            if (!shouldRender && isVisible) {
              setLoadedEditors((prev) => ({
                ...prev,
                diff: new Set([...prev.diff, tab.key]),
              }));
            }

            return (
              <div
                key={"diff" + tab.key}
                className={cn(
                  "editor-wrapper w-full h-full",
                  "editor-transition",
                  isVisible && "visible",
                  !editorLoading[tab.key] && "loaded",
                )}
              >
                {shouldRender && (
                  <MonacoDiffEditor
                    key={"diff" + tab.key}
                    ref={(ref) => {
                      if (ref) {
                        monacoDiffEditorRefs.current[tab.key] = ref;
                      }
                    }}
                    height="100%"
                    language={tab.editorSettings?.language || "json"}
                    modifiedValue={
                      tab.diffModifiedValue ? tab.diffModifiedValue : ""
                    }
                    originalValue={tab.content}
                    tabKey={tab.key}
                    tabTitle={tab.title}
                    theme={theme === "dark" ? "vs-dark" : "vs-light"}
                    onMount={() => {
                      setEditorLoading((prev) => ({
                        ...prev,
                        [tab.key]: false,
                      }));
                    }}
                    onUpdateModifiedValue={(value) => {
                      setTabModifiedValue(tab.key, value);
                    }}
                    onUpdateOriginalValue={(value) => {
                      monacoEditorUpdateContent(tab.key, value);
                    }}
                  />
                )}
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  // vanillaJsonEditor 渲染函数
  const renderVanillaJsonEditor = () => {
    return (
      <div className="editor-container h-full">
        {tabs.map((tab) => {
          const shouldRender = loadedEditors.vanilla.has(tab.key);
          const isVisible = tab.key === activeTabKey;

          if (!shouldRender && isVisible) {
            setLoadedEditors((prev) => ({
              ...prev,
              vanilla: new Set([...prev.vanilla, tab.key]),
            }));
          }

          return (
            <div
              key={"vanilla-" + tab.key}
              className={cn(
                "w-full h-full",
                isVisible && "visible",
                !editorLoading[tab.key] && "loaded",
                {
                  hidden: tab.key !== activeTabKey,
                  "jse-theme-dark": theme === "dark",
                },
              )}
            >
              {shouldRender && (
                <VanillaJsonEditor
                  key={tab.key}
                  ref={(ref) => {
                    if (ref) {
                      vanillaJsonEditorRefs.current[tab.key] = ref;
                    }
                  }}
                  content={tab.vanilla}
                  height="100%"
                  mode={tab.vanillaMode}
                  tabKey={tab.key}
                  onChangeMode={(mode) => {
                    setTabVanillaMode(tab.key, mode);
                  }}
                  onMount={() => {
                    setEditorLoading((prev) => ({
                      ...prev,
                      [tab.key]: false,
                    }));
                  }}
                  onUpdateValue={(content) => {
                    vanillaEditorUpdateContent(tab.key, content);
                  }}
                />
              )}
            </div>
          );
        })}
      </div>
    );
  };

  // 通过菜单栏的 activeKey 渲染编辑器
  const renderEditor = () => {
    switch (sidebarStore.activeKey) {
      case SidebarKeys.textView:
        return renderMonacoJsonEditor();
      case SidebarKeys.treeView:
        return renderVanillaJsonEditor();
      case SidebarKeys.diffView:
        return renderMonacoDiffEditor();
      case SidebarKeys.tableView:
        return renderJsonTableView();
      default:
        return <div>404</div>;
    }
  };

  // tab 切换时同步数据
  const tabSwitchHandle = () => {
    const currentTab = activeTab();

    if (!currentTab) {
      return;
    }

    // 如果当前 tab 存在 monaco 版本和 vanilla 版本不一致, 则需要同步数据
    if (currentTab && currentTab.monacoVersion != currentTab.vanillaVersion) {
      switch (sidebarStore.clickSwitchKey) {
        case SidebarKeys.textView:
          // 如果切换之前是 diff 视图着不需要处理
          if (sidebarStore.activeKey == SidebarKeys.diffView) {
            break;
          }
          // 如果vanillaVersion < monacoVersion 则需要不同步数据
          if (currentTab.vanillaVersion < currentTab.monacoVersion) {
            break;
          }
          vanilla2JsonContent(activeTabKey);
          setMonacoVersion(activeTabKey, currentTab.vanillaVersion);
          // 强制更新 monaco 编辑器内容
          monacoJsonEditorRefs.current[currentTab.key].updateValue(
            activeTab().content,
          );
          break;
        case SidebarKeys.diffView:
          // 如果切换之前是 text 视图着不需要处理
          if (sidebarStore.activeKey == SidebarKeys.textView) {
            break;
          }
          // 如果vanillaVersion < monacoVersion 则需要不同步数据
          if (currentTab.vanillaVersion < currentTab.monacoVersion) {
            break;
          }
          vanilla2JsonContent(activeTabKey);
          setMonacoVersion(activeTabKey, currentTab.vanillaVersion);
          monacoDiffEditorRefs.current[currentTab.key]?.updateOriginalValue(
            activeTab().content,
          );
          break;
        case SidebarKeys.treeView:
          // 如果vanillaVersion < monacoVersion 则需要不同步数据
          if (currentTab.monacoVersion < currentTab.vanillaVersion) {
            break;
          }
          jsonContent2VanillaContent(activeTabKey);
          setVanillaVersion(activeTabKey, currentTab.monacoVersion);
          const tempTab = activeTab();

          if (tempTab && tempTab.vanilla) {
            vanillaJsonEditorRefs.current[
              tempTab.key
            ]?.updateEditorContentAndMode(tempTab.vanillaMode, tempTab.vanilla);
          }
          break;
        case SidebarKeys.tableView:
          // 如果切换到表格视图，确保使用最新的数据
          if (sidebarStore.activeKey == SidebarKeys.treeView) {
            // 如果从树形视图切换，先同步数据
            if (currentTab.vanillaVersion > currentTab.monacoVersion) {
              vanilla2JsonContent(activeTabKey);
              setMonacoVersion(activeTabKey, currentTab.vanillaVersion);
            }
          }
          break;
      }
    }

    // tab 切换时触发校验
    if (sidebarStore.clickSwitchKey == SidebarKeys.textView) {
      setTimeout(() => {
        monacoJsonEditorRefs.current[currentTab.key]?.validate();
      }, 500);
    }
  };

  // url 刷新时同步数据同步数据
  const urlRefreshHandle = (key: string) => {
    const currentTab = getTabByKey(key);

    if (!currentTab) {
      return;
    }

    switch (sidebarStore.clickSwitchKey) {
      case SidebarKeys.textView:
        setMonacoVersion(currentTab.key, currentTab.vanillaVersion);
        monacoJsonEditorRefs.current[currentTab.key]?.updateValue(
          activeTab().content,
        );
        break;
      case SidebarKeys.diffView:
        monacoDiffEditorRefs.current[currentTab.key]?.updateOriginalValue(
          activeTab().content,
        );
        break;
      case SidebarKeys.treeView:
        jsonContent2VanillaContent(currentTab.key);
        setVanillaVersion(currentTab.key, currentTab.monacoVersion);
        const tempTab = activeTab();

        if (tempTab && tempTab.vanilla) {
          vanillaJsonEditorRefs.current[
            tempTab.key
          ]?.updateEditorContentAndMode(tempTab.vanillaMode, tempTab.vanilla);
        }
        break;
      case SidebarKeys.tableView:
        break;
    }
  };

  useLayoutEffect(() => {
    const init = async () => {
      // 先同步设置数据到 store
      await useSettingsStore.getState().syncSettingsStore();

      // 然后检查是否需要同步标签页数据
      // 使用 getState() 获取最新状态，确保使用同步后的值
      if (useSettingsStore.getState().editDataSaveLocal) {
        await syncTabStore();
      }
    };

    init();
  }, []);

  useEffect(() => {
    // 设置 UtoolsListener 的编辑器引用
    UtoolsListener.getInstance().setEditorRefs(monacoJsonEditorRefs.current);
  }, [monacoJsonEditorRefs]);

  useEffect(() => {
    // 在切换标签时预加载下一个编辑器
    if (activeTabKey) {
      // 设置新标签页的加载状态
      setEditorLoading((prev) => ({
        ...prev,
        [activeTabKey]: true,
      }));

      // 预加载相邻的标签页
      const currentIndex = tabs.findIndex((tab) => tab.key === activeTabKey);
      const preloadIndexes = [currentIndex - 1, currentIndex + 1].filter(
        (index) => index >= 0 && index < tabs.length,
      );

      preloadIndexes.forEach((index) => {
        const tab = tabs[index];

        if (!tab) {
          return;
        }

        switch (sidebarStore.activeKey) {
          case SidebarKeys.textView:
            setLoadedEditors((prev) => ({
              ...prev,
              monaco: new Set([...prev.monaco, tab.key]),
            }));
            // 焦点切换到当前激活的 tab
            if (monacoJsonEditorRefs.current[activeTabKey]) {
              monacoJsonEditorRefs.current[activeTabKey].layout();
              monacoJsonEditorRefs.current[activeTabKey].focus();
            }
            break;
          case SidebarKeys.treeView:
            setLoadedEditors((prev) => ({
              ...prev,
              vanilla: new Set([...prev.vanilla, tab.key]),
            }));
            break;
          case SidebarKeys.diffView:
            setLoadedEditors((prev) => ({
              ...prev,
              diff: new Set([...prev.diff, tab.key]),
            }));
            // 焦点切换到当前激活的 tab
            if (monacoDiffEditorRefs.current[activeTabKey]) {
              monacoDiffEditorRefs.current[activeTabKey].layout();
              monacoDiffEditorRefs.current[activeTabKey].focus();
            }
            break;
          case SidebarKeys.tableView:
            setLoadedEditors((prev) => ({
              ...prev,
              table: new Set([...prev.table, tab.key]),
            }));
            break;
        }
      });
    }
  }, [activeTabKey]);

  // 切换视图时同步数据
  useEffect(() => {
    tabSwitchHandle();
    sidebarStore.switchActiveKey();
  }, [sidebarStore.clickSwitchKey]);

  // 添加renderJsonTableView函数
  const renderJsonTableView = () => {
    return (
      <div className="h-full">
        {tabs.map((tab) => {
          const shouldRender = loadedEditors.table.has(tab.key);
          const isVisible = tab.key === activeTabKey;

          if (!shouldRender && isVisible) {
            setLoadedEditors((prev) => ({
              ...prev,
              table: new Set([...prev.table, tab.key]),
            }));
          }

          return (
            <div
              key={"table-" + tab.key}
              className={cn(
                "w-full h-full",
                "editor-transition", // 添加与其他编辑器一致的过渡效果
                isVisible && "visible",
                !editorLoading[tab.key] && "loaded",
                {
                  hidden: tab.key !== activeTabKey,
                },
              )}
            >
              {shouldRender && (
                <JsonTableView
                  key={tab.key}
                  ref={(ref) => {
                    if (ref) {
                      jsonTableViewRefs.current[tab.key] = ref;
                    }
                  }}
                  data={tab.content}
                  onCopy={(type) => {
                    // 实现复制功能
                    try {
                      let content = "";
                      const currentTab = activeTab();

                      if (!currentTab) return false;

                      switch (type) {
                        case "node":
                          // 复制选中节点的值
                          if (jsonTableViewRefs.current[tab.key]) {
                            const selectedNode =
                              jsonTableViewRefs.current[
                                tab.key
                              ].getSelectedNode();

                            if (selectedNode) {
                              content = stringifyJson(selectedNode, 2);
                              clipboard.copy(content, "已复制选中节点");

                              return true;
                            }
                          }

                          return false;
                        case "path":
                          // 复制选中节点的路径
                          if (jsonTableViewRefs.current[tab.key]) {
                            const selectedPath =
                              jsonTableViewRefs.current[
                                tab.key
                              ].getSelectedPath();

                            if (selectedPath) {
                              clipboard.copy(selectedPath, "已复制选中路径");

                              return true;
                            }
                          }

                          return false;
                        default:
                          // 默认复制整个JSON内容
                          content = tab.content || "{}";
                          clipboard.copy(content, "已复制全部内容");

                          return true;
                      }
                    } catch (err) {
                      console.error("复制失败:", err);
                      toast.error("复制失败: " + (err as Error).message);

                      return false;
                    }
                  }}
                  onDataUpdate={(newData) => {
                    // 更新tab内容
                    setTabContent(tab.key, newData);
                  }}
                  onMount={() => {
                    setEditorLoading((prev) => ({
                      ...prev,
                      [tab.key]: false,
                    }));
                  }}
                />
              )}
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <div className="flex flex-col h-full dark:bg-vscode-dark">
      <DynamicTabs
        ref={tabRef}
        onClose={closeTabHandle}
        onSwitch={tabSwitchHandle}
        onUrlRefresh={urlRefreshHandle}
      />
      <div className="flex-grow h-0 overflow-hidden flex flex-col">
        {renderEditor()}
      </div>
    </div>
  );
}
