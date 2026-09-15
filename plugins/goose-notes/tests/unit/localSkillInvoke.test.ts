import { expect, test } from "playwright/test";
import { serializeAiComposerDoc } from "../../src/components/editor/ai/composer/referenceLookup";
import {
  clearLocalSkillsCache,
  resolveInvokedLocalSkill,
  resolveInvokedLocalSkillFromTokens,
} from "../../src/lib/notebook-ai/localContext";

function installLocalSkills(
  files: Array<{ path: string; content: string }>,
) {
  clearLocalSkillsCache();
  (globalThis as { window?: unknown }).window = {
    gooseAiContext: {
      listLocalSkills: () => files,
      readGlobalPrompt: () => "",
    },
  };
}

test("resolveInvokedLocalSkill 匹配任意位置第一个已知 skill", () => {
  installLocalSkills([
    {
      path: "/home/.agents/skills/grill-me/SKILL.md",
      content: "---\nname: grill-me\ndescription: 追问\n---\n\n# Grill",
    },
    {
      path: "/home/.agents/skills/summarize/SKILL.md",
      content: "---\nname: summarize\ndescription: 摘要\n---\n\n# Sum",
    },
  ]);

  expect(resolveInvokedLocalSkill("/grill-me 帮我")).toMatchObject({
    name: "grill-me",
  });
  expect(
    resolveInvokedLocalSkill("请先用 /grill-me 再总结"),
  ).toMatchObject({ name: "grill-me" });
  expect(
    resolveInvokedLocalSkill("用 /unknown 和 /summarize"),
  ).toMatchObject({ name: "summarize" });
  expect(resolveInvokedLocalSkill("没有任何斜杠命令")).toBeNull();
});

test("resolveInvokedLocalSkillFromTokens 优先 skill chip", () => {
  installLocalSkills([
    {
      path: "/home/.agents/skills/grill-me/SKILL.md",
      content: "---\nname: grill-me\ndescription: 追问\n---\n\n# Grill",
    },
    {
      path: "/home/.agents/skills/summarize/SKILL.md",
      content: "---\nname: summarize\ndescription: 摘要\n---\n\n# Sum",
    },
  ]);

  expect(
    resolveInvokedLocalSkillFromTokens([
      { type: "text", text: "请用 " },
      { type: "skill", skill: { name: "grill-me" } },
      { type: "text", text: " 再 /summarize" },
    ]),
  ).toMatchObject({ name: "grill-me" });

  // 无 chip 时回退扫描文本
  expect(
    resolveInvokedLocalSkillFromTokens([
      { type: "text", text: "中间调用 /summarize 一次" },
    ]),
  ).toMatchObject({ name: "summarize" });

  // 第一个 skill chip 不存在时返回 null（不继续扫后面文本）
  expect(
    resolveInvokedLocalSkillFromTokens([
      { type: "skill", skill: { name: "missing-skill" } },
      { type: "text", text: " /grill-me" },
    ]),
  ).toBeNull();
});

test("serializeAiComposerDoc 识别 aiSkillCommand 并收集 skills", () => {
  const payload = serializeAiComposerDoc({
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [
          { type: "text", text: "请用 " },
          {
            type: "aiSkillCommand",
            attrs: {
              name: "grill-me",
              description: "追问澄清",
              path: "/home/.agents/skills/grill-me/SKILL.md",
            },
          },
          { type: "text", text: " 再 " },
          {
            type: "aiSkillCommand",
            attrs: { name: "grill-me" },
          },
          { type: "text", text: " 一次" },
        ],
      },
    ],
  });

  expect(payload.promptText).toBe("请用 /grill-me 再 /grill-me 一次");
  // freeform 与 @ 对称：不含 chip 文本
  expect(payload.freeformText).toBe("请用  再  一次");
  expect(payload.skills).toEqual([
    {
      name: "grill-me",
      description: "追问澄清",
      path: "/home/.agents/skills/grill-me/SKILL.md",
    },
  ]);
  expect(payload.tokens.filter((t) => t.type === "skill")).toHaveLength(2);
});
