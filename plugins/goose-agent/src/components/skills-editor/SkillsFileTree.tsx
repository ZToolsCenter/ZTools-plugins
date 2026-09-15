/**
 * 技能编辑：左侧懒加载文件树。
 */

import { useCallback, useEffect, useState } from "react";
import { ChevronDown, ChevronRight, FileText, Folder } from "lucide-react";
import { exists, listDir, type DirEntry } from "@/lib/fs";
import { cn } from "@/lib/utils";

export type TreeNodeKind = "dir" | "file";

export interface SkillsTreeNode {
  name: string;
  path: string;
  kind: TreeNodeKind;
}

export interface SkillsFileTreeProps {
  /** skills 根绝对路径；null 时不列 */
  rootPath: string | null;
  selectedPath: string | null;
  onSelectFile: (path: string) => void;
  onSelectDir: (path: string) => void;
  /** 外部变更后递增以刷新根列表 */
  refreshKey?: number;
}

function sortEntries(entries: DirEntry[]): DirEntry[] {
  return [...entries].sort((a, b) => {
    if (a.isDirectory !== b.isDirectory) {
      return a.isDirectory ? -1 : 1;
    }
    return a.name.localeCompare(b.name, "zh-CN");
  });
}

function TreeDirRow({
  entry,
  depth,
  selectedPath,
  onSelectFile,
  onSelectDir,
  refreshKey,
}: {
  entry: DirEntry;
  depth: number;
  selectedPath: string | null;
  onSelectFile: (path: string) => void;
  onSelectDir: (path: string) => void;
  refreshKey?: number;
}) {
  const [open, setOpen] = useState(false);
  const [children, setChildren] = useState<DirEntry[] | null>(null);
  const [loading, setLoading] = useState(false);

  const loadChildren = useCallback(async () => {
    setLoading(true);
    try {
      const list = sortEntries(await listDir(entry.path));
      setChildren(list);
    } catch {
      setChildren([]);
    } finally {
      setLoading(false);
    }
  }, [entry.path]);

  useEffect(() => {
    if (open) {
      void loadChildren();
    }
  }, [open, loadChildren, refreshKey]);

  // 若选中路径在本目录下，自动展开
  useEffect(() => {
    if (!selectedPath) return;
    const prefix = entry.path.replace(/\\/g, "/").replace(/\/+$/, "");
    const sel = selectedPath.replace(/\\/g, "/");
    if (sel === prefix || sel.startsWith(prefix + "/")) {
      setOpen(true);
    }
  }, [selectedPath, entry.path]);

  const active = selectedPath === entry.path;

  return (
    <li>
      <button
        type="button"
        onClick={() => {
          setOpen((v) => !v);
          onSelectDir(entry.path);
        }}
        className={cn(
          "flex w-full items-center gap-1 rounded-md px-1.5 py-1 text-left text-[12px] transition-colors",
          active
            ? "bg-accent-subtle text-fg"
            : "text-fg-muted hover:bg-surface-hover hover:text-fg",
        )}
        style={{ paddingLeft: 6 + depth * 12 }}
        title={entry.path}
      >
        <span className="inline-flex size-3.5 shrink-0 items-center justify-center text-fg-faint">
          {open ? (
            <ChevronDown size={12} strokeWidth={2} />
          ) : (
            <ChevronRight size={12} strokeWidth={2} />
          )}
        </span>
        <Folder size={13} strokeWidth={1.75} className="shrink-0 text-fg-faint" />
        <span className="min-w-0 truncate font-medium">{entry.name}</span>
      </button>
      {open ? (
        <ul className="m-0 list-none p-0">
          {loading && children == null ? (
            <li
              className="px-2 py-1 text-[11px] text-fg-faint"
              style={{ paddingLeft: 22 + depth * 12 }}
            >
              加载中…
            </li>
          ) : null}
          {(children ?? []).map((child) =>
            child.isDirectory ? (
              <TreeDirRow
                key={child.path}
                entry={child}
                depth={depth + 1}
                selectedPath={selectedPath}
                onSelectFile={onSelectFile}
                onSelectDir={onSelectDir}
                refreshKey={refreshKey}
              />
            ) : (
              <TreeFileRow
                key={child.path}
                entry={child}
                depth={depth + 1}
                selectedPath={selectedPath}
                onSelectFile={onSelectFile}
              />
            ),
          )}
          {children && children.length === 0 && !loading ? (
            <li
              className="px-2 py-1 text-[11px] text-fg-faint"
              style={{ paddingLeft: 22 + depth * 12 }}
            >
              空目录
            </li>
          ) : null}
        </ul>
      ) : null}
    </li>
  );
}

