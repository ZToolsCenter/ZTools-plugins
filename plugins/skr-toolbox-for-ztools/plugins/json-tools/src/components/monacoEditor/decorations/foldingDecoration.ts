import * as monaco from "monaco-editor";
import { editor } from "monaco-editor";

import { removeJsonComments, parseJson } from "@/utils/json.ts";

/**
 * 更新代码折叠区域的装饰器，显示折叠区域内包含的元素数量
 * @param editor 编辑器实例
 * @param language 当前语言
 * @param foldingDecorationsRef 折叠装饰器引用
 * @returns void
 */
export const updateFoldingDecorations = (
  editor: editor.IStandaloneCodeEditor,
  language: string | undefined,
  foldingDecorationsRef: React.RefObject<monaco.editor.IEditorDecorationsCollection | null>,
): void => {
  if (language !== "json" && language !== "json5") {
    return;
  }

  const model = editor.getModel();

  if (!model) return;

  // 获取折叠模型
  const foldingController = editor.getContribution(
    "editor.contrib.folding",
  ) as any;

  if (!foldingController) return;

  try {
    // 获取当前所有折叠区域
    const foldingModel = foldingController.hiddenRangeModel;

    if (!foldingModel) return;

    const regions = foldingModel._hiddenRanges;

    if (!regions || !regions.length) return;

    // 获取当前折叠的区域
    const decorations: monaco.editor.IModelDeltaDecoration[] = [];
    const modelLines = model.getLinesContent();

    // 遍历所有折叠区域
    for (let i = 0; i < regions.length; i++) {
      const region = regions[i];

      const startLineNumber = region.startLineNumber; // 为折叠内容的首行，不包括{ [
      const endLineNumber = region.endLineNumber;

      // 计算折叠区域内的元素数量
      const elementCount = calculateFoldingElementCount(
        language,
        modelLines,
        startLineNumber,
        endLineNumber,
      );

      // 创建CSS类名
      const className = `folding${startLineNumber - 1}`;

      if (elementCount.type == 1) {
        addFoldingStyles(className, `\\22EF  Object{${elementCount.count}}`);
      } else {
        addFoldingStyles(className, `\\22EF  Array{${elementCount.count}}`);
      }

      // 创建装饰器，显示元素数量
      decorations.push({
        range: new monaco.Range(startLineNumber - 1, 1, startLineNumber - 1, 1),
        options: {
          zIndex: 99999,
          isWholeLine: false,
          beforeContentClassName: className,
        },
      });
    }

    // 应用装饰器
    if (decorations.length > 0) {
      // 清除旧的装饰器
      if (foldingDecorationsRef.current) {
        foldingDecorationsRef.current.clear();
      }
      // 创建新的装饰器集合
      foldingDecorationsRef.current =
        editor.createDecorationsCollection(decorations);
    }
  } catch (e) {
    console.error("更新折叠装饰器失败", e);
  }
};

// 添加折叠样式
export function addFoldingStyles(className: string, content: string) {
  const style = document.createElement("style");

  style.id = className;
  style.textContent = `
        .${className} {}
        .${className} ~ .inline-folded::after {
          width: 100px !important;
          content: "${content}" !important;
        }
  `;
  document.head.appendChild(style);
}

interface ElementCountCount {
  count: number;
  type: number; // 1object 2array
}

// 计算折叠区域内的元素数量
export function calculateFoldingElementCount(
  language: string,
  modelLines: string[],
  startLineNumber: number,
  endLineNumber: number,
): ElementCountCount {
  const result: ElementCountCount = { count: 0, type: 0 };

  // 获取首行
  const firstLines = modelLines.slice(startLineNumber - 2, startLineNumber - 1);
  const firstLine = firstLines[0]?.trim() || "";

  // 获取折叠区域的所有行内容 不包括 [] {}
  const foldedLines = modelLines.slice(startLineNumber - 1, endLineNumber);

  if (foldedLines.length === 0) return result;

  // 判断JSON结构类型
  const isObject = firstLine.includes("{");
  const isArray = firstLine.includes("[");

  if (!isObject && !isArray) return result;

  // 合并所有行以处理
  const content = foldedLines.join("\n");
  let cleanContent = content;

  if (language == "json5") {
    // 移除注释以避免干扰计数
    cleanContent = removeJsonComments(content);
  }
  if (!cleanContent || cleanContent.length == 0) return result;
  // 根据类型计算元素数量
  if (isObject) {
    try {
      const jsonObj = parseJson(`{${cleanContent}}`);

      result.type = 1;
      result.count = Object.keys(jsonObj).length;

      return result;
    } catch (e) {
      console.error(e);

      return result;
    }
  } else if (isArray) {
    try {
      const jsonObj = parseJson(`[${cleanContent}]`);

      result.type = 2;
      result.count = jsonObj.length;

      return result;
    } catch (e) {
      console.error(e);

      return result;
    }
  }

  return result;
}

