/**
 * writeFile / deletePath / renamePath 成功路径写入 useFileChanges。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useFileChanges } from "@/stores/useFileChanges";
import {
  executeDeletePath,
  executeRenamePath,
  executeWriteFile,
} from "../tools/files";
import type { AgentToolContext } from "../tools/types";

const root = "/tmp/goose-agent-ws-track";

vi.mock("@/lib/fs", () => {
  const files = new Map<string, string>();
  const dirs = new Set<string>();

  return {
    isFsAvailable: () => true,
    exists: async (p: string) => files.has(p) || dirs.has(p),
    readFile: async (p: string) => (files.has(p) ? files.get(p)! : null),
    writeFile: async (p: string, content: string) => {
      files.set(p, content);
      return true;
    },
    listDir: async (dir: string) => {
      const prefix = dir.replace(/\/+$/, "") + "/";
      const entries: Array<{
        name: string;
        path: string;
        isFile: boolean;
        isDirectory: boolean;
      }> = [];
      for (const p of files.keys()) {
        if (!p.startsWith(prefix)) continue;
        const rest = p.slice(prefix.length);
        if (!rest || rest.includes("/")) continue;
        entries.push({
          name: rest,
          path: p,
          isFile: true,
          isDirectory: false,
        });
      }
      for (const d of dirs) {
        if (!d.startsWith(prefix)) continue;
        const rest = d.slice(prefix.length);
        if (!rest || rest.includes("/")) continue;
        entries.push({
          name: rest,
          path: d,
          isFile: false,
          isDirectory: true,
        });
      }
      return entries;
    },
    mkdir: async (p: string) => {
      dirs.add(p);
      return true;
    },
    removeFile: async (p: string) => files.delete(p),
    removeDir: async (p: string) => dirs.delete(p),
    rename: async (from: string, to: string) => {
      if (files.has(from)) {
        files.set(to, files.get(from)!);
        files.delete(from);
        return true;
      }
      if (dirs.has(from)) {
        dirs.add(to);
        dirs.delete(from);
        return true;
      }
      return false;
    },
    // test helpers via module state
    __reset: () => {
      files.clear();
      dirs.clear();
    },
    __seed: (p: string, content: string) => {
      files.set(p, content);
    },
  };
});

// re-import mock helpers
import * as fs from "@/lib/fs";

type FsMock = typeof fs & {
  __reset: () => void;
  __seed: (p: string, content: string) => void;
};

const fsMock = fs as FsMock;

function ctx(conversationId?: string): AgentToolContext {
  return {
    permissionMode: "workspace-write",
    workspaceRoot: root,
    conversationId,
  };
}

beforeEach(() => {
  useFileChanges.getState().clearAll();
  fsMock.__reset();
});

describe("file tools change tracking", () => {
  it("writeFile create then modify merges in store", async () => {
    const c = ctx("c1");
    const r1 = (await executeWriteFile(
      { path: "a.txt", content: "hello" },
      c,
    )) as { ok: boolean; changeKind?: string };
    expect(r1.ok).toBe(true);
    expect(r1.changeKind).toBe("create");

    const r2 = (await executeWriteFile(
      { path: "a.txt", content: "world" },
      c,
    )) as { ok: boolean; changeKind?: string };
    expect(r2.ok).toBe(true);
    expect(r2.changeKind).toBe("modify");

    const changes = useFileChanges.getState().getChanges("c1");
    expect(changes).toHaveLength(1);
    expect(changes[0]!.kind).toBe("modify");
    expect(changes[0]!.before).toBeNull();
    expect(changes[0]!.after).toBe("world");
    expect(changes[0]!.path).toContain("a.txt");
  });

  it("skips record when conversationId missing", async () => {
    const r = (await executeWriteFile(
      { path: "b.txt", content: "x" },
      ctx(undefined),
    )) as { ok: boolean };
    expect(r.ok).toBe(true);
    expect(useFileChanges.getState().count("c1")).toBe(0);
    // 无 conversationId 时不应产生任何条目
    expect(Object.keys(useFileChanges.getState().byConversation)).toHaveLength(
      0,
    );
  });

  it("deletePath records before content and after null", async () => {
    fsMock.__seed(`${root}/del.txt`, "payload");
    const r = (await executeDeletePath({ path: "del.txt" }, ctx("c2"))) as {
      ok: boolean;
      changeKind?: string;
    };
    expect(r.ok).toBe(true);
    expect(r.changeKind).toBe("delete");
    const change = useFileChanges.getState().getChanges("c2")[0]!;
    expect(change.kind).toBe("delete");
    expect(change.before).toBe("payload");
    expect(change.after).toBeNull();
  });

  it("renamePath records under final path with fromPath", async () => {
    fsMock.__seed(`${root}/old.txt`, "same");
    const r = (await executeRenamePath(
      { from: "old.txt", to: "new.txt" },
      ctx("c3"),
    )) as { ok: boolean; changeKind?: string; from?: string; to?: string };
    expect(r.ok).toBe(true);
    expect(r.changeKind).toBe("rename");
    const changes = useFileChanges.getState().getChanges("c3");
    expect(changes).toHaveLength(1);
    expect(changes[0]!.path).toContain("new.txt");
    expect(changes[0]!.fromPath).toContain("old.txt");
    expect(changes[0]!.before).toBe("same");
    expect(changes[0]!.after).toBe("same");
  });
});
