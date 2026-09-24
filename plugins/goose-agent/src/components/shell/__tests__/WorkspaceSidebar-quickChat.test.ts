/**
 * Structural contract: bottom exclusive 「快速对话」 dock for workspaceId === null.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const sidebarPath = join(
  dirname(fileURLToPath(import.meta.url)),
  "../WorkspaceSidebar.tsx",
);

describe("WorkspaceSidebar 快速对话 dock", () => {
  const src = readFileSync(sidebarPath, "utf8");

  it("renders fixed bottom 快速对话 dock (shrink-0 + top border + scroll cap)", () => {
    expect(src).toMatch(/data-slot="quick-chat-dock"/);
    expect(src).toMatch(
      /flex min-h-0 max-h-\[min\(45%,280px\)\] shrink-0 flex-col border-t border-border-soft/,
    );
    expect(src).toMatch(/快速对话/);
    expect(src).toMatch(/aria-label="快速对话"/);
    expect(src).toMatch(/aria-label="在快速对话新建会话"/);
  });

  it("session list under dock scrolls; header stays outside scroll", () => {
    const dockIdx = src.indexOf('data-slot="quick-chat-dock"');
    expect(dockIdx).toBeGreaterThan(-1);
    const dockSlice = src.slice(dockIdx, dockIdx + 4000);
    expect(dockSlice).toMatch(/min-h-0 overflow-y-auto/);
    // restore 时同步 active workspace，null 时展开 dock
    expect(src).toMatch(/const wsId = conv\?\.workspaceId \?\? null/);
    expect(src).toMatch(/if \(!wsId\) setQuickChatExpanded\(true\)/);
  });

  it("uses null workspace handlers for quick chat select / new", () => {
    expect(src).toMatch(/ensureConversationForWorkspace\(null\)/);
    expect(src).toMatch(/handleNewSession\(null\)/);
    expect(src).toMatch(/handleSelectSession\(id, null\)/);
    expect(src).toMatch(/setActiveWs\(null\)/);
  });

  it("nests SessionGroup under dock with showNew={false}", () => {
    // dock 内 SessionGroup 与工作区一致：父行 + 新建，嵌套 hide 新会话
    const dockIdx = src.indexOf('data-slot="quick-chat-dock"');
    expect(dockIdx).toBeGreaterThan(-1);
    const dockSlice = src.slice(dockIdx, dockIdx + 3200);
    expect(dockSlice).toMatch(/showNew=\{false\}/);
    expect(dockSlice).toMatch(/sessions=\{unmountedSessions\}/);
    expect(dockSlice).toMatch(/archived=\{unmountedArchived\}/);
  });

  it("does not show mid-list user-facing 未挂载 label", () => {
    // 侧栏 chrome 用户文案用「快速对话」；「未挂载」仅允许出现在注释
    const withoutComments = src
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/[^\n]*/g, "");
    expect(withoutComments).not.toMatch(/未挂载/);
    expect(withoutComments).toMatch(/快速对话/);
  });

  it("scroll area is workspaces / empty CTA only (no mid SessionGroup title 会话)", () => {
    // 空文件夹时不再在滚动区挂 title="会话" 的 SessionGroup
    expect(src).not.toMatch(/title="会话"/);
    expect(src).toMatch(/添加本地文件夹/);
  });

  it("header keeps FolderPlus; no footer-only 添加文件夹 below dock", () => {
    expect(src).toMatch(/title="添加文件夹"/);
    // dock 是 aside 内最后一个 shrink-0 主块（快速对话）
    const lastDock = src.lastIndexOf('data-slot="quick-chat-dock"');
    const afterDock = src.slice(lastDock);
    // dock 之后不应再有「添加文件夹」按钮文案
    expect(afterDock).not.toMatch(/>\s*添加文件夹\s*</);
  });
});
