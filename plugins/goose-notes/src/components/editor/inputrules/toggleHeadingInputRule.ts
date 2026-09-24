/**
 * 等 markdown 触发转换的 transaction 落定后，将同层后续块收编进新的可折叠标题。
 * markdownInputRules 的统一触发插件也复用这段后处理，保证两条入口行为一致。
 */
export function scheduleToggleHeadingSiblingAbsorption(
  editor: any,
  headingBlockId: string,
  headingLevel: number,
): void {
  window.setTimeout(() => {
    absorbSiblings(editor, headingBlockId, headingLevel);
  }, 0);
}

/**
 * 把 headingBlockId 之后的同层兄弟块收编为其 children，
 * 直到遇到 type === "heading" 且 props.level <= headingLevel 为止。
 */
function absorbSiblings(editor: any, headingBlockId: string, headingLevel: number): void {
  // 在更新后的 document 中找到目标块。
  const headingBlock = findBlockById(editor.document, headingBlockId);
  if (!headingBlock) return;

  // 找到该块在其父容器中的同层兄弟列表。
  const siblings = getSiblingList(editor.document, headingBlockId);
  if (!siblings) return;

  const headingIndex = siblings.findIndex((b: any) => b.id === headingBlockId);
  if (headingIndex === -1) return;

  // 收集从 headingIndex+1 开始、直到遇到同级/更高级标题前的所有块。
  const absorbed: any[] = [];
  for (let i = headingIndex + 1; i < siblings.length; i++) {
    const sib = siblings[i];
    if (
      sib.type === "heading" &&
      ((sib.props as any)?.level ?? 1) <= headingLevel
    ) {
      break;
    }
    absorbed.push(sib);
  }

  if (absorbed.length === 0) return;

  // 深拷贝 absorbed（removeBlocks 后原引用可能变陈旧）。
  const absorbedSnapshot = JSON.parse(JSON.stringify(absorbed));

  // 先移除后附加：BlockNote 0.51 无 transact API 对外暴露，顺序执行。
  // 时序说明：先 removeBlocks 再 updateBlock 追加 children；
  // 期间 children 先减后增，ToggleWrapper childAdded 会在增加时触发自动展开。
  editor.removeBlocks(absorbed);

  const existingChildren = headingBlock.children ?? [];
  editor.updateBlock(headingBlock, {
    children: [...existingChildren, ...absorbedSnapshot],
  });

  // 收编后光标回到 heading 标题末尾。
  try {
    const updatedHeading = findBlockById(editor.document, headingBlockId);
    if (updatedHeading) {
      editor.setTextCursorPosition(updatedHeading, "end");
    }
  } catch {
    // 忽略光标设置失败（极端情况）。
  }
}

/** 在整棵文档树中按 id 查找块（BFS）。 */
function findBlockById(blocks: any[], id: string): any | undefined {
  for (const block of blocks) {
    if (block.id === id) return block;
    if (block.children?.length) {
      const found = findBlockById(block.children, id);
      if (found) return found;
    }
  }
  return undefined;
}

/**
 * 找到包含 targetId 块的**直接父容器的子块列表**（即兄弟列表）。
 * 顶层块的父容器是 editor.document 本身。
 */
function getSiblingList(blocks: any[], targetId: string): any[] | undefined {
  for (let i = 0; i < blocks.length; i++) {
    if (blocks[i].id === targetId) return blocks;
    if (blocks[i].children?.length) {
      const found = getSiblingList(blocks[i].children, targetId);
      if (found) return found;
    }
  }
  return undefined;
}
