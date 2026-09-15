import { useEffect, useRef, useState } from "react";
import { Check, FolderPlus, MoreHorizontal, Pencil, Plus, Trash2, X } from "lucide-react";
import { useDroppable } from "@dnd-kit/core";
import type { GroupTally } from "@/lib/groups";
import { MAX_GROUP_NAME_LENGTH, UNGROUPED_KEY } from "@/lib/groups";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface GroupSegmentsProps {
  groups: GroupTally[];
  totalCount: number;
  selected: string | null;
  dropEnabled: boolean;
  onSelect: (id: string | null) => void;
  onCreate: (name: string) => string | null;
  onRename: (id: string, name: string) => boolean;
  onDelete: (id: string) => void;
}

export function GroupSegments({
  groups,
  totalCount,
  selected,
  dropEnabled,
  onSelect,
  onCreate,
  onRename,
  onDelete,
}: GroupSegmentsProps) {
  const [creating, setCreating] = useState(false);
  const [createName, setCreateName] = useState("");
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [groupError, setGroupError] = useState("");
  const [deleteCandidate, setDeleteCandidate] = useState<{ id: string; name: string; count: number } | null>(null);
  const createRef = useRef<HTMLInputElement>(null);
  const renameRef = useRef<HTMLInputElement>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (creating) createRef.current?.focus();
  }, [creating]);

  useEffect(() => {
    if (renamingId) renameRef.current?.focus();
  }, [renamingId]);

  // 选中项滚入视野
  useEffect(() => {
    const root = scrollerRef.current;
    if (!root) return;
    const el = root.querySelector<HTMLElement>('[data-active="true"]');
    el?.scrollIntoView({ inline: "nearest", block: "nearest", behavior: "smooth" });
  }, [selected]);

  const submitCreate = () => {
    const id = onCreate(createName);
    if (id) {
      setGroupError("");
      setCreateName("");
      setCreating(false);
    } else {
      setGroupError("分组名不能为空，也不能与已有分组重复");
    }
  };

  const submitRename = () => {
    if (!renamingId) return;
    if (onRename(renamingId, renameValue)) {
      setGroupError("");
      setRenamingId(null);
      setRenameValue("");
    } else {
      setGroupError("分组名不能为空，也不能与已有分组重复");
    }
  };

  const userGroups = groups.filter((g) => g.id !== UNGROUPED_KEY);
  const ungrouped = groups.find((g) => g.id === UNGROUPED_KEY);
  const showRail = userGroups.length > 0 || creating || totalCount > 0;

  if (!showRail) return null;

  return (
    <div className="group-segments flex min-h-[45px] shrink-0 flex-col justify-center border-b border-border bg-bg py-2 pl-3">
      <div
        ref={scrollerRef}
        className="flex items-center gap-1 overflow-x-auto pr-[11.75rem] scrollbar-none [scroll-padding-left:0.75rem] [scroll-padding-right:11.75rem]"
        role="tablist"
        aria-label="账户分组"
      >
        <SegmentChip
          label="全部"
          count={totalCount}
          active={selected === null}
          onClick={() => { setGroupError(""); onSelect(null); }}
        />

        {userGroups.map((g) =>
          renamingId === g.id ? (
            <form
              key={g.id}
              className="flex h-7 shrink-0 items-center gap-1 rounded-full border border-accent-border bg-input px-2"
              onSubmit={(e) => {
                e.preventDefault();
                submitRename();
              }}
            >
              <input
                ref={renameRef}
                value={renameValue}
                onChange={(e) => { setRenameValue(e.target.value); setGroupError(""); }}
                onKeyDown={(e) => {
                  if (e.key === "Escape") {
                    setRenamingId(null);
                    setRenameValue("");
                    setGroupError("");
                  }
                }}
                className="group-name-input w-[72px] bg-transparent text-[11px] text-fg"
                maxLength={MAX_GROUP_NAME_LENGTH}
                aria-label="重命名分组"
              />
              <button
                type="submit"
                className="rounded-full p-0.5 text-accent transition-colors hover:bg-accent-subtle active:bg-surface-active"
                aria-label="确认重命名"
              >
                <Check size={12} />
              </button>
              <button
                type="button"
                onClick={() => {
                  setRenamingId(null);
                  setRenameValue("");
                  setGroupError("");
                }}
                className="rounded-full p-0.5 text-fg-faint transition-colors hover:bg-surface-hover active:bg-surface-active"
                aria-label="取消重命名"
              >
                <X size={12} />
              </button>
            </form>
          ) : (
            <div key={g.id} className="group/seg relative shrink-0">
              <SegmentChip
                label={g.name}
                count={g.count}
                active={selected === g.id}
                dropEnabled={dropEnabled}
                dropGroupId={g.id}
                hasMenu
                onClick={() => { setGroupError(""); onSelect(g.id); }}
              />
              {/* 菜单仅在悬停/聚焦时露出，不常驻占位 */}
              <DropdownMenu>
                <DropdownMenuTrigger
                  className="absolute right-1 top-1/2 flex size-4 -translate-y-1/2 items-center justify-center rounded text-fg-faint opacity-0 transition-[color,background-color,opacity] hover:bg-bg hover:text-fg focus-visible:opacity-100 group-hover/seg:opacity-100 group-focus-within/seg:opacity-100 data-[popup-open]:bg-bg data-[popup-open]:opacity-100"
                  aria-label={`${g.name} 分组菜单`}
                  onClick={(e) => e.stopPropagation()}
                >
                  <MoreHorizontal size={10} strokeWidth={2} />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-36">
                  <DropdownMenuItem
                    className="gap-2 text-[12.5px]"
                    onClick={() => {
                      setGroupError("");
                      setRenamingId(g.id);
                      setRenameValue(g.name);
                    }}
                  >
                    <Pencil size={13} />
                    重命名
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    className="gap-2 text-[12.5px] text-timer-low"
                    onClick={() => setDeleteCandidate({ id: g.id, name: g.name, count: g.count })}
                  >
                    <Trash2 size={13} />
                    删除分组
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          ),
        )}

        {ungrouped && (ungrouped.count > 0 || selected === UNGROUPED_KEY || dropEnabled) && (
          <SegmentChip
            label={ungrouped.name}
            count={ungrouped.count}
            active={selected === UNGROUPED_KEY}
            dropEnabled={dropEnabled}
            dropGroupId={null}
            onClick={() => { setGroupError(""); onSelect(UNGROUPED_KEY); }}
            muted
          />
        )}

        {creating ? (
          <form
            className="flex h-7 shrink-0 items-center gap-1 rounded-full border border-accent-border bg-input px-2"
            onSubmit={(e) => {
              e.preventDefault();
              submitCreate();
            }}
          >
            <FolderPlus size={12} className="text-fg-faint" />
            <input
              ref={createRef}
              value={createName}
              onChange={(e) => { setCreateName(e.target.value); setGroupError(""); }}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  setCreating(false);
                  setCreateName("");
                  setGroupError("");
                }
              }}
              placeholder="分组名"
              className="group-name-input w-[72px] bg-transparent text-[11px] text-fg placeholder:text-fg-faint"
              maxLength={MAX_GROUP_NAME_LENGTH}
              aria-label="新建分组名称"
            />
            <button type="submit" className="rounded-full p-0.5 text-accent transition-colors hover:bg-accent-subtle active:bg-surface-active" aria-label="创建分组">
              <Check size={12} />
            </button>
            <button
              type="button"
              onClick={() => {
                setCreating(false);
                setCreateName("");
                setGroupError("");
              }}
              className="rounded-full p-0.5 text-fg-faint transition-colors hover:bg-surface-hover active:bg-surface-active"
              aria-label="取消创建"
            >
              <X size={12} />
            </button>
          </form>
        ) : (
          <button
            type="button"
            onClick={() => { setGroupError(""); setCreating(true); }}
            className="flex h-7 shrink-0 items-center gap-1 rounded-full border border-dashed border-border px-2.5 text-[11px] text-fg-muted transition-colors hover:border-border-strong hover:bg-surface-hover hover:text-fg active:bg-surface-active"
            aria-label="新建分组"
          >
            <Plus size={12} />
            分组
          </button>
        )}
      </div>
      {groupError && (
        <p role="alert" className="mt-1.5 px-1 text-[11px] text-timer-low">{groupError}</p>
      )}
      {deleteCandidate && (
        <div role="alertdialog" aria-label="确认删除分组" className="mt-2 flex items-center gap-2 rounded-lg bg-surface-hover px-2.5 py-2">
          <p className="min-w-0 flex-1 break-words text-[11px] leading-relaxed text-fg-muted">
            删除“{deleteCandidate.name}”？{deleteCandidate.count > 0 ? `${deleteCandidate.count} 个账户会移到未分组。` : "此分组没有账户。"}
          </p>
          <button type="button" onClick={() => setDeleteCandidate(null)} className="min-h-8 rounded-lg px-2 text-[11px] text-fg-muted transition-colors hover:bg-surface active:bg-surface-active">取消</button>
          <button type="button" onClick={() => { onDelete(deleteCandidate.id); setDeleteCandidate(null); }} className="min-h-8 rounded-lg bg-timer-low px-2.5 text-[11px] font-medium text-danger-fg transition-[filter,transform] hover:brightness-95 active:translate-y-px active:brightness-90">删除</button>
        </div>
      )}
    </div>
  );
}

