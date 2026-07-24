import * as monaco from "monaco-editor";
import { editor } from "monaco-editor";
import { RefObject } from "react";

import { DecorationManager } from "./decorationManager.ts";

// 图片URL正则表达式，支持多种图片格式
export const IMAGE_URL_REGEX =
  /(https?:\/\/\S*\.(jpg|jpeg|png|gif|webp|svg|bmp|ico)(\?\S*)?)/gi;

// 最大显示解码长度（图片URL）
const MAX_DISPLAY_URL_LENGTH = 60;

// 最大匹配数量限制
const MAX_MATCH_COUNT = 100;

// 定义图片装饰器接口
export interface ImageDecoratorState {
  editorRef: RefObject<editor.IStandaloneCodeEditor | null>;
  hoverProviderId: RefObject<monaco.IDisposable | null>;
  updateTimeoutRef: RefObject<NodeJS.Timeout | null>;
  decorationManagerRef: RefObject<DecorationManager | null>;
  cacheRef: RefObject<Record<string, boolean>>;
  enabled: boolean;
  theme: string;
  editorPrefix?: string; // 编辑器类型前缀，用于区分左右编辑器
}

// 主题检测工具函数
const getCurrentTheme = (): string => {
  return document.documentElement.classList.contains("dark") ? "dark" : "light";
};

// 获取当前主题对应的样式
const getThemeStyles = (theme?: string) => {
  const currentTheme = theme || getCurrentTheme();
  const isDark = currentTheme === "dark";

  return {
    linkBgColor: isDark ? "#374151" : "#f3f4f6",
    linkTextColor: isDark ? "#9ca3af" : "#6b7280",
    linkBorderColor: isDark ? "#4b5563" : "#e5e7eb",
    hoverBgColor: isDark ? "#4b5563" : "#e5e7eb",
    successBgColor: isDark ? "#065f46" : "#10b981",
    successBorderColor: isDark ? "#047857" : "#059669",
  };
};

// 全局启用状态控制
let isImageDecorationEnabled = true; // 下划线装饰器全局启用状态
let isImageProviderEnabled = false; // 全局图片悬停提供者启用状态（已禁用）

// 图片预览弹窗管理器
class ImagePreviewManager {
  private static instance: ImagePreviewManager;
  private currentPreview: HTMLElement | null = null;
  private themeObserver: MutationObserver | null = null;
  private copyTimeout: NodeJS.Timeout | null = null; // 跟踪复制超时
  // 跟踪 document 级事件监听器，确保能完整清理
  private activeEscHandler: ((e: KeyboardEvent) => void) | null = null;
  private activeClickHandler: ((e: MouseEvent) => void) | null = null;

  static getInstance(): ImagePreviewManager {
    if (!ImagePreviewManager.instance) {
      ImagePreviewManager.instance = new ImagePreviewManager();
    }

    return ImagePreviewManager.instance;
  }

