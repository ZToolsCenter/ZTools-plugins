import { describe, expect, it } from "vitest";
import {
  normalizePathSlashes,
  pathBasename,
  pathDirname,
  toWorkspaceRelativePath,
} from "../displayPath";

describe("normalizePathSlashes", () => {
  it("统一反斜杠并去尾部 /", () => {
    expect(normalizePathSlashes("a\\b\\c\\")).toBe("a/b/c");
    expect(normalizePathSlashes("/foo/bar/")).toBe("/foo/bar");
  });

  it("保留 Unix 根", () => {
    expect(normalizePathSlashes("/")).toBe("/");
  });
});

describe("toWorkspaceRelativePath", () => {
  const root = "/Users/me/project";

  it("正常相对化", () => {
    expect(
      toWorkspaceRelativePath("/Users/me/project/src/components/foo.tsx", root),
    ).toBe("src/components/foo.tsx");
  });

  it("root 本身 → .", () => {
    expect(toWorkspaceRelativePath(root, root)).toBe(".");
    expect(toWorkspaceRelativePath(`${root}/`, root)).toBe(".");
  });

  it("不在 root 下 → 规范后的原路径", () => {
    expect(toWorkspaceRelativePath("/other/place/a.ts", root)).toBe(
      "/other/place/a.ts",
    );
  });

  it("Windows 风格反斜杠", () => {
    expect(
      toWorkspaceRelativePath(
        "C:\\Users\\me\\project\\src\\a.ts",
        "C:\\Users\\me\\project",
      ),
    ).toBe("src/a.ts");
  });

  it("null / 空 root 返回规范 path", () => {
    expect(toWorkspaceRelativePath("/Users/me/project/a.ts", null)).toBe(
      "/Users/me/project/a.ts",
    );
    expect(toWorkspaceRelativePath("/Users/me/project/a.ts", undefined)).toBe(
      "/Users/me/project/a.ts",
    );
    expect(toWorkspaceRelativePath("/Users/me/project/a.ts", "")).toBe(
      "/Users/me/project/a.ts",
    );
  });

  it("mac 大小写不敏感前缀，切片保留原大小写", () => {
    expect(
      toWorkspaceRelativePath(
        "/Users/Me/Project/Src/Foo.tsx",
        "/users/me/project",
      ),
    ).toBe("Src/Foo.tsx");
  });
});

describe("pathBasename / pathDirname", () => {
  it("basename", () => {
    expect(pathBasename("src/components/foo.tsx")).toBe("foo.tsx");
    expect(pathBasename("/Users/me/a.ts")).toBe("a.ts");
    expect(pathBasename("a\\b\\c.ts")).toBe("c.ts");
  });

  it("dirname：相对展示；. 或空 → \"\"", () => {
    expect(pathDirname("src/components/foo.tsx")).toBe("src/components");
    expect(pathDirname("foo.tsx")).toBe("");
    expect(pathDirname(".")).toBe("");
    expect(pathDirname("")).toBe("");
  });
});
