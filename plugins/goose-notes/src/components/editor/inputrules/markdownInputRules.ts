import { createExtension } from "@blocknote/core";
import { Plugin, PluginKey, TextSelection } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import { isInsideToggle } from "@/components/editor/utils/toggleNesting";
import { scheduleToggleHeadingSiblingAbsorption } from "./toggleHeadingInputRule";

type RestoreState = {
  /** 块内容节点的位置；转换不会改变该位置。 */
  pos: number;
  /** 删除触发空格后应恢复的原始前缀，例如 `1.`、`1。`、`[]`、`【】`、`#`。 */
  triggerText: string;
  /** 转换前的块类型与属性，退格时精确恢复，避免丢失颜色等通用属性。 */
  originalType: string;
  originalAttrs: Record<string, unknown>;
  /** 用于确认 Backspace 仍停留在这次刚转换出的目标块中。 */
  convertedType: string;
};

type BlockTrigger = {
  type: string;
  props: Record<string, unknown>;
  triggerText: string;
  afterTransform?: () => void;
};

const markdownBlockTriggerKey = new PluginKey<RestoreState | null>(
  "goose-markdown-block-trigger",
);

/**
 * 转换后立刻在空块开头退格时，还原触发前缀（不含触发空格）。
 * 供本插件 handleKeyDown 与 emptyBlockBackspace 共用，避免插件顺序导致
 * 列表项原生降级抢走退格、触发字符（`【】` / `1。` 等）丢失。
 */
export function tryUndoMarkdownBlockTrigger(view: EditorView): boolean {
  const stored = markdownBlockTriggerKey.getState(view.state);
  if (!stored) return false;

  const { state } = view;
  const node = state.doc.nodeAt(stored.pos);
  const { $from, empty } = state.selection;
  // 边界：非空内容 / 非空选区 / 光标不在块首 / 已离开该块 → 一律放行默认删除。
  if (
    !node ||
    node.type.name !== stored.convertedType ||
    node.textContent.length > 0 ||
    !empty ||
    $from.parentOffset !== 0 ||
    $from.before($from.depth) !== stored.pos
  ) {
    return false;
  }

  const originalType = state.schema.nodes[stored.originalType];
  if (!originalType) return false;

  const tr = state.tr;
  // 先还原块类型，再写回触发前缀（不含触发空格），避免 `【】 ` / `1。 ` 退格变成双空格。
  tr.setNodeMarkup(stored.pos, originalType, stored.originalAttrs);
  const insertAt = stored.pos + 1;
  tr.insertText(stored.triggerText, insertAt);
  // 光标固定在还原前缀之后；docChanged 会清掉 restore 状态，再次退格走普通删除。
  tr.setSelection(
    TextSelection.create(tr.doc, insertAt + stored.triggerText.length),
  );
  view.dispatch(tr);
  return true;
}

/**
 * 行首待办触发匹配：半角 `[]`/`[x]` 与中文 `【】`/`【x】`。
 * 导出供单测；转换与退格还原都依赖同一规则。
 */
export function matchCheckListTrigger(
  textBefore: string,
): { checked: boolean; triggerText: string } | null {
  const matched = /^\s?(?:\[([ xX]?)\]|【([ xX]?)】)$/u.exec(textBefore);
  if (!matched) return null;
  const mark = matched[1] ?? matched[2] ?? "";
  return {
    checked: /x/i.test(mark),
    triggerText: matched[0],
  };
}

/**
 * 将所有「行首标记 + 空格」的普通 markdown 块触发收敛到一处。
 *
 * BlockNote 原生及 createExtension.inputRules 最终都会使用同一个 undoable input-rule
 * 通道。该通道撤销块转换时会额外回填本次输入的空格，因此 `1. ` 退格会成为 `1.  `。
 * 这里自行处理转换，并记录转换前的块；只要用户立刻在空块开头按 Backspace，就还原
 * 精确的触发文本（不含触发空格）。有其它编辑动作后记录自动失效，退格回到正常行为。
 *
 * 此插件由共享 Editor 挂载，主窗与速记小窗完全一致。特殊块的 markdown 屏蔽仍由
 * suppressMarkdownInSpecialBlocks 负责，并因注册顺序优先于本插件执行。
 * 分隔线 `---` 不以空格触发，退格不会出现本次的“双空格”问题，继续使用 BlockNote 原实现。
 */