  private setupThemeObserver() {
    if (this.themeObserver) return;

    this.themeObserver = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        if (
          mutation.type === "attributes" &&
          mutation.attributeName === "class"
        ) {
          // 如果有当前预览，重新渲染以应用新主题
          if (this.currentPreview) {
            const imageUrl = this.currentPreview.getAttribute("data-image-url");
            const positionStr =
              this.currentPreview.getAttribute("data-position");

            if (imageUrl && positionStr) {
              try {
                const position = JSON.parse(positionStr);
                const currentTheme = getCurrentTheme();

                this.hideImagePreview();
                setTimeout(() => {
                  this.showImagePreview(imageUrl, position, currentTheme);
                }, 100);
              } catch {
                // 忽略解析错误
              }
            }
          }
          // 清除复制超时
          if (this.copyTimeout) {
            clearTimeout(this.copyTimeout);
            this.copyTimeout = null;
          }
        }
      });
    });

    this.themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });
  }

  showImagePreview(
    imageUrl: string,
    position: { x: number; y: number },
    theme: string = "light",
  ) {
    this.hideImagePreview();

    // 设置主题监听器
    this.setupThemeObserver();

    const preview = document.createElement("div");
    const isDarkMode = theme === "dark";

    // 保存数据用于主题切换时重新渲染
    preview.setAttribute("data-image-url", imageUrl);
    preview.setAttribute("data-position", JSON.stringify(position));

    preview.className = "image-preview-container";
    preview.style.cssText = `
      position: fixed;
      background: ${isDarkMode ? "#1f2937" : "#ffffff"};
      border: 1px solid ${isDarkMode ? "#374151" : "#e5e7eb"};
      border-radius: 12px;
      box-shadow: 0 4px 6px -1px ${isDarkMode ? "rgba(0, 0, 0, 0.3)" : "rgba(0, 0, 0, 0.1)"},
                  0 2px 4px -1px ${isDarkMode ? "rgba(0, 0, 0, 0.2)" : "rgba(0, 0, 0, 0.06)"};
      padding: 12px;
      z-index: 100000;
      max-width: min(80vw, 500px);
      max-height: 70vh;
      overflow: hidden;
      cursor: pointer;
      backdrop-filter: blur(20px);
      animation: fadeInScale 0.2s ease-out;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
    `;

    const img = document.createElement("img");

    img.src = imageUrl;
    img.style.cssText = `
      max-width: 100%;
      max-height: 35vh;
      min-height: 80px;
      display: none;
      border-radius: 8px;
      object-fit: contain;
    `;

    // 统一的状态容器样式(加载中和错误都使用这个)
    const statusBgColor = isDarkMode ? "#1f2937" : "#f9fafb";
    const statusTextColor = isDarkMode ? "#9ca3af" : "#6b7280";
    const statusBorderColor = isDarkMode ? "#374151" : "#e5e7eb";
    const statusIconColor = isDarkMode ? "#6b7280" : "#9ca3af";
    const loadingAccentColor = isDarkMode ? "#60a5fa" : "#3b82f6";
    const loadingBgColor = isDarkMode ? "#374151" : "#e5e7eb";

    const statusContainer = document.createElement("div");

    statusContainer.style.cssText = `
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 12px;
      padding: 60px 30px;
      color: ${statusTextColor};
      background: ${statusBgColor};
      border-radius: 12px;
      margin: 8px 0;
      border: 1px solid ${statusBorderColor};
    `;

    // 加载中的内容
    statusContainer.innerHTML = `
      <div style="
        width: 32px;
        height: 32px;
        border-radius: 50%;
        background: conic-gradient(from 0deg, ${loadingAccentColor} 0deg 90deg, ${loadingBgColor} 90deg);
        animation: spin 1s linear infinite;
        position: relative;
      ">
        <div style="
          width: 24px;
          height: 24px;
          border-radius: 50%;
          background: ${isDarkMode ? "#1f2937" : "#ffffff"};
          position: absolute;
          top: 50%;
          left: 50%;
          transform: translate(-50%, -50%);
        "></div>
      </div>
      <div style="font-size: 16px; font-weight: 500;">加载图片中...</div>
      <style>
        @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
        @keyframes fadeInScale { 0% { opacity: 0; transform: scale(0.9); } 100% { opacity: 1; transform: scale(1); } }
      </style>
    `;

    const closeBtn = document.createElement("div");

    closeBtn.innerHTML = `
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <line x1="18" y1="6" x2="6" y2="18"></line>
        <line x1="6" y1="6" x2="18" y2="18"></line>
      </svg>
    `;
    closeBtn.style.cssText = `
      position: absolute; top: 8px; right: 8px; width: 24px; height: 24px;
      background: ${isDarkMode ? "rgba(239, 68, 68, 0.9)" : "rgba(220, 38, 38, 0.9)"};
      color: white; border-radius: 50%;
      display: flex; align-items: center; justify-content: center; cursor: pointer;
      font-size: 10px; font-weight: bold; transition: all 0.2s ease; z-index: 10;
      backdrop-filter: blur(10px); border: 1px solid ${isDarkMode ? "rgba(239, 68, 68, 0.3)" : "rgba(220, 38, 38, 0.3)"};
    `;

    const displayUrl =
      imageUrl.length > MAX_DISPLAY_URL_LENGTH
        ? imageUrl.substring(0, MAX_DISPLAY_URL_LENGTH) + "..."
        : imageUrl;

    const linkInfo = document.createElement("div");

    // 使用 getThemeStyles 获取样式
    const themeStyles = getThemeStyles(theme);

    // 创建链接信息容器
    const linkInfoWrapper = document.createElement("div");

    linkInfoWrapper.style.cssText = `
      margin-top: 16px;
      padding: 12px 16px;
      background: ${themeStyles.linkBgColor};
      border-radius: 8px;
      font-size: 12px;
      color: ${themeStyles.linkTextColor};
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      font-family: 'SF Mono', 'Monaco', 'Inconsolata', 'Roboto Mono', 'Source Code Pro', monospace;
      cursor: pointer;
      transition: all 0.2s ease;
      border: 1px solid ${themeStyles.linkBorderColor};
    `;
    linkInfoWrapper.title = imageUrl;

    const linkInfoContent = document.createElement("div");

    linkInfoContent.style.cssText = `
      display: flex;
      align-items: center;
      gap: 8px;
    `;

    const linkInfoText = document.createElement("span");

    linkInfoText.style.cssText = `
      flex: 1;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    `;
    linkInfoText.textContent = displayUrl;

    linkInfoContent.appendChild(linkInfoText);
    linkInfoWrapper.appendChild(linkInfoContent);
    linkInfo.appendChild(linkInfoWrapper);

    img.onerror = () => {
      img.style.display = "none";

      // 替换状态容器内容为错误状态,保持容器样式不变
      statusContainer.innerHTML = `
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="${statusIconColor}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="10"></circle>
          <line x1="15" y1="9" x2="9" y2="15"></line>
          <line x1="9" y1="9" x2="15" y2="15"></line>
        </svg>
        <div style="font-size: 16px; font-weight: 500;">图片加载失败</div>
        <div style="font-size: 14px; opacity: 0.7;">请检查图片链接是否有效</div>
      `;
    };

    preview.appendChild(statusContainer);
    preview.appendChild(img);
    preview.appendChild(closeBtn);
    preview.appendChild(linkInfo);

    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const previewRect = { width: 400, height: 300 };

    let left = Math.min(
      Math.max(10, position.x + 10),
      viewportWidth - previewRect.width - 10,
    );
    let top = Math.min(
      Math.max(10, position.y + 10),
      viewportHeight - previewRect.height - 10,
    );

    preview.style.left = `${left}px`;
    preview.style.top = `${top}px`;

    const hidePreview = () => this.hideImagePreview();

    closeBtn.onclick = hidePreview;

    // 添加关闭按钮悬停效果
    closeBtn.onmouseenter = () => {
      closeBtn.style.transform = "scale(1.1)";
      closeBtn.style.background = isDarkMode
        ? "rgba(239, 68, 68, 1)"
        : "rgba(220, 38, 38, 1)";
    };

    closeBtn.onmouseleave = () => {
      closeBtn.style.transform = "scale(1)";
      closeBtn.style.background = isDarkMode
        ? "rgba(239, 68, 68, 0.9)"
        : "rgba(220, 38, 38, 0.9)";
    };

    img.onload = () => {
      statusContainer.style.display = "none";
      img.style.display = "block";

      const previewRect = preview.getBoundingClientRect();

      if (left + previewRect.width > viewportWidth) {
        left = Math.max(10, viewportWidth - previewRect.width - 10);
        preview.style.left = `${left}px`;
      }
      if (top + previewRect.height > viewportHeight) {
        top = Math.max(10, viewportHeight - previewRect.height - 10);
        preview.style.top = `${top}px`;
      }
    };

    // 为链接信息元素添加点击和悬停事件
    linkInfoWrapper.onclick = async (e) => {
      e.stopPropagation();
      try {
        await navigator.clipboard.writeText(imageUrl);
        const originalContent = linkInfoContent.innerHTML;

        // 复制成功的绿色背景颜色
        const currentThemeStyles = getThemeStyles();

        linkInfoContent.innerHTML = `
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="20 6 9 17 4 12"></polyline>
          </svg>
          <span style="flex: 1;">已复制到剪贴板</span>
        `;
        linkInfoWrapper.style.background = currentThemeStyles.successBgColor;
        linkInfoWrapper.style.color = "white";
        linkInfoWrapper.style.borderColor =
          currentThemeStyles.successBorderColor;
        linkInfoWrapper.setAttribute("data-copy-success", "true");

        // 清除之前的超时
        if (this.copyTimeout) {
          clearTimeout(this.copyTimeout);
        }

        // 设置新的超时
        this.copyTimeout = setTimeout(() => {
          if (
            linkInfoWrapper &&
            linkInfoWrapper.getAttribute("data-copy-success") === "true"
          ) {
            linkInfoWrapper.removeAttribute("data-copy-success");
            linkInfoContent.innerHTML = originalContent;
            // 使用当前主题的样式进行恢复
            const themeStylesNow = getThemeStyles();

            linkInfoWrapper.style.background = themeStylesNow.linkBgColor;

            linkInfoWrapper.style.color = themeStylesNow.linkTextColor;
            linkInfoWrapper.style.borderColor = themeStylesNow.linkBorderColor;
          }
        }, 2000);
      } catch (err) {
        console.error("复制失败:", err);
      }
    };

    // 添加悬停效果
    linkInfoWrapper.onmouseenter = () => {
      if (!linkInfoWrapper.getAttribute("data-copy-success")) {
        const currentThemeStyles = getThemeStyles();

        linkInfoWrapper.style.background = currentThemeStyles.hoverBgColor;
        linkInfoWrapper.style.transform = "translateY(-1px)";
      }
    };

    linkInfoWrapper.onmouseleave = () => {
      if (!linkInfoWrapper.getAttribute("data-copy-success")) {
        const currentThemeStyles = getThemeStyles();

        linkInfoWrapper.style.background = currentThemeStyles.linkBgColor;

        linkInfoWrapper.style.color = currentThemeStyles.linkTextColor;
        linkInfoWrapper.style.borderColor = currentThemeStyles.linkBorderColor;
        linkInfoWrapper.style.transform = "translateY(0)";
      }
    };

    // 设置图片为可点击状态
    img.style.cursor = "zoom-in";

    preview.onclick = (e) => {
      if (e.target === preview || e.target === img) {
        window.open(imageUrl, "_blank", "noopener,noreferrer");
      }
    };

    // 移除预览盒子的悬停动画效果，保持静态显示

    // 先清理之前可能残留的事件监听器
    this.cleanupEventListeners();

    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        hidePreview();
      }
    };

    const handleOutsideClick = (e: MouseEvent) => {
      if (preview && !preview.contains(e.target as Node)) {
        hidePreview();
      }
    };

    // 保存引用以便后续清理
    this.activeEscHandler = handleEsc;
    this.activeClickHandler = handleOutsideClick;

    document.addEventListener("keydown", handleEsc);
    setTimeout(
      () => document.addEventListener("click", handleOutsideClick),
      100,
    );

    document.body.appendChild(preview);
    this.currentPreview = preview;
  }

  hideImagePreview() {
    // 清理 document 级事件监听器
    this.cleanupEventListeners();

    if (this.currentPreview) {
      document.body.removeChild(this.currentPreview);
      this.currentPreview = null;
    }
    // 清除复制超时
    if (this.copyTimeout) {
      clearTimeout(this.copyTimeout);
      this.copyTimeout = null;
    }
  }

  /** 清理 document 级事件监听器，防止泄漏 */
  private cleanupEventListeners() {
    if (this.activeEscHandler) {
      document.removeEventListener("keydown", this.activeEscHandler);
      this.activeEscHandler = null;
    }
    if (this.activeClickHandler) {
      document.removeEventListener("click", this.activeClickHandler);
      this.activeClickHandler = null;
    }
  }
}