function SegmentChip({
  label,
  count,
  active,
  onClick,
  muted,
  dropEnabled = false,
  dropGroupId,
  hasMenu = false,
}: {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
  muted?: boolean;
  dropEnabled?: boolean;
  dropGroupId?: string | null;
  hasMenu?: boolean;
}) {
  const isDropTarget = dropGroupId !== undefined;
  const { isOver, setNodeRef } = useDroppable({
    id: isDropTarget ? `group-drop:${dropGroupId ?? UNGROUPED_KEY}` : `group-drop-disabled:${label}`,
    disabled: !isDropTarget || !dropEnabled,
    data: { type: "group", groupId: dropGroupId ?? null },
  });

  return (
    <button
      ref={setNodeRef}
      type="button"
      role="tab"
      tabIndex={active ? 0 : -1}
      aria-selected={active}
      aria-label={`${label} ${count}`}
      title={label}
      data-active={active ? "true" : undefined}
      onClick={onClick}
      onKeyDown={(event) => {
        if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
        event.preventDefault();
        const tabs = Array.from(event.currentTarget.closest('[role="tablist"]')?.querySelectorAll<HTMLButtonElement>('[role="tab"]') ?? []);
        const current = tabs.indexOf(event.currentTarget);
        const nextIndex = event.key === "Home"
          ? 0
          : event.key === "End"
            ? tabs.length - 1
            : (current + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
        tabs[nextIndex]?.focus();
        tabs[nextIndex]?.click();
      }}
      className={`group/chip flex h-7 shrink-0 items-center gap-1.5 rounded-full text-left transition-[color,background-color,box-shadow,transform,padding] ${
        // 默认与「全部」同宽；仅悬停/菜单聚焦时略扩右侧给「…」
        hasMenu
          ? "pl-3.5 pr-3.5 group-hover/seg:pr-6 group-focus-within/seg:pr-6"
          : "px-3.5"
      } ${
        isOver
          ? "scale-[1.04] bg-accent text-accent-fg shadow-[0_0_0_2px_var(--color-bg),0_0_0_4px_var(--color-accent)]"
          : active
          ? "bg-accent-subtle text-accent"
          : muted
            ? "text-fg-faint hover:bg-surface-hover hover:text-fg-muted active:bg-surface-active"
            : "text-fg-muted hover:bg-surface-hover hover:text-fg active:bg-surface-active"
      }`}
    >
      <span className="max-w-[7rem] truncate text-[11.5px] font-medium leading-none">
        {label}
      </span>
      <span
        className={`tabular-nums text-[10px] leading-none ${
          active ? "text-accent" : "text-fg-faint"
        }`}
      >
        {count}
      </span>
    </button>
  );
}
