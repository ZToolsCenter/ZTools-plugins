import { useCallback, useEffect, useMemo, useState } from "react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  closestCenter,
  pointerWithin,
  type CollisionDetection,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  rectSortingStrategy,
  verticalListSortingStrategy,
  sortableKeyboardCoordinates,
} from "@dnd-kit/sortable";
import { CodeCell, CodeCellOverlay } from "./CodeCell";
import { GroupSegments } from "./GroupSegments";
import { EmptyState } from "./EmptyState";
import { usePlatform } from "@/platform/context";
import {
  buildGroupTallies,
  filterByGroup,
  resolveSelectedGroup,
} from "@/lib/groups";
import { filterAccounts } from "@/lib/search";
import type { AccountData, VaultGroup } from "@/lib/types";
import type { ViewMode } from "@/stores/useAccounts";

interface CodeGridProps {
  accounts: AccountData[];
  groups: VaultGroup[];
  searchQuery: string;
  viewMode: ViewMode;
  selectedGroup: string | null;
  onSelectGroup: (groupId: string | null) => void;
  onCreateGroup: (name: string) => string | null;
  onRenameGroup: (id: string, name: string) => boolean;
  onDeleteGroup: (id: string) => void;
  onCopy: (text: string) => void;
  onDetail: (account: AccountData) => void;
  onIncrement: (id: string) => void;
  onReorder: (activeId: string, overId: string) => void;
  onMoveToGroup: (accountId: string, groupId: string | null) => void;
  onAdd: () => void;
  onClipboardImport: () => void;
  onScreenCapture: () => void;
}

