"use client";

import React, { useRef, useEffect, useState, useImperativeHandle } from "react";
import { Tabs, Tab, Tooltip, cn } from "@heroui/react";
import { Icon } from "@iconify/react";
import axios from "axios";
import {
  Input,
  Button,
  Card,
  Modal,
  ModalContent,
  ModalHeader,
  ModalBody,
  ModalFooter,
} from "@heroui/react";

import toast from "@/utils/toast";
import { useTabStore, TabItem } from "@/store/useTabStore";
import { IcRoundClose } from "@/components/Icons.tsx";
import { JsonSample } from "@/utils/jsonSample.ts";
import { useSettingsStore } from "@/store/useSettingsStore.ts";
import { globalShortcutListener } from "@/utils/shortcut.ts";
import { getFontSizeConfig } from "@/styles/fontSize.ts";
import { parseJson } from "@/utils/json";

export interface DynamicTabsRef {
  getPositionTop: () => number;
}

export interface DynamicTabsProps {
  ref?: React.Ref<DynamicTabsRef>;
  onSwitch: (key: string) => void;
  onClose?: (keys: Array<string>) => void;
  onUrlRefresh?: (key: string) => void;
}

const DynamicTabs: React.FC<DynamicTabsProps> = ({
  onSwitch,
  onClose,
  onUrlRefresh,
  ref,
}) => {
  const {
    tabs,
    activeTabKey,
    addTab,
    closeTab,
    setActiveTab,
    setTabContent,
    renameTab,
    closeAllTabs,
    closeLeftTabs,
    closeRightTabs,
    closeOtherTabs,
    getTabByKey,
  } = useTabStore();
  const { newTabShortcut, closeTabShortcut, fontSize } = useSettingsStore();
  const fontSizeConfig = getFontSizeConfig(fontSize);
  const tabListRef = useRef<HTMLDivElement>(null);
  const tabContainerRef = useRef<HTMLDivElement>(null);
  const tabRenameInputRef = useRef<HTMLInputElement>(null);
  const [editingTab, setEditingTab] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState<string>("");
  const [contextMenuPosition, setContextMenuPosition] = useState<{
    x: number;
    y: number;
  } | null>(null);
  const [contextMenuTabKey, setContextMenuTabKey] = useState<string>("");
  const [tabDisableKeys, setTabDisableKeys] = useState<string[]>([]);

  // 添加菜单相关状态
  const [showAddMenu, setShowAddMenu] = useState<boolean>(false);
  const [addMenuPosition, setAddMenuPosition] = useState<{
    x: number;
    y: number;
  }>({ x: 0, y: 0 });

  const [inputPosition, setInputPosition] = useState<{
    left: number;
    top: number;
    width: number;
  }>({ left: 0, top: 0, width: 0 });

  const addButtonRef = useRef<HTMLDivElement>(null);

  // 点击检测相关状态
  const clickTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const lastClickTimeRef = useRef<number>(0);

  // 添加确认弹窗相关状态
  const [refreshConfirmOpen, setRefreshConfirmOpen] = useState(false);
  const [refreshTabInfo, setRefreshTabInfo] = useState<{
    key: string;
    url: string;
  } | null>(null);

  // 精确计算标签页滚动位置 - 使用优化后的平滑滚动
  const scrollToActiveTab = () => {
    if (tabListRef.current && tabContainerRef.current) {
      const activeTabElement = tabListRef.current.querySelector(
        `[data-key="${activeTabKey}"]`,
      ) as HTMLElement;

      if (activeTabKey === "add") {
        addTab(undefined, undefined);

        return;
      }

      if (activeTabElement) {
        const containerRect = tabContainerRef.current.getBoundingClientRect();
        const tabListRect = tabListRef.current.getBoundingClientRect();

        // 计算相对于容器的偏移量
        const tabOffset = activeTabElement.offsetLeft;
        const tabWidth = activeTabElement.offsetWidth;

        // 容器的可视宽度
        const containerWidth = containerRect.width;

        // 计算滚动位置，确保标签尽可能居中
        let scrollPosition = tabOffset - containerWidth / 2 + tabWidth / 2;

        // 处理边界情况
        scrollPosition = Math.max(0, scrollPosition);
        const maxScrollPosition = tabListRect.width - containerWidth;

        scrollPosition = Math.min(scrollPosition, maxScrollPosition);

        // 使用优化的平滑滚动替代原生 scrollTo
        smoothScroll(scrollPosition, 350);
      }
    }
  };

  // 滚动相关状态和引用
  const rafIdRef = useRef<number | null>(null);

  // 获取滚动边界
  const getScrollBounds = () => {
    if (!tabContainerRef.current) return { min: 0, max: 0 };
    const container = tabContainerRef.current;

    return {
      min: 0,
      max: Math.max(0, container.scrollWidth - container.clientWidth),
    };
  };

  // 直接设置滚动位置，无动画
  const setScrollPosition = (scrollLeft: number) => {
    if (!tabContainerRef.current) return;
    const bounds = getScrollBounds();
    const clampedScrollLeft = Math.max(
      bounds.min,
      Math.min(bounds.max, scrollLeft),
    );

    tabContainerRef.current.scrollLeft = clampedScrollLeft;

    return clampedScrollLeft;
  };

  // 优化的平滑滚动函数 - 防止边界回弹
  const smoothScroll = (targetScrollLeft: number, duration: number = 200) => {
    if (!tabContainerRef.current) return;

    // 取消所有进行中的动画
    if (rafIdRef.current) {
      cancelAnimationFrame(rafIdRef.current);
      rafIdRef.current = null;
    }

    // 确保目标位置在边界内
    const bounds = getScrollBounds();

    targetScrollLeft = Math.max(
      bounds.min,
      Math.min(bounds.max, targetScrollLeft),
    );

    const startScrollLeft = tabContainerRef.current.scrollLeft;
    const distance = targetScrollLeft - startScrollLeft;

    // 如果距离很小，直接设置位置
    if (Math.abs(distance) < 1) {
      setScrollPosition(targetScrollLeft);

      return;
    }

    const startTime = performance.now();

    const animateScroll = (currentTime: number) => {
      const elapsed = currentTime - startTime;
      const progress = Math.min(elapsed / duration, 1);

      // 使用更温和的缓动函数，减少回弹感
      const easeOutQuad = 1 - Math.pow(1 - progress, 2);
      const currentScrollLeft = startScrollLeft + distance * easeOutQuad;

      // 设置滚动位置，但始终保持在边界内
      const finalScrollLeft = setScrollPosition(currentScrollLeft);

      // 检查是否已经到达边界，如果是则提前停止动画
      if (
        finalScrollLeft !== undefined &&
        ((finalScrollLeft <= bounds.min && distance < 0) ||
          (finalScrollLeft >= bounds.max && distance > 0))
      ) {
        rafIdRef.current = null;
        setScrollPosition(finalScrollLeft);

        return;
      }

      if (progress < 1) {
        rafIdRef.current = requestAnimationFrame(animateScroll);
      } else {
        rafIdRef.current = null;
        // 确保最终位置精确且在边界内
        setScrollPosition(targetScrollLeft);
      }
    };

    rafIdRef.current = requestAnimationFrame(animateScroll);
  };

  // 处理鼠标滚轮滚动
  const handleWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    if (!tabContainerRef.current) return;

    const currentScrollLeft = tabContainerRef.current.scrollLeft;
    const bounds = getScrollBounds();

    // 检测滚动方向
    const scrollDelta = e.deltaY;
    const scrollingLeft = scrollDelta < 0;
    const scrollingRight = scrollDelta > 0;

    // 边界检测：如果已经在边界，且试图继续向边界方向滚动，允许默认行为
    if (
      (currentScrollLeft <= bounds.min && scrollingLeft) ||
      (currentScrollLeft >= bounds.max && scrollingRight)
    ) {
      return;
    }

    // 如果内容不需要滚动，允许默认行为
    if (bounds.max <= bounds.min) {
      return;
    }

    // 只在需要自定义滚动行为时才阻止默认行为
    e.preventDefault();
    e.stopPropagation();

    // 检测是否为触控板滚动（增量较小且连续）
    const isTouchpad = Math.abs(scrollDelta) < 8 && e.deltaMode === 0;

    if (isTouchpad) {
      // 触控板滚动：累积小增量，但要注意边界
      const accumulatedDelta = scrollDelta * 0.4;
      let targetScrollLeft = currentScrollLeft + accumulatedDelta;

      // 在计算目标位置后立即进行边界检查
      targetScrollLeft = Math.max(
        bounds.min,
        Math.min(bounds.max, targetScrollLeft),
      );

      // 只有当目标位置与当前位置不同时才滚动
      if (Math.abs(targetScrollLeft - currentScrollLeft) > 0.5) {
        smoothScroll(targetScrollLeft, 80);
      }
    } else {
      // 鼠标滚轮滚动

      // 根据滚动速度调整乘数
      const speedMultiplier = Math.abs(scrollDelta) > 80 ? 1.0 : 0.6;
      let scrollAmount = scrollDelta * speedMultiplier;

      // 限制最大滚动量
      const maxScrollAmount = 80;

      scrollAmount = Math.max(
        -maxScrollAmount,
        Math.min(maxScrollAmount, scrollAmount),
      );

      let targetScrollLeft = currentScrollLeft + scrollAmount;

      // 立即进行边界检查，防止超出
      targetScrollLeft = Math.max(
        bounds.min,
        Math.min(bounds.max, targetScrollLeft),
      );

      // 只有当需要移动时才执行动画
      if (Math.abs(targetScrollLeft - currentScrollLeft) > 0.5) {
        const duration = Math.abs(scrollAmount) < 20 ? 100 : 150;

        smoothScroll(targetScrollLeft, duration);
      }
    }
  };

  useEffect(() => {
    scrollToActiveTab();
    onSwitch(activeTabKey);
  }, [activeTabKey]);

  useEffect(() => {
    if (editingTab && tabRenameInputRef.current) {
      tabRenameInputRef.current.focus();
    }
  }, [editingTab]);

  // 键盘事件处理函数
  const handleKeyDown = (
    e: React.KeyboardEvent<HTMLDivElement>,
    action: () => void,
  ) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      action();
    }
  };

  // 处理双击重命名
  const handleDoubleClick = (tab: TabItem, event: React.MouseEvent) => {
    const targetElement = event.currentTarget;
    const rect = targetElement.getBoundingClientRect();

    setEditingTab(tab.key);
    setEditingTitle(tab.title);

    // 设置输入框位置和宽度
    setInputPosition({
      left: rect.left,
      top: rect.top,
      width: rect.width,
    });
  };

  // 处理添加按钮的智能点击（区分单击和双击）
  const handleAddButtonClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    const now = Date.now();
    const timeSinceLastClick = now - lastClickTimeRef.current;

    // 清除之前的定时器
    if (clickTimeoutRef.current) {
      clearTimeout(clickTimeoutRef.current);
      clickTimeoutRef.current = null;
    }

    // 如果两次点击间隔小于300ms，认为是双击
    if (timeSinceLastClick < 300) {
      // 双击 - 创建空白tab
      addTab(undefined, undefined);
      lastClickTimeRef.current = 0;
    } else {
      // 单击 - 延迟执行菜单显示，等待可能的双击
      clickTimeoutRef.current = setTimeout(() => {
        toggleAddMenu();
        clickTimeoutRef.current = null;
      }, 300);
    }

    lastClickTimeRef.current = now;
  };

  const handleContextMenu = (
    tab: TabItem,
    event: React.MouseEvent<HTMLDivElement>,
  ) => {
    event.preventDefault();
    setContextMenuPosition({
      x: event.clientX,
      y: event.clientY,
    });
    setContextMenuTabKey(tab.key);
  };

  // 处理输入框的键盘事件
  const handleInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      confirmRename();
    } else if (e.key === "Escape") {
      setEditingTab(null);
    }
  };

  // 确认重命名
  const confirmRename = () => {
    if (editingTab) {
      renameTab(editingTab, editingTitle);
      setEditingTab(null);
    }
  };

  // 菜单事件处理
  const handleMenuAction = (action: string) => {
    if (!contextMenuTabKey) return;

    switch (action) {
      case "rename":
        // 触发重命名逻辑（复用现有的双击重命名逻辑）
        const tabElement = document.querySelector(
          `[data-key="${contextMenuTabKey}"]`,
        );

        if (tabElement) {
          const rect = tabElement.getBoundingClientRect();

          setEditingTab(contextMenuTabKey);
          const tab = getTabByKey(contextMenuTabKey);

          if (tab) {
            setEditingTitle(tab.title);

            // 设置输入框位置和宽度
            setInputPosition({
              left: rect.left,
              top: rect.top,
              width: rect.width,
            });
          }
        }
        setContextMenuPosition(null);
        setContextMenuTabKey("");
        break;
      case "close":
        closeTab(contextMenuTabKey);
        onClose?.([contextMenuTabKey]);
        setContextMenuPosition(null);
        setContextMenuTabKey("");
        break;
      case "close-left":
        const closeLeftKeys = closeLeftTabs(contextMenuTabKey);

        onClose?.(closeLeftKeys);
        setContextMenuPosition(null);
        setContextMenuTabKey("");
        break;
      case "close-right":
        const closeRightKeys = closeRightTabs(contextMenuTabKey);

        onClose?.(closeRightKeys);
        setContextMenuPosition(null);
        setContextMenuTabKey("");
        break;
      case "close-others":
        const closeOtherKeys = closeOtherTabs(contextMenuTabKey);

        onClose?.(closeOtherKeys);
        setContextMenuPosition(null);
        setContextMenuTabKey("");
        break;
      case "close-all":
        const closeAllKeys = closeAllTabs();

        onClose?.(closeAllKeys);
        setContextMenuPosition(null);
        setContextMenuTabKey("");
        break;
    }
  };

  // 添加菜单相关状态
  const [jsonUrl, setJsonUrl] = useState<string>("");

  // 处理添加菜单选项
  const handleAddMenuAction = (action: string) => {
    switch (action) {
      case "upload":
        // 触发文件上传
        const fileInput = document.createElement("input");

        fileInput.type = "file";
        fileInput.accept = "application/json";
        fileInput.onchange = (e) => {
          const target = e.target as HTMLInputElement;

          if (target.files && target.files.length > 0) {
            const file = target.files[0];
            const reader = new FileReader();

            reader.onload = (event) => {
              try {
                const content = event.target?.result as string;

                // 创建新标签并设置内容
                addTab(file.name, content);
                setShowAddMenu(false);
                toast.success("文件上传成功");
              } catch (error) {
                toast.error(
                  "文件处理失败",
                  error instanceof Error ? error.message : "请确保文件格式正确",
                );
              }
            };

            reader.onerror = () => {
              toast.error("文件读取失败", "请确保文件可访问且格式正确");
            };

            reader.readAsText(file);
          }
        };
        fileInput.click();
        break;
      case "sample":
        addTab("Sample JSON", JsonSample);
        setShowAddMenu(false);
        break;
    }
  };

  // 处理URL输入
  const handleUrlSubmit = async () => {
    if (!jsonUrl.trim()) {
      return;
    }

    try {
      // URL validation
      new URL(jsonUrl); // This will throw an error if URL is invalid

      const response = await axios.get(jsonUrl, {
        headers: {
          Accept: "application/json, text/plain, */*",
        },
        responseType: "text",
      });

      // Get response data
      const responseText = response.data;

      // Create filename from URL
      const urlObj = new URL(jsonUrl);
      const pathParts = urlObj.pathname.split("/");
      let fileName = pathParts[pathParts.length - 1] || urlObj.hostname;

      if (!fileName || fileName === "/") {
        fileName = urlObj.hostname;
      }

      // 检查内容是否为JSON格式
      let isJson = true;

      try {
        // 尝试解析为JSON
        parseJson(responseText);

        // 确保JSON文件名有正确后缀
        if (!fileName.toLowerCase().endsWith(".json")) {
          fileName += ".json";
        }
      } catch {
        // 不是有效的JSON格式，作为文本处理
        isJson = false;

        // 如果没有扩展名，添加.txt后缀
        if (!fileName.includes(".")) {
          fileName += ".txt";
        }
      }

      // 创建新标签页，无论是否为JSON格式
      addTab(fileName, responseText, { url: jsonUrl });

      // 关闭菜单并清除URL
      setShowAddMenu(false);
      setJsonUrl("");

      toast.success(isJson ? "JSON文件加载成功" : "文本文件加载成功");
    } catch (error) {
      console.error("获取数据失败:", error);

      // Provide more specific error messages
      if (error instanceof TypeError && error.message.includes("URL")) {
        toast.error("URL格式无效", "请输入完整的URL，包括http://或https://");
      } else if (axios.isAxiosError(error)) {
        if (error.code === "ERR_NETWORK") {
          toast.error("网络错误", "无法连接到指定URL，请检查网络连接");
        } else if (error.response?.status === 403) {
          toast.error("访问被拒绝", "该资源不允许跨域访问或需要身份验证");
        } else if (error.response?.status === 404) {
          toast.error("资源不存在", "指定URL未找到任何资源");
        } else {
          toast.error(
            "获取数据失败",
            `HTTP错误: ${error.response?.status || "未知"} - ${error.message}`,
          );
        }
      } else {
        toast.error(
          "获取数据失败",
          error instanceof Error ? error.message : "请检查URL是否正确",
        );
      }
    }
  };

  // 刷新URL数据
  const refreshUrlData = async (tabKey: string, url: string) => {
    try {
      const response = await axios.get(url, {
        headers: {
          Accept: "application/json, text/plain, */*",
        },
        responseType: "text",
      });

      const responseText = response.data;
      const tab = getTabByKey(tabKey);

      if (!tab) {
        toast.error("刷新失败", "找不到指定的标签页");

        return;
      }
      setTabContent(tabKey, responseText);
      onUrlRefresh && onUrlRefresh(activeTabKey);
      toast.success("刷新成功");
    } catch (error) {
      console.error("刷新数据失败:", error);

      if (axios.isAxiosError(error)) {
        if (error.code === "ERR_NETWORK") {
          toast.error("网络错误", "无法连接到指定URL，请检查网络连接");
        } else if (error.response?.status === 403) {
          toast.error("访问被拒绝", "该资源不允许跨域访问或需要身份验证");
        } else if (error.response?.status === 404) {
          toast.error("资源不存在", "指定URL未找到任何资源");
        } else {
          toast.error(
            "刷新失败",
            `HTTP错误: ${error.response?.status || "未知"} - ${error.message}`,
          );
        }
      } else {
        toast.error(
          "刷新失败",
          error instanceof Error ? error.message : "请检查URL是否可用",
        );
      }
    }
  };

  // 显示刷新确认弹窗
  const showRefreshConfirm = (tabKey: string, url: string) => {
    setRefreshTabInfo({ key: tabKey, url });
    setRefreshConfirmOpen(true);
  };

  const handleConfirmRefresh = () => {
    if (refreshTabInfo) {
      refreshUrlData(refreshTabInfo.key, refreshTabInfo.url);
      setRefreshConfirmOpen(false);
      setRefreshTabInfo(null);
    }
  };

  // 使用 useRef 保持回调函数的稳定性
  const handleNewTabShortcutRef = useRef(() => {
    addTab(undefined, undefined);
  });

  // 使用 useRef 保持关闭标签页回调函数的稳定性
  const handleCloseTabShortcutRef = useRef(() => {
    const currentTab = tabs.find((tab) => tab.key === activeTabKey);

    if (currentTab && currentTab.closable) {
      closeTab(activeTabKey);
      onClose?.([activeTabKey]);
    }
  });

  // 更新 ref 中的函数
  useEffect(() => {
    handleNewTabShortcutRef.current = () => {
      addTab(undefined, undefined);
    };
  }, [addTab]);

  // 更新关闭标签页 ref 中的函数
  useEffect(() => {
    handleCloseTabShortcutRef.current = () => {
      const currentTab = tabs.find((tab) => tab.key === activeTabKey);

      if (currentTab && currentTab.closable) {
        closeTab(activeTabKey);
        onClose?.([activeTabKey]);
      }
    };
  }, [tabs, activeTabKey, closeTab, onClose]);

  // 设置快捷键监听
  useEffect(() => {
    const handleNewTabShortcut = () => {
      handleNewTabShortcutRef.current();
    };

    const handleCloseTabShortcut = () => {
      handleCloseTabShortcutRef.current();
    };

    // 注册快捷键监听（设置为全局快捷键，即使在编辑器中也能使用）
    globalShortcutListener.addListener(newTabShortcut, handleNewTabShortcut, {
      global: true,
    });
    globalShortcutListener.addListener(
      closeTabShortcut,
      handleCloseTabShortcut,
      { global: true },
    );

    return () => {
      // 清理快捷键监听
      globalShortcutListener.removeListener(
        newTabShortcut,
        handleNewTabShortcut,
        { global: true },
      );
      globalShortcutListener.removeListener(
        closeTabShortcut,
        handleCloseTabShortcut,
        { global: true },
      );
    };
  }, [newTabShortcut, closeTabShortcut]);

  // 使用 useImperativeHandle 暴露方法
  useImperativeHandle(ref, () => ({
    getPositionTop: () => {
      if (!tabContainerRef.current) return 35;
      const containerRect = tabContainerRef.current.getBoundingClientRect();

      return containerRect.bottom;
    },
  }));

  // 渲染重命名输入框
  const renderRenameInput = () => {
    if (!editingTab) return null;

    return (
      <div
        className="absolute"
        style={{
          position: "fixed",
          left: `${inputPosition.left}px`,
          top: `2px`,
          width: `${inputPosition.width}px`,
          zIndex: 1000,
        }}
      >
        <div className="flex items-center space-x-2">
          <Input
            ref={tabRenameInputRef}
            classNames={{
              input: "text-xs !pe-0",
              inputWrapper: "px-0 pl-0.5",
            }}
            endContent={
              <Tooltip content="确认">
                <div
                  className="cursor-pointer hover:bg-default-100 rounded-full"
                  role="button"
                  tabIndex={0}
                  onClick={confirmRename}
                  onKeyDown={confirmRename}
                >
                  <Icon icon="mage:check" width={fontSizeConfig.icon} />
                </div>
              </Tooltip>
            }
            size="sm"
            value={editingTitle}
            onBlur={confirmRename}
            onChange={(e) => setEditingTitle(e.target.value)}
            onKeyDown={handleInputKeyDown}
          />
        </div>
      </div>
    );
  };

  // 键盘水平滚动支持
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!tabContainerRef.current) return;

      // 只在没有聚焦输入框时响应键盘滚动
      const activeElement = document.activeElement;

      if (
        activeElement &&
        (activeElement.tagName === "INPUT" ||
          activeElement.tagName === "TEXTAREA" ||
          (activeElement as HTMLElement).contentEditable === "true")
      ) {
        return;
      }

      let scrollAmount = 0;

      switch (e.key) {
        case "ArrowLeft":
          scrollAmount = -150;
          break;
        case "ArrowRight":
          scrollAmount = 150;
          break;
        default:
          return;
      }

      if (scrollAmount !== 0 && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        const currentScrollLeft = tabContainerRef.current.scrollLeft;
        const targetScrollLeft = currentScrollLeft + scrollAmount;

        smoothScroll(targetScrollLeft, 200);
      }
    };

    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  // 添加外部点击关闭菜单的处理
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if ((event.target as Element).closest('[aria-label="添加新标签页"]')) {
        return;
      }

      if (
        contextMenuPosition &&
        !(event.target as Element).closest(".tab-context-menu")
      ) {
        setContextMenuPosition(null);
        setContextMenuTabKey("");
      }

      if (showAddMenu && !(event.target as Element).closest(".add-menu")) {
        setShowAddMenu(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [contextMenuPosition, showAddMenu]);

  // 清理定时器和动画
  useEffect(() => {
    return () => {
      // 清理点击定时器
      if (clickTimeoutRef.current) {
        clearTimeout(clickTimeoutRef.current);
      }
      // 清理滚动动画
      if (rafIdRef.current) {
        cancelAnimationFrame(rafIdRef.current);
      }
    };
  }, []);

  // 修改右键菜单样式
  const renderTabContextMenu = () => {
    // 即使没有contextMenuPosition，也要渲染菜单但使其不可见，以支持动画
    return (
      <div
        className={cn(
          "tab-context-menu fixed bg-default-50 border border-divider rounded-lg shadow-xl z-50",
          contextMenuPosition ? "opacity-100" : "opacity-0 pointer-events-none",
        )}
        style={{
          left: contextMenuPosition?.x || 0,
          top: contextMenuPosition?.y || 0,
          minWidth: "220px",
        }}
      >
        <div className="py-1.5">
          <button
            className="w-full text-left px-4 py-2.5 flex items-center gap-3 hover:bg-default-100 text-sm transition-colors"
            onClick={() => handleMenuAction("close")}
          >
            <div className="w-5 h-5 flex items-center justify-center text-default-600">
              <Icon icon="gg:close" width={fontSizeConfig.icon} />
            </div>
            <span>关闭</span>
          </button>
          <button
            className="w-full text-left px-4 py-2.5 flex items-center gap-3 hover:bg-default-100 text-sm transition-colors"
            onClick={() => handleMenuAction("rename")}
          >
            <div className="w-5 h-5 flex items-center justify-center text-default-600">
              <Icon icon="solar:pen-linear" width={fontSizeConfig.icon} />
            </div>
            <span>重命名</span>
          </button>
          <hr className="my-1 border-divider opacity-60" />
          <button
            className="w-full text-left px-4 py-2.5 flex items-center gap-3 hover:bg-default-100 text-sm transition-colors"
            onClick={() => handleMenuAction("close-left")}
          >
            <div className="w-5 h-5 flex items-center justify-center text-default-600">
              <Icon icon="ph:arrow-left" width={fontSizeConfig.icon} />
            </div>
            <span>关闭左侧</span>
          </button>
          <button
            className="w-full text-left px-4 py-2.5 flex items-center gap-3 hover:bg-default-100 text-sm transition-colors"
            onClick={() => handleMenuAction("close-right")}
          >
            <div className="w-5 h-5 flex items-center justify-center text-default-600">
              <Icon icon="ph:arrow-right" width={fontSizeConfig.icon} />
            </div>
            <span>关闭右侧</span>
          </button>
          <button
            className="w-full text-left px-4 py-2.5 flex items-center gap-3 hover:bg-default-100 text-sm transition-colors"
            onClick={() => handleMenuAction("close-others")}
          >
            <div className="w-5 h-5 flex items-center justify-center text-default-600">
              <Icon
                icon="material-symbols:tab-close-inactive-outline"
                width={18}
              />
            </div>
            <span>关闭其他</span>
          </button>
          <hr className="my-1 border-divider opacity-60" />
          <button
            className="w-full text-left px-4 py-2.5 flex items-center gap-3 hover:bg-danger/10 text-sm text-danger transition-colors"
            onClick={() => handleMenuAction("close-all")}
          >
            <div className="w-5 h-5 flex items-center justify-center text-danger">
              <Icon icon="gg:close" width={fontSizeConfig.icon} />
            </div>
            <span>关闭所有</span>
          </button>
        </div>
      </div>
    );
  };

  // 修改添加菜单显示逻辑
  const toggleAddMenu = () => {
    if (addButtonRef.current) {
      const buttonRect = addButtonRef.current.getBoundingClientRect();
      const newPosition = {
        x: buttonRect.left - 8,
        y: buttonRect.bottom + 8,
      };

      setAddMenuPosition(newPosition);

      // 延迟setState以确保事件处理顺序正确
      setTimeout(() => {
        setShowAddMenu((prevState) => !prevState);
      }, 0);
    }
  };

  // 确保在组件挂载后和窗口大小变化时更新菜单位置
  useEffect(() => {
    const updateAddMenuPosition = () => {
      if (addButtonRef.current) {
        const buttonRect = addButtonRef.current.getBoundingClientRect();

        setAddMenuPosition({
          x: buttonRect.left - 10,
          y: buttonRect.bottom + 8,
        });
      }
    };

    // 初始化位置
    updateAddMenuPosition();

    // 监听窗口大小变化，更新位置
    window.addEventListener("resize", updateAddMenuPosition);

    return () => {
      window.removeEventListener("resize", updateAddMenuPosition);
    };
  }, []);

  // 渲染菜单
  const renderAddMenu = () => {
    return (
      <>
        <div
          aria-label="关闭添加菜单"
          className={cn(
            "fixed inset-0 z-40 transition-opacity",
            showAddMenu ? "" : "opacity-0 pointer-events-none",
          )}
          role="button"
          tabIndex={-1}
          onClick={() => setShowAddMenu(false)}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              setShowAddMenu(false);
            }
          }}
        />
        <div
          className={cn(
            "add-menu fixed bg-default-50 border border-divider rounded-xl shadow-xl z-50",
            "transition-all duration-300 ease-in-out",
            "before:absolute before:w-3 before:h-3 before:bg-default-50 before:rotate-45 before:-top-1.5 before:left-5 before:border-t before:border-l before:border-divider",
            showAddMenu
              ? "opacity-100 scale-100 translate-y-0"
              : "opacity-0 scale-95 translate-y-2 pointer-events-none",
          )}
          style={{
            left: addMenuPosition.x,
            top: addMenuPosition.y,
            minWidth: "480px",
            transformOrigin: "top left",
          }}
        >
          <div className="p-5">
            <div className="mb-5">
              <h3 className="text-sm font-semibold mb-3 flex items-center gap-2 text-default-700">
                <Icon
                  className="text-indigo-500"
                  icon="solar:magic-stick-linear"
                />
                快速创建
              </h3>
              <div className="border-b border-divider pb-5">
                <div className="flex gap-3 w-full">
                  <Button
                    className="flex-1 h-28 flex-col px-3 py-2 transition-all hover:scale-[1.02] bg-gradient-to-br from-default-50 to-default-100 hover:bg-gradient-to-br hover:from-primary-50/30 hover:to-default-100 hover:shadow-sm hover:border-primary-100 justify-center items-center"
                    startContent={
                      <div className="w-10 h-10 rounded-full bg-primary-50 flex items-center justify-center">
                        <Icon
                          className="text-xl text-indigo-500"
                          icon="carbon:document-blank"
                        />
                      </div>
                    }
                    variant="flat"
                    onPress={() => {
                      addTab("", "");
                      setShowAddMenu(false);
                    }}
                  >
                    <div className="flex flex-col items-center gap-1">
                      <span className="font-medium">新建 Tab</span>
                      <span className="text-xs text-default-500">
                        创建空白 Tab 标签页
                      </span>
                      <span className="text-xs text-primary font-medium">
                        <div className="flex">
                          {newTabShortcut} 或 {"  "}
                          <div className="flex ml-0.5">
                            双击
                            <Icon
                              icon="solar:add-square-linear"
                              style={{ margin: "1.5px 0 0 1px" }}
                              width={14}
                            />
                          </div>
                        </div>
                      </span>
                    </div>
                  </Button>
                  <Button
                    className="flex-1 h-28 flex-col px-3 py-2 transition-all hover:scale-[1.02] bg-gradient-to-br from-default-50 to-default-100 hover:bg-gradient-to-br hover:from-primary-50/30 hover:to-default-100 hover:shadow-sm hover:border-primary-100 justify-center items-center"
                    startContent={
                      <div className="w-10 h-10 rounded-full bg-primary-50 flex items-center justify-center">
                        <Icon
                          className="text-xl text-indigo-500"
                          icon="ri:file-code-line"
                        />
                      </div>
                    }
                    variant="flat"
                    onPress={() => {
                      handleAddMenuAction("sample");
                      setShowAddMenu(false);
                    }}
                  >
                    <div className="flex flex-col items-center gap-1">
                      <span className="font-medium">JSON 示例</span>
                      <span className="text-xs text-default-500">
                        包含常用字段
                      </span>
                    </div>
                  </Button>
                </div>
              </div>
            </div>

            <div className="mb-5">
              <h3 className="text-sm font-semibold mb-3 flex items-center gap-2 text-default-700">
                <Icon
                  className="text-indigo-500"
                  icon="solar:link-circle-linear"
                />
                从 URL 获取 JSON
              </h3>
              <div className="border-b border-divider pb-5">
                <div className="w-full flex flex-col gap-2">
                  <Input
                    classNames={{
                      inputWrapper: "shadow-sm bg-default-100 border-divider",
                      input: "focus:ring-0",
                    }}
                    endContent={
                      <Button
                        className="bg-indigo-500 border-0"
                        color="primary"
                        isDisabled={!jsonUrl.trim()}
                        radius="sm"
                        size="sm"
                        onPress={handleUrlSubmit}
                      >
                        <span className="px-1">获取</span>
                      </Button>
                    }
                    placeholder="输入 JSON 链接地址"
                    startContent={
                      <Icon
                        className="text-default-400"
                        icon="solar:link-linear"
                        width={18}
                      />
                    }
                    value={jsonUrl}
                    variant="flat"
                    onChange={(e) => setJsonUrl(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        handleUrlSubmit();
                      }
                    }}
                  />
                  <p className="text-xs text-default-400 px-1">
                    支持任何公开的 JSON 资源 URL，系统将自动解析并加载
                  </p>
                </div>
              </div>
            </div>

            <div>
              <h3 className="text-sm font-semibold mb-3 flex items-center gap-2 text-default-700">
                <Icon className="text-indigo-500" icon="solar:upload-linear" />
                文件操作
              </h3>
              <div className="flex justify-center">
                <Card
                  isPressable
                  className="border-2 border-dashed border-default-200 rounded-xl hover:border-indigo-500  hover:bg-primary-50/10 dark:hover:bg-primary-900/20 transition-all duration-300 w-full py-5 cursor-pointer"
                  onPress={() => {
                    const fileInput = document.createElement("input");

                    fileInput.type = "file";
                    fileInput.accept = "application/json";
                    fileInput.onchange = (e) => {
                      const target = e.target as HTMLInputElement;

                      if (target.files && target.files.length > 0) {
                        const file = target.files[0];
                        const reader = new FileReader();

                        reader.onload = (event) => {
                          try {
                            const content = event.target?.result as string;

                            addTab(file.name, content);
                            setShowAddMenu(false);
                            toast.success("文件上传成功");
                          } catch (error) {
                            toast.error(
                              "文件处理失败",
                              error instanceof Error
                                ? error.message
                                : "请确保文件格式正确",
                            );
                          }
                        };

                        reader.onerror = () => {
                          toast.error(
                            "文件读取失败",
                            "请确保文件可访问且格式正确",
                          );
                        };

                        reader.readAsText(file);
                      }
                    };
                    fileInput.click();
                  }}
                >
                  <div className="flex flex-col items-center justify-center gap-3 w-full">
                    <div className="p-3.5 rounded-full bg-primary-50 text-indigo-500">
                      <Icon
                        icon="heroicons:document-arrow-up"
                        width={fontSizeConfig.icon}
                      />
                    </div>
                    <div className="space-y-2 text-center">
                      <p className="text-sm font-medium">上传 JSON 文件</p>
                      <p className="text-xs text-default-500">
                        或将JSON文件拖放到任意区域
                      </p>
                    </div>
                  </div>
                </Card>
              </div>
            </div>
          </div>
        </div>
      </>
    );
  };

  // 拖拽状态
  const [isDragging, setIsDragging] = useState<boolean>(false);

  // 处理文件拖放
  const handleFileDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const files = Array.from(e.dataTransfer.files).filter(
        (file) =>
          file.type === "application/json" || file.name.endsWith(".json"),
      );

      if (files.length === 0) {
        toast.warning("未找到有效的JSON文件", "请确保拖放的是JSON文件");

        return;
      }

      // 处理每个文件
      files.forEach((file) => {
        const reader = new FileReader();

        reader.onload = (event) => {
          try {
            const content = event.target?.result as string;

            // 创建新标签并设置内容
            addTab(file.name, content);
            setShowAddMenu(false);
            toast.success("文件上传成功");
          } catch (error) {
            toast.error(
              "文件处理失败",
              error instanceof Error ? error.message : "请确保文件格式正确",
            );
          }
        };

        reader.onerror = () => {
          toast.error("文件读取失败", "请确保文件可访问且格式正确");
        };

        reader.readAsText(file);
      });
    }
  };

  // 处理拖拽进入
  const handleDragEnter = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };

  // 处理拖拽离开
  const handleDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  };

  // 处理拖拽经过
  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
  };

  return (
    <div
      className={cn(
        "flex flex-col overflow-hidden border-b border-default-200 pb-0.5 relative",
        {
          "bg-default-100": !isDragging,
          "bg-primary-50/40 dark:bg-primary-900/20": isDragging,
        },
      )}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleFileDrop}
    >
      <div className="flex items-center relative">
        <div className="sticky left-0 z-10 h-full flex items-center pr-1 shadow-[4px_0_8px_-1px_rgba(0,0,0,0.05)] dark:shadow-[4px_0_8px_-1px_rgba(0,0,0,0.2)]">
          <div
            ref={addButtonRef}
            aria-label="添加新标签页"
            className="sticky left-0 z-50 cursor-pointer p-1.5 ml-1.5 flex-shrink-0 bg-default-100 hover:bg-default-200 rounded-lg text-default-600 transition-colors"
            role="button"
            tabIndex={0}
            onClick={handleAddButtonClick}
            onContextMenu={(e) => {
              e.preventDefault();
              e.stopPropagation();
              toggleAddMenu();
            }}
            onKeyDown={(e) =>
              handleKeyDown(e, () => {
                toggleAddMenu();
              })
            }
          >
            <Icon icon="solar:add-square-linear" width={fontSizeConfig.icon} />
          </div>
        </div>

        <div
          ref={tabContainerRef}
          className="flex-grow h-10 overflow-x-auto scrollbar-hide"
          style={{
            scrollBehavior: "auto",
            willChange: "scroll-position",
            WebkitOverflowScrolling: "touch",
            transform: "translateZ(0)", // 启用硬件加速
            overflowX: "auto", // 确保水平滚动
            overflowY: "hidden", // 禁用垂直滚动
          }}
          onWheel={handleWheel}
        >
          <Tabs
            ref={tabListRef}
            aria-label="标签页"
            classNames={{
              tabList: `gap-1 w-full h-10 relative rounded-none p-0 pr-4 ml-2 overflow-x-visible flex-shrink-0`,
              tab: `max-w-fit px-1.5 h-10 flex-shrink-0 data-[hover=true]:bg-default-100 rounded-t-md transition-colors font-size-tab`,
              cursor: "w-full",
              panel:
                "flex-grow overflow-auto border-t border-divider px-0 pb-0 pt-1",
            }}
            disabledKeys={tabDisableKeys}
            selectedKey={activeTabKey}
            style={{
              // 使用动态字体大小
              fontSize: fontSizeConfig.tab,
              lineHeight: fontSizeConfig.lineHeight,
            }}
            variant="underlined"
            onSelectionChange={(key) => setActiveTab(key as string)}
          >
            {tabs.map((tab: TabItem) => (
              <Tab
                key={tab.key}
                title={
                  <div
                    className={cn("flex items-center space-x-2 z-40", {
                      "opacity-0": editingTab === tab.key,
                    })}
                    data-key={tab.key}
                    role="button"
                    tabIndex={0}
                    onContextMenu={(e) => handleContextMenu(tab, e)}
                    onDoubleClick={(e) => handleDoubleClick(tab, e)}
                  >
                    <>
                      <span className="select-none text-sm">{tab.title}</span>
                      {tab.extraData?.url && (
                        <div
                          aria-label="刷新数据"
                          className="rounded-full cursor-pointer flex items-center justify-center z-10 h-6 px-1 !ml-1 text-default-400 hover:text-default-600 hover:bg-default-200 transition-colors"
                          role="button"
                          tabIndex={0}
                          onClick={(e) => {
                            showRefreshConfirm(
                              tab.key,
                              tab.extraData?.url as string,
                            );
                            e.stopPropagation();
                            e.preventDefault();
                          }}
                          onKeyDown={(e) => {
                            handleKeyDown(e, () => {
                              showRefreshConfirm(
                                tab.key,
                                tab.extraData?.url as string,
                              );
                            });
                            e.stopPropagation();
                            e.preventDefault();
                          }}
                        >
                          <Icon
                            icon="solar:refresh-linear"
                            width={fontSizeConfig.icon}
                          />
                        </div>
                      )}
                      {tab.closable && (
                        <div
                          aria-label="关闭标签页"
                          className="rounded-full cursor-pointer flex items-center justify-center z-10 h-6 px-1 !ml-1 text-default-400 hover:text-default-600 hover:bg-default-200 transition-colors"
                          role="button"
                          tabIndex={0}
                          onClick={(e) => {
                            closeTab(tab.key);
                            onClose?.([tab.key]);
                            e.stopPropagation();
                            e.preventDefault();
                          }}
                          onKeyDown={(e) => {
                            handleKeyDown(e, () => {
                              closeTab(tab.key);
                              onClose?.([tab.key]);
                            });
                            e.stopPropagation();
                            e.preventDefault();
                          }}
                          onMouseEnter={() => setTabDisableKeys([tab.key])}
                          onMouseLeave={() => setTabDisableKeys([])}
                        >
                          <IcRoundClose width={fontSizeConfig.icon} />
                        </div>
                      )}
                    </>
                  </div>
                }
              />
            ))}
          </Tabs>
        </div>
      </div>

      {/* 拖放区域指示器 */}
      {isDragging && (
        <div className="absolute inset-0 bg-primary-50/40 dark:bg-primary-800/30 border-2 border-dashed border-primary/50 dark:border-primary-400/70 rounded-lg flex items-center justify-center z-50 pointer-events-none">
          <div className="bg-background/90 dark:bg-background/80 px-6 py-3 rounded-lg shadow-lg flex items-center gap-3">
            <Icon className="text-primary text-xl" icon="solar:upload-linear" />
            <span className="text-sm font-medium">释放鼠标上传JSON文件</span>
          </div>
        </div>
      )}

      {/* 渲染重命名输入框 */}
      {renderRenameInput()}
      {renderTabContextMenu()}
      {renderAddMenu()}

      {/* 刷新确认弹窗 */}
      <Modal
        classNames={{
          backdrop: "bg-black/40 backdrop-blur-md",
          base: "border-none rounded-xl overflow-hidden shadow-2xl max-w-xl",
          header: "border-none",
          footer: "border-none py-4",
          closeButton: "hover:bg-white/10",
        }}
        isOpen={refreshConfirmOpen}
        motionProps={{
          variants: {
            enter: {
              opacity: 1,
              scale: 1,
              y: 0,
              transition: { duration: 0.4, ease: [0.22, 1, 0.36, 1] },
            },
            exit: {
              opacity: 0,
              scale: 0.98,
              y: 10,
              transition: { duration: 0.3, ease: [0.22, 1, 0.36, 1] },
            },
          },
        }}
        placement="center"
        onClose={() => setRefreshConfirmOpen(false)}
      >
        <ModalContent>
          {(onClose) => (
            <>
              <div className="absolute inset-0 bg-gradient-to-br from-primary-100 to-background/80 dark:from-background dark:to-primary-950/5 -z-10" />

              <ModalHeader className="flex flex-col gap-1 pt-6 pb-0">
                <div className="flex items-center gap-3">
                  <span className="text-lg font-medium">
                    {" "}
                    确定要从 URL 获取最新数据吗？
                  </span>
                </div>
              </ModalHeader>

              <ModalBody className="py-5">
                <div className="space-y-5">
                  <div>
                    <p className="text-default-700 text-base dark:text-default-500">
                      当前标签页数据将被最新内容覆盖。
                    </p>
                  </div>

                  <div className="p-4 bg-black/5 dark:bg-white/[0.03] border border-default-200/50 dark:border-white/[0.06] rounded-xl backdrop-blur-sm">
                    <div className="flex items-start gap-3">
                      <div className="flex-1 overflow-hidden">
                        <p className="font-medium text-default-700 dark:text-default-300/90 mb-1.5">
                          数据源地址
                        </p>
                        <div className="group relative">
                          <p
                            className="text-default-500 dark:text-default-500/80 break-all line-clamp-2 group-hover:line-clamp-none transition-all duration-300 pr-8"
                            title={refreshTabInfo?.url}
                          >
                            {refreshTabInfo?.url}
                          </p>
                          <div className="absolute right-0 top-0 opacity-0 group-hover:opacity-100 transition-opacity">
                            <Tooltip content="复制链接">
                              <div
                                className="p-1.5 rounded-md hover:bg-default-200/70 dark:hover:bg-default-700/70 cursor-pointer"
                                role="button"
                                tabIndex={0}
                                onClick={() => {
                                  if (refreshTabInfo?.url) {
                                    navigator.clipboard.writeText(
                                      refreshTabInfo.url,
                                    );
                                    toast.success("链接已复制到剪贴板");
                                  }
                                }}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter" || e.key === " ") {
                                    e.preventDefault();
                                    if (refreshTabInfo?.url) {
                                      navigator.clipboard.writeText(
                                        refreshTabInfo.url,
                                      );
                                      toast.success("链接已复制到剪贴板");
                                    }
                                  }
                                }}
                              >
                                <Icon
                                  icon="solar:copy-linear"
                                  width={fontSizeConfig.icon}
                                />
                              </div>
                            </Tooltip>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </ModalBody>

              <ModalFooter className="flex gap-3 justify-end pb-6">
                <Button
                  className="font-medium text-default-700 dark:text-default-400 min-w-[80px]"
                  radius="full"
                  size="md"
                  variant="light"
                  onPress={onClose}
                >
                  取消
                </Button>
                <Button
                  className="font-medium bg-gradient-to-r from-primary-500 to-primary-600 dark:from-primary-600/90 dark:to-primary-700/90 border-none min-w-[120px]"
                  color="primary"
                  radius="full"
                  size="md"
                  startContent={
                    <Icon
                      className="animate-spin-slow dark:text-white/80"
                      icon="solar:refresh-broken"
                      width={18}
                    />
                  }
                  onPress={handleConfirmRefresh}
                >
                  刷新数据
                </Button>
              </ModalFooter>
            </>
          )}
        </ModalContent>
      </Modal>
    </div>
  );
};

export default DynamicTabs;
