import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { createReactBlockSpec, useUploadLoading } from "@blocknote/react";
import {
  createVideoBlockConfig,
  videoParse,
  type BlockNoteEditor,
} from "@blocknote/core";
import { FilePanelExtension } from "@blocknote/core/extensions";
import * as LucideIcons from "lucide-react";
import { GooseVideoPlayer } from "./GooseVideoPlayer";
import { VideoToolbar } from "./VideoToolbar";
import {
  MediaLoadingPreview,
  MediaPlaceholder,
} from "@/components/editor/blocks/shared/MediaPlaceholder";
import { useEditorPlatform } from "@/components/editor/platform/context";
import { useEditorPageContext } from "@/components/editor/platform/hostContext";
import type { ImageAlignment } from "@/components/editor/image/imageUtils";
import { EDITOR_UI_SCALE_CHANGE_EVENT } from "@/lib/appearance";

function VideoUrlInput({
  block,
  editor,
}: {
  block: any;
  editor: BlockNoteEditor<any, any, any>;
}) {
  const [url, setUrl] = useState("");

  const submit = () => {
    const trimmed = url.trim();
    if (!trimmed) return;
    editor.updateBlock(block, { props: { url: trimmed } });
  };

  return (
    <div className="flex items-center gap-2 rounded-md border border-[var(--goose-block-subtle-border)] bg-[var(--goose-block-subtle-bg)] px-3 py-2">
      <LucideIcons.Link className="h-4 w-4 shrink-0 text-muted-foreground" />
      <input
        type="text"
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            submit();
          }
        }}
        onBlur={submit}
        placeholder="粘贴视频链接..."
        className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground/60"
        autoFocus
      />
    </div>
  );
}

function ensureParagraphAfter(
  editor: BlockNoteEditor<any, any, any>,
  block: { id: string },
) {
  try {
    const [inserted] = editor.insertBlocks(
      [{ type: "paragraph", content: "" }],
      block,
      "after",
    );
    if (inserted) {
      editor.setTextCursorPosition(inserted, "start");
      editor.focus();
    }
  } catch {
    // ignore
  }
}

