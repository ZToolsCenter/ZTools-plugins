import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Sidebar, SidebarProps } from "../../src/components/Sidebar";
import { findOwningWorkspace, isPathInside, mergeLoadedWorkspaceSubtrees } from "../../src/utils/pathUtils";
import { WorkspaceScanResult } from "../../src/types/typora";

function makeWorkspace(rootDir: string, rootName: string, fileNames: string[]): WorkspaceScanResult {
  const files = fileNames.map((name, idx) => ({
    type: "file" as const,
    name,
    path: `${rootDir}/${name}`,
    relativePath: name,
    ext: ".md",
    title: name.replace(/\.md$/, ""),
    excerpt: `Excerpt for ${name}`,
    size: 120 + idx,
    mtimeMs: 1_700_000_000_000 + idx * 1000,
    birthtimeMs: 1_700_000_000_000
  }));
  return {
    rootDir,
    rootName,
    tree: {
      type: "directory",
      name: rootName,
      path: rootDir,
      relativePath: ".",
      children: files,
      childrenLoaded: true
    },
    files,
    isShallow: false
  };
}

function makeSidebarProps(overrides: Partial<SidebarProps> = {}): SidebarProps {
  return {
    width: 256,
    activeTab: "files",
    fileViewMode: "tree",
    sortField: "mtime",
    sortDirection: "desc",
    workspaces: [],
    activeFilePath: null,
    outline: [],
    activeHeadingBlockId: null,
    recentFolders: [],
    onChangeTab: () => {},
    onChangeFileViewMode: () => {},
    onChangeSort: () => {},
    onSelectFile: () => {},
    onOpenFolder: () => {},
    onAddFolder: () => {},
    onExpandDirectory: () => {},
    onRemoveWorkspaceFolder: () => {},
    onCreateFileInFolder: () => {},
    onCreateSubfolder: () => {},
    onRenameEntry: () => {},
    onDuplicateFile: () => {},
    onDeleteEntry: () => {},
    onRevealInFinder: () => {},
    onJumpToHeading: () => {},
    onRunWorkspaceSearch: () => ({ totalMatches: 0, fileCount: 0, results: [] }),
    ...overrides
  };
}

describe("pathUtils workspace matching", () => {
  it("matches exact and nested paths without matching sibling prefixes", () => {
    expect(isPathInside("/notes/work", "/notes/work")).toBe(true);
    expect(isPathInside("/notes/work/sub/a.md", "/notes/work")).toBe(true);
    expect(isPathInside("/notes/work/", "/notes/work")).toBe(true);
    expect(isPathInside("/notes/work-archive/a.md", "/notes/work")).toBe(false);
    expect(isPathInside("C:\\Notes\\Work\\a.md", "C:\\Notes\\Work")).toBe(true);
    expect(isPathInside("c:\\Notes\\Work\\a.md", "C:\\Notes\\Work")).toBe(true);
    expect(isPathInside("C:\\Notes\\Work2\\a.md", "C:\\Notes\\Work")).toBe(false);
  });

  it("preserves previously lazy-loaded subdirectory trees on shallow refresh", () => {
    const nestedFile = {
      type: "file" as const,
      name: "nested.md",
      path: "/notes/docs/nested.md",
      relativePath: "docs/nested.md",
      ext: ".md",
      title: "nested",
      excerpt: "nested",
      size: 10,
      mtimeMs: 1_700_000_000_000,
      birthtimeMs: 1_700_000_000_000
    };
    const existing: WorkspaceScanResult = {
      rootDir: "/notes",
      rootName: "notes",
      isShallow: true,
      files: [nestedFile],
      tree: {
        type: "directory",
        name: "notes",
        path: "/notes",
        relativePath: ".",
        childrenLoaded: true,
        children: [
          {
            type: "directory",
            name: "docs",
            path: "/notes/docs",
            relativePath: "docs",
            childrenLoaded: true,
            children: [nestedFile]
          }
        ]
      }
    };
    const freshShallow: WorkspaceScanResult = {
      rootDir: "/notes",
      rootName: "notes",
      isShallow: true,
      files: [],
      tree: {
        type: "directory",
        name: "notes",
        path: "/notes",
        relativePath: ".",
        childrenLoaded: true,
        children: [
          {
            type: "directory",
            name: "docs",
            path: "/notes/docs",
            relativePath: "docs",
            childrenLoaded: false,
            children: []
          }
        ]
      }
    };
    const merged = mergeLoadedWorkspaceSubtrees(freshShallow, existing);
    const docsDir = merged.tree.children[0];
    expect(docsDir.type).toBe("directory");
    if (docsDir.type === "directory") {
      expect(docsDir.childrenLoaded).toBe(true);
      expect(docsDir.children.map((c) => c.name)).toEqual(["nested.md"]);
    }
    expect(merged.files.map((f) => f.path)).toEqual(["/notes/docs/nested.md"]);
  });

  it("prefers the deepest owning workspace when folders overlap", () => {
    const outer = makeWorkspace("/notes", "notes", ["top.md"]);
    const inner = makeWorkspace("/notes/project", "project", ["spec.md"]);
    expect(findOwningWorkspace([outer, inner], "/notes/project/spec.md")?.rootDir).toBe("/notes/project");
    expect(findOwningWorkspace([outer, inner], "/notes/top.md")?.rootDir).toBe("/notes");
    expect(findOwningWorkspace([outer, inner], "/other/doc.md")).toBeNull();
  });
});