// 添加图片按钮样式，支持编辑器类型前缀
export function addImageButtonStyles(
  className: string,
  editorPrefix: string = "",
) {
  const prefixedClassName = editorPrefix
    ? `${editorPrefix}-${className}`
    : className;
  const existingStyle = document.getElementById(prefixedClassName);

  if (existingStyle) {
    existingStyle.remove();
  }

  const style = document.createElement("style");

  style.id = prefixedClassName;
  style.textContent = `
    .${prefixedClassName} {
      display: inline-block; width: 18px; height: 18px; margin-left: 4px;
      background-image: url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="%2310b981" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>');
      background-repeat: no-repeat; background-position: center; background-size: contain;
      cursor: pointer; border-radius: 3px; vertical-align: middle;
      opacity: 0.8; transition: all 0.2s ease; color: transparent !important;
      font-size: 0 !important; line-height: 0 !important;
    }
    .${prefixedClassName}:hover { opacity: 1; background-color: rgba(16, 185, 129, 0.15);}
    .monaco-editor.vs-dark .${prefixedClassName}, .monaco-editor.hc-black .${prefixedClassName} {
      background-image: url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="%2334d399" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>');
    }
    .monaco-editor.vs-dark .${prefixedClassName}:hover, .monaco-editor.hc-black .${prefixedClassName}:hover {
      background-color: rgba(52, 211, 153, 0.15);
    }
  `;
  document.head.appendChild(style);
}

