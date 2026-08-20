import { createExtension } from "@blocknote/core";
import type { Mark, MarkType, ResolvedPos } from "@tiptap/pm/model";
import { Plugin, TextSelection } from "@tiptap/pm/state";
import type { EditorState } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";

/**
 * 行内代码的光标进出。
 *
 * 「盒内 / 盒外」不是插件自己的状态，而是直接读 ProseMirror 的
 * storedMarks（缺省时读 `$pos.marks()`）：含 code 即盒内。code mark 是
 * inclusive 的，所以右边界缺省就是盒内、左边界缺省就是盒外，两个非缺省
 * 组合由本插件写 storedMarks 得到。渲染侧只需在这两种情况下把浏览器光标
 * 挪到 boundary span 的另一侧。
 */

export type InlineCodeEdge = "start" | "end";

export type InlineCodeEdgeArrowAction =
  | "step-inward"
  | "enter"
  | "leave"
  | null;

/** prosemirror-view 未导出 domObserver 类型，但版本已在 package.json 里锁死。 */
type EditorViewInternals = EditorView & {
  domObserver: { setCurSelection: () => void };
};

const CODE_SELECTOR = "code[data-goose-inline-code]";
const CONTENT_SELECTOR = "[data-goose-inline-code-content]";

function segmentGraphemes(text: string): string[] {
  const Segmenter = (
    Intl as typeof Intl & {
      Segmenter?: new (
        locales?: string | string[],
        options?: { granularity: "grapheme" },
      ) => { segment: (value: string) => Iterable<{ segment: string }> };
    }
  ).Segmenter;

  if (!Segmenter) {
    // 旧版 uTools Chromium 没有 Intl.Segmenter 时，至少正确处理代理对。
    return Array.from(text);
  }
  const values: string[] = [];
  for (const value of new Segmenter(undefined, {
    granularity: "grapheme",
  }).segment(text)) {
    values.push(value.segment);
  }
  return values;
}

/** 文本靠 edge 一侧的首个字素占多少个 UTF-16 码元。 */
export function edgeGraphemeLength(
  text: string,
  edge: InlineCodeEdge,
): number {
  if (!text) return 0;
  const graphemes = segmentGraphemes(text);
  const grapheme =
    edge === "start" ? graphemes[0] : graphemes[graphemes.length - 1];
  return grapheme?.length ?? 0;
}

/** 该文档位置是否正好压在某段行内代码的左右边界上。 */
export function inlineCodeEdgeAt(
  $pos: ResolvedPos,
  codeType: MarkType,
): InlineCodeEdge | null {
  const before = $pos.nodeBefore;
  const after = $pos.nodeAfter;
  const beforeCode = !!before?.isText && !!codeType.isInSet(before.marks);
  const afterCode = !!after?.isText && !!codeType.isInSet(after.marks);
  if (afterCode && !beforeCode) return "start";
  if (beforeCode && !afterCode) return "end";
  return null;
}

/**
 * 光标停在边界上时方向键的语义：
 * 朝代码内部按 → 盒外先进盒内、盒内再走一个字素；朝外按 → 盒内先出盒、盒外交给浏览器。
 */
export function inlineCodeEdgeArrowAction(
  edge: InlineCodeEdge,
  inside: boolean,
  direction: "left" | "right",
): InlineCodeEdgeArrowAction {
  const inward = edge === "start" ? "right" : "left";
  if (direction === inward) return inside ? "step-inward" : "enter";
  return inside ? "leave" : null;
}

function currentMarks(state: EditorState, $pos: ResolvedPos): readonly Mark[] {
  return state.storedMarks ?? $pos.marks();
}

function isInside(
  state: EditorState,
  $pos: ResolvedPos,
  codeType: MarkType,
): boolean {
  return !!codeType.isInSet(currentMarks(state, $pos));
}

/** 落到新位置时补 storedMarks：只有左边界的缺省 marks 不含 code。 */
function marksForCaretAt(
  $pos: ResolvedPos,
  codeType: MarkType,
): readonly Mark[] | null {
  return inlineCodeEdgeAt($pos, codeType) === "start"
    ? ($pos.nodeAfter?.marks ?? null)
    : null;
}

