import { expect, test } from "playwright/test";
import {
  scanLocalFolderPages,
  shouldIgnoreEntry,
  shouldIgnoreLocalRelativePath,
} from "../../src/lib/local-folder-scanner";

test.describe("local-folder-scanner shouldIgnoreEntry", () => {
  test("ignores dot folders", () => {
    const hidden = new Set<string>();
    expect(shouldIgnoreEntry(".git", hidden)).toBe(true);
    expect(shouldIgnoreEntry(".obsidian", hidden)).toBe(true);
  });

  test("ignores built-in ignored folders", () => {
    const hidden = new Set<string>();
    expect(shouldIgnoreEntry("node_modules", hidden)).toBe(true);
    expect(shouldIgnoreEntry("dist", hidden)).toBe(true);
  });

  test("ignores user-configured hidden folders", () => {
    const hidden = new Set(["assets", "obsidian"]);
    expect(shouldIgnoreEntry("assets", hidden)).toBe(true);
    expect(shouldIgnoreEntry("obsidian", hidden)).toBe(true);
  });

  test("keeps non-hidden folders", () => {
    const hidden = new Set(["assets"]);
    expect(shouldIgnoreEntry("visible", hidden)).toBe(false);
    expect(shouldIgnoreEntry("notes", hidden)).toBe(false);
  });
});

test.describe("local-folder 增量路径过滤", () => {
  test("用户隐藏目录内的新文件不会进入增量加载", () => {
    expect(shouldIgnoreLocalRelativePath("assets/new.md", ["assets"])).toBe(true);
    expect(shouldIgnoreLocalRelativePath("docs/obsidian/new.md", ["obsidian"])).toBe(true);
  });

  test("dot 与内置忽略目录的子文件保持和全量扫描一致", () => {
    expect(shouldIgnoreLocalRelativePath(".goose/history/a.md", [])).toBe(true);
    expect(shouldIgnoreLocalRelativePath(".private.md", [])).toBe(true);
    expect(shouldIgnoreLocalRelativePath("node_modules/pkg/readme.md", [])).toBe(true);
  });

  test("根目录和普通子目录 markdown 文件正常进入增量加载", () => {
    expect(shouldIgnoreLocalRelativePath("note.md", ["assets"])).toBe(false);
    expect(shouldIgnoreLocalRelativePath("docs/note.md", ["assets"])).toBe(false);
  });
});

test("本地目录扫描优先走异步文件系统桥，不触发同步 IO", async () => {
  const calls: string[] = [];
  const gooseFs = {
    readDir: () => {
      throw new Error("不应调用同步 readDir");
    },
    readDirAsync: async (dir: string) => {
      calls.push(`dir:${dir}`);
      return [
        {
          name: "note.md",
          isFile: true,
          isDirectory: false,
          path: `${dir}/note.md`,
        },
      ];
    },
    readFile: () => {
      throw new Error("不应调用同步 readFile");
    },
    readFileAsync: async (path: string) => {
      calls.push(`file:${path}`);
      return "# 异步读取\n\n正文";
    },
  } as unknown as GooseFs;

  const pages = await scanLocalFolderPages({
    notebookId: "async-test",
    basePath: "/notes",
    gooseFs,
  });

  expect(calls).toEqual(["dir:/notes", "file:/notes/note.md"]);
  expect(pages).toHaveLength(1);
  expect(pages[0]?.localFilePath).toBe("/notes/note.md");
});
