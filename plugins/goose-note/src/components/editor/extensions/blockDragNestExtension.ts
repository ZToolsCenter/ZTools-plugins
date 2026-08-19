import { createExtension } from "@blocknote/core";

/**
 * 拖拽块时，若相对拖起点明显右移（意图嵌套），
 * 在 ProseMirror 完成同级放置后再执行 nestBlock，使被拖块成为前一块的子项。
 *
 * BlockNote 原生 drop 只做兄弟级插入；列表项下的段落子内容原先只能靠 Tab。
 * 侧栏把手拖拽时，用户期望 Notion 式「往右拖进成为子项」。
 *
 * 判定：drop 时 clientX − dragStartX ≥ NEST_DELTA_X，且 canNestBlock。
 * 仅「右移意图」触发，避免上下重排时误嵌套。
 */

/** 相对拖起点至少右移多少 px 才视为嵌套意图 */
const NEST_DELTA_X = 24;

type NestEditor = {
  canNestBlock: () => boolean;
  nestBlock: () => void;
  prosemirrorView:
    | {
        dom: HTMLElement;
        dragging: unknown;
      }
    | null
    | undefined;
};

type DragNestState = {
  active: boolean;
  startClientX: number;
  lastClientX: number;
};

function isBlockNoteDrag(event: DragEvent, editor: NestEditor): boolean {
  const types = event.dataTransfer?.types;
  if (types) {
    for (let i = 0; i < types.length; i++) {
      if (types[i] === "blocknote/html") return true;
    }
  }
  if (editor.prosemirrorView?.dragging) return true;
  const target = event.target;
  if (target instanceof Element && target.closest(".bn-side-menu")) return true;
  return false;
}

function tryNestAfterDrop(editor: NestEditor, deltaX: number): void {
  if (deltaX < NEST_DELTA_X) return;
  if (!editor.canNestBlock()) return;
  editor.nestBlock();
}

// createExtension 的函数形态：BlockNote 以 { editor } 调用工厂，
// mount 只拿得到 { dom, root, signal }，editor 经闭包捕获。
// 注册时需 gooseBlockDragNestExtension() 调用一次。
export const gooseBlockDragNestExtension = createExtension(
  ({ editor }: { editor: unknown }) => {
    const ed = editor as NestEditor;
    const state: DragNestState = {
      active: false,
      startClientX: 0,
      lastClientX: 0,
    };
    let clearTimer: number | null = null;

    const resetState = () => {
      state.active = false;
      state.startClientX = 0;
      state.lastClientX = 0;
    };

    return {
      key: "goose-block-drag-nest",
      mount({
        signal,
        dom,
        root,
      }: {
        signal: AbortSignal;
        dom: HTMLElement;
        root: Document | ShadowRoot;
      }) {
        const onDragStart = (event: Event) => {
          const e = event as DragEvent;
          const fromSideMenu =
            e.target instanceof Element && e.target.closest(".bn-side-menu");
          if (!fromSideMenu && !isBlockNoteDrag(e, ed)) {
            state.active = false;
            return;
          }
          if (clearTimer != null) {
            window.clearTimeout(clearTimer);
            clearTimer = null;
          }
          state.active = true;
          state.startClientX = e.clientX;
          state.lastClientX = e.clientX;
        };

        const onDragOver = (event: Event) => {
          const e = event as DragEvent;
          if (!state.active && !isBlockNoteDrag(e, ed)) return;
          if (!state.active) {
            // dragstart 未标记时（PM 内部拖拽），用当前点作起点
            state.active = true;
            state.startClientX = e.clientX;
          }
          state.lastClientX = e.clientX;
        };

        const onDrop = () => {
          if (!state.active) return;
          const deltaX = state.lastClientX - state.startClientX;
          // 等 ProseMirror 处理完 drop、选区落到被移动块上后再 nest
          requestAnimationFrame(() => {
            requestAnimationFrame(() => {
              try {
                tryNestAfterDrop(ed, deltaX);
              } catch {
                // nest 失败时保持同级结果，不打断编辑
              }
            });
          });
        };

        const onDragEnd = () => {
          if (clearTimer != null) window.clearTimeout(clearTimer);
          clearTimer = window.setTimeout(() => {
            clearTimer = null;
            resetState();
          }, 80);
        };

        root.addEventListener("dragstart", onDragStart, {
          capture: true,
          signal,
        });
        dom.addEventListener("dragover", onDragOver, { signal });
        dom.addEventListener("drop", onDrop, { signal });
        root.addEventListener("dragend", onDragEnd, {
          capture: true,
          signal,
        });

        signal.addEventListener("abort", () => {
          if (clearTimer != null) {
            window.clearTimeout(clearTimer);
            clearTimer = null;
          }
          resetState();
        });
      },
    };
  },
);