function TreeFileRow({
  entry,
  depth,
  selectedPath,
  onSelectFile,
}: {
  entry: DirEntry;
  depth: number;
  selectedPath: string | null;
  onSelectFile: (path: string) => void;
}) {
  const active = selectedPath === entry.path;
  return (
    <li>
      <button
        type="button"
        onClick={() => onSelectFile(entry.path)}
        className={cn(
          "flex w-full items-center gap-1 rounded-md px-1.5 py-1 text-left text-[12px] transition-colors",
          active
            ? "bg-accent-subtle text-fg"
            : "text-fg-muted hover:bg-surface-hover hover:text-fg",
        )}
        style={{ paddingLeft: 6 + depth * 12 }}
        title={entry.path}
        aria-current={active ? "true" : undefined}
      >
        <span className="inline-flex size-3.5 shrink-0" />
        <FileText size={13} strokeWidth={1.75} className="shrink-0 text-fg-faint" />
        <span className="min-w-0 truncate">{entry.name}</span>
      </button>
    </li>
  );
}

/**
 * 根下列 skill 包目录 + 文件；点开目录再 listDir。
 */
export function SkillsFileTree({
  rootPath,
  selectedPath,
  onSelectFile,
  onSelectDir,
  refreshKey = 0,
}: SkillsFileTreeProps) {
  const [rootEntries, setRootEntries] = useState<DirEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!rootPath) {
      setRootEntries([]);
      setError(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    void (async () => {
      try {
        // 根尚未创建时视为空树，不触发 readDir ENOENT 噪音
        if (!(await exists(rootPath))) {
          if (!cancelled) setRootEntries([]);
          return;
        }
        const list = sortEntries(await listDir(rootPath));
        if (!cancelled) setRootEntries(list);
      } catch {
        if (!cancelled) {
          setRootEntries([]);
          setError("无法读取目录");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [rootPath, refreshKey]);

  if (!rootPath) {
    return (
      <div className="px-2.5 py-3 text-[12px] leading-relaxed text-fg-faint">
        未解析到 skills 根路径
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="shrink-0 px-2.5 py-2 text-[11px] font-medium text-fg-faint">
        文件
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-1.5 pb-2">
        {loading && rootEntries.length === 0 ? (
          <p className="px-1.5 py-2 text-[12px] text-fg-faint">加载中…</p>
        ) : null}
        {error ? (
          <p className="px-1.5 py-2 text-[12px] text-timer-low">{error}</p>
        ) : null}
        {!loading && !error && rootEntries.length === 0 ? (
          <p className="px-1.5 py-2 text-[12px] text-fg-faint">
            暂无技能包。可点「新建技能」创建。
          </p>
        ) : null}
        <ul className="m-0 list-none p-0">
          {rootEntries.map((entry) =>
            entry.isDirectory ? (
              <TreeDirRow
                key={entry.path}
                entry={entry}
                depth={0}
                selectedPath={selectedPath}
                onSelectFile={onSelectFile}
                onSelectDir={onSelectDir}
                refreshKey={refreshKey}
              />
            ) : (
              <TreeFileRow
                key={entry.path}
                entry={entry}
                depth={0}
                selectedPath={selectedPath}
                onSelectFile={onSelectFile}
              />
            ),
          )}
        </ul>
      </div>
    </div>
  );
}
