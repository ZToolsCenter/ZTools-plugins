import { describe, expect, it } from "vitest";
import {
  assertPathInsideRoot,
  buildNewSkillPackage,
  buildTreeFromEntries,
  clearSkillsDiscoveryCache,
  confirmLeaveMessage,
  filterVisibleEntries,
  getSkillsDiscoveryCacheEpoch,
  isPathInsideRoot,
  isProbablyTextFile,
  isValidSkillDirName,
  normalizePath,
  shouldConfirmLeave,
  suggestNewTextFileName,
} from "../skills-editor";

describe("pathGuard", () => {
  it("normalizePath 统一斜杠并去尾 /", () => {
    expect(normalizePath("a\\b\\c")).toBe("a/b/c");
    expect(normalizePath("/foo/bar/")).toBe("/foo/bar");
    expect(normalizePath("/")).toBe("/");
  });

  it("isPathInsideRoot 正常子路径与根自身", () => {
    expect(isPathInsideRoot("/skills", "/skills")).toBe(true);
    expect(isPathInsideRoot("/skills", "/skills/foo")).toBe(true);
    expect(isPathInsideRoot("/skills", "/skills/foo/SKILL.md")).toBe(true);
    expect(isPathInsideRoot("/skills/", "/skills/foo")).toBe(true);
  });

  it("isPathInsideRoot 拒绝越界与 ../", () => {
    expect(isPathInsideRoot("/skills", "/other")).toBe(false);
    expect(isPathInsideRoot("/skills", "/skills-extra")).toBe(false);
    expect(isPathInsideRoot("/skills", "/skills/../etc")).toBe(false);
    expect(isPathInsideRoot("/skills", "/skills/foo/../../etc")).toBe(false);
  });

  it("assertPathInsideRoot 返回 ok / reason", () => {
    expect(assertPathInsideRoot("/r", "/r/a")).toEqual({ ok: true });
    const bad = assertPathInsideRoot("/r", "/x");
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.reason.length).toBeGreaterThan(0);
  });
});

describe("skillTemplate", () => {
  it("isValidSkillDirName agentskills 风格", () => {
    expect(isValidSkillDirName("chat")).toBe(true);
    expect(isValidSkillDirName("web-research")).toBe(true);
    expect(isValidSkillDirName("a1")).toBe(true);
    expect(isValidSkillDirName("")).toBe(false);
    expect(isValidSkillDirName("-foo")).toBe(false);
    expect(isValidSkillDirName("foo-")).toBe(false);
    expect(isValidSkillDirName("foo--bar")).toBe(false);
    expect(isValidSkillDirName("Foo")).toBe(false);
    expect(isValidSkillDirName("a".repeat(65))).toBe(false);
  });

  it("buildNewSkillPackage 含 frontmatter name", () => {
    const pkg = buildNewSkillPackage("My Skill", "做点事");
    expect(pkg.dirName).toBe("my-skill");
    expect(pkg.skillMdRelativePath).toBe("my-skill/SKILL.md");
    expect(pkg.skillMdContent).toContain("name: my-skill");
    expect(pkg.skillMdContent).toContain("description: 做点事");
    expect(pkg.skillMdContent.startsWith("---")).toBe(true);
  });

  it("suggestNewTextFileName 默认 notes.md", () => {
    expect(suggestNewTextFileName()).toBe("notes.md");
    expect(suggestNewTextFileName("readme.md")).toBe("readme.md");
  });
});

describe("dirtyNav", () => {
  it("shouldConfirmLeave 仅 dirty 时为 true", () => {
    expect(shouldConfirmLeave(true)).toBe(true);
    expect(shouldConfirmLeave(false)).toBe(false);
  });

  it("confirmLeaveMessage 文案", () => {
    expect(confirmLeaveMessage).toBe("有未保存的修改，确定离开？");
  });
});

describe("treeModel", () => {
  it("filterVisibleEntries 过滤点开头", () => {
    const entries = [
      { name: "visible", path: "/r/visible" },
      { name: ".hidden", path: "/r/.hidden" },
      { name: "ok.md", path: "/r/ok.md" },
    ];
    expect(filterVisibleEntries(entries).map((e) => e.name)).toEqual([
      "visible",
      "ok.md",
    ]);
  });

  it("buildTreeFromEntries 目录在前且按 name 排序", () => {
    const root = "/skills";
    const tree = buildTreeFromEntries(root, [
      {
        name: "zeta.md",
        path: "/skills/zeta.md",
        isDirectory: false,
        isFile: true,
      },
      {
        name: "alpha",
        path: "/skills/alpha",
        isDirectory: true,
        isFile: false,
      },
      {
        name: "beta",
        path: "/skills/beta",
        isDirectory: true,
        isFile: false,
      },
      {
        name: ".gitkeep",
        path: "/skills/.gitkeep",
        isDirectory: false,
        isFile: true,
      },
      {
        name: "aaa.md",
        path: "/skills/aaa.md",
        isDirectory: false,
        isFile: true,
      },
    ]);
    expect(tree.map((n) => n.name)).toEqual([
      "alpha",
      "beta",
      "aaa.md",
      "zeta.md",
    ]);
    expect(tree[0]?.kind).toBe("dir");
    expect(tree[2]?.kind).toBe("file");
  });

  it("isProbablyTextFile 白名单与二进制", () => {
    expect(isProbablyTextFile("SKILL.md")).toBe(true);
    expect(isProbablyTextFile("config.json")).toBe(true);
    expect(isProbablyTextFile("script.ts")).toBe(true);
    expect(isProbablyTextFile("Makefile")).toBe(true);
    expect(isProbablyTextFile("photo.png")).toBe(false);
    expect(isProbablyTextFile("archive.zip")).toBe(false);
  });
});

describe("discoveryCache", () => {
  it("clear 后 epoch +1", () => {
    const before = getSkillsDiscoveryCacheEpoch();
    clearSkillsDiscoveryCache();
    expect(getSkillsDiscoveryCacheEpoch()).toBe(before + 1);
  });
});
