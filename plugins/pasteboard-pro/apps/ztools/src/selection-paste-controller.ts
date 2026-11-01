import { PasteItemSchema, type PasteItem } from "@pasteboard-pro/core";
import type { ClipboardWriteContent } from "../preload/privacy";
import { combinedTextPasteContent } from "./batch-paste";

export type SelectionPasteNotice = {
  kind: "mixed" | "error" | "queue";
  itemIds: string[];
  message?: string;
};

type PasteResult = { status: string } | undefined;
export type SelectionPasteDependencies = {
  resolveItem(itemId: string): Promise<unknown>;
  pasteSingle(itemId: string, plainText: boolean): Promise<void>;
  pasteContent(content: ClipboardWriteContent): Promise<PasteResult>;
  reportStatus(message: string): void;
  showNotice(notice: SelectionPasteNotice): void;
  closeShelf(): void;
};

/** Resolve the full selection before any clipboard write. Mixed formats cannot
 * be atomically inserted by repeatedly pasting from a window that closes on blur.
 */
export function createSelectionPasteController(dependencies: SelectionPasteDependencies) {
  let pending = false;

  async function paste(itemIds: readonly string[], plainText = false): Promise<void> {
    if (pending || itemIds.length === 0) return;
    pending = true;
    const ids = [...itemIds];
    try {
      const resolved = await Promise.all(ids.map(id => dependencies.resolveItem(id)));
      const items: PasteItem[] = [];
      for (const [index, value] of resolved.entries()) {
        const result = PasteItemSchema.safeParse(value);
        if (result.success && result.data.id === ids[index]) items.push(result.data);
      }
      if (items.length !== ids.length) {
        dependencies.showNotice({
          kind: "error", itemIds: ids,
          message: `${ids.length - items.length} 项内容已不可用，请重新选择后粘贴。`,
        });
        return;
      }
      if (ids.length === 1) {
        await dependencies.pasteSingle(ids[0]!, plainText);
        return;
      }
      const content = combinedTextPasteContent(items);
      if (content === undefined) {
        dependencies.showNotice({ kind: "mixed", itemIds: ids });
        return;
      }
      const result = await dependencies.pasteContent(content);
      if (result === undefined) throw new Error("粘贴服务暂不可用，请重试。");
      dependencies.reportStatus(result.status === "accessibility_required"
        ? `已复制 ${items.length} 条文本；授权辅助功能后可直接粘贴`
        : `已一次性粘贴 ${items.length} 条文本`);
      dependencies.closeShelf();
    } catch (error) {
      dependencies.showNotice({
        kind: "error", itemIds: ids,
        message: error instanceof Error ? error.message : "粘贴失败，请重试。",
      });
    } finally {
      pending = false;
    }
  }

  return { paste };
}
