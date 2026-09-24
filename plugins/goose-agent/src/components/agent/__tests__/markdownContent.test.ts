import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * MarkdownContent 以 streamdown 插件接入高亮/复制；
 * 此处做静态契约校验，避免再退回 controls={false} / 无 plugins。
 */
describe("MarkdownContent streamdown wiring", () => {
  const src = readFileSync(
    join(__dirname, "../MarkdownContent.tsx"),
    "utf8",
  );

  it("loads code + mermaid plugins", () => {
    expect(src).toMatch(/@streamdown\/code/);
    expect(src).toMatch(/@streamdown\/mermaid/);
    expect(src).toMatch(/plugins=\{STREAMDOWN_PLUGINS\}/);
    expect(src).toMatch(/code,\s*mermaid/);
  });

  it("enables code copy/download and mermaid controls", () => {
    expect(src).toMatch(/controls=\{CONTROLS\}/);
    expect(src).toMatch(/copy:\s*true/);
    expect(src).toMatch(/download:\s*true/);
    expect(src).not.toMatch(/controls=\{false\}/);
  });

  it("uses Chinese control labels and custom img with copy", () => {
    expect(src).toMatch(/复制代码/);
    expect(src).toMatch(/复制图片/);
    expect(src).toMatch(/img:\s*MarkdownImage/);
    expect(src).toMatch(/ClipboardItem/);
  });
});

describe("agent-md table chrome", () => {
  const css = readFileSync(join(__dirname, "../agent-chat.css"), "utf8");

  it("flattens streamdown table-wrapper double frame", () => {
    expect(css).toMatch(/\[data-streamdown="table-wrapper"\]/);
    expect(css).toMatch(
      /\.agent-md \[data-streamdown="table-wrapper"\]\s*\{[^}]*border:\s*none/s,
    );
    expect(css).toMatch(
      /table-wrapper"\] > div:last-child\s*\{[^}]*border:\s*none/s,
    );
  });
});
