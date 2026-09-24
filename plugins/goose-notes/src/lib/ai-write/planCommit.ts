import { useNotebooks } from "@/stores/useNotebooks";
import { usePages } from "@/stores/usePages";
import type { AiWritePlan } from "./targetResolution";
import { inferTitleFromContent } from "./planBuilder";

export async function commitAiWritePlan(plan: AiWritePlan) {
  const pagesStore = usePages.getState();

  if (plan.action === "replace_page") {
    if (!plan.target.pageId) return null;
    const ok = await pagesStore.writePageContent(plan.target.pageId, plan.content);
    if (!ok) return null;
    return {
      pageId: plan.target.pageId,
      workspaceId: plan.target.workspaceId,
    };
  }

  if (plan.action === "append_page") {
    if (!plan.target.pageId) return null;
    const ok = await pagesStore.appendPageContent(plan.target.pageId, plan.content);
    if (!ok) return null;
    return {
      pageId: plan.target.pageId,
      workspaceId: plan.target.workspaceId,
    };
  }

  if (plan.action === "replace_block_range") {
    if (!plan.target.pageId || !plan.target.range) return null;
    const fragment = Array.isArray(plan.content)
      ? (plan.content as any[])
      : Array.isArray((plan.content as any)?.content)
        ? ((plan.content as any).content as any[])
        : [];
    if (!fragment.length) return null;
    const ok = await pagesStore.replaceBlockRange(
      plan.target.pageId,
      plan.target.range.startBlockId,
      plan.target.range.endBlockId,
      fragment as any,
    );
    if (!ok) return null;
    return {
      pageId: plan.target.pageId,
      workspaceId: plan.target.workspaceId,
    };
  }

  const workspaceId = plan.target.workspaceId;
  if (!workspaceId) return null;

  const title = inferTitleFromContent(plan.content, plan.previewTitle);
  const notebook = useNotebooks.getState().notebooks[workspaceId];
  const parentId =
    plan.action === "create_child_page"
      ? plan.target.parentId
      : undefined;

  if (notebook?.source === "local-folder") {
    const pageId = await pagesStore.createLocalPageRecord({
      workspaceId,
      parentId,
      title,
      content: plan.content,
    });
    if (!pageId) return null;
    return {
      pageId,
      workspaceId,
    };
  }

  const pageId = pagesStore.createPageRecord({
    workspaceId,
    parentId,
    content: plan.content,
  });

  return {
    pageId,
    workspaceId,
  };
}
