import { useEffect, useMemo, useRef, useState } from "react";
import {
  AgentSessionHeader,
  SessionChatPane,
} from "@/components/agent/AgentSession";
import { useAgentChats } from "@/stores/useAgentChats";
import { useSessionRuns } from "@/stores/useSessionRuns";
import { useWorkspaces } from "@/stores/useWorkspaces";

interface MainAreaProps {
  onOpenSettings: () => void;
  onOpenChanges?: (path?: string) => void;
}

/** 会话 pane LRU 容量（ADR 0015） */
export const SESSION_PANE_CACHE_CAP = 5;

/**
 * 右主区：共享顶栏 + 多会话 pane keep-alive（LRU cap 5）。
 * 切换会话 / 进设置不 abort 进行中的 Turn。
 */
export function MainArea({ onOpenSettings, onOpenChanges }: MainAreaProps) {
  const activeConversationId = useAgentChats((s) => s.activeConversationId);
  const activeWsId = useWorkspaces((s) => s.activeId);

  // 无 active 时确保有会话（工作区绑定）
  useEffect(() => {
    if (!activeConversationId) {
      useAgentChats
        .getState()
        .ensureConversationForWorkspace(activeWsId ?? null);
    }
  }, [activeConversationId, activeWsId]);

  const conversationId =
    useAgentChats((s) => s.activeConversationId) ?? activeConversationId;

  const [mountedIds, setMountedIds] = useState<string[]>(() =>
    conversationId ? [conversationId] : [],
  );
  const orderRef = useRef<string[]>(conversationId ? [conversationId] : []);

  useEffect(() => {
    if (!conversationId) return;
    const order = orderRef.current.filter((id) => id !== conversationId);
    order.push(conversationId);
    const runs = useSessionRuns.getState().runs;
    while (order.length > SESSION_PANE_CACHE_CAP) {
      // 只淘汰未运行的最旧 pane；运行中 pane 永不因 LRU 卸载（可短暂超过 cap）
      const dropIdx = order.findIndex(
        (id) => id !== conversationId && !runs[id],
      );
      if (dropIdx >= 0) order.splice(dropIdx, 1);
      else break;
    }
    orderRef.current = order;
    setMountedIds((prev) => {
      const next = order.slice();
      // 保持引用稳定：集合相同则不更新
      if (
        prev.length === next.length &&
        prev.every((id, i) => id === next[i])
      ) {
        return prev;
      }
      return next;
    });
  }, [conversationId]);

  const panes = useMemo(() => mountedIds, [mountedIds]);

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col bg-bg">
      <AgentSessionHeader
        onOpenSettings={onOpenSettings}
        onOpenChanges={onOpenChanges}
      />
      <div className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        {panes.length === 0 || !conversationId ? (
          <div className="flex flex-1 items-center justify-center text-[12px] text-fg-faint">
            加载会话…
          </div>
        ) : (
          panes.map((id) => {
            const active = id === conversationId;
            return (
              <div
                key={id}
                className={
                  active
                    ? "flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
                    : "hidden"
                }
                aria-hidden={!active}
              >
                <SessionChatPane
                  conversationId={id}
                  isActive={active}
                  onOpenChanges={onOpenChanges}
                />
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
