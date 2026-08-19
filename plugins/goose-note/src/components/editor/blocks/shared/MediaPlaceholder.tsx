import { useCallback, type ReactNode } from "react";
import { FilePanelExtension } from "@blocknote/core/extensions";
import { cn } from "@/components/editor/utils/cn";

export type MediaPlaceholderVariant = "image" | "file";

type MediaPlaceholderProps = {
  variant: MediaPlaceholderVariant;
  blockId: string;
  editor: {
    isEditable: boolean;
    getExtension: (ext: typeof FilePanelExtension) =>
      | { showMenu: (id: string) => void }
      | undefined;
  };
  title: string;
  hint?: string;
  icon: ReactNode;
  className?: string;
};

export function MediaPlaceholder({
  variant,
  blockId,
  editor,
  title,
  hint,
  icon,
  className,
}: MediaPlaceholderProps) {
  const handleMouseDown = useCallback((event: React.MouseEvent) => {
    event.preventDefault();
  }, []);

  const handleClick = useCallback(() => {
    if (!editor.isEditable) return;
    editor.getExtension(FilePanelExtension)?.showMenu(blockId);
  }, [blockId, editor]);

  const isImage = variant === "image";

  return (
    <button
      type="button"
      className={cn(
        "goose-media-placeholder",
        isImage
          ? "goose-media-placeholder--image"
          : "goose-media-placeholder--file",
        className,
      )}
      onMouseDown={handleMouseDown}
      onClick={handleClick}
      disabled={!editor.isEditable}
      aria-label={title}
    >
      <span className="goose-media-placeholder__icon" aria-hidden="true">
        {icon}
      </span>
      <span className="goose-media-placeholder__copy">
        <span className="goose-media-placeholder__title">{title}</span>
        {hint ? (
          <span className="goose-media-placeholder__hint">{hint}</span>
        ) : null}
      </span>
    </button>
  );
}

export function MediaLoadingPreview({ label = "上传中…" }: { label?: string }) {
  return (
    <div className="goose-media-loading" role="status" aria-live="polite">
      <LucideIcons.Loader2
        className="goose-media-loading__spinner"
        size={18}
        strokeWidth={1.75}
        aria-hidden="true"
      />
      <span className="goose-media-loading__label">{label}</span>
    </div>
  );
}
