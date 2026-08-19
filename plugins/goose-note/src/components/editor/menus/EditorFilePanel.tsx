import { useCallback, useEffect, useRef } from "react";
import { useBlockNoteEditor } from "@blocknote/react";
import { toast } from "@/components/ui/sonner";

type EditorFilePanelProps = {
  blockId: string;
};

export function EditorFilePanel({ blockId }: EditorFilePanelProps) {
  const editor = useBlockNoteEditor<any, any, any>();
  const inputRef = useRef<HTMLInputElement | null>(null);

  const block = editor.getBlock(blockId);
  const accept =
    block?.type === "image"
      ? "image/png,image/jpeg,image/jpg,image/gif,image/webp,image/svg+xml,image/bmp,image/tiff,image/avif,image/heic,image/heif"
      : block?.type === "video"
        ? "video/mp4,video/quicktime,video/webm,video/x-m4v,video/x-msvideo,video/x-matroska"
        : undefined;

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      inputRef.current?.click();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [blockId]);

  const handleFileChange = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      event.target.value = "";
      if (!file) return;

      const uploadFile = (editor as any).uploadFile as
        ((file: File, blockId?: string) => Promise<string>) | undefined;
      if (!uploadFile) return;

      try {
        const url = await uploadFile(file, blockId);
        editor.updateBlock(blockId, {
          props: {
            name: file.name,
            url,
          },
        } as any);
      } catch (error) {
        console.error("[file-panel] upload failed", error);
        toast.error("附件上传失败", {
          description: error instanceof Error ? error.message : "请稍后重试",
        });
      }
    },
    [blockId, editor],
  );

  return (
    <input
      ref={inputRef}
      type="file"
      className="hidden"
      accept={accept}
      onChange={handleFileChange}
      aria-hidden="true"
    />
  );
}