/**
 * 更新图片装饰器
 * @param editor 编辑器实例
 * @param state 图片装饰器状态
 */
export const updateImageDecorations = (
  editor: editor.IStandaloneCodeEditor,
  state: ImageDecoratorState,
): void => {
  // 如果全局状态或组件状态禁用，则清除装饰器并退出
  if (!editor || !state.enabled || !isImageDecorationEnabled) {
    if (state.decorationManagerRef.current) {
      state.decorationManagerRef.current.clearAllDecorations(editor);
    }

    return;
  }

  // 初始化装饰器管理器
  if (!state.decorationManagerRef.current) {
    state.decorationManagerRef.current = new DecorationManager(5000);
  }

  const decorationManager = state.decorationManagerRef.current;

  // 获取可见范围内的文本
  const visibleRanges = editor.getVisibleRanges();

  if (!visibleRanges.length) return;

  const model = editor.getModel();

  if (!model) {
    return;
  }
  // 检查行数，少于3行时清空装饰器，
  const lineCount = model.getLineCount();

  if (lineCount < 3) {
    clearImageCache(state);

    return;
  }

  // 定期清理过期缓存
  decorationManager.cleanupExpiredCache();

  // 遍历可见范围内的每一行
  for (const range of visibleRanges) {
    for (
      let lineNumber = range.startLineNumber;
      lineNumber <= range.endLineNumber;
      lineNumber++
    ) {
      const lineContent = model.getLineContent(lineNumber);

      // 使用装饰器管理器检查是否需要处理此行
      if (!decorationManager.shouldProcessLine(lineNumber, lineContent, 1000)) {
        continue;
      }

      // 更新内容缓存
      decorationManager.updateContentCache(lineNumber, lineContent);

      // 复位正则表达式
      IMAGE_URL_REGEX.lastIndex = 0;

      let match;
      let matchCount = 0;
      const decorations: monaco.editor.IModelDeltaDecoration[] = [];
      const matchedUrls: {
        url: string;
        className: string;
        startColumn: number;
      }[] = [];

      while (
        (match = IMAGE_URL_REGEX.exec(lineContent)) !== null &&
        matchCount < MAX_MATCH_COUNT
      ) {
        matchCount++;

        const imageUrl = match[0];
        const startColumn = match.index + 1;
        const endColumn = startColumn + imageUrl.length;
        const editorPrefix = state.editorPrefix || "normal";
        const className = `image-btn-${lineNumber}-${startColumn}`;
        const prefixedClassName = `${editorPrefix}-${className}`;

        matchedUrls.push({
          url: imageUrl,
          className: prefixedClassName,
          startColumn,
        });
        addImageButtonStyles(className, editorPrefix);

        decorations.push({
          range: new monaco.Range(
            lineNumber,
            startColumn,
            lineNumber,
            endColumn + 3,
          ),
          options: {
            inlineClassName: `${prefixedClassName}-url`,
            after: { content: "🖼️", inlineClassName: prefixedClassName },
            zIndex: 3000, // 使用统一的z-index
          },
        });
      }

      // 清理旧行装饰器并应用新装饰器
      decorationManager.clearLineDecorations(editor, lineNumber);

      if (decorations.length > 0) {
        decorationManager.applyDecorations(editor, decorations);
        setTimeout(() => {
          matchedUrls.forEach((urlInfo) => {
            const buttonElement = document.querySelector(
              `.${urlInfo.className}`,
            );

            if (buttonElement) {
              buttonElement.addEventListener("mouseenter", (e) => {
                e.preventDefault();
                e.stopPropagation();
                const rect = buttonElement.getBoundingClientRect();

                ImagePreviewManager.getInstance().showImagePreview(
                  urlInfo.url,
                  {
                    x: rect.right,
                    y: rect.top,
                  },
                  state.theme,
                );
              });
            }
          });
        }, 300);
      }
    }
  }
};

