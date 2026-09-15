import { expect, test } from "playwright/test";
import {
  applyAppearanceScaleVariables,
  clearStartupSettling,
  computeEditorUiScale,
  markStartupSettling,
} from "../../src/lib/appearance";

// 单元测试运行在 Node 环境，这里用最小 document 桩验证 DOM 写入逻辑。
const createDocumentStub = () => {
  const styleProps = new Map<string, string>();
  const attrs = new Set<string>();
  const stub = {
    documentElement: {
      style: {
        setProperty: (name: string, value: string) =>
          void styleProps.set(name, value),
        getPropertyValue: (name: string) => styleProps.get(name) ?? "",
        set fontSize(value: string) {
          styleProps.set("font-size", value);
        },
        get fontSize() {
          return styleProps.get("font-size") ?? "";
        },
      },
      setAttribute: (name: string) => void attrs.add(name),
      removeAttribute: (name: string) => void attrs.delete(name),
      hasAttribute: (name: string) => attrs.has(name),
    },
  };
  return stub;
};

let stub: ReturnType<typeof createDocumentStub>;
let dispatchedEvents: Event[];
const root = () => stub.documentElement;

test.beforeEach(() => {
  stub = createDocumentStub();
  dispatchedEvents = [];
  (globalThis as Record<string, unknown>).document = stub;
  (globalThis as Record<string, unknown>).window = {
    dispatchEvent: (event: Event) => {
      dispatchedEvents.push(event);
      return true;
    },
  };
});

test.afterEach(() => {
  delete (globalThis as Record<string, unknown>).document;
  delete (globalThis as Record<string, unknown>).window;
});

test("首帧前同步写入界面字号与编辑器缩放变量", () => {
  applyAppearanceScaleVariables({ uiFontSize: "normal", editorFontSize: 13 });

  expect(root().style.fontSize).toBe("16px");
  expect(root().style.getPropertyValue("--editor-font-size")).toBe("13px");
  // 13 / 16（默认字号）= 0.8125，首帧即恢复上次缩放而非默认 1
  expect(root().style.getPropertyValue("--editor-scale")).toBe("0.8125");
  expect(root().style.getPropertyValue("--editor-ui-scale")).toBe("0.8125");
});

test("未知界面字号回退到 small，避免启动时字体缺省跳变", () => {
  applyAppearanceScaleVariables({
    // 模拟旧版本持久化里残留的非法值
    uiFontSize: "huge" as never,
    editorFontSize: 16,
  });

  expect(root().style.fontSize).toBe("14px");
  expect(root().style.getPropertyValue("--editor-scale")).toBe("1.0000");
  expect(root().style.getPropertyValue("--editor-ui-scale")).toBe("1.0000");
});

test("编辑器 UI 缩放叠加局部 zoom，并稳定输出四位小数", () => {
  expect(computeEditorUiScale(20, 1.2)).toBe("1.5000");
  expect(computeEditorUiScale(13)).toBe("0.8125");
  expect(computeEditorUiScale(12, 0.7)).toBe("0.5250");
  expect(computeEditorUiScale(16, 1)).toBe("1.0000");
  expect(computeEditorUiScale(24, 1.8)).toBe("2.7000");
});

test("编辑器 UI 缩放遇到非法值时回退到默认比例", () => {
  expect(computeEditorUiScale(Number.NaN, Number.POSITIVE_INFINITY)).toBe(
    "1.0000",
  );
  expect(computeEditorUiScale(0, -1)).toBe("1.0000");
});

test("编辑器 UI 缩放只在值实际变化时派发事件", () => {
  applyAppearanceScaleVariables({ uiFontSize: "small", editorFontSize: 16 });
  applyAppearanceScaleVariables({ uiFontSize: "small", editorFontSize: 16 });
  applyAppearanceScaleVariables({ uiFontSize: "small", editorFontSize: 20 });

  expect(dispatchedEvents).toHaveLength(2);
  expect((dispatchedEvents[0] as CustomEvent).detail).toEqual({
    scale: "1.0000",
  });
  expect((dispatchedEvents[1] as CustomEvent).detail).toEqual({
    scale: "1.2500",
  });
});

test("启动过渡禁用标记可写入并幂等清除", () => {
  markStartupSettling();
  expect(root().hasAttribute("data-startup-settling")).toBe(true);
  clearStartupSettling();
  clearStartupSettling();
  expect(root().hasAttribute("data-startup-settling")).toBe(false);
});
