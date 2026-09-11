/**
 * Composer 上方「项目/分支」上下文条。
 * 工作区 chip 可切换；分支 chip 只读展示（有 Git 才显示）。
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Folder } from "lucide-react";
import type { Selection } from "react-aria-components";
import { toast } from "@/lib/toast";
import { Dropdown } from "@/lib/heroui";
import { readGitBranch } from "@/lib/fs";
import { cn } from "@/lib/utils";
import { useAgentChats } from "@/stores/useAgentChats";
import { useWorkspaces } from "@/stores/useWorkspaces";
import { ContextCards } from "./beautiful-ui/ContextCards";

interface ComposerContextBarProps {
  disabled?: boolean;
}

export function ComposerContextBar({ disabled }: ComposerContextBarProps) {
  const workspaces = useWorkspaces((s) => s.workspaces);
  const activeId = useWorkspaces((s) => s.activeId);
  const setActive = useWorkspaces((s) => s.setActive);
  const addFromPicker = useWorkspaces((s) => s.addFromPicker);

  const activeWs = useMemo(
    () => workspaces.find((w) => w.id === activeId) ?? null,
    [workspaces, activeId],
  );

  const [branch, setBranch] = useState<string | null>(null);

  // 随 active 工作区路径刷新分支
  useEffect(() => {
    let cancelled = false;
    const root = activeWs?.path?.trim();
    if (!root) {
      setBranch(null);
      return;
    }
    setBranch(null);
    void readGitBranch(root).then((name) => {
      if (!cancelled) setBranch(name);
    });
    return () => {
      cancelled = true;
    };
  }, [activeWs?.path]);

  const handleSelectWorkspace = useCallback(
    (id: string) => {
      setActive(id);
      useAgentChats.getState().ensureConversationForWorkspace(id);
    },
    [setActive],
  );

  const handleSelectNone = useCallback(() => {
    setActive(null);
    useAgentChats.getState().ensureConversationForWorkspace(null);
  }, [setActive]);

  const handleAddWorkspace = useCallback(async () => {
    try {
      const item = await addFromPicker();
      if (!item) return;
      useAgentChats.getState().ensureConversationForWorkspace(item.id);
      toast.success(`已添加：${item.name}`);
    } catch (err) {
      console.error("[composer-context] addFromPicker failed:", err);
      toast.error("选择文件夹失败");
    }
  }, [addFromPicker]);

  const handleSelectionChange = (keys: Selection) => {
    if (keys === "all") return;
    const next = Array.from(keys)[0];
    if (typeof next !== "string" || next === "__add__") return;
    if (next === "__none__") {
      handleSelectNone();
      return;
    }
    if (workspaces.some((w) => w.id === next)) {
      handleSelectWorkspace(next);
    }
  };

  const projectLabel = activeWs?.name ?? "不选择工作区";
  const hasWorkspaces = workspaces.length > 0;
  const workspaceCards = [
    {
      id: activeId ?? "__none__",
      title: projectLabel,
      badge: "工作区",
      source: activeWs?.path,
    },
  ];
  const branchCards = branch
    ? [{ id: `branch:${branch}`, title: branch, badge: "分支" }]
    : [];

  return (
    <div
      className={cn(
        "bui flex min-h-0 min-w-0 flex-wrap items-center gap-1 px-0.5",
        disabled && "pointer-events-none opacity-50",
      )}
      aria-label="项目与分支"
    >
      {/* 工作区 / 项目：ContextCards 换皮，下拉仍负责切换 */}
      <div title={activeWs ? activeWs.path : "不选择工作区"}>
      <Dropdown>
        <Dropdown.Trigger
          isDisabled={disabled}
          aria-label="选择工作区"
          className={cn(
            "max-w-[240px] border-0 bg-transparent p-0 text-left",
            "hover:bg-transparent hover:text-fg",
            "disabled:cursor-not-allowed disabled:opacity-40",
          )}
        >
          <ContextCards cards={workspaceCards} />
        </Dropdown.Trigger>
        <Dropdown.Popover placement="top start" className="min-w-[180px] max-w-[280px] p-1.5">
          <div className="px-2 pb-1.5 pt-1 text-[11px] text-fg-faint">工作区</div>
          <Dropdown.Menu
            aria-label="工作区列表"
            selectionMode="single"
            selectedKeys={
              activeId ? new Set([activeId]) : new Set(["__none__"])
            }
            onSelectionChange={handleSelectionChange}
            onAction={(key) => {
              if (key === "__add__") void handleAddWorkspace();
            }}
          >
            <Dropdown.Item
              id="__none__"
              textValue="不选择工作区"
              className={cn(
                "cursor-pointer rounded-md px-2 py-1.5 text-[12.5px]",
                !activeId && "bg-accent-subtle",
              )}
            >
              <span className="min-w-0 truncate text-fg">不选择工作区</span>
            </Dropdown.Item>
            {hasWorkspaces
              ? workspaces.map((ws) => {
                  const isActive = ws.id === activeId;
                  return (
                    <Dropdown.Item
                      key={ws.id}
                      id={ws.id}
                      textValue={ws.name}
                      className={cn(
                        "cursor-pointer rounded-md px-2 py-1.5 text-[12.5px]",
                        isActive && "bg-accent-subtle",
                      )}
                    >
                      <Folder
                        className="size-3.5 shrink-0 text-fg-muted"
                        strokeWidth={1.75}
                      />
                      <span className="min-w-0 truncate text-fg">{ws.name}</span>
                    </Dropdown.Item>
                  );
                })
              : null}
            <Dropdown.Item
              id="__add__"
              textValue="添加工作区"
              className="mt-0.5 cursor-pointer rounded-md px-2 py-1.5 text-[12.5px]"
            >
              <span className="text-fg-muted">添加工作区…</span>
            </Dropdown.Item>
          </Dropdown.Menu>
        </Dropdown.Popover>
      </Dropdown>
      </div>

      {branch ? (
        <div title={branch} aria-label={`当前分支 ${branch}`}>
          <ContextCards cards={branchCards} />
        </div>
      ) : null}
    </div>
  );
}