/**
 * 处理编辑器内容变化时更新图片装饰器
 * @param e 编辑器内容变化事件
 * @param state 图片装饰器状态
 */
export const handleImageContentChange = (
  e: editor.IModelContentChangedEvent,
  state: ImageDecoratorState,
): void => {
  if (!isImageDecorationEnabled || !state.enabled) {
    return;
  }

  if (state.updateTimeoutRef.current) {
    clearTimeout(state.updateTimeoutRef.current);
  }

  state.updateTimeoutRef.current = setTimeout(() => {
    if (!state.editorRef.current || !state.decorationManagerRef.current) {
      return;
    }

    const editor = state.editorRef.current;
    const decorationManager = state.decorationManagerRef.current;
    const model = editor.getModel();

    if (!model) {
      return;
    }
    // 检查行数，少于3行时清空装饰器，
    const lineCount = model.getLineCount();

    if (lineCount < 3) {
      clearImageCache(state);

      return;
    }

    // 检查是否为完全替换
    const isFullReplacement =
      model &&
      e.changes.some(
        (change) =>
          change.range.startLineNumber === 1 &&
          change.range.endLineNumber >= model.getLineCount(),
      );

    if (isFullReplacement) {
      decorationManager.clearAllDecorations(editor);
    } else if (e.changes && e.changes.length > 0) {
      const regex = new RegExp(e.eol, "g");

      e.changes.forEach((change) => {
        let startLineNumber = change.range.startLineNumber;
        let endLineNumber = change.range.endLineNumber;

        if (endLineNumber - startLineNumber === 0) {
          const matches = change.text.match(regex);

          if (matches) {
            endLineNumber = endLineNumber + matches.length;
          }
        }

        decorationManager.clearRangeDecorations(
          editor,
          startLineNumber,
          endLineNumber,
        );
      });
    }

    updateImageDecorations(editor, state);
  }, 300);
};

