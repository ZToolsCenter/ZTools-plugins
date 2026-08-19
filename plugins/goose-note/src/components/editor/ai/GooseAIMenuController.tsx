import { useEffect, useMemo, useRef, useState, type FC } from "react";
import {
  BlockPopover,
  PositionPopover,
  useBlockNoteEditor,
  useExtension,
  useExtensionState,
  type FloatingUIOptions,
} from "@blocknote/react";
import { autoUpdate, flip, offset, shift, size } from "@floating-ui/react";
import { getScaledEditorUiPx } from "@/components/editor/utils/editorContextUi";
import { AIExtension, AIMenu, type AIMenuProps } from "@blocknote/xl-ai";
import { TextSelection } from "prosemirror-state";
import { setFakeSelection } from "@/components/editor/extensions/fakeSelectionExtension";
import { useFormattingToolbarAi } from "@/components/editor/state/formattingToolbarAi";

type GooseAIMenuControllerProps = {
  aiMenu?: FC<AIMenuProps>;
};

type BnColorScheme = "light" | "dark";

/** 浮层 bn-root 需带 data-color-scheme，BlockNote 才会切到深色菜单变量。 */
function resolveBnColorScheme(
  editorDom: HTMLElement | null | undefined,
): BnColorScheme {
  const fromEditor = editorDom
    ?.closest(".bn-root")
    ?.getAttribute("data-color-scheme");
  if (fromEditor === "dark" || fromEditor === "light") return fromEditor;
  if (typeof document !== "undefined") {
    return document.documentElement.classList.contains("dark")
      ? "dark"
      : "light";
  }
  return "light";
}

/**
 * xl-ai 默认把菜单锚到整块并把浮层撑成块宽。格式栏入口需要锚到原文字选区，
 * 其它入口（空段落、斜杠菜单）则继续沿用块锚点。
 */
