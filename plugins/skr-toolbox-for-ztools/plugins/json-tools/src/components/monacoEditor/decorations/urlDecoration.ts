import * as monaco from "monaco-editor";
import { editor } from "monaco-editor";
import { RefObject } from "react";

import { DecorationManager } from "./decorationManager.ts";

// URL编码正则表达式 - 匹配%xx形式的编码
export const URL_REGEX = /%(?:[0-9a-fA-F]{2})+/g;
// 匹配 ": "{urlencode内容}" 格式的正则表达式
export const URL_STRING_REGEX = /: "([^"]*?(?:%(?:[0-9a-fA-F]{2})+)[^"]*?)"/g;

// URL解码函数
export const decodeUrl = (text: string): string | null => {
  try {
    if (!text || !text.match(URL_REGEX)) {
      return null;
    }

    return decodeURIComponent(text);
  } catch (e) {
    return null;
  }
};

// 定义URL下划线装饰器接口
export interface UrlDecoratorState {
  editorRef: RefObject<editor.IStandaloneCodeEditor | null>;
  hoverProviderId: RefObject<monaco.IDisposable | null>;
  updateTimeoutRef: RefObject<NodeJS.Timeout | null>;
  decorationManagerRef: RefObject<DecorationManager | null>;
  enabled: boolean;
}

// 全局启用状态控制
let isUrlDecorationEnabled = true; // 下划线装饰器全局启用状态
let isUrlProviderEnabled = true; // 全局悬浮提供者启用状态

const MAXShowDecodeLength = 100; // 最大显示解码长度

// 注册全局URL解码悬停提供者
export const registerUrlHoverProvider = () => {
  monaco.languages.registerHoverProvider(["json", "json5"], {
    provideHover: (model, position) => {
      // 如果提供者被禁用，直接返回null
      if (!isUrlProviderEnabled) return null;

      const lineContent = model.getLineContent(position.lineNumber);
      const wordInfo = model?.getWordAtPosition(position);

      if (!wordInfo) return null;

      // 获取当前行的文本并检查是否包含URL编码序列
      const currentWordRange = {
        startLineNumber: position.lineNumber,
        endLineNumber: position.lineNumber,
        startColumn: Math.max(1, wordInfo.startColumn), // 扩展范围以捕获%前缀
        endColumn: wordInfo.endColumn, // 扩展范围以捕获可能的后续字符
      };

      const currentWordText = model.getValueInRange(currentWordRange);

      // 尝试直接解码当前单词
      let decoded = decodeUrl(currentWordText);

      if (!decoded) {
        // 如果直接解码失败，尝试检查当前位置是否在 ": "{urlencode内容}" 格式内
        const start = wordInfo.startColumn;
        const end = wordInfo.endColumn;

        // 检查该位置是否在引号内的内容中
        URL_STRING_REGEX.lastIndex = 0;
        let stringMatch;

        while ((stringMatch = URL_STRING_REGEX.exec(lineContent)) !== null) {
          const matchStart = stringMatch.index + 3; // ": " 后面的引号位置
          const matchEnd = matchStart + stringMatch[1].length + 1; // 加上引号

          if (start >= matchStart && end <= matchEnd) {
            decoded = decodeUrl(stringMatch[1]);
            break;
          }
        }

        if (!decoded) {
          return null;
        }
      }

      // 如果解码成功，返回悬停信息
      return {
        contents: [{ value: "**URL 解码器**" }, { value: decoded }],
        range: new monaco.Range(
          position.lineNumber,
          currentWordRange.startColumn,
          position.lineNumber,
          currentWordRange.endColumn,
        ),
      };
    },
  });
};

/**
 * 更新URL下划线装饰器
 * @param editor 编辑器实例
 * @param state URL下划线装饰器状态
 */
export const updateUrlDecorations = (
  editor: editor.IStandaloneCodeEditor,
  state: UrlDecoratorState,
): void => {
  // 如果全局状态或组件状态禁用，则清除装饰器并退出
  if (!editor || !state.enabled || !isUrlDecorationEnabled) {
    if (state.decorationManagerRef.current) {
      state.decorationManagerRef.current.clearAllDecorations(editor);
    }

    return;
  }

  // 初始化装饰器管理器
  if (!state.decorationManagerRef.current) {
    state.decorationManagerRef.current = new DecorationManager(3000);
  }

  const decorationManager = state.decorationManagerRef.current;

  // 获取可见范围内的文本
  const visibleRanges = editor.getVisibleRanges();

  if (!visibleRanges.length) return;

  // 检查行数，少于3行时清空装饰器
  const model = editor.getModel();

  if (!model) {
    return;
  }
  // 检查行数，少于3行时清空装饰器，
  if (model.getLineCount() < 3) {
    clearUrlCache(state);

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

      // 复位正则表达式的lastIndex
      URL_REGEX.lastIndex = 0;
      URL_STRING_REGEX.lastIndex = 0;

      let match;
      let matchCount = 0;
      const decorations: monaco.editor.IModelDeltaDecoration[] = [];

      while (
        (match = URL_REGEX.exec(lineContent)) !== null &&
        matchCount < 100
      ) {
        matchCount++;

        const startColumn = match.index + 1;
        const endColumn = startColumn + match[0].length;

        decorations.push({
          range: new monaco.Range(
            lineNumber,
            startColumn,
            lineNumber,
            endColumn,
          ),
          options: {
            inlineClassName: "url-decoration",
            zIndex: 3000,
          },
        });
      }

      // 处理 ": "{urlencode内容}" 格式的内容
      URL_STRING_REGEX.lastIndex = 0;
      matchCount = 0;

      while (
        (match = URL_STRING_REGEX.exec(lineContent)) !== null &&
        matchCount < 100
      ) {
        matchCount++;
        const urlStr = match[1];

        // 确保包含URL编码内容
        if (!urlStr || !urlStr.match(URL_REGEX)) {
          continue;
        }

        const decoded = decodeUrl(urlStr);

        if (!decoded) {
          continue;
        }

        const startColumn = match.index + 3; // ": " 后面的位置
        const endColumn = startColumn + urlStr.length;

        const decoration: monaco.editor.IModelDeltaDecoration = {
          range: new monaco.Range(
            lineNumber,
            startColumn,
            lineNumber,
            endColumn + 3,
          ),
          options: {
            inlineClassName: "url-decoration",
            zIndex: 3000,
            after: {
              content: `(${decoded})`,
              inlineClassName: "timestamp-decoration",
            },
          },
        };

        // 如果解码后内容太长，不显示after装饰
        if (decoded.length > MAXShowDecodeLength) {
          decoration.options.after = null;
          decoration.range = new monaco.Range(
            lineNumber,
            startColumn,
            lineNumber,
            endColumn,
          );
        }

        decorations.push(decoration);
      }

      // 清理旧行装饰器并应用新装饰器
      decorationManager.clearLineDecorations(editor, lineNumber);

      if (decorations.length > 0) {
        decorationManager.applyDecorations(editor, decorations);
      }
    }
  }
};

