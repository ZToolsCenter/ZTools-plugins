import { expect, test } from "playwright/test";
import type { NotebookAiMessage } from "../../src/lib/notebook-ai/types";
import {
  CONVERSATION_STALE_MS,
  migrateNotebookAiChatsState,
  useNotebookAiChats,
} from "../../src/stores/useNotebookAiChats";

function createMessage(index: number, displayText = `消息 ${index}`) {
  return {
    id: `message-${index}`,
    role: "user",
    metadata: { displayText },
    parts: [{ type: "text", text: displayText }],
  } as NotebookAiMessage;
}

test.beforeEach(() => {
  useNotebookAiChats.setState({ chats: {}, composerDrafts: {} });
});

test("输入草稿按笔记本读写，空内容会清除", () => {
  const store = useNotebookAiChats.getState();
  store.setComposerDraft("nb-draft", {
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [{ type: "text", text: "未发送的草稿" }],
      },
    ],
  });

  expect(store.getComposerDraft("nb-draft")).toMatchObject({
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [{ type: "text", text: "未发送的草稿" }],
      },
    ],
  });

  store.setComposerDraft("nb-draft", {
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [
          { type: "text", text: "带图 " },
          {
            type: "aiImageAttachment",
            attrs: {
              imageId: "img-1",
              fileName: "a.png",
              mediaType: "image/png",
              size: 12,
            },
          },
        ],
      },
    ],
  });
  // 图片 token 不落盘
  expect(JSON.stringify(store.getComposerDraft("nb-draft"))).not.toContain(
    "aiImageAttachment",
  );
  expect(JSON.stringify(store.getComposerDraft("nb-draft"))).toContain(
    "带图",
  );

  store.clearComposerDraft("nb-draft");
  expect(store.getComposerDraft("nb-draft")).toBeNull();
});

test("持久化配置保留原 key 并启用 v1 迁移", () => {
  const options = useNotebookAiChats.persist.getOptions();

  expect(options.name).toBe("goose-note-notebook-ai-chats");
  expect(options.version).toBe(1);
  expect(typeof options.migrate).toBe("function");
});

test("旧单会话数据迁移为一条激活会话", () => {
  const messages = Array.from({ length: 65 }, (_, index) =>
    createMessage(index),
  );
  const migrated = migrateNotebookAiChatsState({
    chats: {
      notebookA: {
        messages,
        updatedAt: 1234,
      },
    },
  });

  const notebookChat = migrated.chats.notebookA;
  expect(notebookChat.activeConversationId).toBe("legacy-notebookA");
  expect(Object.keys(notebookChat.conversations)).toEqual(["legacy-notebookA"]);
  expect(notebookChat.conversations["legacy-notebookA"].messages).toHaveLength(
    60,
  );
  expect(notebookChat.conversations["legacy-notebookA"].messages[0].id).toBe(
    "message-5",
  );
  expect(notebookChat.conversations["legacy-notebookA"].createdAt).toBe(1234);
  expect(notebookChat.updatedAt).toBe(1234);
});

test("空会话不进入历史且重复新建会复用", () => {
  const store = useNotebookAiChats.getState();
  const firstConversationId = store.createConversation("notebookA");
  const reusedConversationId = store.createConversation("notebookA");

  expect(reusedConversationId).toBe(firstConversationId);
  expect(store.getActiveConversationId("notebookA")).toBe(firstConversationId);
  expect(store.getConversationMessages("notebookA")).toEqual([]);
  expect(store.listConversations("notebookA")).toEqual([]);
});

test("每条非空会话独立保存、切换并最多保留 60 条消息", () => {
  const store = useNotebookAiChats.getState();
  const firstConversationId = store.createConversation("notebookA");
  store.setMessages(
    "notebookA",
    firstConversationId,
    Array.from({ length: 65 }, (_, index) => createMessage(index)),
  );

  const secondConversationId = store.createConversation("notebookA");
  expect(secondConversationId).not.toBe(firstConversationId);
  store.setMessages("notebookA", secondConversationId, [
    createMessage(100, "第二段会话"),
  ]);

  expect(store.listConversations("notebookA")).toHaveLength(2);
  expect(
    store.getConversationMessages("notebookA", firstConversationId),
  ).toHaveLength(60);
  expect(
    store.getConversationMessages("notebookA", firstConversationId)[0].id,
  ).toBe("message-5");

  store.setActiveConversation("notebookA", firstConversationId);
  expect(store.getActiveConversationId("notebookA")).toBe(firstConversationId);
  expect(store.getConversationMessages("notebookA")).toHaveLength(60);
});

