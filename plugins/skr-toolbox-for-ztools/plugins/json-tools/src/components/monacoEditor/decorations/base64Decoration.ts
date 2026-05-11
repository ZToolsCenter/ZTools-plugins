import * as monaco from "monaco-editor";
import { editor } from "monaco-editor";
import { RefObject } from "react";

import { DecorationManager } from "./decorationManager.ts";

import { BASE64_REGEX, decodeBase64Strict } from "@/utils/base64.ts";

// 定义Base64下划线装饰器接口
export interface Base64DecoratorState {
  editorRef: RefObject<editor.IStandaloneCodeEditor | null>;
  hoverProviderId: RefObject<monaco.IDisposable | null>;
  updateTimeoutRef: RefObject<NodeJS.Timeout | null>;
  decorationManagerRef: RefObject<DecorationManager | null>;
  enabled: boolean;
}

// 全局启用状态控制
let isBase64DecorationEnabled = true; // 下划线装饰器状态
let isBase64ProviderEnabled = true; // 全局Base64悬停提供者状态

const MAXShowDecodeLength = 100; // 最大显示解码长度

// 注册全局Base64悬停提供者
export const registerBase64HoverProvider = () => {
  monaco.languages.registerHoverProvider(["json", "json5"], {
    provideHover: (model, position) => {
      // 如果提供者被禁用，直接返回null
      if (!isBase64ProviderEnabled) return null;
      const lineContent = model.getLineContent(position.lineNumber);
      const wordInfo = model?.getWordAtPosition(position);

      if (!wordInfo) return null;

      // 获取当前词的范围
      const start = wordInfo.startColumn;
      const end = wordInfo.endColumn;
      const word = lineContent.substring(start - 1, end - 1);

      const decoded = decodeBase64Strict(word);

      if (!decoded) {
        return null;
      }

      // 如果解码成功，返回悬停信息
      return {
        contents: [
          { value: "**Base64 解码器**" },
          { value: "```\n" + decoded + "\n```" },
        ],
        range: new monaco.Range(
          position.lineNumber,
          start,
          position.lineNumber,
          end,
        ),
      };
    },
  });
};

/**
 * 更新Base64下划线装饰器
 * @param editor 编辑器实例
 * @param state Base64下划线装饰器状态
 */
export const updateBase64Decorations = (
  editor: editor.IStandaloneCodeEditor,
  state: Base64DecoratorState,
): void => {
  // 如果全局状态或组件状态禁用，则清除装饰器并退出
  if (!editor || !state.enabled || !isBase64DecorationEnabled) {
    if (state.decorationManagerRef.current) {
      state.decorationManagerRef.current.clearAllDecorations(editor);
    }

    return;
  }

  // 初始化装饰器管理器
  if (!state.decorationManagerRef.current) {
    state.decorationManagerRef.current = new DecorationManager(2999);
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
    clearBase64Cache(state);

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
      BASE64_REGEX.lastIndex = 0;

      // 使用正则表达式查找可能的Base64字符串
      let match;
      let matchCount = 0;
      const decorations: monaco.editor.IModelDeltaDecoration[] = [];

      while (
        (match = BASE64_REGEX.exec(lineContent)) !== null &&
        matchCount < 100
      ) {
        matchCount++;
        const base64Str = match[1] || match[2];

        // 超过3k不进行解码
        if (base64Str.length < 8 || base64Str.length > 3000) {
          continue;
        }

        const decodeBase64 = decodeBase64Strict(base64Str);

        if (!decodeBase64) {
          continue;
        }

        const startColumn = match.index + (match[0].startsWith(": ") ? 4 : 1);
        let endColumn = startColumn + base64Str.length;

        const decoration: monaco.editor.IModelDeltaDecoration = {
          range: new monaco.Range(
            lineNumber,
            startColumn,
            lineNumber,
            endColumn + 3,
          ),
          options: {
            inlineClassName: "base64-decoration",
            zIndex: 2999,
            after: {
              content: `(${decodeBase64})`,
              inlineClassName: "timestamp-decoration",
            },
          },
        };

        if (decodeBase64.length > MAXShowDecodeLength) {
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
 * 处理编辑器内容变化时更新Base64下划线装饰器
 * @param e 编辑器内容变化事件
 * @param state Base64下划线装饰器状态
 */
export const handleBase64ContentChange = (
  e: editor.IModelContentChangedEvent,
  state: Base64DecoratorState,
): void => {
  // 如果装饰器全局禁用，则直接返回
  if (!isBase64DecorationEnabled || !state.enabled) {
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
      clearBase64Cache(state);

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

    updateBase64Decorations(editor, state);
  }, 200);
};

/**
 * 清理Base64装饰器缓存
 * @param state Base64下划线装饰器状态
 */
export const clearBase64Cache = (state: Base64DecoratorState): void => {
  // 使用装饰器管理器清理装饰器
  if (state.editorRef.current && state.decorationManagerRef.current) {
    state.decorationManagerRef.current.clearAllDecorations(
      state.editorRef.current,
    );
  }
};

/**
 * 获取Base64下划线装饰器的全局启用状态
 */
export const getBase64DecorationEnabled = (): boolean => {
  return isBase64DecorationEnabled;
};

/**
 * 设置Base64下划线装饰器的全局启用状态
 * @param enabled 是否启用
 */
export const setBase64DecorationEnabled = (enabled: boolean): void => {
  isBase64DecorationEnabled = enabled;
};

/**
 * 设置Base64悬停提供者的启用状态
 * @param enabled 是否启用
 */
export const setBase64ProviderEnabled = (enabled: boolean) => {
  isBase64ProviderEnabled = enabled;
};

/**
 * 获取Base64悬停提供者的当前启用状态
 */
export const getBase64ProviderEnabled = (): boolean => {
  return isBase64ProviderEnabled;
};
