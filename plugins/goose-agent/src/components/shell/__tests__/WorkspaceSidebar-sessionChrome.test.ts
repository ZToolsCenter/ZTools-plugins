/**
 * Structural contract for ADR 0015 sidebar session chrome.
 * Reads the shipped source so UI placement cannot silently regress.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const sidebarPath = join(
  dirname(fileURLToPath(import.meta.url)),
  "../WorkspaceSidebar.tsx",
);

describe("WorkspaceSidebar session chrome (ADR 0015)", () => {
  const src = readFileSync(sidebarPath, "utf8");

  it("workspace / 快速对话 rows own new-session Plus; nested SessionGroup hides 新会话", () => {
    // 嵌套列表不再铺「新会话」行（工作区 + 快速对话均 showNew={false}）
    expect(src).toMatch(/showNew=\{false\}/);
    expect(src).toMatch(/aria-label=\{`在 \$\{ws\.name\} 新建会话`\}/);
    expect(src).toMatch(/aria-label="在快速对话新建会话"/);
    // SessionGroup 仍支持可选 showNew
    expect(src).toMatch(/showNew\?:/);
    expect(src).toMatch(/MessageSquarePlus/);
    expect(src).toMatch(/新会话/);
  });

  it("row actions are hover-revealed, not always visible", () => {
    // 行操作默认 opacity-0，hover / focus / 无悬停设备才显示
    expect(src).toMatch(/group-hover\/row:opacity-100/);
    expect(src).toMatch(/group-hover\/hdr:opacity-100/);
    expect(src).toMatch(/\[@media\(hover:none\)\]:opacity-100/);
    // 选中行不再强制常显「…」
    expect(src).not.toMatch(/active && "opacity-100"/);
  });

  it("session rows match 新会话 height (h-7) and are full width", () => {
    // 新会话：h-7 w-full（cn 多段 className，不要求同一字面量邻接）
    expect(src).toMatch(
      /inline-flex h-7 w-full items-center gap-1\.5 rounded-md px-2/,
    );
    expect(src).toMatch(/MessageSquarePlus[\s\S]{0,80}新会话/);
    // session row same h-7 w-full
    expect(src).toMatch(
      /flex h-7 w-full items-center gap-1\.5 rounded-md pl-2 pr-7/,
    );
  });

  it("idle archive + running orb, no session timestamp", () => {
    expect(src).toMatch(/title="归档"/);
    expect(src).toMatch(/LoadingState/);
    expect(src).not.toMatch(/ThinkingOrbIndicator/);
    expect(src).not.toMatch(/formatSessionTime/);
    expect(src).not.toMatch(/toLocaleTimeString/);
  });

  it("supports multi-expand and collapse-all", () => {
    expect(src).toMatch(/collapseAll/);
    expect(src).toMatch(/收起全部/);
    expect(src).toMatch(/expandedIds/);
    expect(src).toMatch(/toggleExpanded/);
  });
});