test("删除非激活会话后历史列表不再返回它，激活指针不变", () => {
  const store = useNotebookAiChats.getState();
  const firstId = store.createConversation("notebookA");
  store.setMessages("notebookA", firstId, [createMessage(1, "会话一")]);
  const secondId = store.createConversation("notebookA");
  store.setMessages("notebookA", secondId, [createMessage(2, "会话二")]);

  store.setActiveConversation("notebookA", firstId);
  store.deleteConversation("notebookA", secondId);

  expect(
    store.listConversations("notebookA").map((item) => item.id),
  ).toEqual([firstId]);
  expect(store.getActiveConversationId("notebookA")).toBe(firstId);
});

test("删除激活会话后激活指针回退到剩余最新会话", () => {
  const store = useNotebookAiChats.getState();
  const olderId = store.createConversation("notebookA");
  store.setMessages("notebookA", olderId, [createMessage(1, "较早会话")]);
  const newerId = store.createConversation("notebookA");
  store.setMessages("notebookA", newerId, [createMessage(2, "较新会话")]);

  // newerId 是激活且 updatedAt 最新的会话，删除后应回退到 olderId
  expect(store.getActiveConversationId("notebookA")).toBe(newerId);
  store.deleteConversation("notebookA", newerId);

  expect(store.getActiveConversationId("notebookA")).toBe(olderId);
  expect(store.getConversationMessages("notebookA")).toHaveLength(1);
});

test("三条会话时删除激活的最新会话，激活指针回退到次新的会话", () => {
  const store = useNotebookAiChats.getState();
  const conversationA = store.createConversation("notebookA");
  store.setMessages("notebookA", conversationA, [createMessage(1, "会话 A")]);
  const conversationB = store.createConversation("notebookA");
  store.setMessages("notebookA", conversationB, [createMessage(2, "会话 B")]);
  const conversationC = store.createConversation("notebookA");
  store.setMessages("notebookA", conversationC, [createMessage(3, "会话 C")]);

  // 控制 updatedAt 严格递增：A < B < C
  const base = Date.now() - 10_000;
  useNotebookAiChats.setState((state) => {
    const notebookChat = state.chats.notebookA;
    const touch = (id: string, updatedAt: number) => ({
      ...notebookChat.conversations[id],
      updatedAt,
    });
    return {
      chats: {
        ...state.chats,
        notebookA: {
          ...notebookChat,
          conversations: {
            [conversationA]: touch(conversationA, base),
            [conversationB]: touch(conversationB, base + 1),
            [conversationC]: touch(conversationC, base + 2),
          },
        },
      },
    };
  });

  // 激活 C 后删除 C，应回退到剩余中 updatedAt 最新的 B 而非 A
  store.setActiveConversation("notebookA", conversationC);
  useNotebookAiChats.setState((state) => {
    const notebookChat = state.chats.notebookA;
    return {
      chats: {
        ...state.chats,
        notebookA: {
          ...notebookChat,
          conversations: {
            ...notebookChat.conversations,
            [conversationC]: {
              ...notebookChat.conversations[conversationC],
              updatedAt: base + 2,
            },
          },
        },
      },
    };
  });

  store.deleteConversation("notebookA", conversationC);

  expect(store.getActiveConversationId("notebookA")).toBe(conversationB);
  expect(
    store.listConversations("notebookA").map((item) => item.id),
  ).toEqual([conversationB, conversationA]);
});

test("删除最后一条会话后激活指针为 null，无草稿时移除笔记本记录", () => {
  const store = useNotebookAiChats.getState();
  const conversationId = store.createConversation("notebookA");
  store.setMessages("notebookA", conversationId, [createMessage(1)]);

  store.deleteConversation("notebookA", conversationId);

  expect(store.getActiveConversationId("notebookA")).toBeNull();
  expect(useNotebookAiChats.getState().chats["notebookA"]).toBeUndefined();
});

