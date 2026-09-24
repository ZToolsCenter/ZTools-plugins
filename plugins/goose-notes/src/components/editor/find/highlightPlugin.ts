import { Plugin, PluginKey } from "prosemirror-state";
import { Decoration, DecorationSet } from "prosemirror-view";
import type { Node as ProsemirrorNode } from "prosemirror-model";

export type ParserOptions = {
  content: string;
  language?: string;
  pos: number;
  size: number;
};
export type Parser = (options: ParserOptions) => Decoration[] | Promise<Decoration[]> | void;

export type HighlightPluginOptions = {
  parser: Parser;
  nodeTypes?: string[];
  languageExtractor?: (node: ProsemirrorNode) => string | undefined;
};

class DecorationCache {
  private cache: Map<number, [ProsemirrorNode, Decoration[]]>;
  constructor(cache?: Map<number, [ProsemirrorNode, Decoration[]]>) {
    this.cache = new Map(cache);
  }
  get(pos: number) {
    return this.cache.get(pos);
  }
  set(pos: number, node: ProsemirrorNode, decorations: Decoration[]) {
    if (pos < 0) return;
    this.cache.set(pos, [node, decorations]);
  }
  replace(oldPos: number, newPos: number, node: ProsemirrorNode, decorations: Decoration[]) {
    this.remove(oldPos);
    this.set(newPos, node, decorations);
  }
  remove(pos: number) {
    this.cache.delete(pos);
  }
  invalidate(tr: any) {
    const returnCache = new DecorationCache(this.cache);
    const mapping = tr.mapping;
    this.cache.forEach(([node, decorations], pos) => {
      if (pos < 0) return;
      const result = mapping.mapResult(pos);
      const mappedNode = tr.doc.nodeAt(result.pos);
      if (result.deleted || !mappedNode?.eq(node)) returnCache.remove(pos);
      else if (pos !== result.pos) {
        const updatedDecorations = decorations
          .map((d: any) => d.map(mapping, 0, 0))
          .filter((d: any) => d != null) as Decoration[];
        returnCache.replace(pos, result.pos, mappedNode, updatedDecorations);
      }
    });
    return returnCache;
  }
}

export function createHighlightPlugin({
  parser,
  nodeTypes = ["code_block", "codeBlock"],
  languageExtractor = (node) => node.attrs.language,
}: HighlightPluginOptions) {
  const key = new PluginKey("prosemirror-highlight");
  return new Plugin({
    key,
    state: {
      init(_, instance) {
        const cache = new DecorationCache();
        const [decorations, promises] = calculateDecoration(
          instance.doc,
          parser,
          nodeTypes,
          languageExtractor,
          cache
        );
        return { cache, decorations, promises };
      },
      apply: (tr, data) => {
        const cache = data.cache.invalidate(tr);
        const refresh = !!tr.getMeta("prosemirror-highlight-refresh");
        if (!tr.docChanged && !refresh)
          return {
            cache,
            decorations: data.decorations?.map(tr.mapping, tr.doc),
            promises: data.promises,
          };
        const [decorations, promises] = calculateDecoration(
          tr.doc,
          parser,
          nodeTypes,
          languageExtractor,
          cache
        );
        return { cache, decorations, promises };
      },
    },
    view: (view) => {
      const promises = new Set<Promise<any>>();
      let destroyed = false;
      const refresh = () => {
        if (destroyed) return;
        if (promises.size > 0) return;
        const tr = view.state.tr.setMeta("prosemirror-highlight-refresh", true);
        view.dispatch(tr);
      };
      const check = () => {
        if (destroyed) return;
        const state = key.getState(view.state) as any;
        for (const promise of state?.promises ?? []) {
          promises.add(promise);
          promise
            .then(() => {
              promises.delete(promise);
              refresh();
            })
            .catch((error: any) => {
              console.error("[prosemirror-highlight] Error resolving parser:", error);
              promises.delete(promise);
            });
        }
      };
      check();
      return {
        update: () => check(),
        destroy: () => {
          destroyed = true;
          promises.clear();
        },
      };
    },
    props: {
      decorations(state) {
        return (this.getState(state) as any)?.decorations;
      },
    },
  });
}

function calculateDecoration(
  doc: ProsemirrorNode,
  parser: Parser,
  nodeTypes: string[],
  languageExtractor: (node: ProsemirrorNode) => string | undefined,
  cache: DecorationCache
): [DecorationSet | undefined, Promise<any>[]] {
  const allDecorations: Decoration[][] = [];
  const promises: Promise<any>[] = [];
  const nodes = collectCodeBlocks(doc, nodeTypes);
  try {
    for (const [node, pos] of nodes) {
      const language = languageExtractor(node);
      const cached = cache.get(pos);
      if (cached) {
        const [_, decorations] = cached;
        if (decorations.length > 0) allDecorations.push(decorations);
      } else {
        // FIX: Use textBetween with \n to preserve hard_break nodes!
        const parsed = parser({
          content: node.textBetween(0, node.content.size, "\n", "\n"),
          language: language || undefined,
          pos,
          size: node.nodeSize,
        });
        if (parsed && Array.isArray(parsed)) {
          cache.set(pos, node, parsed);
          if (parsed.length > 0) allDecorations.push(parsed);
        } else if (parsed instanceof Promise) {
          cache.remove(pos);
          promises.push(parsed);
        } else {
          console.error(`[prosemirror-highlight] Invalid parser result:`, parsed);
        }
      }
    }
  } catch (error) {
    console.error(`[prosemirror-highlight] Error parsing code blocks:`, error);
  }
  return [
    allDecorations.length > 0
      ? DecorationSet.create(doc, allDecorations.flat())
      : undefined,
    promises,
  ];
}

function collectCodeBlocks(doc: ProsemirrorNode, nodeTypes: string[]) {
  const nodes: [ProsemirrorNode, number][] = [];
  doc.descendants((node, pos) => {
    if (node.type.isTextblock && nodeTypes.includes(node.type.name)) {
      nodes.push([node, pos]);
      return false;
    }
  });
  return nodes;
}
