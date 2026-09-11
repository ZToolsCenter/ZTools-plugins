import { createExtension } from "@blocknote/core";

/**
 * 折叠标题「自动收编章节」：heading 刚变成 isToggleable（打 `》 ` / 菜单转折叠标题）时，
 * 自动把它下方的同级内容块收进 children。
 *
 * 问题：把已有标题转成折叠标题后，它下方的正文在文档树里仍是**同级兄弟块**而不是
 * children——点收起什么都收不进去，展开又显示「空的折叠块」，与用户预期
 * （Notion：折叠标题管辖它下面的整个章节）不符。
 *
 * 为什么在「变成折叠标题的瞬间」收集、而不是在「收起的瞬间」收集：
 * BlockNote 0.51 的 ToggleWrapper（react dist bi/yi）对 childAdded（children 从无到有）
 * 会**强制展开**——若在收起后才把兄弟块塞进 children，塞入动作本身立刻把块弹开，
 * 收起永远不生效。而转换瞬间块必然是展开态，childAdded 无副作用。
 *
 * 收编范围（章节语义）：紧随其后的同级兄弟块，直到（不含）下一个 level ≤ 本标题
 * 的 heading，或同级列表末尾。更深层级的 heading（level >）属于本章节，一并收入。
 *
 * 检测方式：onChange 里全树扫描 isToggleable heading 的 id 集合，与上一次快照 diff，
 * 新出现的 id 即「刚变成折叠标题」。不用 getChanges（其 prevBlock 形态在 0.51 无
 * 公开类型），全量 diff 对笔记规模的浅树扫描开销可忽略。
 *
 * 守卫：
 * - 标题一红线：首块（editor.document[0]）即便被标记 toggleable 也绝不收编——
 *   否则整篇文档会被吞进 children。
 * - 初始快照（mount 后首次扫描）只登记不收编：已存在的折叠标题保持原状。
 * - 收编在单个 transact 内完成（removeBlocks + updateBlock children 合并），
 *   一次 undo 可整体回退收编动作。
 * - 自身触发的 onChange 重入安全：收编后该 id 已在快照集合里，不会重复收编。
 */

type Block = {
  id: string;
  type: string;
  props: Record<string, unknown>;
  content?: unknown;
  children: Block[];
};

type Editor = {
  document: Block[];
  onChange: (cb: () => void) => (() => void) | undefined;
  transact: (fn: () => void) => void;
  removeBlocks: (blocks: { id: string }[]) => void;
  updateBlock: (block: { id: string }, update: { children: Block[] }) => void;
};

function isToggleableHeading(block: Block): boolean {
  return block.type === "heading" && block.props.isToggleable === true;
}

/** 全树收集 isToggleable heading 的 id。 */
function collectToggleableIds(blocks: Block[], into: Set<string>): Set<string> {
  for (const b of blocks) {
    if (isToggleableHeading(b)) into.add(b.id);
    if (b.children.length > 0) collectToggleableIds(b.children, into);
  }
  return into;
}

/** 在全树中找到 id 对应块所在的同级数组与下标。 */
function findSiblings(
  blocks: Block[],
  id: string,
): { siblings: Block[]; index: number } | null {
  for (let i = 0; i < blocks.length; i++) {
    if (blocks[i].id === id) return { siblings: blocks, index: i };
    if (blocks[i].children.length > 0) {
      const found = findSiblings(blocks[i].children, id);
      if (found) return found;
    }
  }
  return null;
}

/** 收编：heading 之后、直到下一个 level ≤ 它的 heading（不含）为止的同级兄弟块。 */
function collectSection(editor: Editor, headingId: string): void {
  const found = findSiblings(editor.document, headingId);
  if (!found) return;
  const heading = found.siblings[found.index];
  const level = (heading.props.level as number) ?? 1;

  const collected: Block[] = [];
  for (let i = found.index + 1; i < found.siblings.length; i++) {
    const sib = found.siblings[i];
    if (sib.type === "heading" && ((sib.props.level as number) ?? 1) <= level) {
      break;
    }
    collected.push(sib);
  }
  if (collected.length === 0) return;

  editor.transact(() => {
    editor.removeBlocks(collected);
    editor.updateBlock(heading, {
      children: [...heading.children, ...collected],
    });
  });
}

// createExtension 的函数形态：BlockNote 会以 { editor, options } 调用该工厂
// （mount 回调本身只拿得到 { dom, root, signal }，editor 经工厂闭包捕获）。
// 注意 createExtension(fn) 返回的是「options 应用器」，注册时需调用一次：
// extensions: [gooseToggleHeadingAutoCollectExtension()]。
export const gooseToggleHeadingAutoCollectExtension = createExtension(
  ({ editor }: { editor: unknown }) => ({
    key: "goose-toggle-heading-auto-collect",
    mount({ signal }: { signal: AbortSignal }) {
      const ed = editor as Editor;
      // 初始快照：已存在的折叠标题只登记，不收编。
      let known = collectToggleableIds(ed.document, new Set<string>());

      const off = ed.onChange(() => {
        const current = collectToggleableIds(ed.document, new Set<string>());
        const firstBlockId = ed.document[0]?.id;
        const fresh = [...current].filter(
          (id) => !known.has(id) && id !== firstBlockId,
        );
        // 先更新快照再收编：收编的 transact 会同步触发嵌套 onChange，
        // 若快照未先更新，同一 id 会被再次判定为新折叠标题。
        known = current;
        for (const id of fresh) collectSection(ed, id);
      });
      signal.addEventListener("abort", () => off?.());
    },
  }),
);
