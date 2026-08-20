import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { NotebookCreateDialog } from "./NotebookCreateDialog";
import { NotebookEditDialog } from "./NotebookEditDialog";
import { renderNotebookIcon } from "./notebookUtils";
import { activateNotebook } from "@/lib/notebookNavigation";
import { dialogs } from "@/lib/utools/dialogs";
import {
  sortNotebooksByOrder,
  type Notebook,
  useNotebooks,
} from "@/stores/useNotebooks";

interface SortableNotebookItemProps {
  notebook: Notebook;
  isActive: boolean;
  canDeleteNotebook: boolean;
  onActivate: (id: string) => void;
  onEdit: (id: string) => void;
  onDeleteLocal: (id: string) => void;
}

function SortableNotebookItem({
  notebook,
  isActive,
  canDeleteNotebook,
  onActivate,
  onEdit,
  onDeleteLocal,
}: SortableNotebookItemProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: notebook.id });
  const dragMoved = useRef(false);

  if (isDragging) dragMoved.current = true;

  const style: React.CSSProperties = {
    transform: CSS.Translate.toString(transform),
    transition,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        "relative flex select-none items-center rounded-sm outline-none",
        "justify-between gap-2 group",
        "min-h-11 py-2 mb-1 last:mb-0 px-2",
        notebook.localPathMissing && "opacity-50",
        // 选中行 hover 不要被 interactive-hover 盖掉，否则图标底又会糊进行底
        isActive
          ? "bg-[var(--goose-interactive-selected)] text-[var(--goose-interactive-selected-fg)] hover:bg-[var(--goose-interactive-selected)]"
          : "hover:bg-[var(--goose-interactive-hover)]",
        isDragging && "opacity-60 cursor-grabbing z-10",
        !isDragging && "cursor-pointer",
      )}
      role="menuitem"
      tabIndex={-1}
      onPointerDown={() => {
        dragMoved.current = false;
      }}
      onClick={() => {
        if (dragMoved.current) {
          dragMoved.current = false;
          return;
        }
        if (notebook.localPathMissing) return;
        onActivate(notebook.id);
      }}
    >
      <div className="flex items-center gap-2 min-w-0 flex-1">
        <span
          className={cn(
            "flex h-7 w-7 shrink-0 items-center justify-center rounded-lg transition-colors",
            // 图标是唯一拖动手柄：hover 才 grab，行本身是 pointer 点选
            !isDragging && "cursor-grab",
            isDragging && "cursor-grabbing",
            // 图标底始终要比当前行底更抬一点：
            // - 未选中 hover：亮色用 chip token；暗色勿用 interactive-hover（与行 hover 同色会“消失”）
            // - 选中：亮色 chip token；暗色 white/20，hover 再抬一点
            isActive
              ? "bg-[var(--goose-icon-chip-on-selected)] dark:bg-white/20 dark:group-hover:bg-white/28"
              : "group-hover:bg-[var(--goose-icon-chip-on-selected)] dark:group-hover:bg-white/14",
          )}
          {...attributes}
          {...listeners}
          aria-label={`拖拽调整 ${notebook.name} 排序`}
        >
          {renderNotebookIcon(notebook.icon || "BookOpen", "h-4 w-4")}
        </span>
        <span className="truncate text-sm font-medium leading-snug">
          {notebook.name}
        </span>
        {notebook.localPathMissing && (
          <span className="text-xs text-destructive">路径失效</span>
        )}
      </div>
      <div
        className="flex items-center gap-1 shrink-0 justify-end"
        onPointerDown={(e) => e.stopPropagation()}
      >
        {notebook.source === "local-folder" && canDeleteNotebook && (
          <TooltipProvider delayDuration={600}>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  className="inline-flex h-6 w-6 items-center justify-center rounded-md opacity-0 overflow-hidden px-0 text-muted-foreground transition-all duration-120 pointer-events-none hover:bg-[var(--goose-color-danger-subtle-bg)] hover:text-[var(--goose-color-danger)] group-hover:opacity-100 group-hover:pointer-events-auto"
                  onClick={(e) => {
                    e.stopPropagation();
                    onDeleteLocal(notebook.id);
                  }}
                  aria-label="移除本地文件夹"
                >
                  <LucideIcons.FolderX className="h-3.5 w-3.5" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom">移除本地文件夹</TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )}
        <TooltipProvider delayDuration={600}>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                className="inline-flex h-6 w-6 items-center justify-center rounded-md opacity-0 overflow-hidden px-0 text-muted-foreground transition-all duration-120 pointer-events-none hover:bg-[var(--goose-icon-chip-on-selected)] hover:text-foreground dark:hover:bg-white/14 group-hover:opacity-100 group-hover:pointer-events-auto"
                aria-label="编辑记事本"
                onClick={(e) => {
                  e.stopPropagation();
                  onEdit(notebook.id);
                }}
              >
                <LucideIcons.Settings className="h-3.5 w-3.5" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom">编辑记事本</TooltipContent>
          </Tooltip>
        </TooltipProvider>
        {isActive && <LucideIcons.Check className="h-4 w-4" />}
      </div>
    </div>
  );
}

