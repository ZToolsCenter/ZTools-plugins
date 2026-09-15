import { beforeEach, describe, expect, it } from "vitest";
import type { AgentMessage } from "../useAgentChats";
import {
  isConversationArchived,
  useAgentChats,
} from "../useAgentChats";

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

describe("useAgentChats soft archive", () => {
  it("archive hides from listConversationsForWorkspace; restore returns and becomes active", () => {
    const id = useAgentChats
      .getState()
      .createConversation({ workspaceId: "ws-a" });
    useAgentChats.getState().appendMessage(id, makeUserMessage("hello", 100));

    // create another active so restore focus is observable
    const other = useAgentChats
      .getState()
      .createConversation({ workspaceId: "ws-a" });
    useAgentChats.getState().appendMessage(other, makeUserMessage("other", 200));
    useAgentChats.getState().setActiveConversation(other);

    const listedBefore = useAgentChats
      .getState()
      .listConversationsForWorkspace("ws-a")
      .map((c) => c.id);
    expect(listedBefore).toContain(id);
    expect(listedBefore).toContain(other);
    expect(listedBefore).toHaveLength(2);

    useAgentChats.getState().archiveConversation(id);
    expect(isConversationArchived(useAgentChats.getState().conversations[id])).toBe(
      true,
    );
    expect(
      useAgentChats.getState().listConversationsForWorkspace("ws-a").map((c) => c.id),
    ).toEqual([other]);
    expect(
      useAgentChats.getState().listConversations().map((c) => c.id),
    ).toEqual([other]);
    expect(
      useAgentChats
        .getState()
        .listArchivedConversations("ws-a")
        .map((c) => c.id),
    ).toEqual([id]);
    expect(useAgentChats.getState().activeConversationId).toBe(other);

    useAgentChats.getState().restoreConversation(id);
    expect(isConversationArchived(useAgentChats.getState().conversations[id])).toBe(
      false,
    );
    const listedAfter = useAgentChats
      .getState()
      .listConversationsForWorkspace("ws-a")
      .map((c) => c.id);
    expect(listedAfter).toContain(id);
    expect(listedAfter).toContain(other);
    expect(listedAfter).toHaveLength(2);
    expect(useAgentChats.getState().activeConversationId).toBe(id);
  });

  it("messages preserved after archive", () => {
    const id = useAgentChats
      .getState()
      .createConversation({ workspaceId: "ws-a" });
    const msg = makeUserMessage("keep me", 42);
    useAgentChats.getState().appendMessage(id, msg);

    useAgentChats.getState().archiveConversation(id);
    const conv = useAgentChats.getState().conversations[id];
    expect(conv?.messages).toHaveLength(1);
    expect(conv?.messages[0]?.parts).toEqual([{ type: "text", text: "keep me" }]);
  });

  it("archive of active switches to another non-archived same workspace", () => {
    const a1 = useAgentChats
      .getState()
      .createConversation({ workspaceId: "ws-a" });
    useAgentChats.getState().appendMessage(a1, makeUserMessage("a1", 100));
    const a2 = useAgentChats
      .getState()
      .createConversation({ workspaceId: "ws-a" });
    useAgentChats.getState().appendMessage(a2, makeUserMessage("a2", 200));
    useAgentChats.getState().setActiveConversation(a2);

    useAgentChats.getState().archiveConversation(a2);
    expect(useAgentChats.getState().activeConversationId).toBe(a1);
    expect(
      useAgentChats.getState().listConversationsForWorkspace("ws-a").map((c) => c.id),
    ).toEqual([a1]);
  });

  it("archive of sole active creates fresh non-archived empty", () => {
    const only = useAgentChats
      .getState()
      .createConversation({ workspaceId: "ws-a" });
    useAgentChats.getState().appendMessage(only, makeUserMessage("solo"));
    useAgentChats.getState().setActiveConversation(only);

    useAgentChats.getState().archiveConversation(only);
    const active = useAgentChats.getState().activeConversationId;
    expect(active).not.toBe(only);
    expect(active).toBeTruthy();
    const fresh = useAgentChats.getState().conversations[active!];
    expect(fresh?.workspaceId).toBe("ws-a");
    expect(fresh?.messages).toEqual([]);
    expect(isConversationArchived(fresh)).toBe(false);
  });

  it("ensureConversationForWorkspace skips archived when picking recent", () => {
    const archived = useAgentChats
      .getState()
      .createConversation({ workspaceId: "ws-a" });
    useAgentChats
      .getState()
      .appendMessage(archived, makeUserMessage("old", 1000));
    useAgentChats.setState((s) => ({
      conversations: {
        ...s.conversations,
        [archived]: {
          ...s.conversations[archived]!,
          updatedAt: 5000,
          archivedAt: Date.now(),
        },
      },
    }));

    // switch active away so ensure picks "recent"
    const other = useAgentChats
      .getState()
      .createConversation({ workspaceId: "ws-b" });
    useAgentChats.getState().appendMessage(other, makeUserMessage("b"));
    useAgentChats.getState().setActiveConversation(other);

    const ensured = useAgentChats
      .getState()
      .ensureConversationForWorkspace("ws-a");
    expect(ensured).not.toBe(archived);
    expect(
      useAgentChats.getState().conversations[ensured]?.messages.length,
    ).toBe(0);
  });

  it("listArchivedConversations excludes empty-message conversations", () => {
    const withMsg = useAgentChats
      .getState()
      .createConversation({ workspaceId: "ws-a" });
    useAgentChats.getState().appendMessage(withMsg, makeUserMessage("keep"));
    const empty = useAgentChats
      .getState()
      .createConversation({ workspaceId: "ws-a" });
    // empty has no messages

    useAgentChats.setState((s) => ({
      conversations: {
        ...s.conversations,
        [withMsg]: { ...s.conversations[withMsg]!, archivedAt: 100 },
        [empty]: { ...s.conversations[empty]!, archivedAt: 200 },
      },
    }));

    expect(
      useAgentChats
        .getState()
        .listArchivedConversations("ws-a")
        .map((c) => c.id),
    ).toEqual([withMsg]);
    expect(
      useAgentChats
        .getState()
        .listArchivedConversations()
        .map((c) => c.id),
    ).toEqual([withMsg]);
  });

  it("listArchivedConversations filters by workspace and sorts by archivedAt desc", () => {
    const a = useAgentChats
      .getState()
      .createConversation({ workspaceId: "ws-a" });
    useAgentChats.getState().appendMessage(a, makeUserMessage("a"));
    const b = useAgentChats
      .getState()
      .createConversation({ workspaceId: "ws-b" });
    useAgentChats.getState().appendMessage(b, makeUserMessage("b"));
    const a2 = useAgentChats
      .getState()
      .createConversation({ workspaceId: "ws-a" });
    useAgentChats.getState().appendMessage(a2, makeUserMessage("a2"));

    useAgentChats.setState((s) => ({
      conversations: {
        ...s.conversations,
        [a]: { ...s.conversations[a]!, archivedAt: 100 },
        [b]: { ...s.conversations[b]!, archivedAt: 200 },
        [a2]: { ...s.conversations[a2]!, archivedAt: 300 },
      },
    }));

    expect(
      useAgentChats
        .getState()
        .listArchivedConversations("ws-a")
        .map((c) => c.id),
    ).toEqual([a2, a]);
    expect(
      useAgentChats
        .getState()
        .listArchivedConversations()
        .map((c) => c.id),
    ).toEqual([a2, b, a]);
  });
});
