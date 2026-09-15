import {
  aiDocumentFormats,
  type DocumentStateBuilder,
  type StreamToolsProvider,
} from "@blocknote/xl-ai";

const defaultDocumentStateBuilder =
  aiDocumentFormats.html.defaultDocumentStateBuilder;
const defaultStreamToolsProvider =
  aiDocumentFormats.html.getStreamToolsProvider({});
/** 选区模式：允许 update + add（扩写列表），禁止 delete。 */
const selectionUpdateAddToolsProvider =
  aiDocumentFormats.html.getStreamToolsProvider({
    defaultStreamTools: { add: true, update: true, delete: false },
  });
// update/add 工具 validate 签名不同，守卫层用宽松类型包装后原样返回
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SelectionScopedTool = any;

/**
 * 选区 AI 只发送裁剪后的 selectedBlocks，不再附带整篇笔记作为上下文。
 * 无选区入口保持 xl-ai 默认 documentState，仍可理解和编辑整篇文档。
 */
export function createPrivateSelectionDocumentStateBuilder(
  baseBuilder: DocumentStateBuilder<any>,
): DocumentStateBuilder<any> {
  return async (request) => {
    // xl-ai 默认用 getSelectionCutBlocks(true)，会把端点扩到完整单词。
    // 隐私模式重新按原始 PM range 裁剪，避免多发送用户没有选中的相邻字符。
    const exactRequest = request.selectedBlocks
      ? {
          ...request,
          selectedBlocks: request.editor.getSelectionCutBlocks(false).blocks,
        }
      : request;
    const documentState = await baseBuilder(exactRequest);
    if (!documentState.selection) return documentState;

    return {
      ...documentState,
      blocks: [],
    };
  };
}

export const goosePrivateSelectionDocumentStateBuilder =
  createPrivateSelectionDocumentStateBuilder(defaultDocumentStateBuilder);

function collectBlockIds(
  blocks: Array<{ id: string; children?: unknown[] }>,
  ids = new Set<string>(),
) {
  for (const block of blocks) {
    ids.add(block.id);
    if (Array.isArray(block.children)) {
      collectBlockIds(
        block.children as Array<{ id: string; children?: unknown[] }>,
        ids,
      );
    }
  }
  return ids;
}

/** xl-ai 工具里的块 id 常带 `$` 后缀，与编辑器真实 id 对齐。 */
function stripIdSuffix(id: string): string {
  return id.endsWith("$") ? id.slice(0, -1) : id;
}

function idInSelectedSet(
  id: string | undefined,
  selectedBlockIds: ReadonlySet<string>,
): boolean {
  if (!id) return false;
  if (selectedBlockIds.has(id)) return true;
  const bare = stripIdSuffix(id);
  if (selectedBlockIds.has(bare)) return true;
  if (selectedBlockIds.has(`${bare}$`)) return true;
  return false;
}

function guardUpdateTool(
  tool: SelectionScopedTool,
  selectedBlockIds: ReadonlySet<string>,
): SelectionScopedTool {
  return {
    ...tool,
    validate(operation: unknown) {
      const result = tool.validate(operation);
      if (!result.ok) return result;

      const id = (result.value as { id?: string }).id;
      if (!idInSelectedSet(id, selectedBlockIds)) {
        return {
          ok: false,
          error: "AI 只能修改当前文字选区内的块。",
        };
      }
      return result;
    },
  };
}

/**
 * add 的 referenceId 必须落在选中块内（含末块），以便在选区后扩写列表；
 * 不允许以未选中块为锚点插入。
 */
function guardAddTool(
  tool: SelectionScopedTool,
  selectedBlockIds: ReadonlySet<string>,
): SelectionScopedTool {
  return {
    ...tool,
    validate(operation: unknown) {
      const result = tool.validate(operation);
      if (!result.ok) return result;

      const referenceId = (result.value as { referenceId?: string })
        .referenceId;
      if (!idInSelectedSet(referenceId, selectedBlockIds)) {
        return {
          ok: false,
          error: "AI 只能在当前选区范围内插入新块。",
        };
      }
      return result;
    },
  };
}

/**
 * 选区模式暴露 update + add，并用选区位置与块 ID 双重限制写入范围：
 * - xl-ai 的 updateSelection 会把端点块更新裁剪到精确字符范围；
 * - ID guard 阻止模型用未选块 ID 绕过范围限制；
 * - add 仅允许以选中块为 reference，便于在选区后扩写列表项；
 * - delete 不暴露，避免删除选区外整块。
 */
export const gooseSelectionScopedStreamToolsProvider: StreamToolsProvider<
  any,
  any
> = {
  getStreamTools(editor, selectionInfo, onBlockUpdate) {
    if (!selectionInfo) {
      return defaultStreamToolsProvider.getStreamTools(
        editor,
        selectionInfo,
        onBlockUpdate,
      ) as any;
    }

    const exactSelection = editor.getSelectionCutBlocks(false);
    const selectedBlockIds = collectBlockIds(exactSelection.blocks);
    const tools = selectionUpdateAddToolsProvider.getStreamTools(
      editor,
      {
        from: exactSelection._meta.startPos,
        to: exactSelection._meta.endPos,
      },
      onBlockUpdate,
    );

    return tools.map((tool) => {
      if (tool.name === "update") {
        return guardUpdateTool(tool, selectedBlockIds);
      }
      if (tool.name === "add") {
        return guardAddTool(tool, selectedBlockIds);
      }
      return tool;
    }) as any;
  },
};
