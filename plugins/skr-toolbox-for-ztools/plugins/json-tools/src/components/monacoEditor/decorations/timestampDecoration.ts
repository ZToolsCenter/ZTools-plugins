import * as monaco from "monaco-editor";
import { editor } from "monaco-editor";
import { RefObject } from "react";

// 定义时间戳转换黑名单关键字
export const TIMESTAMP_BLACKLIST = ["id", "url", "size", "count", "length"];

// 定义时间戳下划线装饰器接口
export interface TimestampDecoratorState {
  editorRef: RefObject<editor.IStandaloneCodeEditor | null>;
  decorationsRef: RefObject<monaco.editor.IEditorDecorationsCollection | null>;
  decorationIdsRef: RefObject<Record<string, string[]>>;
  hoverProviderId: RefObject<monaco.IDisposable | null>;
  cacheRef: RefObject<Record<string, boolean>>;
  updateTimeoutRef: RefObject<NodeJS.Timeout | null>;
  enabled: boolean;
}

// 全局启用状态控制
let isTimestampDecorationEnabled = true; // 下划线装饰器状态

/**
 * 更新时间戳装饰器
 * @param editor 编辑器实例
 * @param state 时间戳装饰器状态
 */
export const updateTimestampDecorations = (
  editor: editor.IStandaloneCodeEditor,
  state: TimestampDecoratorState,
): void => {
  // 如果全局状态或组件状态禁用，则清除装饰器并退出
  if (!editor || !state.enabled || !isTimestampDecorationEnabled) {
    if (state.decorationsRef.current) {
      state.decorationsRef.current.clear();
    }

    return;
  }

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
    clearTimestampCache(state);

    return;
  }

  const cache = state.cacheRef.current;

  if (!state.decorationsRef.current) {
    state.decorationsRef.current = editor.createDecorationsCollection();
  }

  // 遍历可见范围内的每一行
  for (const range of visibleRanges) {
    for (
      let lineNumber = range.startLineNumber;
      lineNumber <= range.endLineNumber;
      lineNumber++
    ) {
      const lineContent = model.getLineContent(lineNumber);

      // 当前行已处理则跳过
      if (cache[lineNumber]) {
        continue;
      } else {
        cache[lineNumber] = true;
      }

      // 超过长度或折叠的代码
      if (lineContent.length > 800) {
        continue;
      }

      // 检查该行是否包含黑名单中的字段
      const hasBlacklistedField = TIMESTAMP_BLACKLIST.some((keyword) => {
        const pattern = new RegExp(`"\\s*\\w*${keyword}\\w*\\s*"\\s*:`, "i");

        return pattern.test(lineContent);
      });

      // 如果包含黑名单中的字段，则跳过时间戳转换
      if (hasBlacklistedField) {
        continue;
      }

      // 使用正则表达式查找可能的时间戳
      const regex =
        /(?:"(\d{10}|\d{13})"|(?<!\d)(\d{10}|\d{13})(?!\d))(?=,|\s|$|:|]|})/g;
      let match;

      while ((match = regex.exec(lineContent)) !== null) {
        const timestamp = match[1] || match[2];

        const humanReadableTime = timestampToHumanReadable(timestamp);

        if (humanReadableTime) {
          const startColumn = match.index + match[0].indexOf(timestamp) + 1;
          const endColumn = startColumn + timestamp.length;

          const decoration: monaco.editor.IModelDeltaDecoration[] = [
            {
              range: new monaco.Range(
                lineNumber,
                startColumn,
                lineNumber,
                endColumn + 1,
              ),
              options: {
                zIndex: 2998,
                after: {
                  content: ` (${humanReadableTime})`,
                  inlineClassName: "timestamp-decoration",
                },
              },
            },
          ];

          let lineDecorations =
            state.editorRef.current?.getLineDecorations(lineNumber);
          let exits = false;

          if (lineDecorations) {
            for (let i = lineDecorations.length - 1; i >= 0; i--) {
              let lineDecoration = lineDecorations[i];

              if (lineDecoration.options.zIndex === 2998) {
                exits = true;
                break;
              }
            }
          }
          // 如果已经存在装饰器则不用重复添加，兼容 undo 时
          if (exits) {
            continue;
          }

          let ids = state.decorationIdsRef.current[lineNumber];

          if (ids && ids.length > 0) {
            state.editorRef.current?.removeDecorations(ids);
          }

          state.decorationIdsRef.current[lineNumber] =
            state.decorationsRef.current?.append(decoration);
        }
      }
    }
  }
};

