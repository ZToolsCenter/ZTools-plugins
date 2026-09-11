import { useNotebooks } from "../../../useNotebooks";
import type { StoreSet, StoreGet } from "../hydrate";
import { flushEditorContent } from "../flushEditor";

export const setActivePageAction = (
  set: StoreSet,
  get: StoreGet,
  id: string | null,
): void => {
  const previousActivePageId = get().activePageId;
  if (previousActivePageId === id) return;

  // 触发编辑器把未提交内容回填到 store；同步事件，无 IO。
  flushEditorContent(true);

  // 切走时让上一页的本地保存在后台收尾，不再阻塞当前切换。
  // flushPendingLocalSaveByPageId 内部本身按 pageId 串行写盘，安全可重入。
  if (previousActivePageId && previousActivePageId !== id) {
    void get().flushPendingLocalSaveByPageId(previousActivePageId);
  }

  if (!id) {
    set({ activePageId: null });
    return;
  }

  // 本地文件夹的内容由 scanner 一次性加载，并保留内存中的任何脏改动；
  // 切换标签页时直接用 store 里的 page.content，不再重读原文件。
  // 重读会绕过 frontmatter/raw-guard 流水线，并覆盖用户未保存的编辑。
  set({ activePageId: id });

  const notebookId = useNotebooks.getState().activeNotebookId;
  if (notebookId) {
    useNotebooks.getState().setLastActivePage(notebookId, id);
  }
};