function moveCaret(
  view: EditorView,
  target: number,
  codeType: MarkType,
): boolean {
  const { state } = view;
  const $target = state.doc.resolve(target);
  view.dispatch(
    state.tr
      .setSelection(TextSelection.create(state.doc, target))
      .setStoredMarks(marksForCaretAt($target, codeType) as Mark[] | null),
  );
  return true;
}

function stepTarget(
  $pos: ResolvedPos,
  from: number,
  direction: "left" | "right",
): number | null {
  const text =
    direction === "right" ? ($pos.nodeAfter?.text ?? "") : ($pos.nodeBefore?.text ?? "");
  const length = edgeGraphemeLength(text, direction === "right" ? "start" : "end");
  if (!length) return null;
  return direction === "right" ? from + length : from - length;
}

function handleArrow(view: EditorView, direction: "left" | "right"): boolean {
  const { state } = view;
  const codeType = state.schema.marks.code;
  if (!codeType) return false;

  const selection = state.selection;
  if (!(selection instanceof TextSelection) || !selection.empty) return false;

  const $pos = selection.$from;
  const edge = inlineCodeEdgeAt($pos, codeType);

  if (!edge) {
    // 不在边界：浏览器只会把光标停在盒外，落点是左边界时要改成盒内。
    const target = stepTarget($pos, selection.from, direction);
    if (target === null) return false;
    if (inlineCodeEdgeAt(state.doc.resolve(target), codeType) !== "start") {
      return false;
    }
    return moveCaret(view, target, codeType);
  }

  const action = inlineCodeEdgeArrowAction(
    edge,
    isInside(state, $pos, codeType),
    direction,
  );
  if (!action) return false;

  if (action === "step-inward") {
    const target = stepTarget($pos, selection.from, direction);
    if (target === null) return false;
    return moveCaret(view, target, codeType);
  }

  const marks = currentMarks(state, $pos);
  const next =
    action === "enter"
      ? codeType.create().addToSet(marks as Mark[])
      : codeType.removeFromSet(marks as Mark[]);
  view.dispatch(state.tr.setStoredMarks(next));
  return true;
}

/**
 * 边界上的删除必须自己做：浏览器会把紧邻的零宽 boundary span 当成要删的东西，
 * 删完文档没变化，ProseMirror 也就不会重绘补回那个 span。
 */
function handleDelete(
  view: EditorView,
  direction: "backward" | "forward",
): boolean {
  const { state } = view;
  const codeType = state.schema.marks.code;
  if (!codeType) return false;

  const selection = state.selection;
  if (!(selection instanceof TextSelection) || !selection.empty) return false;

  const $pos = selection.$from;
  if (!inlineCodeEdgeAt($pos, codeType)) return false;

  const node = direction === "backward" ? $pos.nodeBefore : $pos.nodeAfter;
  if (!node?.isText) return false;
  const length = edgeGraphemeLength(
    node.text ?? "",
    direction === "backward" ? "end" : "start",
  );
  if (!length) return false;

  const inside = isInside(state, $pos, codeType);
  const tr =
    direction === "backward"
      ? state.tr.delete(selection.from - length, selection.from)
      : state.tr.delete(selection.from, selection.from + length);

  // 删除会清掉 storedMarks，这里把删除前的「盒内 / 盒外」补回去。
  const $after = tr.selection.$from;
  if (inlineCodeEdgeAt($after, codeType)) {
    const marks = $after.marks();
    tr.setStoredMarks(
      inside
        ? codeType.create().addToSet(marks)
        : codeType.removeFromSet(marks),
    );
  }
  view.dispatch(tr.scrollIntoView());
  return true;
}

function inlineCodeElementAt(
  view: EditorView,
  pos: number,
  edge: InlineCodeEdge,
): HTMLElement | null {
  let dom: { node: Node; offset: number };
  try {
    dom = view.domAtPos(pos, edge === "start" ? 1 : -1);
  } catch {
    return null;
  }

  let candidate: Node | null = dom.node;
  if (candidate.nodeType === Node.ELEMENT_NODE) {
    candidate =
      candidate.childNodes[edge === "start" ? dom.offset : dom.offset - 1] ??
      candidate;
  }
  const element =
    candidate.nodeType === Node.ELEMENT_NODE
      ? (candidate as HTMLElement)
      : candidate.parentElement;
  return element?.closest<HTMLElement>(CODE_SELECTOR) ?? null;
}