test("删除最后一条会话但有输入草稿时保留笔记本记录", () => {
  const store = useNotebookAiChats.getState();
  const conversationId = store.createConversation("notebookA");
  store.setMessages("notebookA", conversationId, [createMessage(1)]);
  store.setComposerDraft("notebookA", {
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [{ type: "text", text: "未发送的草稿" }],
      },
    ],
  });

  store.deleteConversation("notebookA", conversationId);

  expect(store.getActiveConversationId("notebookA")).toBeNull();
  expect(useNotebookAiChats.getState().chats["notebookA"]).toBeDefined();
  expect(store.getComposerDraft("notebookA")).not.toBeNull();
});

test("删除不存在的会话不抛错、不影响其他数据", () => {
  const store = useNotebookAiChats.getState();
  const conversationId = store.createConversation("notebookA");
  store.setMessages("notebookA", conversationId, [createMessage(1)]);

  expect(() =>
    store.deleteConversation("notebookA", "missing-conversation"),
  ).not.toThrow();
  expect(() =>
    store.deleteConversation("missing-notebook", conversationId),
  ).not.toThrow();

  expect(store.getActiveConversationId("notebookA")).toBe(conversationId);
  expect(store.listConversations("notebookA")).toHaveLength(1);
});

test("不存在的会话不能被激活", () => {
  const store = useNotebookAiChats.getState();
  const conversationId = store.createConversation("notebookA");

  store.setActiveConversation("notebookA", "missing-conversation");

  expect(store.getActiveConversationId("notebookA")).toBe(conversationId);
});

test("保存非当前会话时不会把激活指针切回旧会话", () => {
  const store = useNotebookAiChats.getState();
  const firstConversationId = store.createConversation("notebookA");
  store.setMessages("notebookA", firstConversationId, [createMessage(1)]);
  const secondConversationId = store.createConversation("notebookA");
  store.setMessages("notebookA", secondConversationId, [createMessage(2)]);

  store.setActiveConversation("notebookA", firstConversationId);
  store.setMessages("notebookA", secondConversationId, [createMessage(3)]);

  expect(store.getActiveConversationId("notebookA")).toBe(firstConversationId);
});

test("图片消息只持久化附件摘要，不写入 data URL", () => {
  const store = useNotebookAiChats.getState();
  const conversationId = store.createConversation("notebookA");
  const imageMessage = {
    id: "image-message",
    role: "user",
    metadata: {
      displayText: "看看这张图",
      imageAttachments: [{ filename: "diagram.png", mediaType: "image/png" }],
    },
    parts: [
      {
        type: "file",
        mediaType: "image/png",
        filename: "diagram.png",
        url: "data:image/png;base64,ZmFrZQ==",
      },
      { type: "text", text: "看看这张图" },
    ],
  } as NotebookAiMessage;

  store.setMessages("notebookA", conversationId, [imageMessage]);

  const [persisted] = store.getConversationMessages(
    "notebookA",
    conversationId,
  );
  expect(persisted.parts).toEqual([{ type: "text", text: "看看这张图" }]);
  expect(persisted.metadata?.imageAttachments).toEqual([
    { filename: "diagram.png", mediaType: "image/png" },
  ]);
});

test("最多保留 20 个笔记本且不限制单个笔记本的历史会话数", () => {
  const store = useNotebookAiChats.getState();

  for (let index = 0; index < 21; index += 1) {
    store.createConversation(`notebook-${index}`);
  }

  expect(Object.keys(useNotebookAiChats.getState().chats)).toHaveLength(20);
  expect(useNotebookAiChats.getState().chats["notebook-20"]).toBeDefined();

  for (let index = 0; index < 25; index += 1) {
    const conversationId = store.createConversation("notebook-history");
    store.setMessages("notebook-history", conversationId, [
      createMessage(index, `会话 ${index}`),
    ]);
  }

  expect(store.listConversations("notebook-history")).toHaveLength(25);
});