export function NotebookSwitcher() {
  const {
    notebooks,
    activeNotebookId,
    createNotebook,
    createLocalFolderNotebook,
    updateNotebook,
    deleteNotebook,
    reorderNotebooks,
  } = useNotebooks();
  const notebookDropdownHoverExpand = useSettings(
    (state) => state.notebookDropdownHoverExpand,
  );
  const [isOpen, setIsOpen] = useState(false);
  const hovering = useRef({ trigger: false, content: false });
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isDraggingRef = useRef(false);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 6 },
    }),
  );

  useEffect(
    () => () => {
      if (closeTimer.current !== null) clearTimeout(closeTimer.current);
    },
    [],
  );

  const scheduleClose = () => {
    if (isDraggingRef.current) return;
    if (closeTimer.current !== null) clearTimeout(closeTimer.current);
    closeTimer.current = setTimeout(() => {
      if (
        !isDraggingRef.current &&
        !hovering.current.trigger &&
        !hovering.current.content
      ) {
        setIsOpen(false);
      }
    }, 80);
  };

  const [editDialog, setEditDialog] = useState({
    open: false,
    id: "",
    name: "",
    confirmName: "",
    icon: "",
    excludeFromGlobalSearch: false,
    openDeleteConfirm: false,
    isLocalFolder: false,
  });
  const [createDialog, setCreateDialog] = useState({
    open: false,
    name: "",
    icon: "BookOpen",
    error: "",
  });

  const activeNotebook = activeNotebookId ? notebooks[activeNotebookId] : null;
  const notebookList = sortNotebooksByOrder(notebooks);
  const canDeleteNotebook = Object.keys(notebooks).length > 1;

  const handleCreate = () => {
    setCreateDialog({ open: true, name: "", icon: "BookOpen", error: "" });
    setIsOpen(false);
  };

  const handleConfirmCreate = () => {
    if (!createDialog.name.trim()) {
      setCreateDialog({ ...createDialog, error: "请输入记事本名称" });
      return;
    }

    const nameExists = Object.values(notebooks).some(
      (nb) => nb.name.toLowerCase() === createDialog.name.trim().toLowerCase(),
    );
    if (nameExists) {
      setCreateDialog({ ...createDialog, error: "记事本名称已存在" });
      return;
    }

    const notebookId = createNotebook(
      createDialog.name.trim(),
      createDialog.icon,
    );
    void activateNotebook(notebookId);
    setCreateDialog({ open: false, name: "", icon: "BookOpen", error: "" });
  };

  const handleOpenLocalFolder = async () => {
    try {
      const utools = (
        window as Window & {
          utools?: {
            showOpenDialog?: (options: {
              title?: string;
              properties: string[];
            }) => Promise<string[] | null>;
          };
        }
      ).utools;
      if (typeof utools?.showOpenDialog === "function") {
        const result = await utools.showOpenDialog({
          title: "选择 Markdown 文件夹",
          properties: ["openDirectory"],
        });
        if (result && result.length > 0) {
          const folderName = result[0].split(/[\\/]/).pop() || "Unknown";
          const notebookId = createLocalFolderNotebook(folderName, result[0]);
          await usePages
            .getState()
            .loadLocalFolderPages(notebookId, result[0], {
              showWelcome: true,
            });
          void activateNotebook(notebookId);
        }
      } else {
        const path = await dialogs.selectDirectory();
        if (path) {
          const folderName = path.split(/[\\/]/).pop() || "Unknown";
          const notebookId = createLocalFolderNotebook(folderName, path);
          await usePages.getState().loadLocalFolderPages(notebookId, path, {
            showWelcome: true,
          });
          void activateNotebook(notebookId);
        }
      }
    } catch (e) {
      console.error(e);
    } finally {
      setIsOpen(false);
    }
  };

  const handleEdit = (id: string) => {
    const notebook = notebooks[id];
    if (!notebook) return;

    setEditDialog({
      open: true,
      id,
      name: notebook.name,
      confirmName: notebook.name,
      icon:
        notebook.icon ||
        (notebook.source === "local-folder" ? "FolderOpen" : "BookOpen"),
      excludeFromGlobalSearch: Boolean(notebook.excludeFromGlobalSearch),
      openDeleteConfirm: false,
      isLocalFolder: notebook.source === "local-folder",
    });
    setIsOpen(false);
  };

  const handleSaveEdit = () => {
    if (!editDialog.id) return;
    updateNotebook(editDialog.id, {
      name: editDialog.name,
      icon: editDialog.icon,
      excludeFromGlobalSearch: editDialog.excludeFromGlobalSearch,
    });
    setEditDialog({ ...editDialog, open: false });
  };

  const handleDelete = () => {
    if (!editDialog.id) return;
    deleteNotebook(editDialog.id);
    setEditDialog({ ...editDialog, open: false });
  };

  const handleDragStart = () => {
    isDraggingRef.current = true;
    setIsOpen(true);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    isDraggingRef.current = false;
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldIndex = notebookList.findIndex((nb) => nb.id === active.id);
    const newIndex = notebookList.findIndex((nb) => nb.id === over.id);
    if (oldIndex < 0 || newIndex < 0) return;

    const next = arrayMove(notebookList, oldIndex, newIndex);
    reorderNotebooks(next.map((nb) => nb.id));
  };

  const handleDragCancel = () => {
    isDraggingRef.current = false;
  };

  return (
    <>
      <DropdownMenu open={isOpen} onOpenChange={setIsOpen} modal={false}>
        <DropdownMenuTrigger asChild>
          <div
            className="w-full"
            onMouseEnter={() => {
              if (!notebookDropdownHoverExpand) return;
              hovering.current.trigger = true;
              if (closeTimer.current !== null) clearTimeout(closeTimer.current);
              setIsOpen(true);
            }}
            onMouseLeave={() => {
              if (!notebookDropdownHoverExpand) return;
              hovering.current.trigger = false;
              scheduleClose();
            }}
          >
            <Button
              variant="ghost"
              className="w-full justify-between px-2 h-9 py-0 font-medium text-foreground hover:bg-[var(--goose-interactive-hover)] transition-colors"
            >
              <div className="flex items-center gap-2 truncate min-w-0">
                {activeNotebook && (
                  <span className="flex h-[18px] w-[18px] shrink-0 items-center justify-center text-foreground/70 text-[16px] leading-none">
                    {renderNotebookIcon(
                      activeNotebook.icon || "BookOpen",
                      "h-[18px] w-[18px] leading-none",
                    )}
                  </span>
                )}
                {/* leading-snug：truncate(overflow hidden) 配 leading-none 会裁掉 g/y/p 降部 */}
                <span className="truncate text-[13px] tracking-[0.01em] leading-snug">
                  {activeNotebook?.name || "选择记事本"}
                </span>
              </div>
              {isOpen ? (
                <LucideIcons.ChevronUp className="h-3.5 w-3.5 shrink-0 text-foreground/40 transition-transform" />
              ) : (
                <LucideIcons.ChevronDown className="h-3.5 w-3.5 shrink-0 text-foreground/40 transition-transform" />
              )}
            </Button>
          </div>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          className="w-[13.75rem] min-w-[13.75rem] max-w-[calc(100vw-1rem)] px-1 pb-1 pt-1.5 before:content-[''] before:absolute before:left-0 before:right-0 before:-top-2 before:h-2 backdrop-blur-0 data-[state=closed]:animate-none data-[state=closed]:zoom-out-100 data-[state=closed]:duration-0"
          style={{ width: 220, minWidth: 220 }}
          align="start"
          alignOffset={0}
          sideOffset={4}
          forceMount
          onMouseEnter={() => {
            if (!notebookDropdownHoverExpand) return;
            hovering.current.content = true;
            if (closeTimer.current !== null) clearTimeout(closeTimer.current);
          }}
          onMouseLeave={() => {
            if (!notebookDropdownHoverExpand) return;
            hovering.current.content = false;
            scheduleClose();
          }}
          onCloseAutoFocus={(e) => {
            if (isDraggingRef.current) e.preventDefault();
          }}
          onInteractOutside={(e) => {
            if (isDraggingRef.current) e.preventDefault();
          }}
          onPointerDownOutside={(e) => {
            if (isDraggingRef.current) e.preventDefault();
          }}
        >
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
            onDragCancel={handleDragCancel}
          >
            <SortableContext
              items={notebookList.map((nb) => nb.id)}
              strategy={verticalListSortingStrategy}
            >
              {notebookList.map((notebook) => (
                <SortableNotebookItem
                  key={notebook.id}
                  notebook={notebook}
                  isActive={activeNotebookId === notebook.id}
                  canDeleteNotebook={canDeleteNotebook}
                  onActivate={(id) => {
                    void activateNotebook(id);
                    setIsOpen(false);
                  }}
                  onEdit={handleEdit}
                  onDeleteLocal={deleteNotebook}
                />
              ))}
            </SortableContext>
          </DndContext>
          <DropdownMenuGroup className="grid grid-cols-2 gap-2 px-0 pt-1.5 pb-1.5">
            <DropdownMenuItem
              className="h-10 w-full justify-start gap-1.5 rounded-[10px] px-2.5 text-xs font-medium whitespace-nowrap"
              onClick={handleCreate}
            >
              <LucideIcons.BookPlus className="h-4 w-4" />
              新建记事本
            </DropdownMenuItem>
            <DropdownMenuItem
              className="h-10 w-full justify-start gap-1.5 rounded-[10px] px-2.5 text-xs font-medium whitespace-nowrap"
              onClick={handleOpenLocalFolder}
            >
              <LucideIcons.FolderOpen className="h-4 w-4" />
              打开文件夹
            </DropdownMenuItem>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>

      {editDialog.open && (
        <NotebookEditDialog
          open={editDialog.open}
          notebookId={editDialog.id}
          name={editDialog.name}
          confirmName={editDialog.confirmName}
          icon={editDialog.icon}
          excludeFromGlobalSearch={editDialog.excludeFromGlobalSearch}
          openDeleteConfirm={editDialog.openDeleteConfirm}
          isLocalFolder={editDialog.isLocalFolder}
          onOpenChange={(open) => setEditDialog({ ...editDialog, open })}
          onNameChange={(name) => setEditDialog({ ...editDialog, name })}
          onIconChange={(icon) => setEditDialog({ ...editDialog, icon })}
          onExcludeFromGlobalSearchChange={(excludeFromGlobalSearch) =>
            setEditDialog({ ...editDialog, excludeFromGlobalSearch })
          }
          onSave={handleSaveEdit}
          onDelete={handleDelete}
        />
      )}

      {createDialog.open && (
        <NotebookCreateDialog
          open={createDialog.open}
          name={createDialog.name}
          icon={createDialog.icon}
          error={createDialog.error}
          onOpenChange={(open) =>
            setCreateDialog({ ...createDialog, open, error: "" })
          }
          onNameChange={(name) => setCreateDialog({ ...createDialog, name })}
          onIconChange={(icon) => setCreateDialog({ ...createDialog, icon })}
          onCreate={handleConfirmCreate}
          onClearError={() =>
            createDialog.error &&
            setCreateDialog({ ...createDialog, error: "" })
          }
        />
      )}
    </>
  );
}
