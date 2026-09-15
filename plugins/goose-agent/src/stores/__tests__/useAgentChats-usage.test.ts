import { beforeEach, describe, expect, it } from "vitest";
import type { AgentTokenUsage } from "@/lib/agent/usage";
import { useAgentChats } from "../useAgentChats";

function makeUsage(
  partial: Partial<AgentTokenUsage> &
    Pick<
      AgentTokenUsage,
      "promptTokens" | "completionTokens" | "totalTokens" | "source"
    >,
): AgentTokenUsage {
  return { updatedAt: Date.now(), ...partial };
}

beforeEach(() => {
  useAgentChats.setState({
    conversations: {},
    activeConversationId: null,
    composerDrafts: {},
  });
});

describe("useAgentChats recordTurnUsage / getConversationUsage", () => {
  it("after createConversation, recordTurnUsage sets lastTurn and initializes session", () => {
    const id = useAgentChats.getState().createConversation();
    const turn = makeUsage({
      promptTokens: 100,
      completionTokens: 50,
      totalTokens: 150,
      cacheReadTokens: 10,
      cacheWriteTokens: 5,
      source: "provider",
    });

    useAgentChats.getState().recordTurnUsage(id, turn);

    const usage = useAgentChats.getState().getConversationUsage(id);
    expect(usage).not.toBeNull();
    expect(usage!.lastTurn).toEqual(turn);
    expect(usage!.session).toEqual({
      promptTokens: 100,
      completionTokens: 50,
      totalTokens: 150,
      cacheReadTokens: 10,
      cacheWriteTokens: 5,
    });
  });

  it("second recordTurnUsage: lastTurn is second; session sums both turns", () => {
    const id = useAgentChats.getState().createConversation();
    const turn1 = makeUsage({
      promptTokens: 100,
      completionTokens: 50,
      totalTokens: 150,
      cacheReadTokens: 10,
      cacheWriteTokens: 5,
      source: "provider",
    });
    const turn2 = makeUsage({
      promptTokens: 200,
      completionTokens: 80,
      totalTokens: 280,
      cacheReadTokens: 20,
      cacheWriteTokens: 8,
      source: "provider",
    });

    useAgentChats.getState().recordTurnUsage(id, turn1);
    useAgentChats.getState().recordTurnUsage(id, turn2);

    const usage = useAgentChats.getState().getConversationUsage(id);
    expect(usage!.lastTurn).toEqual(turn2);
    expect(usage!.session.promptTokens).toBe(100 + 200);
    expect(usage!.session.completionTokens).toBe(50 + 80);
    expect(usage!.session.totalTokens).toBe(150 + 280);
    expect(usage!.session.cacheReadTokens).toBe(10 + 20);
    expect(usage!.session.cacheWriteTokens).toBe(5 + 8);
  });

  it("getConversationUsage returns the usage object", () => {
    const id = useAgentChats.getState().createConversation();
    expect(useAgentChats.getState().getConversationUsage(id)).toBeNull();

    const turn = makeUsage({
      promptTokens: 1,
      completionTokens: 2,
      totalTokens: 3,
      source: "provider",
    });
    useAgentChats.getState().recordTurnUsage(id, turn);

    const usage = useAgentChats.getState().getConversationUsage(id);
    expect(usage).toEqual({
      lastTurn: turn,
      session: {
        promptTokens: 1,
        completionTokens: 2,
        totalTokens: 3,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
      },
    });
  });

  it("recordTurnUsage on unknown conversationId is no-op (does not throw)", () => {
    expect(() => {
      useAgentChats.getState().recordTurnUsage(
        "missing-conv-id",
        makeUsage({
          promptTokens: 10,
          completionTokens: 5,
          totalTokens: 15,
          source: "provider",
        }),
      );
    }).not.toThrow();

    expect(
      useAgentChats.getState().getConversationUsage("missing-conv-id"),
    ).toBeNull();
    expect(Object.keys(useAgentChats.getState().conversations)).toHaveLength(
      0,
    );
  });

  it('preserves source "estimate" on lastTurn', () => {
    const id = useAgentChats.getState().createConversation();
    const turn = makeUsage({
      promptTokens: 40,
      completionTokens: 20,
      totalTokens: 60,
      source: "estimate",
    });

    useAgentChats.getState().recordTurnUsage(id, turn);

    const usage = useAgentChats.getState().getConversationUsage(id);
    expect(usage!.lastTurn.source).toBe("estimate");
    expect(usage!.lastTurn).toEqual(turn);
  });
});