function VideoBlockContent({
  block,
  editor,
}: {
  block: any;
  editor: BlockNoteEditor<any, any, any>;
}) {
  const showLoader = useUploadLoading(block.id);
  const shellRef = useRef<HTMLDivElement>(null);
  const platform = useEditorPlatform();
  const { getActivePageLocalFilePath } = useEditorPageContext();
  const [resolvedSrc, setResolvedSrc] = useState<string | null>(null);
  const [selected, setSelected] = useState(false);
  const [toolbarRect, setToolbarRect] = useState<DOMRect | null>(null);

  const rawSrc = block.props.url as string;
  const activePageLocalFilePath = getActivePageLocalFilePath();
  const alignment: ImageAlignment =
    block.props.textAlignment === "center" ||
    block.props.textAlignment === "right"
      ? block.props.textAlignment
      : "left";

  useEffect(() => {
    let cancelled = false;
    setResolvedSrc(null);

    if (!rawSrc) return () => undefined;
    if (/^(?:https?:|data:|blob:)/i.test(rawSrc)) {
      setResolvedSrc(rawSrc);
      return () => undefined;
    }

    void platform.imageStorage
      .resolveRefToUrl(rawSrc, activePageLocalFilePath)
      .then((url) => {
        if (!cancelled) setResolvedSrc(url);
      })
      .catch((error) => {
        console.error("[video] 视频资源解析失败:", rawSrc, error);
        if (!cancelled) setResolvedSrc(rawSrc);
      });

    return () => {
      cancelled = true;
    };
  }, [activePageLocalFilePath, platform.imageStorage, rawSrc]);

  const updateToolbarRect = useCallback(() => {
    const shell = shellRef.current;
    if (shell) setToolbarRect(shell.getBoundingClientRect());
  }, []);

  useEffect(() => {
    if (!selected) return;
    updateToolbarRect();

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (shellRef.current?.contains(target) ||
          target.closest("[data-goose-video-toolbar]"))
      ) {
        return;
      }
      setSelected(false);
    };

    document.addEventListener("pointerdown", handlePointerDown, true);
    window.addEventListener("scroll", updateToolbarRect, true);
    window.addEventListener("resize", updateToolbarRect);
    window.addEventListener(EDITOR_UI_SCALE_CHANGE_EVENT, updateToolbarRect);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown, true);
      window.removeEventListener("scroll", updateToolbarRect, true);
      window.removeEventListener("resize", updateToolbarRect);
      window.removeEventListener(
        EDITOR_UI_SCALE_CHANGE_EVENT,
        updateToolbarRect,
      );
    };
  }, [selected, updateToolbarRect]);

  const handleEnterBelow = useCallback(() => {
    ensureParagraphAfter(editor, block);
  }, [block, editor]);

  const handleReplace = useCallback(() => {
    editor.getExtension(FilePanelExtension)?.showMenu(block.id);
  }, [block.id, editor]);

  const handleDownload = useCallback(() => {
    if (!resolvedSrc) return;
    const link = document.createElement("a");
    link.href = resolvedSrc;
    link.download = block.props.name || `video-${Date.now()}.mp4`;
    document.body.appendChild(link);
    link.click();
    link.remove();
  }, [block.props.name, resolvedSrc]);

  const handleDelete = useCallback(() => {
    editor.removeBlocks([block]);
  }, [block, editor]);

  const handleAlign = useCallback(
    (value: ImageAlignment) => {
      editor.updateBlock(block, { props: { textAlignment: value } });
    },
    [block, editor],
  );

  if (showLoader) {
    return <MediaLoadingPreview label="视频处理中…" />;
  }

  if (!block.props.url) {
    return (
      <MediaPlaceholder
        variant="image"
        blockId={block.id}
        editor={editor}
        title="添加视频"
        hint="点击选择本地视频，将自动压缩为 MP4"
        icon={<LucideIcons.Video size={22} strokeWidth={1.75} />}
      />
    );
  }

  if (!resolvedSrc) {
    return <MediaLoadingPreview label="视频加载中…" />;
  }

  return (
    <div
      ref={shellRef}
      className="goose-video-block-shell"
      data-selected={selected ? "true" : "false"}
      data-alignment={alignment}
      style={
        block.props.previewWidth
          ? { width: `min(${block.props.previewWidth}px, 100%)` }
          : undefined
      }
      onPointerDownCapture={() => {
        setSelected(true);
        window.requestAnimationFrame(updateToolbarRect);
      }}
    >
      <GooseVideoPlayer src={resolvedSrc} onEnterBelow={handleEnterBelow} />
      {selected &&
        toolbarRect &&
        createPortal(
          <VideoToolbar
            rect={toolbarRect}
            alignment={alignment}
            editable={editor.isEditable}
            onAlign={handleAlign}
            onReplace={handleReplace}
            onDownload={handleDownload}
            onDelete={handleDelete}
          />,
          document.body,
        )}
    </div>
  );
}

export const customVideoBlock = createReactBlockSpec(
  createVideoBlockConfig({}),
  {
    meta: {
      fileBlockAccept: [
        "video/mp4",
        "video/quicktime",
        "video/webm",
        "video/x-m4v",
        "video/x-msvideo",
        "video/x-matroska",
        "video/*",
      ],
    },
    render: ({ block, editor }) => (
      <VideoBlockContent block={block} editor={editor} />
    ),
    parse: videoParse({}),
    toExternalHTML: ({ block }) => {
      if (!block.props.url) {
        return <p></p>;
      }
      return (
        <video
          src={block.props.url}
          controls
          className="bn-visual-media rounded-md max-w-full"
        />
      );
    },
  },
)();