test("打开空面板不会为占位会话淘汰已有真实历史", () => {
  const store = useNotebookAiChats.getState();

  for (let index = 0; index < 20; index += 1) {
    const notebookId = `history-${index}`;
    const conversationId = store.createConversation(notebookId);
    store.setMessages(notebookId, conversationId, [createMessage(index)]);
  }

  const emptyConversationId = store.createConversation("empty-panel");
  expect(Object.keys(useNotebookAiChats.getState().chats)).toHaveLength(21);
  expect(useNotebookAiChats.getState().chats["history-0"]).toBeDefined();

  store.setMessages("empty-panel", emptyConversationId, [createMessage(100)]);
  expect(Object.keys(useNotebookAiChats.getState().chats)).toHaveLength(20);
  expect(useNotebookAiChats.getState().chats["empty-panel"]).toBeDefined();
});

test("清空全部会话记录", () => {
  const store = useNotebookAiChats.getState();
  store.createConversation("notebookA");
  store.createConversation("notebookB");

  store.clearAllChats();

  expect(useNotebookAiChats.getState().chats).toEqual({});
});

test("打开 AI：未过期会话继续，过期会话归档后进入空白新会话", () => {
  const store = useNotebookAiChats.getState();
  const conversationId = store.createConversation("notebookA");
  store.setMessages("notebookA", conversationId, [createMessage(1, "旧会话")]);

  const freshNow = Date.now();
  const continuedId = store.ensureFreshActiveConversation("notebookA", {
    now: freshNow,
  });
  expect(continuedId).toBe(conversationId);
  expect(store.getConversationMessages("notebookA")).toHaveLength(1);

  const staleNow = freshNow + CONVERSATION_STALE_MS + 1;
  const nextId = store.ensureFreshActiveConversation("notebookA", {
    now: staleNow,
  });

  expect(nextId).not.toBe(conversationId);
  expect(store.getActiveConversationId("notebookA")).toBe(nextId);
  expect(store.getConversationMessages("notebookA")).toEqual([]);
  // 旧会话仍在历史里
  expect(store.listConversations("notebookA").map((item) => item.id)).toEqual([
    conversationId,
  ]);
  expect(
    store.getConversationMessages("notebookA", conversationId),
  ).toHaveLength(1);
});

test("打开 AI：空会话不会被 6 小时规则误归档", () => {
  const store = useNotebookAiChats.getState();
  const emptyId = store.createConversation("notebookA");

  // 人为把 touch 时间拨到很久以前
  useNotebookAiChats.setState((state) => {
    const notebookChat = state.chats.notebookA;
    const conversation = notebookChat.conversations[emptyId];
    return {
      chats: {
        ...state.chats,
        notebookA: {
          ...notebookChat,
          updatedAt: 1,
          conversations: {
            ...notebookChat.conversations,
            [emptyId]: { ...conversation, updatedAt: 1, createdAt: 1 },
          },
        },
      },
    };
  });

  const resolvedId = store.ensureFreshActiveConversation("notebookA", {
    now: Date.now(),
  });
  expect(resolvedId).toBe(emptyId);
  expect(store.getConversationMessages("notebookA")).toEqual([]);
});

test("从历史切回旧会话会刷新活跃时间，短时间内再打开仍保留", () => {
  const store = useNotebookAiChats.getState();
  const oldId = store.createConversation("notebookA");
  store.setMessages("notebookA", oldId, [createMessage(1, "历史会话")]);
  const newerId = store.createConversation("notebookA");
  store.setMessages("notebookA", newerId, [createMessage(2, "新会话")]);

  // 把会话消息时间拨到过期，但随后从历史点开旧会话
  const base = Date.now() - CONVERSATION_STALE_MS - 60_000;
  useNotebookAiChats.setState((state) => {
    const notebookChat = state.chats.notebookA;
    return {
      chats: {
        ...state.chats,
        notebookA: {
          ...notebookChat,
          updatedAt: base,
          conversations: {
            [oldId]: {
              ...notebookChat.conversations[oldId],
              updatedAt: base,
            },
            [newerId]: {
              ...notebookChat.conversations[newerId],
              updatedAt: base + 1,
            },
          },
        },
      },
    };
  });

  store.setActiveConversation("notebookA", oldId);
  const resolvedId = store.ensureFreshActiveConversation("notebookA", {
    now: Date.now(),
  });
  expect(resolvedId).toBe(oldId);
  expect(store.getConversationMessages("notebookA")[0]?.metadata?.displayText).toBe(
    "历史会话",
  );
});
