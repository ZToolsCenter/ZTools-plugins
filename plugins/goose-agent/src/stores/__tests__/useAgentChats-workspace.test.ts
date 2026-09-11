import { beforeEach, describe, expect, it } from "vitest";
import type { AgentMessage } from "../useAgentChats";
import { useAgentChats } from "../useAgentChats";

function makeUserMessage(text: string, createdAt = Date.now()): AgentMessage {
  return {
    id: `msg-${createdAt}-${Math.random().toString(36).slice(2, 7)}`,
    role: "user",
    parts: [{ type: "text", text }],
    createdAt,
  };
}

beforeEach(() => {
  useAgentChats.setState({
    conversations: {},
    activeConversationId: null,
    composerDrafts: {},
  });
});

describe("useAgentChats workspace binding", () => {
  it("createConversation binds workspaceId", () => {
    const id = useAgentChats
      .getState()
      .createConversation({ workspaceId: "ws-a" });
    const conv = useAgentChats.getState().conversations[id];
    expect(conv?.workspaceId).toBe("ws-a");
  });

  it("createConversation without options stores null workspaceId", () => {
    const id = useAgentChats.getState().createConversation();
    const conv = useAgentChats.getState().conversations[id];
    expect(conv?.workspaceId ?? null).toBeNull();
  });

  it("createConversation only reuses empty session in same workspace", () => {
    const emptyA = useAgentChats
      .getState()
      .createConversation({ workspaceId: "ws-a" });
    const againA = useAgentChats
      .getState()
      .createConversation({ workspaceId: "ws-a" });
    expect(againA).toBe(emptyA);

    const emptyB = useAgentChats
      .getState()
      .createConversation({ workspaceId: "ws-b" });
    expect(emptyB).not.toBe(emptyA);
    expect(useAgentChats.getState().conversations[emptyB]?.workspaceId).toBe(
      "ws-b",
    );
  });

  it("listConversationsForWorkspace filters by workspace and non-empty", () => {
    const a1 = useAgentChats
      .getState()
      .createConversation({ workspaceId: "ws-a" });
    useAgentChats.getState().appendMessage(a1, makeUserMessage("a1", 1000));
    const a2 = useAgentChats
      .getState()
      .createConversation({ workspaceId: "ws-a" });
    useAgentChats
      .getState()
      .appendMessage(a2, makeUserMessage("a2", 2000));

    const b1 = useAgentChats
      .getState()
      .createConversation({ workspaceId: "ws-b" });
    useAgentChats
      .getState()
      .appendMessage(b1, makeUserMessage("b1", 3000));

    // pin updatedAt for stable desc order
    useAgentChats.setState((s) => ({
      conversations: {
        ...s.conversations,
        [a1]: { ...s.conversations[a1]!, updatedAt: 1000 },
        [a2]: { ...s.conversations[a2]!, updatedAt: 2000 },
        [b1]: { ...s.conversations[b1]!, updatedAt: 3000 },
      },
    }));

    // empty in ws-a should not appear
    useAgentChats.getState().createConversation({ workspaceId: "ws-a" });

    const listA = useAgentChats
      .getState()
      .listConversationsForWorkspace("ws-a");
    expect(listA.map((c) => c.id)).toEqual([a2, a1]);

    const listB = useAgentChats
      .getState()
      .listConversationsForWorkspace("ws-b");
    expect(listB.map((c) => c.id)).toEqual([b1]);

    const listNull = useAgentChats
      .getState()
      .listConversationsForWorkspace(null);
    expect(listNull).toEqual([]);
  });

  it("listConversations remains global (non-empty only)", () => {
    const a = useAgentChats
      .getState()
      .createConversation({ workspaceId: "ws-a" });
    useAgentChats.getState().appendMessage(a, makeUserMessage("a"));
    const b = useAgentChats
      .getState()
      .createConversation({ workspaceId: "ws-b" });
    useAgentChats.getState().appendMessage(b, makeUserMessage("b"));
    useAgentChats.getState().createConversation({ workspaceId: "ws-c" });

    const global = useAgentChats.getState().listConversations();
    expect(global.map((c) => c.id).sort()).toEqual([a, b].sort());
  });

  it("ensureConversationForWorkspace switches to recent session or creates", () => {
    const a = useAgentChats
      .getState()
      .createConversation({ workspaceId: "ws-a" });
    useAgentChats.getState().appendMessage(a, makeUserMessage("a"));
    const b = useAgentChats
      .getState()
      .createConversation({ workspaceId: "ws-b" });
    useAgentChats.getState().appendMessage(b, makeUserMessage("b"));
    expect(useAgentChats.getState().activeConversationId).toBe(b);

    const ensuredA = useAgentChats
      .getState()
      .ensureConversationForWorkspace("ws-a");
    expect(ensuredA).toBe(a);
    expect(useAgentChats.getState().activeConversationId).toBe(a);

    const ensuredC = useAgentChats
      .getState()
      .ensureConversationForWorkspace("ws-c");
    expect(ensuredC).not.toBe(a);
    expect(ensuredC).not.toBe(b);
    expect(
      useAgentChats.getState().conversations[ensuredC]?.workspaceId,
    ).toBe("ws-c");
    expect(
      useAgentChats.getState().conversations[ensuredC]?.messages,
    ).toEqual([]);
  });

  it("ensureConversationForWorkspace keeps active same-workspace non-stale", () => {
    const id = useAgentChats
      .getState()
      .createConversation({ workspaceId: "ws-a" });
    useAgentChats.getState().appendMessage(id, makeUserMessage("hi"));
    const now = Date.now();
    const again = useAgentChats
      .getState()
      .ensureConversationForWorkspace("ws-a", { now, maxAgeMs: 60_000 });
    expect(again).toBe(id);
  });

  it("ensureConversationForWorkspace creates fresh when same-workspace active is stale", () => {
    const id = useAgentChats
      .getState()
      .createConversation({ workspaceId: "ws-a" });
    useAgentChats.getState().appendMessage(id, makeUserMessage("old"));
    // force old updatedAt
    useAgentChats.setState((s) => ({
      conversations: {
        ...s.conversations,
        [id]: {
          ...s.conversations[id]!,
          updatedAt: 1_000,
        },
      },
    }));

    const fresh = useAgentChats.getState().ensureConversationForWorkspace(
      "ws-a",
      { now: 1_000 + 10 * 60 * 60 * 1000, maxAgeMs: 60_000 },
    );
    expect(fresh).not.toBe(id);
    expect(useAgentChats.getState().conversations[fresh]?.workspaceId).toBe(
      "ws-a",
    );
    expect(
      useAgentChats.getState().conversations[fresh]?.messages.length,
    ).toBe(0);
    // stale session kept
    expect(useAgentChats.getState().conversations[id]).toBeDefined();
  });

  it("legacy data without workspaceId normalizes as null", () => {
    const now = Date.now();
    useAgentChats.setState({
      conversations: {
        legacy: {
          id: "legacy",
          messages: [makeUserMessage("legacy", now)],
          createdAt: now,
          updatedAt: now,
          // no workspaceId field
        },
      },
      activeConversationId: "legacy",
      composerDrafts: {},
    });

    const listNull = useAgentChats
      .getState()
      .listConversationsForWorkspace(null);
    expect(listNull.map((c) => c.id)).toEqual(["legacy"]);
    expect(
      useAgentChats.getState().conversations.legacy?.workspaceId ?? null,
    ).toBe(null);

    // 未过期的未挂载 active 应保持
    const ensured = useAgentChats
      .getState()
      .ensureConversationForWorkspace(null);
    expect(ensured).toBe("legacy");
  });

  it("deleteConversation prefers same workspace remaining session", () => {
    const a1 = useAgentChats
      .getState()
      .createConversation({ workspaceId: "ws-a" });
    useAgentChats.getState().appendMessage(a1, makeUserMessage("a1", 100));
    const b1 = useAgentChats
      .getState()
      .createConversation({ workspaceId: "ws-b" });
    useAgentChats.getState().appendMessage(b1, makeUserMessage("b1", 200));
    const a2 = useAgentChats
      .getState()
      .createConversation({ workspaceId: "ws-a" });
    useAgentChats.getState().appendMessage(a2, makeUserMessage("a2", 300));

    useAgentChats.getState().setActiveConversation(a2);
    useAgentChats.getState().deleteConversation(a2);
    expect(useAgentChats.getState().activeConversationId).toBe(a1);
  });
});
