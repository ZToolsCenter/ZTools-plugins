import React, { useEffect, useRef, useState, useCallback } from "react";
import { Button, cn, Select, SelectItem, Slider, Switch } from "@heroui/react";
import { Icon } from "@iconify/react";

import { useTabStore } from "@/store/useTabStore";
import { useSettingsStore } from "@/store/useSettingsStore";
import {
  setBase64DecorationEnabled,
  setBase64ProviderEnabled,
} from "@/components/monacoEditor/decorations/base64Decoration.ts";
import {
  setUnicodeDecorationEnabled,
  setUnicodeProviderEnabled,
} from "@/components/monacoEditor/decorations/unicodeDecoration.ts";
import {
  setUrlDecorationEnabled,
  setUrlProviderEnabled,
} from "@/components/monacoEditor/decorations/urlDecoration.ts";

// 定义菜单位置类型
interface MenuPosition {
  x: number;
  y: number;
}

// 定义停靠位置类型
type DockPosition = "left" | "right" | "top" | "bottom" | null;

// 定义支持的语言列表
export const SUPPORTED_LANGUAGES = [
  { id: "json", name: "JSON", icon: "vscode-icons:file-type-json" },
  { id: "json5", name: "JSON5", icon: "vscode-icons:file-type-json" },
  { id: "yaml", name: "YAML", icon: "vscode-icons:file-type-yaml" },
  { id: "xml", name: "XML", icon: "vscode-icons:file-type-xml" },
  { id: "toml", name: "TOML", icon: "vscode-icons:file-type-toml" },
  { id: "go", name: "Go", icon: "vscode-icons:file-type-go" },
  {
    id: "javascript",
    name: "JavaScript",
    icon: "vscode-icons:file-type-js-official",
  },
  {
    id: "typescript",
    name: "TypeScript",
    icon: "vscode-icons:file-type-typescript-official",
  },
  { id: "html", name: "HTML", icon: "vscode-icons:file-type-html" },
  { id: "css", name: "CSS", icon: "vscode-icons:file-type-css" },
  { id: "python", name: "Python", icon: "vscode-icons:file-type-python" },
  { id: "java", name: "Java", icon: "vscode-icons:file-type-java" },
  { id: "csharp", name: "C#", icon: "vscode-icons:file-type-csharp" },
  { id: "cpp", name: "C++", icon: "vscode-icons:file-type-cpp" },
  { id: "markdown", name: "Markdown", icon: "vscode-icons:file-type-markdown" },
  { id: "sql", name: "SQL", icon: "vscode-icons:file-type-sql" },
  { id: "shell", name: "Shell", icon: "vscode-icons:file-type-shell" },
];

interface DraggableMenuProps {
  containerRef: React.RefObject<HTMLDivElement | null>;
  onLanguageChange: (language: string) => void;
  onFontSizeChange: (fontSize: number) => void;
  onIndentSizeChange: (indentSize: number) => void;
  onReset: () => void;
  currentLanguage: string;
  currentFontSize: number;
  currentIndentSize: number;
  tabKey: string;
  timestampDecoratorsEnabled?: boolean; // 添加时间戳装饰器状态
  onTimestampDecoratorsChange?: (enabled: boolean) => void; // 添加时间戳装饰器状态变更函数
  base64DecoratorsEnabled?: boolean; // 添加Base64装饰器状态
  unicodeDecoratorsEnabled?: boolean; // 添加Unicode装饰器状态
  urlDecoratorsEnabled?: boolean; // 添加URL装饰器状态
  imageDecoratorsEnabled?: boolean; // 添加图片装饰器状态
  onBase64DecoratorsChange?: (enabled: boolean) => void; // 添加Base64装饰器状态变更函数
  onUnicodeDecoratorsChange?: (enabled: boolean) => void; // 添加Unicode装饰器状态变更函数
  onUrlDecoratorsChange?: (enabled: boolean) => void; // 添加URL装饰器状态变更函数
  onImageDecoratorsChange?: (enabled: boolean) => void; // 添加图片装饰器状态变更函数
}