/**
 * 清理图片装饰器缓存
 * @param state 图片装饰器状态
 */
export const clearImageCache = (state: ImageDecoratorState): void => {
  state.cacheRef.current = {};
  if (state.editorRef.current && state.decorationManagerRef.current) {
    state.decorationManagerRef.current.clearAllDecorations(
      state.editorRef.current,
    );
  }

  // 关闭所有预览弹窗
  ImagePreviewManager.getInstance().hideImagePreview();
};

/**
 * 切换图片装饰器状态
 * @param editor 编辑器实例
 * @param state 图片装饰器状态
 * @param enabled 是否启用装饰器
 * @returns 是否成功切换
 */
export const toggleImageDecorators = (
  editor: editor.IStandaloneCodeEditor | null,
  state: ImageDecoratorState,
  enabled?: boolean,
): boolean => {
  if (!editor) {
    return false;
  }

  // 如果没有提供参数，则切换状态
  const newState = enabled !== undefined ? enabled : !state.enabled;

  // 更新状态
  state.enabled = newState;

  // 立即应用更改
  if (newState) {
    // 启用装饰器时，立即更新
    clearImageCache(state);
    setTimeout(() => {
      updateImageDecorations(editor, state);
    }, 0);
  } else {
    // 禁用装饰器时，清除现有装饰
    if (state.decorationManagerRef.current) {
      state.decorationManagerRef.current.clearAllDecorations(editor);
    }
    clearImageCache(state);
  }

  return true;
};

/**
 * 获取图片装饰器的全局启用状态
 */
export const getImageDecorationEnabled = (): boolean => {
  return isImageDecorationEnabled;
};

/**
 * 设置图片装饰器的全局启用状态
 * @param enabled 是否启用
 */
export const setImageDecorationEnabled = (enabled: boolean): void => {
  isImageDecorationEnabled = enabled;
  if (!enabled) {
    ImagePreviewManager.getInstance().hideImagePreview();
  }
};

/**
 * 设置图片悬停提供者的启用状态（已禁用）
 * @param _enabled 是否启用（已忽略，始终保持禁用状态）
 */
export const setImageProviderEnabled = (_enabled?: boolean) => {
  // 图片悬停提供者始终保持禁用状态
  isImageProviderEnabled = false;
};

/**
 * 获取图片悬停提供者的当前启用状态
 */
export const getImageProviderEnabled = (): boolean => {
  return isImageProviderEnabled;
};
