import { toast } from "@/components/ui/sonner";

interface SidebarRenameDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  renamePageId: string | null;
  renameValue: string;
  onRenameValueChange: (value: string) => void;
  isLocalFolder: boolean;
  onConfirm: () => void;
}

export function SidebarRenameDialog({
  open,
  onOpenChange,
  renamePageId,
  renameValue,
  onRenameValueChange,
  isLocalFolder,
  onConfirm,
}: SidebarRenameDialogProps) {
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
    >
      <DialogContent className="sm:max-w-[400px] z-[100]">
        <DialogHeader>
          <DialogTitle>
            {isLocalFolder ? "重命名文件" : "重命名页面"}
          </DialogTitle>
          <DialogDescription className="sr-only">
            {isLocalFolder ? "输入新的文件名称" : "输入新的页面名称"}
          </DialogDescription>
        </DialogHeader>
        <div className="py-6">
          <div className="grid gap-2">
            <Label htmlFor="rename-input">新名称</Label>
            <Input
              id="rename-input"
              value={renameValue}
              onChange={(e) => onRenameValueChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  onConfirm();
                } else if (e.key === "Escape") {
                  onOpenChange(false);
                }
              }}
              autoFocus
              placeholder={isLocalFolder ? "输入新的文件名称" : "输入新的页面名称"}
            />
          </div>
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
          >
            取消
          </Button>
          <Button
            onClick={onConfirm}
            disabled={!renamePageId || renameValue.trim() === ""}
          >
            确认
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function useRenameDialog() {
  const [renameDialogOpen, setRenameDialogOpen] = useState(false);
  const [renameValue, setRenameValue] = useState("");
  const [renamePageId, setRenamePageId] = useState<string | null>(null);

  const { pages, updatePage } = usePages();

  const openRenameDialog = (pageId: string, currentTitle: string) => {
    setRenamePageId(pageId);
    setRenameValue(currentTitle);
    setRenameDialogOpen(true);
  };

  const closeRenameDialog = useCallback(() => {
    setRenameDialogOpen(false);
    setRenamePageId(null);
  }, []);

  const confirmRename = useCallback(async () => {
    if (!renamePageId) return;
    const page = pages[renamePageId];
    const nextTitle = renameValue.trim();
    if (!page || nextTitle === "") return;

    const newContent = structuredClone(page.content);
    if (!newContent || newContent.type !== "doc") {
      newContent.type = "doc";
      newContent.content = [];
    }
    if (
      newContent.content?.[0]?.type === "heading" &&
      newContent.content[0].attrs?.level === 1
    ) {
      newContent.content[0].content = nextTitle
        ? [{ type: "text", text: nextTitle }]
        : undefined;
    } else {
      newContent.content = [
        {
          type: "heading",
          attrs: { level: 1 },
          content: [{ type: "text", text: nextTitle }],
        },
        ...(newContent.content || []),
      ];
    }

    const notebook = useNotebooks.getState().notebooks[page.workspaceId];
    const isLocalFolder = notebook?.source === "local-folder";
    if (isLocalFolder && page.localFilePath && (window as any).gooseFs) {
      const gooseFs = (window as any).gooseFs as GooseFs;
      const dir = page.localFilePath.replace(/[^\/\\]+$/, "");
      const extMatch = page.localFilePath.match(/\.(md|markdown)$/i);
      const ext = extMatch ? extMatch[0] : ".md";
      const rawTitle = nextTitle.replace(/[\/\\]/g, "-").trim();
      const safeTitle = rawTitle.replace(/\.(md|markdown)$/i, "");
      const newPath = `${dir}${safeTitle}${ext}`;

      const exists = gooseFs.existsAsync
        ? await gooseFs.existsAsync(newPath)
        : gooseFs.exists(newPath);
      if (exists) {
        toast.error("重命名失败：目标文件已存在");
        return;
      }
      if (newPath !== page.localFilePath) {
        const renamedResult = gooseFs.rename(page.localFilePath, newPath);
        const renamed =
          renamedResult instanceof Promise
            ? await renamedResult
            : renamedResult;
        if (!renamed) {
          toast.error("重命名失败：文件系统错误");
          return;
        }
        updatePage(renamePageId, {
          content: newContent,
          localFilePath: newPath,
        });
      } else {
        updatePage(renamePageId, { content: newContent });
      }
    } else {
      updatePage(renamePageId, { content: newContent });
    }

    setRenameDialogOpen(false);
    setRenamePageId(null);
  }, [pages, renamePageId, renameValue, updatePage]);

  return {
    renameDialogOpen,
    setRenameDialogOpen,
    renameValue,
    setRenameValue,
    renamePageId,
    setRenamePageId,
    openRenameDialog,
    closeRenameDialog,
    confirmRename,
  };
}
