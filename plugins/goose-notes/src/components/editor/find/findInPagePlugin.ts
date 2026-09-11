import { createExtension } from "@blocknote/core";
import { Plugin, PluginKey } from "prosemirror-state";
import { Decoration, DecorationSet } from "prosemirror-view";
import type { EditorView } from "prosemirror-view";
import type { BlockNoteEditor } from "@blocknote/core";

export type FindMatch = { from: number; to: number };

export type FindState = {
  query: string;
  caseSensitive: boolean;
  matches: FindMatch[];
  current: number;
};

const initialState: FindState = {
  query: "",
  caseSensitive: false,
  matches: [],
  current: -1,
};

type FindMeta =
  | { type: "set"; query: string; caseSensitive: boolean }
  | { type: "step"; delta: number }
  | { type: "clear" };

export const findInPageKey = new PluginKey<FindState>("goose-find-in-page");

function collectMatches(
  doc: import("prosemirror-model").Node,
  query: string,
  caseSensitive: boolean,
): FindMatch[] {
  if (!query) return [];
  const needle = caseSensitive ? query : query.toLowerCase();
  const matches: FindMatch[] = [];
  doc.descendants((node, pos) => {
    if (!node.isText || !node.text) return;
    const haystack = caseSensitive ? node.text : node.text.toLowerCase();
    let from = 0;
    while (from <= haystack.length - needle.length) {
      const idx = haystack.indexOf(needle, from);
      if (idx === -1) break;
      matches.push({ from: pos + idx, to: pos + idx + needle.length });
      from = idx + Math.max(needle.length, 1);
    }
  });
  return matches;
}

function recomputeAfterDocChange(prev: FindState, doc: import("prosemirror-model").Node): FindState {
  if (!prev.query) return prev;
  const matches = collectMatches(doc, prev.query, prev.caseSensitive);
  if (matches.length === 0) {
    return { ...prev, matches: [], current: -1 };
  }
  const current = Math.min(Math.max(prev.current, 0), matches.length - 1);
  return { ...prev, matches, current };
}

const findInPagePlugin = new Plugin<FindState>({
  key: findInPageKey,
  state: {
    init: () => initialState,
    apply(tr, value, _oldState, newState) {
      const meta = tr.getMeta(findInPageKey) as FindMeta | undefined;
      if (meta) {
        if (meta.type === "clear") {
          return initialState;
        }
        if (meta.type === "set") {
          const matches = collectMatches(newState.doc, meta.query, meta.caseSensitive);
          const current = matches.length > 0 ? 0 : -1;
          return {
            query: meta.query,
            caseSensitive: meta.caseSensitive,
            matches,
            current,
          };
        }
        if (meta.type === "step") {
          if (value.matches.length === 0) return value;
          const total = value.matches.length;
          const current = ((value.current + meta.delta) % total + total) % total;
          return { ...value, current };
        }
      }
      if (tr.docChanged && value.query) {
        return recomputeAfterDocChange(value, newState.doc);
      }
      return value;
    },
  },
  props: {
    decorations(state) {
      const value = findInPageKey.getState(state);
      if (!value || value.matches.length === 0) return null;
      const decorations: Decoration[] = value.matches.map((match, idx) =>
        Decoration.inline(match.from, match.to, {
          class:
            idx === value.current
              ? "goose-find-match goose-find-match--current"
              : "goose-find-match",
        }),
      );
      return DecorationSet.create(state.doc, decorations);
    },
  },
});

export const gooseFindInPageExtension = createExtension({
  key: "goose-find-in-page",
  prosemirrorPlugins: [findInPagePlugin],
});

function getView(editor: BlockNoteEditor<any, any, any>): EditorView | null {
  return (editor.prosemirrorView as EditorView | undefined) ?? null;
}

export function getFindState(editor: BlockNoteEditor<any, any, any>): FindState | null {
  const view = getView(editor);
  if (!view) return null;
  return findInPageKey.getState(view.state) ?? null;
}

export function setFindQuery(
  editor: BlockNoteEditor<any, any, any>,
  query: string,
  caseSensitive: boolean,
) {
  const view = getView(editor);
  if (!view) return;
  view.dispatch(
    view.state.tr.setMeta(findInPageKey, {
      type: "set",
      query,
      caseSensitive,
    } satisfies FindMeta),
  );
  scrollToCurrentMatch(view);
}

export function stepFindMatch(editor: BlockNoteEditor<any, any, any>, delta: number) {
  const view = getView(editor);
  if (!view) return;
  view.dispatch(
    view.state.tr.setMeta(findInPageKey, { type: "step", delta } satisfies FindMeta),
  );
  scrollToCurrentMatch(view);
}

export function clearFind(editor: BlockNoteEditor<any, any, any>) {
  const view = getView(editor);
  if (!view) return;
  view.dispatch(view.state.tr.setMeta(findInPageKey, { type: "clear" } satisfies FindMeta));
}

function scrollToCurrentMatch(view: EditorView) {
  const value = findInPageKey.getState(view.state);
  if (!value || value.current < 0 || value.current >= value.matches.length) return;
  const match = value.matches[value.current];
  const dom = view.domAtPos(match.from);
  const node =
    dom.node.nodeType === Node.TEXT_NODE ? dom.node.parentElement : (dom.node as HTMLElement);
  node?.scrollIntoView?.({ block: "center", behavior: "smooth" });
}