export function CodeGrid({
  accounts,
  groups,
  searchQuery,
  viewMode,
  selectedGroup,
  onSelectGroup,
  onCreateGroup,
  onRenameGroup,
  onDeleteGroup,
  onCopy,
  onDetail,
  onIncrement,
  onReorder,
  onMoveToGroup,
  onAdd,
  onClipboardImport,
  onScreenCapture,
}: CodeGridProps) {
  const platform = usePlatform();
  const [activeId, setActiveId] = useState<string | null>(null);

  const searched = useMemo(
    () => filterAccounts(accounts, searchQuery),
    [accounts, searchQuery],
  );

  const effectiveGroup = useMemo(
    () => resolveSelectedGroup(selectedGroup, groups, accounts),
    [selectedGroup, groups, accounts],
  );

  useEffect(() => {
    if (selectedGroup !== effectiveGroup) {
      onSelectGroup(effectiveGroup);
    }
  }, [selectedGroup, effectiveGroup, onSelectGroup]);

  // 一级计数基于全量；搜索时仍显示全局结构，内容区用搜索结果
  const tallies = useMemo(
    () => buildGroupTallies(groups, accounts),
    [groups, accounts],
  );

  const scoped = useMemo(() => {
    const base = searchQuery ? searched : filterByGroup(searched, effectiveGroup);
    return base;
  }, [searched, effectiveGroup, searchQuery]);

  const flatIds = useMemo(
    () => scoped.map((account) => `account:${account.id}`),
    [scoped],
  );

  const sortable = !searchQuery;

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const detectCollision = useCallback<CollisionDetection>((args) => {
    const pointerHits = pointerWithin(args);
    return pointerHits.length > 0 ? pointerHits : closestCenter(args);
  }, []);

  const handleCopy = useCallback(
    async (text: string) => {
      try {
        await platform.copyText(text);
        onCopy(text);
        return true;
      } catch {
        return false;
      }
    },
    [onCopy, platform],
  );

  const handleDragStart = useCallback((e: DragStartEvent) => {
    const accountId = e.active.data.current?.accountId;
    setActiveId(typeof accountId === "string" ? accountId : null);
  }, []);

  const handleDragEnd = useCallback(
    (e: DragEndEvent) => {
      const { active, over } = e;
      const accountId = active.data.current?.accountId;
      if (typeof accountId !== "string") {
        setActiveId(null);
        return;
      }
      if (over?.data.current?.type === "group") {
        onMoveToGroup(accountId, (over.data.current.groupId as string | null) ?? null);
      } else if (over?.data.current?.type === "account") {
        const overAccountId = over.data.current.accountId;
        if (typeof overAccountId === "string" && accountId !== overAccountId) {
          onReorder(accountId, overAccountId);
        }
      }
      setActiveId(null);
    },
    [onMoveToGroup, onReorder],
  );

  const handleDragCancel = useCallback(() => setActiveId(null), []);

  const activeAccount = activeId
    ? accounts.find((a) => a.id === activeId) ?? null
    : null;

  if (accounts.length === 0) {
    return (
      <EmptyState
        onAdd={onAdd}
        onClipboardImport={onClipboardImport}
        onScreenCapture={onScreenCapture}
      />
    );
  }

  const isList = viewMode === "list";
  const isCompact = viewMode === "compact";
  const cellsClass = isList
    ? "flex flex-col gap-2"
    : isCompact
      ? "grid grid-cols-3 gap-2 max-[360px]:grid-cols-2"
      : "grid grid-cols-2 gap-3";

  const showSegments = !searchQuery;

  return (
    <div className={`relative z-[1] flex min-h-0 flex-1 flex-col ${showSegments ? "" : "pt-[45px]"}`}>
      <DndContext
        sensors={sensors}
        collisionDetection={detectCollision}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onDragCancel={handleDragCancel}
      >
        {showSegments && (
          <GroupSegments
            groups={tallies}
            totalCount={accounts.length}
            selected={effectiveGroup}
            dropEnabled={activeId !== null}
            onSelect={onSelectGroup}
            onCreate={onCreateGroup}
            onRename={onRenameGroup}
            onDelete={onDeleteGroup}
          />
        )}

        {searchQuery && searched.length === 0 ? (
          <div className="flex min-h-0 flex-1 items-center justify-center px-6 py-12">
            <p className="text-[13px] text-fg-faint">
              未找到匹配 "{searchQuery}" 的账户
            </p>
          </div>
        ) : scoped.length === 0 ? (
          <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 px-6 py-12">
            <p className="text-[13px] text-fg-muted">这个分组还是空的</p>
            <p className="text-[12px] text-fg-faint">
              添加账户，或把账户拖到上方分组
            </p>
            <button
              type="button"
              onClick={onAdd}
              className="primary-control mt-2 rounded-full bg-accent px-3.5 py-1.5 text-[12px] font-medium text-accent-fg"
            >
              添加账户
            </button>
          </div>
        ) : (
          <div className="min-h-0 flex-1 overflow-y-auto">
            {searchQuery && (
              <div className="sticky top-0 z-[2] border-b border-border bg-bg px-4 py-2">
                <p className="text-[11px] font-medium tracking-wide text-fg-faint">
                  搜索结果 · {scoped.length}
                </p>
              </div>
            )}

            <SortableContext
              items={flatIds}
              strategy={isList ? verticalListSortingStrategy : rectSortingStrategy}
            >
              <div className={`${cellsClass} px-4 pb-5 pt-3`}>
                {scoped.map((account, i) => (
                  <CodeCell
                    key={account.id}
                    account={account}
                    onCopy={handleCopy}
                    onDetail={onDetail}
                    onIncrement={onIncrement}
                    index={i}
                    viewMode={viewMode}
                    sortable={sortable}
                  />
                ))}
              </div>
            </SortableContext>
          </div>
        )}

        <DragOverlay
          dropAnimation={{
            duration: 200,
            easing: "cubic-bezier(0.16,1,0.3,1)",
          }}
        >
          {activeAccount ? (
            <CodeCellOverlay account={activeAccount} viewMode={viewMode} />
          ) : null}
        </DragOverlay>
      </DndContext>
    </div>
  );
}
