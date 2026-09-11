/**
 * Structural contract: ComposerContextBar 可不选工作区（对齐侧栏快速对话）。
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const contextBarPath = join(
  dirname(fileURLToPath(import.meta.url)),
  "../ComposerContextBar.tsx",
);
const composerPath = join(
  dirname(fileURLToPath(import.meta.url)),
  "../Composer.tsx",
);

describe("ComposerContextBar 不选择工作区", () => {
  const src = readFileSync(contextBarPath, "utf8");

  it("exposes __none__ menu item with 不选择工作区 label", () => {
    expect(src).toMatch(/id="__none__"/);
    expect(src).toMatch(/textValue="不选择工作区"/);
    expect(src).toMatch(/不选择工作区/);
    expect(src).not.toMatch(/未挂载/);
  });

  it("selects __none__ when !activeId; handles null workspace like sidebar", () => {
    expect(src).toMatch(/activeId \? new Set\(\[activeId\]\) : new Set\(\["__none__"\]\)/);
    expect(src).toMatch(/next === "__none__"/);
    expect(src).toMatch(/setActive\(null\)/);
    expect(src).toMatch(/ensureConversationForWorkspace\(null\)/);
  });

  it("chip empty label is 不选择工作区", () => {
    expect(src).toMatch(/activeWs\?\.name \?\? "不选择工作区"/);
  });
});

describe("Composer hides ContextBar after task starts", () => {
  const src = readFileSync(composerPath, "utf8");

  it("renders ComposerContextBar only when messages.length === 0", () => {
    expect(src).toMatch(
      /conversations\[conversationId\]\?\.messages\.length/,
    );
    expect(src).toMatch(/showContextBar/);
    expect(src).toMatch(
      /\{showContextBar \? <ComposerContextBar disabled=\{disabled\} \/> : null\}/,
    );
  });
});