/** 把浏览器光标钉到 boundary span 的正确一侧；两侧映射回的文档位置相同。 */
function syncCaretSide(view: EditorView): void {
  const { state } = view;
  const codeType = state.schema.marks.code;
  if (!codeType || view.composing || !view.hasFocus()) return;

  const selection = state.selection;
  if (!(selection instanceof TextSelection) || !selection.empty) return;

  const $pos = selection.$from;
  const edge = inlineCodeEdgeAt($pos, codeType);
  if (!edge) return;

  const code = inlineCodeElementAt(view, selection.from, edge);
  if (!code) return;

  const domSelection = view.dom.ownerDocument.getSelection();
  if (!domSelection?.isCollapsed || !domSelection.anchorNode) return;

  const wantInside = isInside(state, $pos, codeType);
  if (code.contains(domSelection.anchorNode) === wantInside) return;

  const range = view.dom.ownerDocument.createRange();
  if (wantInside) {
    const content = code.querySelector(CONTENT_SELECTOR);
    if (!content) return;
    if (edge === "start") range.setStartBefore(content);
    else range.setStartAfter(content);
  } else {
    const sibling = edge === "start" ? code.previousSibling : code.nextSibling;
    if (sibling?.nodeType === Node.TEXT_NODE) {
      range.setStart(
        sibling,
        edge === "start" ? (sibling.nodeValue?.length ?? 0) : 0,
      );
    } else if (edge === "start") {
      range.setStartBefore(code);
    } else {
      range.setStartAfter(code);
    }
  }
  range.collapse(true);
  domSelection.removeAllRanges();
  domSelection.addRange(range);
  // 不同步 DOMObserver 的话，它会把这次改动当成用户选区变化，
  // 在 flush 里用 selectionToDOM 把光标画回 ProseMirror 的缺省一侧。
  (view as EditorViewInternals).domObserver.setCurSelection();
}

function inlineCodeCaretPlugin() {
  return new Plugin({
    props: {
      handleKeyDown(view: EditorView, event: KeyboardEvent): boolean {
        if (
          event.shiftKey ||
          event.metaKey ||
          event.ctrlKey ||
          event.altKey ||
          event.isComposing ||
          view.composing
        ) {
          return false;
        }
        if (event.key === "ArrowLeft" || event.keyCode === 37) {
          return handleArrow(view, "left");
        }
        if (event.key === "ArrowRight" || event.keyCode === 39) {
          return handleArrow(view, "right");
        }
        if (event.key === "Backspace" || event.keyCode === 8) {
          return handleDelete(view, "backward");
        }
        if (event.key === "Delete" || event.keyCode === 46) {
          return handleDelete(view, "forward");
        }
        return false;
      },
      /** 点在盒子矩形内落盒内、点在左右留白里落盒外。 */
      handleClick(view: EditorView, pos: number, event: MouseEvent): boolean {
        if (event.button !== 0) return false;

        const { state } = view;
        const codeType = state.schema.marks.code;
        if (!codeType) return false;

        const $pos = state.doc.resolve(pos);
        const edge = inlineCodeEdgeAt($pos, codeType);
        if (!edge) return false;

        const code = inlineCodeElementAt(view, pos, edge);
        if (!code) return false;

        const rect = code.getBoundingClientRect();
        const inside =
          event.clientX > rect.left && event.clientX < rect.right;
        const marks = inside
          ? marksForCaretAt($pos, codeType)
          : codeType.removeFromSet($pos.marks());

        view.dispatch(
          state.tr
            .setSelection(TextSelection.create(state.doc, pos))
            .setStoredMarks(marks as Mark[] | null),
        );
        return true;
      },
    },
    view() {
      return { update: syncCaretSide };
    },
  });
}

export const gooseInlineCodeCaretExtension = createExtension({
  key: "goose-inline-code-caret",
  prosemirrorPlugins: [inlineCodeCaretPlugin()],
});