describe("Sidebar without default workspace and with multi-folder support", () => {
  it("does not render 默认工作区 or built-in sample files in the file library", () => {
    const html = renderToStaticMarkup(React.createElement(Sidebar, makeSidebarProps()));
    expect(html).not.toContain("默认工作区");
    expect(html).not.toContain("Welcome &amp; Quick Start.md");
    expect(html).not.toContain("Markdown Reference.md");
    expect(html).toContain("打开文件夹...");
  });

  it("renders multiple workspace folders and their files in tree view", () => {
    const wsA = makeWorkspace("/tmp/alpha", "alpha", ["alpha-note.md"]);
    const wsB = makeWorkspace("/tmp/beta", "beta", ["beta-note.md"]);
    const html = renderToStaticMarkup(
      React.createElement(
        Sidebar,
        makeSidebarProps({
          workspaces: [wsA, wsB]
        })
      )
    );
    expect(html).toContain("工作区 (2 个文件夹)");
    expect(html).toContain("alpha");
    expect(html).toContain("beta");
    expect(html).toContain("alpha-note.md");
    expect(html).toContain("beta-note.md");
    expect(html).toContain("添加文件夹...");
    expect(html).toContain('data-testid="sidebar-add-folder-btn"');
  });

  it("aggregates files from all added folders in list view", () => {
    const wsA = makeWorkspace("/tmp/alpha", "alpha", ["alpha-note.md"]);
    const wsB = makeWorkspace("/tmp/beta", "beta", ["beta-note.md"]);
    const html = renderToStaticMarkup(
      React.createElement(
        Sidebar,
        makeSidebarProps({
          fileViewMode: "list",
          workspaces: [wsA, wsB]
        })
      )
    );
    expect(html).toContain("alpha-note.md");
    expect(html).toContain("beta-note.md");
  });

  it("shows multi-folder search placeholder when multiple folders are added", () => {
    const wsA = makeWorkspace("/tmp/alpha", "alpha", ["alpha-note.md"]);
    const wsB = makeWorkspace("/tmp/beta", "beta", ["beta-note.md"]);
    const html = renderToStaticMarkup(
      React.createElement(
        Sidebar,
        makeSidebarProps({
          activeTab: "search",
          workspaces: [wsA, wsB]
        })
      )
    );
    expect(html).toContain("在 2 个文件夹中搜索...");
  });
});