const DraggableMenu: React.FC<DraggableMenuProps> = ({
  containerRef,
  onLanguageChange,
  onFontSizeChange,
  onIndentSizeChange,
  onReset,
  currentLanguage,
  currentFontSize,
  currentIndentSize,
  tabKey,
  timestampDecoratorsEnabled,
  onTimestampDecoratorsChange,
  imageDecoratorsEnabled,
  onImageDecoratorsChange,
}) => {
  const { updateEditorSettings, activeTab, activeTabKey } = useTabStore();
  const {
    base64DecoderEnabled,
    unicodeDecoderEnabled,
    urlDecoderEnabled,
    setBase64DecoderEnabled,
    setUnicodeDecoderEnabled,
    setUrlDecoderEnabled,
    timestampDecoderEnabled, // 获取全局时间戳解码器设置
  } = useSettingsStore();

  // 根据全局设置确定局部开关实际状态
  // 如果传入的timestampDecoratorsEnabled为undefined，则使用全局设置
  // 否则使用传入的值，但不能超过全局设置的权限
  const actualTimestampDecoratorsEnabled =
    timestampDecoratorsEnabled !== undefined
      ? timestampDecoderEnabled && timestampDecoratorsEnabled // 如果全局关闭，强制局部也关闭
      : timestampDecoderEnabled; // 默认继承全局设置

  const [menuPosition, setMenuPosition] = useState<MenuPosition>({
    x: 0,
    y: 300,
  });
  const [isDragging, setIsDragging] = useState(false);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [dockedPosition, setDockedPosition] = useState<DockPosition>("right"); // 默认右侧停靠
  const [isHide, setIsHide] = useState(true);
  const [isPositionCalculated, setIsPositionCalculated] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLDivElement>(null);
  // 添加延时关闭的定时器引用
  const closeTimerRef = useRef<NodeJS.Timeout | null>(null);

  // 保存拖动状态，避免状态更新引起的重渲染
  const dragStateRef = useRef({
    startX: 0,
    startY: 0,
    initialX: 0,
    initialY: 0,
    dx: 0,
    dy: 0,
    animationFrameId: 0,
  });

  // 处理Base64解码器状态变化
  const handleBase64DecodersChange = (enabled: boolean) => {
    // 更新全局状态
    setBase64DecoderEnabled(enabled);
    setBase64ProviderEnabled(enabled);
    setBase64DecorationEnabled(enabled);
  };

  // 处理Unicode解码器状态变化
  const handleUnicodeDecodersChange = (enabled: boolean) => {
    // 更新全局状态
    setUnicodeDecoderEnabled(enabled);
    setUnicodeProviderEnabled(enabled);
    setUnicodeDecorationEnabled(enabled);
  };

  // 处理URL解码器状态变化
  const handleUrlDecodersChange = (enabled: boolean) => {
    // 更新全局状态
    setUrlDecoderEnabled(enabled);
    setUrlProviderEnabled(enabled);
    setUrlDecorationEnabled(enabled);
  };

  // 处理时间戳装饰器状态变化
  const handleTimestampDecoratorsChange = (enabled: boolean) => {
    // 如果全局设置为关闭，则不允许开启局部设置
    if (!timestampDecoderEnabled && enabled) {
      return; // 全局关闭时，不允许开启局部设置
    }

    if (onTimestampDecoratorsChange) {
      onTimestampDecoratorsChange(enabled);
    }
  };

  // 同步全局设置到Monaco编辑器
  useEffect(() => {
    // 同步全局设置到Monaco装饰器
    setBase64DecorationEnabled(base64DecoderEnabled);
    setBase64ProviderEnabled(base64DecoderEnabled);
    setUnicodeDecorationEnabled(unicodeDecoderEnabled);
    setUnicodeProviderEnabled(unicodeDecoderEnabled);
    setUrlDecorationEnabled(urlDecoderEnabled);
    setUrlProviderEnabled(urlDecoderEnabled);
  }, [base64DecoderEnabled, unicodeDecoderEnabled, urlDecoderEnabled]);

  // 全局设置变化时，确保局部设置不超出全局权限
  useEffect(() => {
    // 如果全局时间戳解码器被禁用，强制关闭局部设置
    if (
      !timestampDecoderEnabled &&
      actualTimestampDecoratorsEnabled &&
      onTimestampDecoratorsChange
    ) {
      onTimestampDecoratorsChange(false);
    }
  }, [
    timestampDecoderEnabled,
    actualTimestampDecoratorsEnabled,
    onTimestampDecoratorsChange,
  ]);

  useEffect(() => {
    updateEditorSettings(tabKey, {
      fontSize: currentFontSize,
      language: currentLanguage,
      indentSize: currentIndentSize,
      timestampDecoratorsEnabled: actualTimestampDecoratorsEnabled,
    });
  }, [
    currentLanguage,
    currentFontSize,
    currentIndentSize,
    actualTimestampDecoratorsEnabled,
    tabKey,
    updateEditorSettings,
  ]);

  // 重新计算菜单位置的函数
  const recalculatePosition = useCallback(() => {
    if (containerRef.current && menuRef.current) {
      const containerRect = containerRef.current.getBoundingClientRect();
      const menuWidth = menuRef.current.offsetWidth;
      const menuHeight = menuRef.current.offsetHeight;

      let x = menuPosition.x;
      let y = menuPosition.y;

      // 根据停靠位置调整
      if (dockedPosition === "right") {
        x = containerRect.width - menuWidth / 2;
        // 确保Y坐标不超出容器底部
        y = Math.min(containerRect.height - menuHeight, Math.max(0, y));
      } else if (dockedPosition === "left") {
        x = -menuWidth / 2;
        // 确保Y坐标不超出容器底部
        y = Math.min(containerRect.height - menuHeight, Math.max(0, y));
      } else if (dockedPosition === "bottom") {
        // 确保X坐标不超出容器右侧
        x = Math.min(containerRect.width - menuWidth, Math.max(0, x));
        y = containerRect.height - menuHeight / 2;
      } else if (dockedPosition === "top") {
        // 确保X坐标不超出容器右侧
        x = Math.min(containerRect.width - menuWidth, Math.max(0, x));
        y = -menuHeight / 2;
      } else {
        // 确保菜单不会完全移出容器
        x = Math.min(
          containerRect.width - menuWidth / 4,
          Math.max(0, menuPosition.x),
        );
        y = Math.min(
          containerRect.height - menuHeight / 2,
          Math.max(0, menuPosition.y),
        );
      }

      // 确保菜单在窗口缩小时不会完全隐藏，至少保留一个可点击的区域
      if (dockedPosition === "right" && containerRect.width < menuWidth) {
        x = containerRect.width - menuWidth / 4; // 确保至少有1/4的菜单可见
      } else if (dockedPosition === "left" && containerRect.width < menuWidth) {
        x = (-menuWidth * 3) / 4; // 确保至少有1/4的菜单可见
      }

      // 应用新位置
      if (x !== menuPosition.x || y !== menuPosition.y) {
        setMenuPosition({ x, y });
      }
    }
  }, [menuPosition, containerRef, dockedPosition]);

  // 初始化位置到右下角，半隐藏
  useEffect(() => {
    requestAnimationFrame(() => {
      setTimeout(() => {
        if (containerRef.current && menuRef.current) {
          const containerRect = containerRef.current.getBoundingClientRect();
          const menuWidth = menuRef.current.offsetWidth;
          const menuHeight = menuRef.current.offsetHeight;

          // 计算位置：右下角，右侧隐藏一半
          const x = containerRect.width - menuWidth / 2;
          const y = containerRect.height - menuHeight - 80;

          setMenuPosition({ x, y });
          setDockedPosition("right");
        }
        setTimeout(() => {
          setIsPositionCalculated(true);
        }, 200);
      }, 500); // 添加较短的延迟，确保DOM更新完成
    });
  }, [containerRef]);

  // 处理窗口大小变化
  useEffect(() => {
    const handleResize = () => {
      recalculatePosition();
    };

    // 监听窗口大小变化
    window.addEventListener("resize", handleResize);

    // 定期检查容器尺寸变化（变通方案，适用于容器大小变化但不触发resize事件的情况）
    // 例如：AI面板打开/关闭，或其他可能影响布局的变化
    const intervalId = setInterval(recalculatePosition, 1000); // 减少到1秒以提高响应性

    // 监听可能导致布局变化的DOM变化
    const resizeObserver = new ResizeObserver(() => {
      recalculatePosition();
    });

    if (containerRef.current) {
      resizeObserver.observe(containerRef.current);
    }

    return () => {
      window.removeEventListener("resize", handleResize);
      clearInterval(intervalId);
      resizeObserver.disconnect();
    };
  }, [recalculatePosition]);

  // 开始拖动
  const startDrag = (clientX: number, clientY: number) => {
    setIsDragging(true);
    setIsHide(false);

    // 记录初始位置
    dragStateRef.current.startX = clientX;
    dragStateRef.current.startY = clientY;
    dragStateRef.current.initialX = menuPosition.x;
    dragStateRef.current.initialY = menuPosition.y;

    // 使用DOM直接操作，避免状态更新
    if (menuRef.current) {
      menuRef.current.style.transition = "none";
    }
  };

  // 处理拖动中的移动
  const handleDrag = (clientX: number, clientY: number) => {
    if (!isDragging || !menuRef.current || !containerRef.current) return;

    const { startX, startY } = dragStateRef.current;

    // 计算移动距离
    const dx = clientX - startX;
    const dy = clientY - startY;

    // 保存当前偏移量
    dragStateRef.current.dx = dx;
    dragStateRef.current.dy = dy;

    // 直接应用变换，不更新状态
    menuRef.current.style.transform = `translate(${dx}px, ${dy}px)`;
  };

  // 使用requestAnimationFrame优化拖动性能
  const updateDragAnimation = () => {
    if (isDragging) {
      dragStateRef.current.animationFrameId =
        requestAnimationFrame(updateDragAnimation);
    }
  };

  // 确定最近的边缘
  const determineClosestEdge = (x: number, y: number): DockPosition => {
    if (!containerRef.current || !menuRef.current) return "right";

    const containerRect = containerRef.current.getBoundingClientRect();
    const menuWidth = menuRef.current.offsetWidth;
    const menuHeight = menuRef.current.offsetHeight;

    // 计算到各边的距离
    const distToLeft = x;
    const distToRight = containerRect.width - (x + menuWidth);
    const distToTop = y;
    const distToBottom = containerRect.height - (y + menuHeight);

    // 找出最小距离对应的边
    const minDist = Math.min(distToLeft, distToRight, distToTop, distToBottom);

    if (minDist === distToLeft) return "left";
    if (minDist === distToRight) return "right";
    if (minDist === distToTop) return "top";

    return "bottom";
  };

  // 结束拖动 - 贴边并半隐藏
  const finishDrag = () => {
    if (!isDragging || !menuRef.current || !containerRef.current) return;

    cancelAnimationFrame(dragStateRef.current.animationFrameId);

    const { initialX, initialY, dx, dy } = dragStateRef.current;
    const containerRect = containerRef.current.getBoundingClientRect();
    const menuWidth = menuRef.current.offsetWidth;
    const menuHeight = menuRef.current.offsetHeight;

    // 计算中间位置
    let newX = initialX + dx;
    let newY = initialY + dy;

    // 确定最近的边缘
    const closestEdge = determineClosestEdge(newX, newY);

    // 根据最近的边缘调整位置（半隐藏）
    if (closestEdge === "left") {
      newX = -menuWidth / 2;
      newY = Math.min(containerRect.height - menuHeight, Math.max(0, newY));
    } else if (closestEdge === "right") {
      newX = containerRect.width - menuWidth / 2;
      newY = Math.min(containerRect.height - menuHeight, Math.max(0, newY));
    } else if (closestEdge === "top") {
      newX = Math.min(containerRect.width - menuWidth, Math.max(0, newX));
      newY = -menuHeight / 2;
    } else if (closestEdge === "bottom") {
      newX = Math.min(containerRect.width - menuWidth, Math.max(0, newX));
      newY = containerRect.height - menuHeight / 2;
    }

    // 确保菜单在窗口缩小时不会完全隐藏，至少保留一个可点击的区域
    if (closestEdge === "right" && containerRect.width < menuWidth) {
      newX = containerRect.width - menuWidth / 4; // 确保至少有1/4的菜单可见
    } else if (closestEdge === "left" && containerRect.width < menuWidth) {
      newX = (-menuWidth * 3) / 4; // 确保至少有1/4的菜单可见
    }

    // 使用FLIP技术避免弹跳
    // 1. 记录当前视觉位置
    const firstRect = menuRef.current.getBoundingClientRect();

    // 2. 立即更新实际位置（不带动画）
    menuRef.current.style.transition = "none";
    menuRef.current.style.transform = "";
    menuRef.current.style.left = `${newX}px`;
    menuRef.current.style.top = `${newY}px`;

    // 强制浏览器重新计算布局
    void menuRef.current.offsetWidth;

    // 3. 计算调整后的位置与之前视觉位置的差异
    const lastRect = menuRef.current.getBoundingClientRect();
    const diffX = firstRect.left - lastRect.left;
    const diffY = firstRect.top - lastRect.top;

    // 4. 应用反向变换，使元素保持在原来的视觉位置
    menuRef.current.style.transform = `translate(${diffX}px, ${diffY}px)`;

    // 强制浏览器重新计算布局
    void menuRef.current.offsetWidth;

    // 5. 平滑过渡到最终位置（包括贴边的变换）
    const dockTransform = getDockTransform(closestEdge);

    menuRef.current.style.transition = "transform 0.3s ease";
    menuRef.current.style.transform = dockTransform;

    // 保存位置到 store
    updateEditorSettings(tabKey, {
      fontSize: currentFontSize,
      language: currentLanguage,
      indentSize: currentIndentSize,
    });

    // 更新状态
    setMenuPosition({ x: newX, y: newY });
    setDockedPosition(closestEdge);
    setIsDragging(false);

    // 动画结束后移除过渡效果但保持变换
    const onTransitionEnd = () => {
      if (menuRef.current) {
        menuRef.current.style.transition = "";
      }
    };

    menuRef.current.addEventListener("transitionend", onTransitionEnd, {
      once: true,
    });
  };

  const toggleMenu = () => {
    clearCloseTimer(); // 清除可能存在的定时器
    setIsMenuOpen(!isMenuOpen);
  };

  // 监听全局鼠标事件
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      handleDrag(e.clientX, e.clientY);
    };

    const handleMouseUp = () => {
      finishDrag();
    };

    if (isDragging) {
      window.addEventListener("mousemove", handleMouseMove, { passive: true });
      window.addEventListener("mouseup", handleMouseUp);

      // 启动动画帧
      dragStateRef.current.animationFrameId =
        requestAnimationFrame(updateDragAnimation);

      return () => {
        window.removeEventListener("mousemove", handleMouseMove);
        window.removeEventListener("mouseup", handleMouseUp);
        cancelAnimationFrame(dragStateRef.current.animationFrameId);
      };
    }

    return undefined;
  }, [isDragging]);

  // 点击菜单外部关闭菜单
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        menuRef.current &&
        !menuRef.current.contains(e.target as Node) &&
        buttonRef.current &&
        !buttonRef.current.contains(e.target as Node) &&
        isMenuOpen
      ) {
        // 点击外部时立即关闭菜单，而不是延时关闭
        clearCloseTimer(); // 清除可能存在的定时器
        setIsMenuOpen(false);
        setIsHide(true);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [isMenuOpen]);

  // 计算当悬浮球停靠时的变换
  const getDockTransform = (position: DockPosition = dockedPosition) => {
    if (!position || isDragging) return "";

    // 鼠标悬停时不应用变换
    if (isHide) return "";

    // 对小容器做特殊处理
    if (position === "left") {
      // 返回默认变换
      return "translateX(50%)";
    }

    if (position === "right") {
      // 返回默认变换
      return "translateX(-50%)";
    }

    if (position === "top") return "translateY(50%)";
    if (position === "bottom") return "translateY(-50%)";

    return "";
  };

  // 移动检测容器宽度的逻辑到一个副作用函数中
  useEffect(() => {
    if (!isHide && menuRef.current && containerRef.current) {
      const containerWidth = containerRef.current.getBoundingClientRect().width;
      const menuWidth = menuRef.current.offsetWidth;

      // 根据容器宽度调整变换样式
      if (
        (dockedPosition === "left" || dockedPosition === "right") &&
        containerWidth < menuWidth
      ) {
        if (menuRef.current) {
          // 应用特殊变换
          const transform =
            dockedPosition === "left" ? "translateX(25%)" : "translateX(-25%)";

          menuRef.current.style.transform = transform;
        }
      }
    }
  }, [isHide, dockedPosition]);

  // 清除菜单关闭定时器的函数
  const clearCloseTimer = () => {
    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  };

  // 设置延时关闭菜单的函数
  // 添加600ms延迟，给用户足够的时间在悬浮菜单和菜单面板之间移动鼠标
  // 这样可以提高用户体验，避免菜单过早关闭
  const setCloseTimer = () => {
    clearCloseTimer();
    closeTimerRef.current = setTimeout(() => {
      setIsHide(true);
      setIsMenuOpen(false);
    }, 1000); // 600ms 后关闭菜单
  };

  // 确保组件卸载时清除定时器
  useEffect(() => {
    return () => {
      clearCloseTimer();
    };
  }, []);

  // 计算时间戳开关是否应该禁用
  // 当全局时间戳解码器为关闭状态时，禁用局部开关
  const isTimestampSwitchDisabled = !timestampDecoderEnabled;

  // 当tab key 相当时才渲染，解决diff编辑器重复渲染的问题
  if (activeTabKey !== tabKey) {
    return null;
  }

  return (
    <div
      ref={menuRef}
      className={cn(
        "absolute z-50",
        "transition-all duration-500 ease-in-out",
        isDragging
          ? "cursor-grabbing"
          : isMenuOpen
            ? "cursor-default"
            : "cursor-grab",
      )}
      style={{
        left: `${menuPosition.x}px`,
        top: `${menuPosition.y}px`,
        transition: isDragging
          ? "none"
          : "left 0.3s ease, top 0.3s ease, transform 0.3s ease, opacity 0.5s ease-in-out",
        transform: getDockTransform(),
        opacity: isPositionCalculated ? 1 : 0,
        visibility: isPositionCalculated ? "visible" : "hidden",
      }}
      onMouseEnter={() => {
        clearCloseTimer(); // 清除可能存在的关闭定时器
        if (dockedPosition) {
          setIsHide(false);
        }
      }}
      onMouseLeave={() => {
        setCloseTimer(); // 设置延时关闭定时器
      }}
    >
      {/* 拖动手柄区域 */}
      <div
        aria-label="拖动设置菜单"
        className={cn(
          "absolute -top-3 -left-3 -right-3 -bottom-3",
          isMenuOpen ? "cursor-default" : "cursor-grab",
          isMenuOpen && "pointer-events-none", // 菜单打开时禁用拖动手柄
        )}
        role="button"
        style={{
          touchAction: "none",
          zIndex: -1,
        }}
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
          }
        }}
        onMouseDown={(e) => {
          if (isMenuOpen) return; // 菜单打开时不允许拖动
          e.preventDefault();
          e.stopPropagation();
          startDrag(e.clientX, e.clientY);
        }}
      />

      {/* 菜单按钮 */}
      <div
        ref={buttonRef}
        aria-expanded={isMenuOpen}
        aria-label="打开设置菜单"
        className={cn(
          "w-10 h-10 flex items-center justify-center rounded-full shadow-lg cursor-pointer",
          "bg-gradient-to-r from-blue-500 to-indigo-600 dark:from-blue-600 dark:to-indigo-700",
          "transform transition-all duration-300 hover:scale-110 active:scale-95",
          "ring-2 ring-white/50 hover:ring-white/80 dark:ring-blue-400/30 dark:hover:ring-blue-400/60",
          "backdrop-blur-md",
          isMenuOpen ? "rotate-180" : "",
        )}
        role="button"
        tabIndex={0}
        onClick={toggleMenu}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            toggleMenu();
          }
        }}
      >
        <Icon
          aria-hidden="true"
          className="text-white w-5 h-5"
          icon="heroicons:cog-6-tooth"
          style={{
            filter: "drop-shadow(0 1px 2px rgba(0,0,0,0.2))",
          }}
        />
      </div>

      {/* 菜单面板 */}
      <div
        aria-label="编辑器设置菜单"
        className={cn(
          "absolute rounded-xl overflow-hidden transition-all duration-300",
          "bg-white/90 dark:bg-gray-800/90 backdrop-blur-md",
          "shadow-lg dark:shadow-gray-900/30 border border-gray-200/50 dark:border-gray-700/50",
          isMenuOpen
            ? "opacity-100 scale-100 translate-y-0"
            : "opacity-0 scale-95 translate-y-2 pointer-events-none",
        )}
        role="dialog"
        style={{
          bottom: "calc(100% + 10px)",
          right: 0,
          transformOrigin: "bottom right",
          width: "450px",
        }}
        onMouseEnter={clearCloseTimer}
        onMouseLeave={setCloseTimer}
      >
        {/* 菜单头部 */}
        <div className="bg-gradient-to-r from-blue-500/90 to-indigo-600/90 dark:from-blue-600/90 dark:to-indigo-700/90 p-4 text-white">
          <h3 className="text-sm font-medium flex items-center">
            <Icon
              className="mr-2"
              icon="heroicons:adjustments-horizontal"
              width={20}
            />
            {activeTab().title} 的编辑器设置
          </h3>
        </div>

        <div className="p-5 space-y-5">
          {/* 语言选择器 */}
          <div className="space-y-2">
            <label
              className="block text-xs uppercase tracking-wide font-semibold text-gray-600 dark:text-gray-300"
              htmlFor="language-select"
            >
              编辑器语言
            </label>
            <Select
              aria-label="选择编程语言"
              className="w-full"
              color="primary"
              id="language-select"
              radius="sm"
              selectedKeys={[currentLanguage]}
              size="sm"
              startContent={
                <Icon
                  className="mr-1 text-primary"
                  icon={
                    SUPPORTED_LANGUAGES.find(
                      (lang) => lang.id === currentLanguage,
                    )?.icon || ""
                  }
                  width={18}
                />
              }
              variant="bordered"
              onChange={(e) => onLanguageChange(e.target.value)}
            >
              {SUPPORTED_LANGUAGES.map((lang) => (
                <SelectItem
                  key={lang.id}
                  aria-label={lang.name}
                  startContent={
                    <Icon className="mr-2" icon={lang.icon} width={18} />
                  }
                >
                  {lang.name}
                </SelectItem>
              ))}
            </Select>
          </div>

          {/* 分隔线 */}
          <div className="h-px bg-gray-200 dark:bg-gray-700/40" />

          {/* 时间戳格式化开关 */}
          {onTimestampDecoratorsChange && (
            <div className="flex items-center justify-between px-1">
              <div className="space-y-1">
                <label
                  className={`text-xs uppercase tracking-wide font-semibold ${
                    isTimestampSwitchDisabled
                      ? "text-gray-400 dark:text-gray-500"
                      : "text-gray-600 dark:text-gray-300"
                  }`}
                  htmlFor="timestamp-switch"
                >
                  时间戳格式化
                </label>
                <p
                  className={`text-xs ${
                    isTimestampSwitchDisabled
                      ? "text-gray-400 dark:text-gray-500"
                      : "text-gray-500 dark:text-gray-400"
                  }`}
                >
                  {isTimestampSwitchDisabled
                    ? "全局时间戳解码器已禁用，请在设置中启用"
                    : "自动识别并格式化Unix时间戳"}
                </p>
              </div>
              <Switch
                aria-label="时间戳格式化开关"
                color="primary"
                id="timestamp-switch"
                isDisabled={isTimestampSwitchDisabled}
                isSelected={actualTimestampDecoratorsEnabled}
                size="sm"
                onChange={() =>
                  handleTimestampDecoratorsChange(
                    !actualTimestampDecoratorsEnabled,
                  )
                }
              />
            </div>
          )}

          {/* Base64解码器开关 */}
          <div className="flex items-center justify-between px-1">
            <div className="space-y-1">
              <label
                className="text-xs uppercase tracking-wide font-semibold text-gray-600 dark:text-gray-300"
                htmlFor="base64-switch"
              >
                Base64解码器(全局)
              </label>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                自动识别并显示Base64字符串解码结果
              </p>
            </div>
            <Switch
              aria-label="Base64解码器开关"
              color="primary"
              id="base64-switch"
              isSelected={base64DecoderEnabled}
              size="sm"
              onChange={() => handleBase64DecodersChange(!base64DecoderEnabled)}
            />
          </div>

          {/* Unicode解码器开关 */}
          <div className="flex items-center justify-between px-1">
            <div className="space-y-1">
              <label
                className="text-xs uppercase tracking-wide font-semibold text-gray-600 dark:text-gray-300"
                htmlFor="unicode-switch"
              >
                Unicode解码器(全局)
              </label>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                自动识别并显示Unicode转义序列的解码结果
              </p>
            </div>
            <Switch
              aria-label="Unicode解码器开关"
              color="primary"
              id="unicode-switch"
              isSelected={unicodeDecoderEnabled}
              size="sm"
              onChange={() =>
                handleUnicodeDecodersChange(!unicodeDecoderEnabled)
              }
            />
          </div>

          {/* URL解码器开关 */}
          <div className="flex items-center justify-between px-1">
            <div className="space-y-1">
              <label
                className="text-xs uppercase tracking-wide font-semibold text-gray-600 dark:text-gray-300"
                htmlFor="url-switch"
              >
                URL解码器(全局)
              </label>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                自动识别并显示URL编码字符串的解码结果
              </p>
            </div>
            <Switch
              aria-label="URL解码器开关"
              color="primary"
              id="url-switch"
              isSelected={urlDecoderEnabled}
              size="sm"
              onChange={() => handleUrlDecodersChange(!urlDecoderEnabled)}
            />
          </div>

          {/* 图片预览装饰器开关 */}
          {onImageDecoratorsChange && (
            <div className="flex items-center justify-between px-1">
              <div className="space-y-1">
                <label
                  className="text-xs uppercase tracking-wide font-semibold text-gray-600 dark:text-gray-300"
                  htmlFor="image-decoration-switch"
                >
                  图片预览装饰器
                </label>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  自动识别图片URL并显示预览按钮
                </p>
              </div>
              <Switch
                aria-label="图片预览装饰器开关"
                color="primary"
                id="image-decoration-switch"
                isSelected={imageDecoratorsEnabled ?? true}
                size="sm"
                onChange={() =>
                  onImageDecoratorsChange &&
                  onImageDecoratorsChange(!(imageDecoratorsEnabled ?? true))
                }
              />
            </div>
          )}

          {/* 分隔线 */}
          <div className="h-px bg-gray-200 dark:bg-gray-700/40" />

          {/* 字体大小滑块 */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label
                className="text-xs uppercase tracking-wide font-semibold text-gray-600 dark:text-gray-300"
                htmlFor="font-size-slider"
              >
                字体大小
              </label>
              <span className="text-sm font-medium text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-700/50 px-2 py-0.5 rounded">
                {currentFontSize}px
              </span>
            </div>
            <Slider
              aria-label="调整字体大小"
              className="w-full"
              color="primary"
              id="font-size-slider"
              maxValue={24}
              minValue={12}
              size="sm"
              step={1}
              value={currentFontSize}
              onChange={(value) => onFontSizeChange(value as number)}
            />
            <div className="flex justify-between text-xs text-gray-500">
              <span>小</span>
              <span>大</span>
            </div>
          </div>

          {/* 缩进大小滑块 */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label
                className="text-xs uppercase tracking-wide font-semibold text-gray-600 dark:text-gray-300"
                htmlFor="indent-size-slider"
              >
                缩进大小
              </label>
              <span className="text-sm font-medium text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-700/50 px-2 py-0.5 rounded">
                {currentIndentSize}空格
              </span>
            </div>
            <Slider
              aria-label="调整缩进大小"
              className="w-full"
              color="primary"
              id="indent-size-slider"
              maxValue={8}
              minValue={1}
              size="sm"
              step={1}
              value={currentIndentSize}
              onChange={(value) => onIndentSizeChange(value as number)}
            />
            <div className="flex justify-between text-xs text-gray-500">
              <span>紧凑</span>
              <span>宽松</span>
            </div>
          </div>

          {/* 重置按钮 */}
          <Button
            aria-label="重置设置"
            className="w-full mt-2"
            color="primary"
            radius="sm"
            startContent={
              <Icon aria-hidden="true" icon="heroicons:arrow-path" width={16} />
            }
            variant="flat"
            onPress={onReset}
          >
            恢复默认设置
          </Button>
        </div>
      </div>
    </div>
  );
};

export default DraggableMenu;
