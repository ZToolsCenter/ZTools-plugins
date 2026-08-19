import { useCallback, useState } from "react";
import { createFileBlockConfig, fileParse } from "@blocknote/core";
import { createReactBlockSpec, useUploadLoading } from "@blocknote/react";
import { FilePanelExtension } from "@blocknote/core/extensions";
import { toast } from "@/components/ui/sonner";
import { useEditorPlatform } from "@/components/editor/platform/context";
import {
  useEditorPageContext,
  useEditorSettings,
} from "@/components/editor/platform/hostContext";
import {
  MediaLoadingPreview,
  MediaPlaceholder,
} from "@/components/editor/blocks/shared/MediaPlaceholder";

function triggerDownload(url: string, name: string): void {
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

function CustomFileBlockContent({
  block,
  editor,
}: {
  block: any;
  editor: any;
}) {
  const showLoader = useUploadLoading(block.id);
  const platform = useEditorPlatform();
  const { onOpenAttachment } = useEditorPageContext();
  const { features } = useEditorSettings();
  const [renaming, setRenaming] = useState(false);
  const [draftName, setDraftName] = useState("");

  const handleAddFile = useCallback(() => {
    if (!editor.isEditable) return;
    const filePanel = editor.getExtension(FilePanelExtension);
    filePanel?.showMenu(block.id);
  }, [editor, block.id]);

  const handleDownload = useCallback(async () => {
    const url = block.props.url;
    const name = block.props.name || "download";
    if (!url) return;

    if (!/^(?:https?|data|blob):/i.test(url)) {
      const blob = await platform.imageStorage.load(url);
      if (!blob) {
        toast.error("附件不存在或尚未同步完成");
        return;
      }
      const objectUrl = URL.createObjectURL(blob);
      try {
        triggerDownload(objectUrl, name);
      } finally {
        setTimeout(() => URL.revokeObjectURL(objectUrl), 30_000);
      }
      return;
    }

    triggerDownload(url, name);
  }, [block.props.url, block.props.name, platform]);

  const handleOpen = useCallback(async () => {
    const url = block.props.url as string;
    const name = (block.props.name as string) || "download";
    if (!url) return;

    if (!features.openAttachmentsExternally || !onOpenAttachment) {
      await handleDownload();
      return;
    }

    const result = await onOpenAttachment(url, name);
    if (!result.ok) {
      toast.error("系统默认应用打开失败", {
        description: result.error || "请下载后再打开",
      });
    }
  }, [
    block.props.name,
    block.props.url,
    features.openAttachmentsExternally,
    handleDownload,
    onOpenAttachment,
  ]);

  const handleDelete = useCallback(() => {
    editor.removeBlocks([block]);
  }, [editor, block]);

  const handleRenameStart = useCallback(() => {
    setDraftName(block.props.name || "");
    setRenaming(true);
  }, [block.props.name]);

  const handleRenameCommit = useCallback(() => {
    const trimmed = draftName.trim();
    if (trimmed) {
      editor.updateBlock(block, { props: { name: trimmed } });
    }
    setRenaming(false);
  }, [editor, block, draftName]);

  const handleRenameCancel = useCallback(() => {
    setRenaming(false);
  }, []);

  const handleRenameKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      e.stopPropagation();
      if (e.key === "Enter") {
        e.preventDefault();
        handleRenameCommit();
      } else if (e.key === "Escape") {
        e.preventDefault();
        handleRenameCancel();
      }
    },
    [handleRenameCommit, handleRenameCancel],
  );

  if (showLoader) {
    return <MediaLoadingPreview />;
  }

  if (!block.props.url) {
    return (
      <MediaPlaceholder
        variant="file"
        blockId={block.id}
        editor={editor}
        title="添加文件"
        hint="点击选择，或直接拖入编辑器"
        icon={<LucideIcons.FileUp size={18} strokeWidth={1.75} />}
      />
    );
  }

  return (
    <div className="goose-file-block-content">
      <div className="goose-file-block-info">
        <button
          type="button"
          className="goose-file-block-icon-btn"
          onClick={handleAddFile}
          title="更换文件"
        >
          <LucideIcons.FileText size={20} strokeWidth={1.75} />
        </button>
        {renaming ? (
          <input
            className="goose-file-block-name-input"
            value={draftName}
            autoFocus
            onFocus={(e) => e.target.select()}
            onChange={(e) => setDraftName(e.target.value)}
            onKeyDown={handleRenameKeyDown}
            onBlur={handleRenameCommit}
            onClick={(e) => e.stopPropagation()}
          />
        ) : (
          <button
            type="button"
            className="goose-file-block-name"
            onClick={handleOpen}
            title="使用系统默认应用打开"
          >
            {block.props.name}
          </button>
        )}
      </div>
      <div className="goose-editor-inline-context-ui goose-file-block-actions">
        {features.openAttachmentsExternally && (
          <button
            type="button"
            className="goose-file-block-action-btn"
            onClick={handleOpen}
            title="使用系统默认应用打开"
          >
            <LucideIcons.ExternalLink size={16} strokeWidth={1.75} />
          </button>
        )}
        <button
          type="button"
          className="goose-file-block-action-btn"
          onClick={handleRenameStart}
          title="重命名"
        >
          <LucideIcons.Pencil size={16} strokeWidth={1.75} />
        </button>
        <button
          type="button"
          className="goose-file-block-action-btn"
          onClick={handleDownload}
          title="下载"
        >
          <LucideIcons.Download size={16} strokeWidth={1.75} />
        </button>
        <button
          type="button"
          className="goose-file-block-action-btn"
          onClick={handleDelete}
          title="删除"
        >
          <LucideIcons.Trash2 size={16} strokeWidth={1.75} />
        </button>
      </div>
    </div>
  );
}

export const customFileBlock = createReactBlockSpec(createFileBlockConfig(), {
  meta: {
    fileBlockAccept: ["*/*"],
  },
  render: (props) => (
    <CustomFileBlockContent block={props.block} editor={props.editor} />
  ),
  parse: fileParse(),
  toExternalHTML: ({ block }) => {
    if (!block.props.url) {
      return <p>添加文件</p>;
    }

    const link = (
      <a href={block.props.url}>{block.props.name || block.props.url}</a>
    );

    if (block.props.caption) {
      return (
        <div>
          {link}
          <p>{block.props.caption}</p>
        </div>
      );
    }

    return link;
  },
})();