/**
 * 处理编辑器内容变化时更新时间戳装饰器
 * @param e 编辑器内容变化事件
 * @param state 时间戳装饰器状态
 */
export const handleTimestampContentChange = (
  e: editor.IModelContentChangedEvent,
  state: TimestampDecoratorState,
): void => {
  if (!state.enabled) {
    return;
  }

  if (state.updateTimeoutRef.current) {
    clearTimeout(state.updateTimeoutRef.current);
  }

  state.updateTimeoutRef.current = setTimeout(() => {
    // 检查行数，少于3行时清空装饰器
    const model = state.editorRef.current?.getModel();

    if (!model) {
      return;
    }
    // 检查行数，少于3行时清空装饰器，
    const lineCount = model.getLineCount();

    if (lineCount < 3) {
      clearTimestampCache(state);

      return;
    }

    // 内容发生变化则时间戳需要重新计算
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

        for (let sLine = startLineNumber; sLine <= endLineNumber; sLine++) {
          // 设置行需要检测时间
          state.cacheRef.current[sLine] = false;

          // 清除之前的装饰器
          const ids = state.decorationIdsRef.current[sLine];

          if (ids && ids.length > 0) {
            state.editorRef.current?.removeDecorations(ids);
            delete state.decorationIdsRef.current[sLine];
          }
        }
      }
    }

    if (state.editorRef.current) {
      updateTimestampDecorations(state.editorRef.current, state);
    }
  }, 200); // 添加适当的延迟，提高性能
};

/**
 * 将时间戳转换为人类可读的时间
 * @param timestamp 时间戳字符串
 * @returns 格式化的日期时间字符串
 */
export const timestampToHumanReadable = (timestamp: string): string => {
  try {
    const ts = parseInt(timestamp);
    // 处理10位(秒)和13位(毫秒)时间戳
    const date = new Date(ts.toString().length === 10 ? ts * 1000 : ts);

    // 检查日期是否有效
    if (isNaN(date.getTime())) {
      return "";
    }

    // 检查日期是否在1970年到2199年之间
    const year = date.getFullYear();

    if (year < 1970 || year > 2199) {
      return "";
    }

    return date.toLocaleString();
  } catch (e) {
    return "";
  }
};

/**
 * 清理时间戳缓存
 * @param state 时间戳装饰器状态
 */
export const clearTimestampCache = (state: TimestampDecoratorState): void => {
  state.cacheRef.current = {};
};

/**
 * 切换时间戳装饰器状态
 * @param editor 编辑器实例
 * @param state 时间戳装饰器状态
 * @param enabled 是否启用装饰器
 * @returns 是否成功切换
 */
export const toggleTimestampDecorators = (
  editor: editor.IStandaloneCodeEditor | null,
  state: TimestampDecoratorState,
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
    clearTimestampCache(state);
    setTimeout(() => {
      updateTimestampDecorations(editor, state);
    }, 0);
  } else {
    // 禁用装饰器时，清除现有装饰
    if (state.decorationsRef.current) {
      state.decorationsRef.current.clear();
    }
    clearTimestampCache(state);
  }

  return true;
};

/**
 * 获取时间戳下划线装饰器的全局启用状态
 */
export const getTimestampDecorationEnabled = (): boolean => {
  return isTimestampDecorationEnabled;
};

/**
 * 设置时间戳下划线装饰器的全局启用状态
 * @param enabled 是否启用
 */
export const setTimestampDecorationEnabled = (enabled: boolean): void => {
  isTimestampDecorationEnabled = enabled;
};
