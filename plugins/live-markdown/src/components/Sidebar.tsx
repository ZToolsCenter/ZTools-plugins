import React, { useEffect, useMemo, useState } from "react";
import {
  ArrowUpDown,
  ChevronDown,
  ChevronRight,
  Cloud,
  Copy,
  DownloadCloud,
  Edit3,
  ExternalLink,
  FilePlus,
  FileText,
  Folder,
  FolderOpen,
  FolderPlus,
  List,
  ListTree,
  RefreshCw,
  Search,
  Settings,
  Trash2,
  UploadCloud,
  X
} from "lucide-react";
import { findOwningWorkspace, isPathInside } from "../utils/pathUtils";
import {
  FileViewMode,
  OutlineItem,
  SidebarTab,
  SortDirection,
  SortField,
  WebdavRemoteFile,
  WorkspaceDirectoryNode,
  WorkspaceFileNode,
  WorkspaceScanResult,
  WorkspaceSearchResponse
} from "../types/typora";

export interface SidebarProps {
  width: number;
  activeTab: SidebarTab;
  fileViewMode: FileViewMode;
  sortField: SortField;
  sortDirection: SortDirection;
  workspaces: WorkspaceScanResult[];
  activeFilePath: string | null;
  outline: OutlineItem[];
  activeHeadingBlockId: string | null;
  recentFolders: string[];
  webdavEnabled?: boolean;
  webdavSyncState?: "idle" | "testing" | "syncing" | "success" | "error";
  webdavRemoteFiles?: WebdavRemoteFile[];
  onChangeTab: (tab: SidebarTab) => void;
  onChangeFileViewMode: (mode: FileViewMode) => void;
  onChangeSort: (field: SortField, dir: SortDirection) => void;
  onSelectFile: (filePath: string, jumpToLine?: number) => void;
  onOpenFolder: (folderPath?: string) => void;
  onAddFolder?: () => void;
  onExpandDirectory?: (dirPath: string) => void;
  onRemoveWorkspaceFolder?: (folderPath: string) => void;
  onCreateFileInFolder: (parentDir: string) => void;
  onCreateSubfolder: (parentDir: string) => void;
  onRenameEntry: (targetPath: string, currentName: string) => void;
  onDuplicateFile: (filePath: string) => void;
  onDeleteEntry: (targetPath: string, name: string) => void;
  onRevealInFinder: (targetPath: string) => void;
  onJumpToHeading: (blockId: string) => void;
  onRunWorkspaceSearch: (
    query: string,
    options: { caseSensitive: boolean; wholeWord: boolean; isRegex: boolean }
  ) => WorkspaceSearchResponse;
  onSyncWebdavNow?: () => void;
  onPushCurrentDocToWebdav?: () => void;
  onPullWebdavFile?: (fileName: string) => void;
  onOpenWebdavSettings?: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  width,
  activeTab,
  fileViewMode,
  sortField,
  sortDirection,
  workspaces,
  activeFilePath,
  outline,
  activeHeadingBlockId,
  recentFolders,
  webdavEnabled = false,
  webdavSyncState = "idle",
  webdavRemoteFiles = [],
  onChangeTab,
  onChangeFileViewMode,
  onChangeSort,
  onSelectFile,
  onOpenFolder,
  onAddFolder,
  onExpandDirectory,
  onRemoveWorkspaceFolder,
  onCreateFileInFolder,
  onCreateSubfolder,
  onRenameEntry,
  onDuplicateFile,
  onDeleteEntry,
  onRevealInFinder,
  onJumpToHeading,
  onRunWorkspaceSearch,
  onSyncWebdavNow,
  onPushCurrentDocToWebdav,
  onPullWebdavFile,
  onOpenWebdavSettings
}) => {
  const [expandedDirs, setExpandedDirs] = useState<Record<string, boolean>>({});
  const [collapsedHeadings, setCollapsedHeadings] = useState<Record<string, boolean>>({});
  const [outlineFilter, setOutlineFilter] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [wholeWord, setWholeWord] = useState(false);
  const [isRegex, setIsRegex] = useState(false);
  const [showSortMenu, setShowSortMenu] = useState(false);
  const [folderContextMenu, setFolderContextMenu] = useState<{
    open: boolean;
    x: number;
    y: number;
    folderPath: string;
    folderName: string;
  } | null>(null);

  const allWorkspaces = workspaces;
  const activeWorkspace = useMemo(
    () => findOwningWorkspace(allWorkspaces, activeFilePath) ?? allWorkspaces[0] ?? null,
    [allWorkspaces, activeFilePath]
  );

  const rootDirSet = useMemo(
    () => new Set(allWorkspaces.map((w) => w.tree.path)),
    [allWorkspaces]
  );

  const [webdavExpanded, setWebdavExpanded] = useState<boolean>(
    () => Boolean(webdavRemoteFiles && webdavRemoteFiles.length > 0)
  );

  useEffect(() => {
    if (webdavRemoteFiles && webdavRemoteFiles.length > 0) {
      setWebdavExpanded(true);
    }
  }, [webdavRemoteFiles.length]);

  const isDirExpanded = (dirPath: string): boolean => {
    if (dirPath in expandedDirs) {
      return Boolean(expandedDirs[dirPath]);
    }
    if (rootDirSet.has(dirPath)) {
      return true;
    }
    if (activeFilePath && isPathInside(activeFilePath, dirPath)) {
      return true;
    }
    return false;
  };

  const toggleDir = (node: WorkspaceDirectoryNode) => {
    const currentlyExpanded = isDirExpanded(node.path);
    const willExpand = !currentlyExpanded;
    if (willExpand && node.childrenLoaded === false) {
      onExpandDirectory?.(node.path);
    }
    setExpandedDirs((prev) => ({
      ...prev,
      [node.path]: willExpand
    }));
  };

  const sortedFlatFiles = useMemo(() => {
    if (allWorkspaces.length === 0) return [];
    const seen = new Set<string>();
    const list: Array<WorkspaceFileNode & { rootName: string }> = [];
    for (const ws of allWorkspaces) {
      for (const file of ws.files) {
        if (seen.has(file.path)) continue;
        seen.add(file.path);
        list.push({ ...file, rootName: ws.rootName });
      }
    }
    list.sort((a, b) => {
      let cmp = 0;
      if (sortField === "name") {
        cmp = a.name.localeCompare(b.name, "zh-CN", { numeric: true });
      } else {
        cmp = a.mtimeMs - b.mtimeMs;
      }
      return sortDirection === "asc" ? cmp : -cmp;
    });
    return list;
  }, [allWorkspaces, sortField, sortDirection]);

  const filteredOutline = useMemo(() => {
    const q = outlineFilter.trim().toLowerCase();
    if (!q) return outline;
    return outline.filter((item) => item.text.toLowerCase().includes(q));
  }, [outline, outlineFilter]);

  const visibleOutline = useMemo(() => {
    if (outlineFilter.trim()) return filteredOutline;
    const result: OutlineItem[] = [];
    let hiddenBelowLevel: number | null = null;

    for (const item of outline) {
      if (hiddenBelowLevel !== null) {
        if (item.level > hiddenBelowLevel) {
          continue;
        }
        hiddenBelowLevel = null;
      }
      result.push(item);
      if (collapsedHeadings[item.id]) {
        hiddenBelowLevel = item.level;
      }
    }
    return result;
  }, [outline, filteredOutline, outlineFilter, collapsedHeadings]);

  const searchResponse = useMemo(() => {
    if (allWorkspaces.length === 0 || !searchQuery.trim()) {
      return { totalMatches: 0, fileCount: 0, results: [] };
    }
    try {
      return onRunWorkspaceSearch(searchQuery, {
        caseSensitive,
        wholeWord,
        isRegex
      });
    } catch {
      return { totalMatches: 0, fileCount: 0, results: [] };
    }
  }, [allWorkspaces, searchQuery, caseSensitive, wholeWord, isRegex, onRunWorkspaceSearch]);

  const renderTreeNode = (
    node: WorkspaceDirectoryNode | WorkspaceFileNode,
    depth: number
  ): React.ReactNode => {
    if (node.type === "directory") {
      const isCollapsed = !isDirExpanded(node.path);
      return (
        <div key={node.path}>
          <div
            className="ty-tree-row ty-tree-dir-row"
            title={node.name}
            data-full-title={node.name}
            style={{ paddingLeft: `${10 + depth * 14}px` }}
            onClick={() => toggleDir(node)}
          >
            {isCollapsed ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
            <Folder size={13} className="ty-tree-folder-icon" />
            <span
              className="ty-tree-node-label"
              title={node.name}
              data-full-title={node.name}
            >
              {node.name}
            </span>
            <span
              className="ty-tree-row-actions"
              onClick={(e) => e.stopPropagation()}
            >
              <button
                type="button"
                className="ty-icon-btn ty-tree-action-btn"
                title="在此文件夹新建 Markdown"
                onClick={() => {
                  setExpandedDirs((prev) => ({ ...prev, [node.path]: true }));
                  onCreateFileInFolder(node.path);
                }}
              >
                <FilePlus size={11} />
              </button>
            </span>
          </div>
          {!isCollapsed &&
            (node.children.length > 0 ? (
              node.children.map((child) => renderTreeNode(child, depth + 1))
            ) : (
              <div
                style={{
                  padding: `4px 10px 4px ${26 + depth * 14}px`,
                  fontSize: 11.5,
                  color: "var(--muted-text-color)",
                  opacity: 0.75
                }}
              >
                （空目录）
              </div>
            ))}
        </div>
      );
    }

    const isActive = activeFilePath === node.path;
    return (
      <div
        key={node.path}
        className={`ty-tree-row ${isActive ? "is-active" : ""}`}
        title={node.name}
        data-full-title={node.name}
        style={{ paddingLeft: `${18 + depth * 14}px` }}
        onClick={() => onSelectFile(node.path)}
      >
        <FileText size={13} className="ty-tree-file-icon" />
        <span
          className="ty-tree-node-label"
          title={node.relativePath || node.name}
          data-full-title={node.name}
        >
          {node.name}
        </span>
        <span
          className="ty-tree-row-actions"
          onClick={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            className="ty-icon-btn ty-tree-action-btn"
            title="重命名"
            onClick={() => onRenameEntry(node.path, node.name)}
          >
            <Edit3 size={11} />
          </button>
          <button
            type="button"
            className="ty-icon-btn ty-tree-action-btn"
            title="复制副本"
            onClick={() => onDuplicateFile(node.path)}
          >
            <Copy size={11} />
          </button>
          <button
            type="button"
            className="ty-icon-btn ty-tree-action-btn"
            title="删除文件"
            onClick={() => onDeleteEntry(node.path, node.name)}
          >
            <Trash2 size={11} />
          </button>
        </span>
      </div>
    );
  };

  return (
    <aside id="typora-sidebar" style={{ width: `${width}px` }}>
      {/* Top 3-Tab Switcher: Files / Outline / Search */}
      <div className="ty-sidebar-header">
        <button
          type="button"
          className={`ty-sidebar-tab ${activeTab === "files" ? "is-active" : ""}`}
          onClick={() => onChangeTab("files")}
        >
          <Folder size={13} />
          <span>文件</span>
        </button>
        <button
          type="button"
          className={`ty-sidebar-tab ${activeTab === "outline" ? "is-active" : ""}`}
          onClick={() => onChangeTab("outline")}
        >
          <List size={13} />
          <span>大纲</span>
        </button>
        <button
          type="button"
          className={`ty-sidebar-tab ${activeTab === "search" ? "is-active" : ""}`}
          onClick={() => onChangeTab("search")}
        >
          <Search size={13} />
          <span>搜索</span>
        </button>
      </div>

      {/* Tab 1: Files */}
      {activeTab === "files" && (
        <div className="ty-sidebar-file-wrapper">
          <div className="ty-sidebar-subbar">
            <span
              style={{
                fontSize: 11.5,
                fontWeight: 600,
                color: "var(--muted-text-color)",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap"
              }}
              title={allWorkspaces.length > 0 ? allWorkspaces.map((w) => w.rootDir).join("\n") : "本地工作区"}
            >
              {allWorkspaces.length > 1
                ? `工作区 (${allWorkspaces.length} 个文件夹)`
                : allWorkspaces[0]?.rootName || "工作区"}
            </span>
            <div style={{ display: "flex", alignItems: "center", gap: 3 }}>
              <button
                type="button"
                className="ty-icon-btn"
                data-testid="sidebar-add-folder-btn"
                onClick={() => (onAddFolder ? onAddFolder() : onOpenFolder())}
                title="添加文件夹到工作区..."
              >
                <FolderPlus size={13} />
              </button>
              <button
                type="button"
                className={`ty-icon-btn ${fileViewMode === "tree" ? "is-active" : ""}`}
                onClick={() => onChangeFileViewMode("tree")}
                title="树形视图 (File Tree)"
              >
                <ListTree size={13} />
              </button>
              <button
                type="button"
                className={`ty-icon-btn ${fileViewMode === "list" ? "is-active" : ""}`}
                onClick={() => onChangeFileViewMode("list")}
                title="文章列表视图 (File List)"
              >
                <List size={13} />
              </button>
              <div style={{ position: "relative" }}>
                <button
                  type="button"
                  className="ty-icon-btn"
                  onClick={() => setShowSortMenu((v) => !v)}
                  title="排序方式"
                >
                  <ArrowUpDown size={13} />
                </button>
                {showSortMenu && (
                  <div
                    className="ty-menu-dropdown"
                    style={{ right: 0, left: "auto", minWidth: 165 }}
                  >
                    <button
                      type="button"
                      className="ty-menu-option"
                      onClick={() => {
                        onChangeSort("name", "asc");
                        setShowSortMenu(false);
                      }}
                    >
                      <span>
                        {sortField === "name" && sortDirection === "asc" ? "✓ " : ""}
                        按名称升序 (A→Z)
                      </span>
                    </button>
                    <button
                      type="button"
                      className="ty-menu-option"
                      onClick={() => {
                        onChangeSort("name", "desc");
                        setShowSortMenu(false);
                      }}
                    >
                      <span>
                        {sortField === "name" && sortDirection === "desc" ? "✓ " : ""}
                        按名称降序 (Z→A)
                      </span>
                    </button>
                    <button
                      type="button"
                      className="ty-menu-option"
                      onClick={() => {
                        onChangeSort("mtime", "desc");
                        setShowSortMenu(false);
                      }}
                    >
                      <span>
                        {sortField === "mtime" && sortDirection === "desc" ? "✓ " : ""}
                        按修改时间 (最新优先)
                      </span>
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="ty-sidebar-content ty-sidebar-content-scroll" id="file-library">
            {/* 打开文件夹添加的工作区目录树 (可添加多个文件夹，支持右键移除) */}
            {allWorkspaces.length > 0 ? (
              fileViewMode === "tree" ? (
                allWorkspaces.map((ws) => (
                  <div key={ws.rootDir} style={{ marginTop: 2 }}>
                    <div
                      className="ty-tree-row ty-tree-dir-row"
                      title={`${ws.rootName}\n路径: ${ws.rootDir}\n(右键可从工作区移除)`}
                      data-full-title={ws.rootName}
                      style={{ paddingLeft: "10px", fontWeight: 600 }}
                      onClick={() => toggleDir(ws.tree)}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        setFolderContextMenu({
                          open: true,
                          x: e.clientX,
                          y: e.clientY,
                          folderPath: ws.rootDir,
                          folderName: ws.rootName
                        });
                      }}
                    >
                      {isDirExpanded(ws.tree.path) ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                      <Folder size={13} className="ty-tree-folder-icon" />
                      <span className="ty-tree-node-label">{ws.rootName}</span>
                      <span className="ty-tree-row-actions" onClick={(e) => e.stopPropagation()}>
                        <button
                          type="button"
                          className="ty-icon-btn ty-tree-action-btn"
                          title="在此文件夹新建 Markdown"
                          onClick={() => onCreateFileInFolder(ws.rootDir)}
                        >
                          <FilePlus size={11} />
                        </button>
                        <button
                          type="button"
                          className="ty-icon-btn ty-tree-action-btn"
                          title="新建子文件夹"
                          onClick={() => onCreateSubfolder(ws.rootDir)}
                        >
                          <FolderPlus size={11} />
                        </button>
                        <button
                          type="button"
                          className="ty-icon-btn ty-tree-action-btn"
                          title={`从工作区移除 ${ws.rootName}`}
                          onClick={() => onRemoveWorkspaceFolder?.(ws.rootDir)}
                        >
                          <X size={11} />
                        </button>
                      </span>
                    </div>
                    {isDirExpanded(ws.tree.path) && (
                      ws.tree.children.length > 0 ? (
                        ws.tree.children.map((child) => renderTreeNode(child, 1))
                      ) : (
                        <div style={{ padding: "4px 10px 4px 28px", fontSize: 11, color: "var(--muted-text-color)" }}>
                          （空目录）
                        </div>
                      )
                    )}
                  </div>
                ))
              ) : (
                sortedFlatFiles.map((file) => {
                  const isActive = activeFilePath === file.path;
                  const dateStr = new Date(file.mtimeMs).toLocaleDateString(
                    "zh-CN",
                    { month: "short", day: "numeric" }
                  );
                  return (
                    <div
                      key={file.path}
                      className={`ty-article-card ${isActive ? "is-active" : ""}`}
                      title={allWorkspaces.length > 1 ? `${file.rootName}/${file.relativePath}` : file.name}
                      data-full-title={file.name}
                      onClick={() => onSelectFile(file.path)}
                    >
                      <div
                        className="ty-article-title"
                        title={file.name}
                        data-full-title={file.name}
                      >
                        <span title={file.name}>{file.name}</span>
                        <span style={{ fontSize: 11, fontWeight: 400, color: "var(--muted-text-color)" }}>
                          {allWorkspaces.length > 1 ? `${file.rootName} · ${dateStr}` : dateStr}
                        </span>
                      </div>
                      <div className="ty-article-excerpt">
                        {file.excerpt || "（空白文档）"}
                      </div>
                    </div>
                  );
                })
              )
            ) : (
              <div style={{ padding: "10px 14px", fontSize: 12 }}>
                <p style={{ color: "var(--muted-text-color)", marginTop: 0, marginBottom: 8, fontSize: 11.5 }}>
                  打开本地文件夹即可添加至工作区，支持同时添加多个文件夹。
                </p>
                <button
                  type="button"
                  className="ty-icon-btn is-active"
                  style={{ width: "100%", justifyContent: "center", padding: "6px 10px" }}
                  onClick={() => onOpenFolder()}
                >
                  <FolderOpen size={14} />
                  <span>打开文件夹...</span>
                </button>
                {recentFolders.length > 0 && (
                  <div style={{ marginTop: 12 }}>
                    <div style={{ fontSize: 11, fontWeight: 600, color: "var(--muted-text-color)", marginBottom: 4 }}>
                      最近打开的目录
                    </div>
                    {recentFolders.map((dir) => (
                      <div key={dir} className="ty-tree-row" onClick={() => onOpenFolder(dir)} title={dir}>
                        <Folder size={12} />
                        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {dir.split(/[\\/]/).pop() || dir}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Section 2: WebDAV 云同步 (同级可折叠面板) */}
          <div className="ty-sidebar-webdav-dock" data-testid="sidebar-webdav-section">
            <div
              className="ty-sidebar-webdav-dock-header"
              onClick={() => setWebdavExpanded((v) => !v)}
              title="点击展开 / 折叠 WebDAV 云同步列表"
            >
              <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
                {webdavExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                <Cloud size={13} color="var(--primary-color)" />
                <span>WebDAV 云同步 ({webdavRemoteFiles.length})</span>
              </span>
              <span style={{ display: "inline-flex", gap: 3 }} onClick={(e) => e.stopPropagation()}>
                {webdavEnabled && (
                  <>
                    <button
                      type="button"
                      className="ty-icon-btn"
                      style={{ padding: "1px 4px" }}
                      title="上传当前文档到 WebDAV"
                      data-testid="sidebar-webdav-push-btn"
                      onClick={() => onPushCurrentDocToWebdav?.()}
                    >
                      <UploadCloud size={12} />
                    </button>
                    <button
                      type="button"
                      className="ty-icon-btn"
                      style={{ padding: "1px 4px" }}
                      title="立即同步 WebDAV"
                      data-testid="sidebar-webdav-sync-btn"
                      onClick={() => onSyncWebdavNow?.()}
                    >
                      <RefreshCw
                        size={12}
                        className={
                          webdavSyncState === "syncing" || webdavSyncState === "testing"
                            ? "ty-spin"
                            : ""
                        }
                      />
                    </button>
                  </>
                )}
                <button
                  type="button"
                  className="ty-icon-btn"
                  style={{ padding: "1px 4px" }}
                  title="WebDAV 云同步设置"
                  data-testid="sidebar-webdav-settings-btn"
                  onClick={() => onOpenWebdavSettings?.()}
                >
                  <Settings size={12} />
                </button>
              </span>
            </div>

            {webdavExpanded && (
              <div className="ty-sidebar-webdav-dock-body">
                {webdavEnabled ? (
                  webdavRemoteFiles.length === 0 ? (
                    <div
                      style={{
                        padding: "8px 12px 10px",
                        fontSize: 11.5,
                        color: "var(--muted-text-color)"
                      }}
                    >
                      云端目录暂无文档，可点击上方上传或同步按钮。
                    </div>
                  ) : (
                    webdavRemoteFiles.map((remoteFile) => (
                      <div
                        key={remoteFile.href || remoteFile.name}
                        className="ty-tree-row"
                        data-testid={`sidebar-webdav-file-${remoteFile.name}`}
                        onClick={() => onPullWebdavFile?.(remoteFile.name)}
                        title={`点击从 WebDAV 拉取并打开: ${remoteFile.name}`}
                      >
                        <DownloadCloud size={12} className="ty-tree-file-icon" />
                        <span className="ty-tree-node-label">{remoteFile.name}</span>
                      </div>
                    ))
                  )
                ) : (
                  <div style={{ padding: "6px 12px 10px" }}>
                    <button
                      type="button"
                      className="ty-icon-btn"
                      data-testid="sidebar-open-webdav-settings"
                      style={{
                        width: "100%",
                        justifyContent: "center",
                        padding: "6px 10px",
                        border: "1px dashed var(--border-color)",
                        fontSize: 11.5
                      }}
                      onClick={() => onOpenWebdavSettings?.()}
                    >
                      <Cloud size={13} />
                      <span>配置 WebDAV 云同步...</span>
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Tab 2: Outline (#outline-content) */}
      {activeTab === "outline" && (
        <>
          <div className="ty-sidebar-subbar">
            <input
              type="text"
              className="ty-sidebar-input"
              placeholder="过滤大纲标题..."
              value={outlineFilter}
              onChange={(e) => setOutlineFilter(e.target.value)}
            />
          </div>
          <div className="ty-sidebar-content" id="outline-content">
            {visibleOutline.length === 0 ? (
              <div
                style={{
                  padding: "18px 14px",
                  fontSize: 12,
                  color: "var(--muted-text-color)"
                }}
              >
                当前文档暂无标题大纲（使用 `# 标题` 创建章节）。
              </div>
            ) : (
              visibleOutline.map((item, idx) => {
                const isActive = activeHeadingBlockId === item.blockId;
                const nextItem = outline[outline.indexOf(item) + 1];
                const hasChildren = Boolean(
                  nextItem && nextItem.level > item.level
                );
                const isCollapsed = Boolean(collapsedHeadings[item.id]);

                return (
                  <div
                    key={item.id || idx}
                    className={`ty-outline-item ${isActive ? "is-active" : ""}`}
                    title={item.text}
                    data-full-title={item.text}
                    style={{
                      paddingLeft: `${10 + (item.level - 1) * 14}px`
                    }}
                    onClick={() => onJumpToHeading(item.blockId)}
                  >
                    {hasChildren ? (
                      <span
                        onClick={(e) => {
                          e.stopPropagation();
                          setCollapsedHeadings((prev) => ({
                            ...prev,
                            [item.id]: !prev[item.id]
                          }));
                        }}
                        style={{ display: "inline-flex", alignItems: "center" }}
                      >
                        {isCollapsed ? (
                          <ChevronRight size={12} />
                        ) : (
                          <ChevronDown size={12} />
                        )}
                      </span>
                    ) : (
                      <span style={{ width: 12, display: "inline-block" }} />
                    )}
                    <span
                      className="ty-outline-text"
                      title={item.text}
                      data-full-title={item.text}
                    >
                      {item.text}
                    </span>
                  </div>
                );
              })
            )}
          </div>
        </>
      )}

      {/* Tab 3: Workspace Global Search */}
      {activeTab === "search" && (
        <>
          <div
            className="ty-sidebar-subbar"
            style={{ flexDirection: "column", alignItems: "stretch" }}
          >
            <input
              type="text"
              className="ty-sidebar-input"
              placeholder={
                allWorkspaces.length > 1
                  ? `在 ${allWorkspaces.length} 个文件夹中搜索...`
                  : allWorkspaces.length === 1
                    ? `在 ${allWorkspaces[0].rootName} 中搜索...`
                    : "请先打开文件夹以跨文件搜索"
              }
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                fontSize: 11
              }}
            >
              <span style={{ color: "var(--muted-text-color)" }}>
                {searchQuery.trim()
                  ? `${searchResponse.totalMatches} 处匹配 (${searchResponse.fileCount} 个文件)`
                  : "支持大小写 / 全词 / 正则"}
              </span>
              <span style={{ display: "inline-flex", gap: 3 }}>
                <button
                  type="button"
                  className={`ty-icon-btn ${caseSensitive ? "is-active" : ""}`}
                  style={{ padding: "1px 5px" }}
                  onClick={() => setCaseSensitive((v) => !v)}
                  title="区分大小写 (Match Case)"
                >
                  Aa
                </button>
                <button
                  type="button"
                  className={`ty-icon-btn ${wholeWord ? "is-active" : ""}`}
                  style={{ padding: "1px 5px" }}
                  onClick={() => setWholeWord((v) => !v)}
                  title="全词匹配 (Whole Word)"
                >
                  \b
                </button>
                <button
                  type="button"
                  className={`ty-icon-btn ${isRegex ? "is-active" : ""}`}
                  style={{ padding: "1px 5px" }}
                  onClick={() => setIsRegex((v) => !v)}
                  title="正则表达式 (Regular Expression)"
                >
                  .*
                </button>
              </span>
            </div>
          </div>

          <div className="ty-sidebar-content">
            {allWorkspaces.length === 0 ? (
              <div style={{ padding: "14px 12px", fontSize: 12 }}>
                <button
                  type="button"
                  className="ty-icon-btn is-active"
                  style={{ width: "100%", justifyContent: "center", padding: "7px" }}
                  onClick={() => onOpenFolder()}
                >
                  <FolderOpen size={13} />
                  <span>打开文件夹以启用全局搜索</span>
                </button>
              </div>
            ) : (
              searchResponse.results.map((fileRes) => (
                <div
                  key={fileRes.path}
                  style={{
                    borderBottom: "1px solid var(--side-bar-border-color)",
                    padding: "6px 10px"
                  }}
                >
                  <div
                    style={{
                      fontSize: 12,
                      fontWeight: 600,
                      display: "flex",
                      justifyContent: "space-between",
                      cursor: "pointer"
                    }}
                    onClick={() => onSelectFile(fileRes.path)}
                  >
                    <span>{fileRes.name}</span>
                    <span style={{ color: "var(--muted-text-color)", fontSize: 11 }}>
                      {fileRes.matches.length}
                    </span>
                  </div>
                  {fileRes.matches.slice(0, 12).map((m, idx) => (
                    <div
                      key={idx}
                      className="ty-tree-row"
                      style={{
                        padding: "3px 6px",
                        fontSize: 11.5,
                        fontFamily: "var(--font-monospace)"
                      }}
                      onClick={() => onSelectFile(fileRes.path, m.lineNumber)}
                    >
                      <span style={{ color: "var(--muted-text-color)", minWidth: 26 }}>
                        L{m.lineNumber}
                      </span>
                      <span
                        style={{
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap"
                        }}
                      >
                        {m.lineText}
                      </span>
                    </div>
                  ))}
                </div>
              ))
            )}
          </div>
        </>
      )}

      {/* Sidebar Bottom Bar */}
      <div className="ty-sidebar-footer">
        <button
          type="button"
          className="ty-icon-btn"
          onClick={() =>
            activeWorkspace
              ? onCreateFileInFolder(activeWorkspace.rootDir)
              : onOpenFolder()
          }
        >
          <FilePlus size={12} />
          <span>{activeWorkspace ? "新建文件" : "打开目录"}</span>
        </button>
        <button
          type="button"
          className="ty-icon-btn"
          data-testid={allWorkspaces.length > 0 ? "sidebar-footer-add-folder-btn" : "sidebar-footer-open-folder-btn"}
          onClick={() => (allWorkspaces.length > 0 && onAddFolder ? onAddFolder() : onOpenFolder())}
          title={allWorkspaces.length > 0 ? "添加更多文件夹到工作区" : "打开文件夹"}
        >
          {allWorkspaces.length > 0 ? <FolderPlus size={12} /> : <FolderOpen size={12} />}
          <span>{allWorkspaces.length > 0 ? "添加文件夹..." : "打开文件夹..."}</span>
        </button>
      </div>
      {folderContextMenu && folderContextMenu.open && (
        <div className="ty-context-backdrop" onClick={() => setFolderContextMenu(null)}>
          <div
            className="ty-editor-context-menu"
            style={{ left: Math.min(folderContextMenu.x, window.innerWidth - 220), top: Math.min(folderContextMenu.y, window.innerHeight - 150), minWidth: 180 }}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              className="ty-context-item"
              onClick={() => {
                if (onAddFolder) onAddFolder();
                else onOpenFolder();
                setFolderContextMenu(null);
              }}
            >
              <FolderPlus size={13} />
              <span>添加文件夹到工作区...</span>
            </button>
            <button
              type="button"
              className="ty-context-item"
              onClick={() => {
                onRevealInFinder(folderContextMenu.folderPath);
                setFolderContextMenu(null);
              }}
            >
              <ExternalLink size={13} />
              <span>在 Finder 中显示</span>
            </button>
            <div className="ty-menu-divider" />
            <button
              type="button"
              className="ty-context-item"
              style={{ color: "#ef4444" }}
              onClick={() => {
                onRemoveWorkspaceFolder?.(folderContextMenu.folderPath);
                setFolderContextMenu(null);
              }}
            >
              <Trash2 size={13} color="#ef4444" />
              <span>从工作区移除文件夹</span>
            </button>
          </div>
        </div>
      )}
    </aside>
  );
};
