// Staged clipboard link submission.
//
// `wf` stages one bare clipboard link as the parent of the next typed note.
// This module owns what that submission does, so the reuse rule is testable
// without a uTools runtime:
//
//   1. no note          -> the link alone is the capture
//   2. link already captured once -> reuse that node as the parent, no new link node
//   3. link not captured yet      -> create the link node, then hang the note under it
//
// A cached parent that Workflowy has since deleted is dropped and replaced by
// one fresh link node, so a stale record never costs the user the note.

function createStagedLinkCaptureHost(deps = {}) {
    const createTextCaptureNodes = deps.createTextCaptureNodes;
    const findCreatedWorkflowyChildNodeId = deps.findCreatedWorkflowyChildNodeId;
    const getWorkflowyNodeId = deps.getWorkflowyNodeId;
    const getCapturedLinkNodeId = deps.getCapturedLinkNodeId || (() => '');
    const rememberCapturedLink = deps.rememberCapturedLink || (() => null);
    const forgetCapturedLink = deps.forgetCapturedLink || (() => false);
    const notify = deps.notify || (() => {});

    const submitStagedLinkCapture = async ({
        parentId,
        noteText = '',
        stagedWebLink = null,
        settings = {},
        mode = 'add'
    } = {}) => {
        const url = String(stagedWebLink?.url || '').trim();
        if (!url) return { skipped: true, linkNodeId: '', reused: false };

        const title = String(stagedWebLink?.title || '').trim() || url;

        const createNote = (linkNodeId) => createTextCaptureNodes({
            parentId,
            text: noteText,
            settings,
            rememberedWebSource: null,
            forceParentId: linkNodeId,
            mode
        });

        const createLinkNode = async () => {
            const linkResult = await createTextCaptureNodes({
                parentId,
                text: url,
                settings,
                rememberedWebSource: null,
                forceParentId: null,
                mode
            });
            const nodeId = getWorkflowyNodeId(linkResult?.createdNodes?.[0])
                || await findCreatedWorkflowyChildNodeId({
                    parentId: linkResult?.createdParentId,
                    expectedItem: linkResult?.childItems?.[0],
                    settings
                });
            if (nodeId) rememberCapturedLink({ url, nodeId, title });
            return nodeId || '';
        };

        const cachedNodeId = getCapturedLinkNodeId(url) || '';

        if (!noteText) {
            if (cachedNodeId) {
                notify('该链接已收录，未重复创建');
                return { skipped: false, linkNodeId: cachedNodeId, reused: true, createdLinkNode: false, mode: 'link-only' };
            }
            const createdNodeId = await createLinkNode();
            notify(createdNodeId ? '已保存剪贴板链接' : '未能取得链接节点 ID');
            return { skipped: false, linkNodeId: createdNodeId, reused: false, createdLinkNode: !!createdNodeId, mode: 'link-only' };
        }

        const linkNodeId = cachedNodeId || await createLinkNode();
        if (!linkNodeId) {
            notify('未能取得链接节点 ID，笔记已按普通节点保存');
            await createNote(null);
            return { skipped: false, linkNodeId: '', reused: false, createdLinkNode: false, mode: 'degraded' };
        }

        try {
            await createNote(linkNodeId);
            return {
                skipped: false,
                linkNodeId,
                reused: !!cachedNodeId,
                createdLinkNode: !cachedNodeId,
                mode: cachedNodeId ? 'note-reused' : 'note'
            };
        } catch (error) {
            // Only a cached parent can be stale. A freshly created one that
            // fails is a real failure and must surface to the caller.
            if (!cachedNodeId) throw error;

            forgetCapturedLink(url);
            const freshNodeId = await createLinkNode();
            if (!freshNodeId) throw error;
            await createNote(freshNodeId);
            notify('原链接父节点已失效，已重新创建链接节点');
            return { skipped: false, linkNodeId: freshNodeId, reused: false, createdLinkNode: true, mode: 'note-relinked' };
        }
    };

    return { submitStagedLinkCapture };
}

module.exports = { createStagedLinkCaptureHost };
