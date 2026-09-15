import { renderNotebookIcon } from "./notebookUtils";
import { IconSelector } from "@/pages/workspace/components/shared/IconSelector";
import { AlertTriangle, Save } from "lucide-react";
import { Switch } from "@/components/ui/switch";

interface NotebookEditDialogProps {
  open: boolean;
  notebookId: string;
  name: string;
  confirmName: string;
  icon: string;
  excludeFromGlobalSearch?: boolean;
  openDeleteConfirm?: boolean;
  isLocalFolder?: boolean;
  onOpenChange: (open: boolean) => void;
  onNameChange: (name: string) => void;
  onIconChange: (icon: string) => void;
  onExcludeFromGlobalSearchChange: (value: boolean) => void;
  onSave: () => void;
  onDelete: () => void;
}

export function NotebookEditDialog({
  open,
  notebookId,
  name,
  confirmName,
  icon,
  excludeFromGlobalSearch = false,
  openDeleteConfirm = false,
  isLocalFolder = false,
  onOpenChange,
  onNameChange,
  onIconChange,
  onExcludeFromGlobalSearchChange,
  onSave,
  onDelete,
}: NotebookEditDialogProps) {
  const editDialogContentRef = useRef<HTMLDivElement>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteConfirmInput, setDeleteConfirmInput] = useState("");

  useEffect(() => {
    if (!open) {
      setShowDeleteConfirm(false);
      setDeleteConfirmInput("");
    }
  }, [open]);

  useEffect(() => {
    if (open) {
      setShowDeleteConfirm(openDeleteConfirm);
    }
  }, [open, openDeleteConfirm]);

  const isDeleteEnabled = deleteConfirmInput === confirmName;

  return (
    <DialogShell
      open={open}
      onOpenChange={onOpenChange}
      layout="fullscreen"
      contentClassName="bg-[hsl(var(--goose-shell-bg))]"
      bodyClassName="relative h-full overflow-y-auto p-6 animate-in fade-in duration-200"
    >
      {/* 内容卡片 */}
      <div ref={editDialogContentRef} className="relative mx-auto w-full max-w-md py-6">
        {/* 标题 */}
        <div className="text-center mb-8">
          {showDeleteConfirm && (
            <div className="inline-flex items-center justify-center w-14 h-14 rounded-[14px] mb-4 bg-[var(--goose-color-danger-subtle-bg)]">
              <AlertTriangle className="w-7 h-7 text-destructive" />
            </div>
          )}
          <h1 className="text-2xl font-bold text-foreground mb-2">
            {showDeleteConfirm
              ? (isLocalFolder ? "移除本地文件夹" : "永久删除记事本")
              : "编辑记事本"}
          </h1>
          <p className="text-muted-foreground">
            {showDeleteConfirm
              ? (isLocalFolder ? "仅移除挂载，不会删除磁盘上的文件" : "此操作无法撤销，请谨慎操作")
              : "修改记事本的名称与图标"}
          </p>
        </div>

        {/* 表单卡片 */}
        {showDeleteConfirm ? (
          <div className="bg-[var(--goose-color-danger-subtle-bg)] backdrop-blur-[1px] rounded-[14px] p-6 shadow-[0_12px_26px_rgba(15,23,42,0.1)] space-y-4">
            <div className="space-y-3">
              <Label
                htmlFor="confirm-delete"
                className="select-text text-sm font-medium text-destructive"
              >
                {isLocalFolder ? "确认移除" : "确认删除"} <span className="select-text font-bold">{confirmName}</span>
              </Label>
              <Input
                id="confirm-delete"
                value={deleteConfirmInput}
                onChange={(e) => setDeleteConfirmInput(e.target.value)}
                placeholder={confirmName}
                className="h-12 text-base"
                autoFocus
              />
            </div>

            <div className="flex gap-3 pt-2">
              <Button
                variant="outline"
                size="lg"
                onClick={() => {
                  if (openDeleteConfirm) {
                    // 直接删除入口：关闭整个对话框
                    onOpenChange(false);
                  } else {
                    // 编辑进入删除：返回编辑界面
                    setShowDeleteConfirm(false);
                  }
                }}
                className="flex-1"
              >
                取消
              </Button>
              <Button
                variant="destructive"
                size="lg"
                onClick={() => {
                  if (!isDeleteEnabled) return;
                  onDelete();
                }}
                disabled={!isDeleteEnabled}
                className="flex-1"
              >
                {isLocalFolder ? "确认移除" : "确认删除"}
              </Button>
            </div>
          </div>
        ) : (
          <div className="bg-card backdrop-blur-[1px] border-0 rounded-[14px] p-6 shadow-[0_12px_26px_rgba(15,23,42,0.1)] space-y-4">
            <div className="space-y-3">
              <Label className="text-sm font-medium text-muted-foreground">
                选择图标
              </Label>
              <div className="flex justify-center">
                <Suspense
                  fallback={
                    <Button variant="outline" className="h-16 w-16 text-2xl">
                      ...
                    </Button>
                  }
                >
                  <IconSelector
                    value={icon}
                    onChange={(val) => onIconChange(val || (isLocalFolder ? "FolderOpen" : "BookOpen"))}
                    portalContainerRef={editDialogContentRef}
                  >
                    <Button
                      variant="outline"
                      className="inline-flex h-20 w-20 items-center justify-center p-0 rounded-[16px] bg-[hsl(var(--goose-selected-bg)/0.6)] hover:bg-[var(--goose-interactive-hover)] transition-all duration-200 [&>span]:flex [&>span]:items-center [&>span]:justify-center"
                    >
                      {renderNotebookIcon(icon, "!h-11 !w-11 stroke-[1.5] text-[2.75rem]")}
                    </Button>
                  </IconSelector>
                </Suspense>
              </div>
            </div>

            <div className="space-y-3">
              <Label
                htmlFor="notebook-name"
                className="text-sm font-medium text-muted-foreground"
              >
                记事本名称
              </Label>
              <Input
                id="notebook-name"
                value={name}
                onChange={(e) => onNameChange(e.target.value)}
                placeholder="记事本名称"
                className="h-12 text-base"
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    onSave();
                  }
                }}
              />
            </div>

            <div className="flex items-start justify-between gap-4 rounded-[12px] border border-border/60 bg-muted/20 px-4 py-3">
              <div className="min-w-0 space-y-1">
                <Label
                  htmlFor="exclude-from-global-search"
                  className="text-sm font-medium text-foreground cursor-pointer"
                >
                  不在全局搜索中展示
                </Label>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  开启后，该记事本页面不会出现在「所有记事本」搜索；切换到该记事本后仍可搜索。
                </p>
              </div>
              <Switch
                id="exclude-from-global-search"
                checked={excludeFromGlobalSearch}
                onCheckedChange={onExcludeFromGlobalSearchChange}
                className="mt-0.5 shrink-0"
              />
            </div>
          </div>
        )}

        {/* 操作按钮 - 编辑模式 */}
        {!showDeleteConfirm && (
          <div className="flex flex-col gap-4 mt-6">
            {/* 删除按钮（仅在有多个记事本时显示） */}
            {notebookId &&
              Object.keys(useNotebooks.getState().notebooks).length > 1 && (
                <Button
                  variant="ghost"
                  size="lg"
                  onClick={() => setShowDeleteConfirm(true)}
                  className="text-muted-foreground hover:text-[var(--goose-color-danger-focus)] hover:bg-[var(--goose-color-danger-subtle-bg)] w-full"
                >
                  {isLocalFolder ? (
                    <LucideIcons.FolderX className="mr-2 h-4 w-4" />
                  ) : (
                    <LucideIcons.Trash2 className="mr-2 h-4 w-4" />
                  )}
                  {isLocalFolder ? "移除此记事本" : "删除此记事本"}
                </Button>
              )}

            <div className="grid grid-cols-2 gap-3">
              <Button
                variant="outline"
                size="lg"
                onClick={() => onOpenChange(false)}
                className="h-11 w-full"
              >
                取消
              </Button>
              <Button
                size="lg"
                onClick={onSave}
                disabled={!notebookId}
                className="h-11 w-full"
              >
                <Save className="mr-2 h-4 w-4" />
                保存
              </Button>
            </div>
          </div>
        )}
      </div>
    </DialogShell>
  );
}