export function GooseAIMenuController({
  aiMenu: Component = AIMenu,
}: GooseAIMenuControllerProps) {
  const editor = useBlockNoteEditor();
  const ai = useExtension(AIExtension);
  const aiMenuState = useExtensionState(AIExtension, {
    editor,
    selector: (state) => state.aiMenuState,
  });
  const selection = useFormattingToolbarAi((state) => state.selection);
  const resetFormattingToolbarAi = useFormattingToolbarAi(
    (state) => state.reset,
  );
  const openedFromSelectionRef = useRef(false);
  const [colorScheme, setColorScheme] = useState<BnColorScheme>(() =>
    resolveBnColorScheme(editor.domElement),
  );

  const blockId = aiMenuState === "closed" ? undefined : aiMenuState.blockId;
  const open = aiMenuState !== "closed";

  // 打开时读取 + 监听 html class / 编辑器 bn-root 的 color-scheme，主题切换能跟上
  useEffect(() => {
    const read = () => {
      setColorScheme(resolveBnColorScheme(editor.domElement));
    };
    read();
    if (typeof document === "undefined") return;

    const observer = new MutationObserver(read);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });
    const bnRoot = editor.domElement?.closest(".bn-root");
    if (bnRoot) {
      observer.observe(bnRoot, {
        attributes: true,
        attributeFilter: ["data-color-scheme"],
      });
    }
    return () => observer.disconnect();
  }, [editor.domElement, open]);

  useEffect(() => {
    if (open && selection) {
      openedFromSelectionRef.current = true;
      return;
    }
    if (open || !openedFromSelectionRef.current) return;

    openedFromSelectionRef.current = false;
    try {
      setFakeSelection(editor, null);
    } catch {
      /* 编辑器可能正随页面切换卸载。 */
    }
    resetFormattingToolbarAi();

    // xl-ai 关闭时会把焦点还给编辑器；下一帧恢复原范围，避免快捷键撤销
    // 落到页面而不是 ProseMirror。该事务不进入 undo history。
    if (selection) {
      requestAnimationFrame(() => {
        try {
          const view = editor.prosemirrorView;
          if (!view) return;
          const docSize = view.state.doc.content.size;
          const from = Math.min(selection.from, docSize);
          const to = Math.min(selection.to, docSize);
          if (from !== to) {
            const tr = view.state.tr.setSelection(
              TextSelection.create(view.state.doc, from, to),
            );
            tr.setMeta("addToHistory", false);
            view.dispatch(tr);
          }
          view.focus();
        } catch {
          /* 关闭期间文档或页面可能已经切换。 */
        }
      });
    }
  }, [editor, open, resetFormattingToolbarAi, selection]);

  useEffect(
    () => () => {
      try {
        setFakeSelection(editor, null);
      } catch {
        /* ignore */
      }
      resetFormattingToolbarAi();
    },
    [editor, resetFormattingToolbarAi],
  );

  const floatingUIOptions = useMemo<FloatingUIOptions>(() => {
    // 菜单固定视觉宽度（与 editor-ai-menu.css 中 .bn-combobox 一致），
    // 不再把浮层撑成「整块宽度」：块锚点时宽度=块宽会把输入框拉成满行，
    // 多行时图标与首行错位，且 placement:bottom 会让窄内容视觉上偏离选区。
    const MENU_WIDTH_PX = 320;
    const pad = 8;

    const sharedMiddleware = [
      offset(() => getScaledEditorUiPx(10)),
      flip({
        fallbackPlacements: ["top-start", "bottom-end", "top-end"],
        padding: pad,
      }),
      shift({ padding: pad, crossAxis: true }),
      size({
        apply({ availableWidth, elements }) {
          const scale =
            typeof document !== "undefined"
              ? Number.parseFloat(
                  getComputedStyle(document.documentElement).getPropertyValue(
                    "--editor-ui-scale",
                  ) || "1",
                ) || 1
              : 1;
          const maxW = Math.max(
            240,
            Math.min(MENU_WIDTH_PX, availableWidth / Math.max(scale, 0.5) - pad),
          );
          Object.assign(elements.floating.style, {
            width: `${maxW}px`,
            maxWidth: `${maxW}px`,
          });
        },
        padding: pad,
      }),
    ];

    return {
      useFloatingOptions: {
        open,
        // 选区与块锚点都用 start 对齐，避免 bottom 居中导致菜单跑到标题下方中间
        placement: "bottom-start",
        middleware: sharedMiddleware,
        onOpenChange: (nextOpen) => {
          if (nextOpen || aiMenuState === "closed") return;
          if (aiMenuState.status === "user-input") {
            ai.closeAIMenu();
          } else if (
            aiMenuState.status === "user-reviewing" ||
            aiMenuState.status === "error"
          ) {
            ai.rejectChanges();
          }
        },
        whileElementsMounted(reference, floating, update) {
          return autoUpdate(reference, floating, update, {
            animationFrame: true,
          });
        },
      },
      useDismissProps: {
        enabled:
          aiMenuState === "closed" || aiMenuState.status === "user-input",
        outsidePress: (event) => {
          if (event.target instanceof Element) {
            const blockElement = event.target.closest(".bn-block");
            if (
              blockElement &&
              blockElement.getAttribute("data-id") === blockId
            ) {
              ai.closeAIMenu();
            }
          }
          return true;
        },
      },
      elementProps: {
        className: "bn-root bn-mantine goose-ai-menu-floating",
        "data-color-scheme": colorScheme,
        style: { zIndex: 20010 },
      },
      focusManagerProps: {
        disabled: false,
        getInsideElements: () => (editor.domElement ? [editor.domElement] : []),
      },
    };
  }, [ai, aiMenuState, blockId, colorScheme, editor.domElement, open]);

  // GenericPopover 的外层负责 viewport 定位；缩放只放在内层 surface，
  // 避免 CSS zoom 同时放大 Floating UI 计算出的 fixed 坐标。
  const content = open ? (
    <div
      className="goose-editor-context-ui bn-root bn-mantine"
      data-color-scheme={colorScheme}
    >
      <Component />
    </div>
  ) : null;

  if (selection) {
    return (
      <PositionPopover
        position={selection}
        portalElement={null}
        {...floatingUIOptions}
      >
        {content}
      </PositionPopover>
    );
  }

  return (
    <BlockPopover blockId={blockId} portalElement={null} {...floatingUIOptions}>
      {content}
    </BlockPopover>
  );
}