function getBlockTrigger(
  textBefore: string,
  editor: any,
  currentBlock: any,
): BlockTrigger | null {
  const code = /^```(.*?)$/u.exec(textBefore);
  if (code) {
    return {
      type: "codeBlock",
      props: { language: code[1].trim() || "text" },
      triggerText: code[0],
    };
  }

  const ordered = /^\s?(\d+)([.。])$/u.exec(textBefore);
  if (ordered) {
    const start = Number.parseInt(ordered[1], 10);
    return {
      type: "numberedListItem",
      props: start === 1 ? {} : { start },
      triggerText: ordered[0],
    };
  }

  const bullet = /^\s?[-+*]$/u.exec(textBefore);
  if (bullet) {
    return { type: "bulletListItem", props: {}, triggerText: bullet[0] };
  }

  // 半角 `[]` / `[x]` 与中文全角 `【】` / `【x】` 均转待办，对齐 `1.` / `1。` 的中英输入习惯。
  const checked = matchCheckListTrigger(textBefore);
  if (checked) {
    return {
      type: "checkListItem",
      props: { checked: checked.checked },
      triggerText: checked.triggerText,
    };
  }

  const heading = /^(#{1,6})$/u.exec(textBefore);
  if (heading) {
    return {
      type: "heading",
      props: { level: heading[1].length },
      triggerText: heading[0],
    };
  }

  const quote = /^[|｜]$/u.exec(textBefore);
  if (quote) {
    return { type: "quote", props: {}, triggerText: quote[0] };
  }

  const toggle = /^[>》]$/u.exec(textBefore);
  if (toggle) {
    // 复用旧折叠输入规则的边界：首块、折叠块内部与已是折叠标题的场景均原样输入。
    if (
      currentBlock.id === editor.document[0]?.id ||
      isInsideToggle(editor, currentBlock)
    ) {
      return null;
    }

    if (currentBlock.type === "heading") {
      const props = currentBlock.props as {
        isToggleable?: boolean;
        level?: number;
      };
      if (props.isToggleable) return null;

      const headingId = currentBlock.id;
      const headingLevel = props.level ?? 1;
      return {
        type: "heading",
        props: { isToggleable: true },
        triggerText: toggle[0],
        afterTransform: () =>
          scheduleToggleHeadingSiblingAbsorption(
            editor,
            headingId,
            headingLevel,
          ),
      };
    }

    if (currentBlock.type === "paragraph") {
      return {
        type: "toggleListItem",
        props: {},
        triggerText: toggle[0],
      };
    }
  }

  return null;
}

function createMarkdownBlockTrigger(editor: any) {
  return new Plugin<RestoreState | null>({
    key: markdownBlockTriggerKey,
    state: {
      init: () => null,
      apply(tr, previous) {
        const stored = tr.getMeta(markdownBlockTriggerKey) as
          | RestoreState
          | undefined;
        if (stored) return stored;
        return tr.selectionSet || tr.docChanged ? null : previous;
      },
    },
    props: {
      handleTextInput(view, from, to, text) {
        if (text !== " " || from !== to) return false;

        const { state } = view;
        const $from = state.doc.resolve(from);
        const parent = $from.parent;
        if (parent.type.name !== "paragraph" && parent.type.name !== "heading") {
          return false;
        }

        const textBefore = parent.textBetween(
          0,
          $from.parentOffset,
          null,
          "￼",
        );
        const currentBlock = editor.getTextCursorPosition().block;
        const trigger = getBlockTrigger(textBefore, editor, currentBlock);
        if (!trigger) return false;

        // 除折叠标题外，所有 markdown 触发只允许从普通段落开始。
        if (
          parent.type.name !== "paragraph" &&
          !(trigger.type === "heading" && /^[>》]$/u.test(textBefore))
        ) {
          return false;
        }

        const blockPos = $from.before($from.depth);
        const targetType = state.schema.nodes[trigger.type];
        if (!targetType) return false;

        const tr = state.tr;
        tr.setNodeMarkup(blockPos, targetType, {
          ...parent.attrs,
          ...trigger.props,
        });
        tr.delete(from - trigger.triggerText.length, from);
        tr.setMeta(markdownBlockTriggerKey, {
          pos: blockPos,
          triggerText: trigger.triggerText,
          originalType: parent.type.name,
          originalAttrs: { ...parent.attrs },
          convertedType: trigger.type,
        } satisfies RestoreState);
        view.dispatch(tr);
        trigger.afterTransform?.();
        return true;
      },
      handleKeyDown(view, event) {
        if (event.key !== "Backspace") return false;
        return tryUndoMarkdownBlockTrigger(view);
      },
    },
  });
}

export const gooseMarkdownInputRulesExtension = createExtension(({ editor }) => ({
  key: "goose-markdown-input-rules",
  prosemirrorPlugins: [createMarkdownBlockTrigger(editor)],
}));
