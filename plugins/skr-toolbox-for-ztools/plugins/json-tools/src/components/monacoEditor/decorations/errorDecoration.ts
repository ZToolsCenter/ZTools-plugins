import * as monaco from "monaco-editor";
import { editor } from "monaco-editor";
import { RefObject } from "react";

// 错误装饰器状态接口
export interface ErrorDecoratorState {
  editorRef: RefObject<editor.IStandaloneCodeEditor | null>;
  decorationsRef: RefObject<monaco.editor.IEditorDecorationsCollection | null>;
}

/**
 * 高亮错误行
 * @param editor 编辑器实例
 * @param state 错误装饰器状态
 * @param lineNumber 需要高亮的行号
 * @param duration 高亮持续时间(毫秒)，默认5000
 * @returns 是否成功高亮
 */
export const highlightErrorLine = (
  editor: editor.IStandaloneCodeEditor,
  state: ErrorDecoratorState,
  lineNumber: number,
  duration: number = 5000,
): boolean => {
  if (!editor) {
    return false;
  }

  // 滚动到错误行
  editor.revealLineInCenter(lineNumber);

  // 如果存在旧的装饰，先清除
  if (state.decorationsRef.current) {
    state.decorationsRef.current.clear();
  }

  // 创建新的装饰集合
  state.decorationsRef.current = editor.createDecorationsCollection([
    {
      range: new monaco.Range(lineNumber, 1, lineNumber, 1),
      options: {
        isWholeLine: true,
        className: "errorLineHighlight",
        glyphMarginClassName: "",
      },
    },
  ]);

  // 指定时间后移除高亮
  setTimeout(() => {
    if (state.decorationsRef.current) {
      state.decorationsRef.current.clear();
    }
  }, duration);

  return true;
};

/**
 * 清除错误高亮
 * @param state 错误装饰器状态
 */
export const clearErrorHighlight = (state: ErrorDecoratorState): void => {
  if (state.decorationsRef.current) {
    state.decorationsRef.current.clear();
  }
};
