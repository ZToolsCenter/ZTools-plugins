import { describe, expect, it } from "vitest";
import {
  formatToolResultForModel,
  MAX_TOOL_RESULT_CHARS,
  messageHasContent,
  normalizeOutgoingContent,
  parseToolArguments,
  toAIMessages,
  toOpenAILoopMessages,
} from "../messageFormat";
import {
  encodeMessagesForClaude,
  encodeMessagesForOpenAIChat,
  encodeMessagesForResponsesInput,
  toClaudeContent,
  toOpenAIChatContent,
  toResponsesInputContent,
} from "../../ai-provider/multimodal";
import type { AgentChatMessage } from "../types";

describe("formatToolResultForModel", () => {
  it("keeps short results intact", () => {
    expect(formatToolResultForModel(null)).toBe("");
    expect(formatToolResultForModel("hello")).toBe("hello");
    expect(formatToolResultForModel({ ok: true, n: 1 })).toBe(
      JSON.stringify({ ok: true, n: 1 }),
    );
  });

  it("truncates long results with Chinese notice", () => {
    const long = "x".repeat(MAX_TOOL_RESULT_CHARS + 500);
    const out = formatToolResultForModel(long);
    expect(out.length).toBeLessThan(long.length);
    expect(out.startsWith("x".repeat(100))).toBe(true);
    expect(out).toContain("工具结果已截断");
    expect(out).toContain(String(long.length));
    expect(out.length).toBe(
      MAX_TOOL_RESULT_CHARS + `…[工具结果已截断，原长 ${long.length}]`.length,
    );
  });

  it("omits contentBase64 and long html from model payload", () => {
    const b64 = "A".repeat(5000);
    const html = "<div>" + "x".repeat(3000) + "</div>";
    const out = formatToolResultForModel({
      ok: true,
      kind: "office-docx",
      filename: "a.docx",
      contentBase64: b64,
      html,
    });
    expect(out).not.toContain(b64);
    expect(out).toContain("contentBase64Omitted");
    expect(out).toContain("htmlOmitted");
    expect(out).toContain("a.docx");
    // 原始完整 base64 不得回传
    expect(out.includes("AAAA")).toBe(false);
  });

  it("omits long svg and long mermaid source from model payload", () => {
    const svg = "<svg>" + "p".repeat(3000) + "</svg>";
    const source = "graph TD;\n" + "A-->B;\n".repeat(800);
    const out = formatToolResultForModel({
      ok: true,
      kind: "diagram",
      svg,
      source,
    });
    expect(out).toContain("svgOmitted");
    expect(out).toContain("sourceOmitted");
    expect(out).not.toContain("p".repeat(500));
  });
});

describe("parseToolArguments", () => {
  it("parses JSON and falls back on bad input", () => {
    expect(parseToolArguments('{"a":1}')).toEqual({ a: 1 });
    expect(parseToolArguments("")).toEqual({});
    expect(parseToolArguments("not-json")).toEqual({ _raw: "not-json" });
  });
});

describe("multimodal messageFormat", () => {
  const imagePart = {
    type: "image" as const,
    mediaType: "image/jpeg",
    dataBase64: "abc123",
  };

  it("messageHasContent keeps image-only and drops empty", () => {
    expect(messageHasContent("")).toBe(false);
    expect(messageHasContent("hi")).toBe(true);
    expect(messageHasContent([{ type: "text", text: "  " }])).toBe(false);
    expect(messageHasContent([imagePart])).toBe(true);
    expect(
      messageHasContent([
        { type: "text", text: "see" },
        imagePart,
      ]),
    ).toBe(true);
  });

  it("normalizeOutgoingContent preserves image parts", () => {
    expect(normalizeOutgoingContent([imagePart])).toEqual([imagePart]);
    expect(
      normalizeOutgoingContent([
        { type: "text", text: "  " },
        imagePart,
        { type: "text", text: "caption" },
      ]),
    ).toEqual([imagePart, { type: "text", text: "caption" }]);
    expect(normalizeOutgoingContent([{ type: "text", text: "only" }])).toBe(
      "only",
    );
  });

  it("toAIMessages keeps image parts and does not strip image-only user", () => {
    const messages: AgentChatMessage[] = [
      { role: "system", content: "sys" },
      {
        role: "user",
        content: [imagePart, { type: "text", text: "what is this?" }],
      },
      {
        role: "user",
        content: [imagePart],
      },
      { role: "user", content: "  " },
      {
        role: "user",
        content: [{ type: "text", text: "" }],
      },
    ];
    const out = toAIMessages(messages);
    expect(out).toHaveLength(3);
    expect(out[0]).toEqual({ role: "system", content: "sys" });
    expect(out[1]?.content).toEqual([
      imagePart,
      { type: "text", text: "what is this?" },
    ]);
    expect(out[2]?.content).toEqual([imagePart]);
  });

  it("toOpenAILoopMessages encodes image_url data URLs", () => {
    const messages: AgentChatMessage[] = [
      {
        role: "user",
        content: [{ type: "text", text: "look" }, imagePart],
      },
    ];
    const out = toOpenAILoopMessages(messages);
    expect(out).toHaveLength(1);
    expect(out[0]).toEqual({
      role: "user",
      content: [
        { type: "text", text: "look" },
        {
          type: "image_url",
          image_url: { url: "data:image/jpeg;base64,abc123" },
        },
      ],
    });
  });
});

describe("protocol content encoders", () => {
  const parts = [
    { type: "image" as const, mediaType: "image/png", dataBase64: "xyz" },
    { type: "text" as const, text: "describe" },
  ];

  it("OpenAI Chat Completions shape", () => {
    expect(toOpenAIChatContent(parts)).toEqual([
      {
        type: "image_url",
        image_url: { url: "data:image/png;base64,xyz" },
      },
      { type: "text", text: "describe" },
    ]);
    const msgs = encodeMessagesForOpenAIChat([
      { role: "user", content: parts },
    ]);
    expect(msgs[0]?.content).toEqual(toOpenAIChatContent(parts));
  });

  it("OpenAI Responses input_image shape", () => {
    expect(toResponsesInputContent(parts)).toEqual([
      { type: "input_image", image_url: "data:image/png;base64,xyz" },
      { type: "input_text", text: "describe" },
    ]);
    const { input } = encodeMessagesForResponsesInput([
      { role: "system", content: "s" },
      { role: "user", content: parts },
    ]);
    expect(input[0]?.content).toEqual(toResponsesInputContent(parts));
  });

  it("Anthropic image source shape (images before text)", () => {
    expect(toClaudeContent(parts)).toEqual([
      {
        type: "image",
        source: {
          type: "base64",
          media_type: "image/png",
          data: "xyz",
        },
      },
      { type: "text", text: "describe" },
    ]);
    const { claudeMessages } = encodeMessagesForClaude([
      { role: "user", content: parts },
    ]);
    expect(claudeMessages[0]?.content).toEqual(toClaudeContent(parts));
  });
});