/**
 * 处理编辑器内容变化时更新URL下划线装饰器
 * @param e 编辑器内容变化事件
 * @param state URL下划线装饰器状态
 */
export const handleUrlContentChange = (
  e: editor.IModelContentChangedEvent,
  state: UrlDecoratorState,
): void => {
  // 如果装饰器全局禁用，则直接返回
  if (!isUrlDecorationEnabled || !state.enabled) {
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

    // 检查行数，少于3行时清空装饰器
    const model = editor.getModel();

    if (!model) {
      return;
    }
    // 检查行数，少于3行时清空装饰器，
    if (model.getLineCount() < 3) {
      clearUrlCache(state);

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
      // 完全替换：清理所有装饰器
      decorationManager.clearAllDecorations(editor);
    } else {
      // 增量更新：只清理受影响的行
      if (e.changes && e.changes.length > 0) {
        const regex = new RegExp(e.eol, "g");

        for (let i = 0; i < e.changes.length; i++) {
          let startLineNumber = e.changes[i].range.startLineNumber;
          let endLineNumber = e.changes[i].range.endLineNumber;

          // 当只有变化一行时，判断一下更新的内容是否有 \n
          if (endLineNumber - startLineNumber == 0) {
            const matches = e.changes[i].text.match(regex);

            if (matches) {
              endLineNumber = endLineNumber + matches?.length;
            }
          }

          // 清理受影响范围的装饰器
          decorationManager.clearRangeDecorations(
            editor,
            startLineNumber,
            endLineNumber,
          );

          // 装饰器管理器会自动处理缓存失效，无需手动设置
        }
      }
    }

    updateUrlDecorations(editor, state);
  }, 200);
};

/**
 * 清理URL装饰器缓存
 * @param state URL下划线装饰器状态
 */
export const clearUrlCache = (state: UrlDecoratorState): void => {
  // 使用装饰器管理器清理装饰器
  if (state.editorRef.current && state.decorationManagerRef.current) {
    state.decorationManagerRef.current.clearAllDecorations(
      state.editorRef.current,
    );
  }
};

/**
 * 获取URL下划线装饰器的全局启用状态
 */
export const getUrlDecorationEnabled = (): boolean => {
  return isUrlDecorationEnabled;
};

/**
 * 设置URL下划线装饰器的全局启用状态
 * @param enabled 是否启用
 */
export const setUrlDecorationEnabled = (enabled: boolean): void => {
  isUrlDecorationEnabled = enabled;
};

/**
 * 设置URL悬停提供者的启用状态
 * @param enabled 是否启用
 */
export const setUrlProviderEnabled = (enabled: boolean) => {
  isUrlProviderEnabled = enabled;
};

/**
 * 获取URL悬停提供者的当前启用状态
 */
export const getUrlProviderEnabled = (): boolean => {
  return isUrlProviderEnabled;
};
