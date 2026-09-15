/**
 * 技能编辑独立全页：左树 + 右文本编辑 + 新建/删除。
 * 根路径：全局 ~/.agents/skills；项目 <workspace>/.agents/skills。
 * 内置 skill 不进树。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, FilePlus, FolderPlus, Trash2 } from "lucide-react";
import { toast } from "@/lib/toast";
import { Button, Tooltip } from "@/lib/heroui";
import {
  exists,
  isFsAvailable,
  listDir,
  mkdir,
  readFile,
  removeDir,
  removeFile,
  writeFile,
} from "@/lib/fs";
import { joinPath, normalizeDir } from "@/lib/agent/localContext";
import {
  buildSkillMdTemplate,
  clearSkillsDiscoveryCache,
  confirmLeaveMessage,
  isPathInsideRoot,
  isProbablyTextFile,
  resolveEditorSkillsRoot,
  resolveSkillMdPath,
  resolveSkillPackageDir,
  shouldConfirmLeave,
  validateSkillFileName,
  validateSkillPackageName,
  type SkillsEditorScope,
} from "@/lib/agent/skills-editor";
import { cn } from "@/lib/utils";
import { SkillsFileTree } from "./SkillsFileTree";
import { SkillsEditorPane } from "./SkillsEditorPane";

export type SkillsEditorOpenOptions = {
  /** global | project */
  scope?: "global" | "project";
  /** 绝对路径：skill 的 SKILL.md 或任意文件，打开时选中 */
  initialFilePath?: string | null;
};

export interface SkillsEditorPageProps {
  onBack: () => void;
  workspaceRoot: string | null;
  initialScope?: "global" | "project";
  initialFilePath?: string | null;
}

function basename(path: string): string {
  const parts = path.replace(/\\/g, "/").split("/");
  return parts[parts.length - 1] || path;
}

function dirname(path: string): string {
  const n = path.replace(/\\/g, "/");
  const i = n.lastIndexOf("/");
  if (i <= 0) return n;
  return n.slice(0, i) || "/";
}

function assertWritable(skillsRoot: string, targetPath: string): boolean {
  // skills-editor pathGuard：(root, target)
  if (!isPathInsideRoot(skillsRoot, targetPath)) {
    toast.error("路径不在 skills 根目录内");
    return false;
  }
  return true;
}

/**
 * 技能独立全页：顶栏返回 +「技能」；主体左树 + 右编辑。
 */
export function SkillsEditorPage({
  onBack,
  workspaceRoot,
  initialScope,
  initialFilePath,
}: SkillsEditorPageProps) {
  const hasWorkspace = Boolean(workspaceRoot?.trim());
  const [scope, setScope] = useState<SkillsEditorScope>(() => {
    if (initialScope === "project" && hasWorkspace) return "project";
    return "global";
  });
  const [selectedPath, setSelectedPath] = useState<string | null>(
    initialFilePath?.trim() || null,
  );
  const [selectedDir, setSelectedDir] = useState<string | null>(null);
  const [content, setContent] = useState("");
  const [savedContent, setSavedContent] = useState("");
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [loadingFile, setLoadingFile] = useState(false);

  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;

  const skillsRoot = useMemo(
    () =>
      resolveEditorSkillsRoot(scope, {
        workspaceRoot: workspaceRoot?.trim() || null,
      }),
    [scope, workspaceRoot],
  );

  const fsReady = isFsAvailable();

  const confirmLeaveDirty = useCallback((): boolean => {
    if (!shouldConfirmLeave(dirtyRef.current)) return true;
    return window.confirm(confirmLeaveMessage);
  }, []);

  const bumpRefresh = useCallback(() => {
    setRefreshKey((k) => k + 1);
  }, []);

  const loadFile = useCallback(async (filePath: string) => {
    setLoadingFile(true);
    try {
      const text = await readFile(filePath);
      const value = text ?? "";
      setContent(value);
      setSavedContent(value);
      setDirty(false);
    } catch {
      setContent("");
      setSavedContent("");
      setDirty(false);
      toast.error("读取文件失败");
    } finally {
      setLoadingFile(false);
    }
  }, []);

  // 初始文件 / scope 对齐
  useEffect(() => {
    const init = initialFilePath?.trim();
    if (!init || !skillsRoot) return;
    if (!isPathInsideRoot(skillsRoot, init)) return;
    setSelectedPath(init);
    if (isProbablyTextFile(init)) {
      void loadFile(init);
    }
    // 仅挂载时处理 initial
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const selectFile = useCallback(
    async (filePath: string) => {
      if (filePath === selectedPath) return;
      if (!confirmLeaveDirty()) return;
      if (!isProbablyTextFile(filePath)) {
        toast.error("不支持编辑此类型");
        return;
      }
      setSelectedPath(filePath);
      setSelectedDir(dirname(filePath));
      await loadFile(filePath);
    },
    [confirmLeaveDirty, loadFile, selectedPath],
  );

  const selectDir = useCallback((dirPath: string) => {
    setSelectedDir(dirPath);
  }, []);

  const switchScope = useCallback(
    (next: SkillsEditorScope) => {
      if (next === scope) return;
      if (next === "project" && !hasWorkspace) return;
      if (!confirmLeaveDirty()) return;
      setScope(next);
      setSelectedPath(null);
      setSelectedDir(null);
      setContent("");
      setSavedContent("");
      setDirty(false);
    },
    [confirmLeaveDirty, hasWorkspace, scope],
  );

  const handleBack = useCallback(() => {
    if (!confirmLeaveDirty()) return;
    onBack();
  }, [confirmLeaveDirty, onBack]);

  const handleSave = useCallback(async () => {
    if (!selectedPath || !skillsRoot || !dirty) return;
    if (!assertWritable(skillsRoot, selectedPath)) return;
    setSaving(true);
    try {
      const ok = await writeFile(selectedPath, content);
      if (ok) {
        setSavedContent(content);
        setDirty(false);
        clearSkillsDiscoveryCache();
        toast.success("已保存");
      } else {
        toast.error("保存失败");
      }
    } finally {
      setSaving(false);
    }
  }, [content, dirty, selectedPath, skillsRoot]);

  const copyText = useCallback(async (text: string) => {
    try {
      if (typeof window !== "undefined" && window.gooseAgent?.copyText) {
        window.gooseAgent.copyText(text);
      } else if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        throw new Error("no clipboard");
      }
      toast.success("已复制到剪贴板");
    } catch {
      toast.error("复制失败");
    }
  }, []);

  const handleNewSkill = useCallback(async () => {
    if (!skillsRoot) {
      toast.error(
        scope === "project" ? "请先挂载工作区" : "无法解析全局 skills 路径（需 uTools）",
      );
      return;
    }
    if (!fsReady) {
      toast.error("需 uTools 真机");
      return;
    }
    if (!confirmLeaveDirty()) return;

    const raw = window.prompt("技能名称（小写字母、数字、连字符）");
    if (raw == null) return;
    const name = validateSkillPackageName(raw);
    if (!name) {
      toast.error("名称无效", {
        description: "请使用字母开头，仅含 a-z、0-9、-",
      });
      return;
    }

    const pkgDir = resolveSkillPackageDir(skillsRoot, name);
    const skillMd = resolveSkillMdPath(skillsRoot, name);
    if (!assertWritable(skillsRoot, skillMd)) return;

    if (await exists(pkgDir)) {
      toast.error("技能已存在", { description: name });
      return;
    }

    // 确保 skills 根存在
    const rootNorm = normalizeDir(skillsRoot);
    if (!(await exists(rootNorm))) {
      const mkRoot = await mkdir(rootNorm);
      // 可能父级 .agents 也不存在：再试一级
      if (!mkRoot) {
        const agentsDir = dirname(rootNorm);
        await mkdir(agentsDir);
        await mkdir(rootNorm);
      }
    }

    const mk = await mkdir(pkgDir);
    if (!mk && !(await exists(pkgDir))) {
      toast.error("创建目录失败");
      return;
    }

    const body = buildSkillMdTemplate(name);
    const ok = await writeFile(skillMd, body);
    if (!ok) {
      toast.error("写入 SKILL.md 失败");
      return;
    }

    clearSkillsDiscoveryCache();
    bumpRefresh();
    setSelectedPath(skillMd);
    setSelectedDir(pkgDir);
    setContent(body);
    setSavedContent(body);
    setDirty(false);
    toast.success("已创建技能", { description: name });
  }, [bumpRefresh, confirmLeaveDirty, fsReady, scope, skillsRoot]);

  const handleNewFile = useCallback(async () => {
    if (!skillsRoot) {
      toast.error("无法解析 skills 路径");
      return;
    }
    if (!fsReady) {
      toast.error("需 uTools 真机");
      return;
    }
    if (!confirmLeaveDirty()) return;

    // 目标目录：当前选中目录，或选中文件的父目录，或 skills 根
    let targetDir =
      selectedDir ??
      (selectedPath ? dirname(selectedPath) : null) ??
      skillsRoot;

    // 若选中的是 skills 根下的文件（非包内），仍用其父目录
    if (!isPathInsideRoot(skillsRoot, targetDir)) {
      targetDir = skillsRoot;
    }

    const raw = window.prompt("文件名（如 notes.md）");
    if (raw == null) return;
    const fileName = validateSkillFileName(raw);
    if (!fileName) {
      toast.error("文件名无效", {
        description: "勿含路径分隔符或 ..",
      });
      return;
    }

    const filePath = joinPath(normalizeDir(targetDir), fileName);
    if (!assertWritable(skillsRoot, filePath)) return;

    if (await exists(filePath)) {
      toast.error("文件已存在");
      return;
    }

    if (!(await exists(targetDir))) {
      const mk = await mkdir(targetDir);
      if (!mk) {
        toast.error("目标目录不存在且无法创建");
        return;
      }
    }

    const initial =
      fileName.toLowerCase().endsWith(".md") ? `# ${fileName.replace(/\.md$/i, "")}\n` : "";
    const ok = await writeFile(filePath, initial);
    if (!ok) {
      toast.error("创建文件失败");
      return;
    }

    clearSkillsDiscoveryCache();
    bumpRefresh();

    if (isProbablyTextFile(filePath)) {
      setSelectedPath(filePath);
      setSelectedDir(targetDir);
      setContent(initial);
      setSavedContent(initial);
      setDirty(false);
    }
    toast.success("已创建文件", { description: fileName });
  }, [
    bumpRefresh,
    confirmLeaveDirty,
    fsReady,
    selectedDir,
    selectedPath,
    skillsRoot,
  ]);

  const handleDelete = useCallback(async () => {
    if (!skillsRoot) return;
    if (!fsReady) {
      toast.error("需 uTools 真机");
      return;
    }

    // 优先删选中文件；无文件则删选中目录（不可删 skills 根本身）
    const target = selectedPath ?? selectedDir;
    if (!target) {
      toast.error("请先选择要删除的文件或目录");
      return;
    }
    if (!assertWritable(skillsRoot, target)) return;

    const rootNorm = normalizeDir(skillsRoot);
    const targetNorm = normalizeDir(target);
    if (targetNorm === rootNorm) {
      toast.error("不能删除 skills 根目录");
      return;
    }

    const label = basename(target);
    if (!window.confirm(`确定删除「${label}」？此操作不可撤销。`)) {
      return;
    }

    // 判断是文件还是目录
    let isDir = false;
    if (selectedPath && selectedPath === target) {
      isDir = false;
    } else if (selectedDir === target) {
      isDir = true;
    } else {
      // 兜底：list 父目录
      try {
        const parent = dirname(target);
        const entries = await listDir(parent);
        const hit = entries.find((e) => e.path === target || e.name === label);
        isDir = Boolean(hit?.isDirectory);
      } catch {
        isDir = !isProbablyTextFile(target);
      }
    }

    const ok = isDir ? await removeDir(target) : await removeFile(target);
    if (!ok) {
      // 文件删失败时再试目录（可能是包）
      const retry = isDir ? await removeFile(target) : await removeDir(target);
      if (!retry) {
        toast.error("删除失败");
        return;
      }
    }

    clearSkillsDiscoveryCache();
    bumpRefresh();
    setSelectedPath(null);
    setSelectedDir(null);
    setContent("");
    setSavedContent("");
    setDirty(false);
    toast.success("已删除", { description: label });
  }, [
    bumpRefresh,
    fsReady,
    selectedDir,
    selectedPath,
    skillsRoot,
  ]);

  const emptyScopeHint =
    scope === "project" && !hasWorkspace
      ? "请先在侧栏挂载工作区"
      : scope === "global" && !skillsRoot
        ? "无法解析全局 skills 路径。请在 uTools 真机中打开，或先确保已有本地技能。"
        : null;

  const projectDisabled = !hasWorkspace;
  const projectTabHint = "请先在侧栏挂载工作区";

  return (
    <div className="flex h-full min-h-0 w-full flex-col bg-bg text-fg">
      <header className="flex shrink-0 items-center gap-2 px-3 py-2.5">
        <button
          type="button"
          onClick={handleBack}
          className="icon-control inline-flex size-8 items-center justify-center rounded-md text-fg-muted"
          title="返回"
          aria-label="返回工作台"
        >
          <ArrowLeft size={18} strokeWidth={1.75} />
        </button>
        <div className="min-w-0 flex-1">
          <h1 className="text-[14px] font-semibold leading-tight text-fg">
            技能
          </h1>
          <p className="truncate text-[11.5px] leading-tight text-fg-faint">
            {skillsRoot
              ? skillsRoot
              : scope === "project"
                ? projectTabHint
                : "需 uTools 解析全局路径"}
          </p>
        </div>

        <div
          className="inline-flex shrink-0 items-center rounded-lg bg-surface-hover p-0.5"
          role="group"
          aria-label="技能范围"
        >
          <button
            type="button"
            onClick={() => switchScope("global")}
            className={cn(
              "inline-flex h-7 items-center rounded-md px-2.5 text-[11.5px] font-medium transition-colors",
              scope === "global"
                ? "bg-surface text-fg shadow-sm"
                : "text-fg-muted hover:text-fg",
            )}
            aria-pressed={scope === "global"}
          >
            全局
          </button>
          {projectDisabled ? (
            <Tooltip delay={300}>
              <Tooltip.Trigger className="inline-flex outline-none">
                <span className="inline-flex">
                  <button
                    type="button"
                    disabled
                    className={cn(
                      "inline-flex h-7 items-center rounded-md px-2.5 text-[11.5px] font-medium transition-colors",
                      "cursor-not-allowed opacity-40 text-fg-muted",
                    )}
                    aria-pressed={false}
                    aria-disabled="true"
                  >
                    项目
                  </button>
                </span>
              </Tooltip.Trigger>
              <Tooltip.Content placement="bottom" className="max-w-[220px] px-2 py-1.5">
                {projectTabHint}
              </Tooltip.Content>
            </Tooltip>
          ) : (
            <button
              type="button"
              onClick={() => switchScope("project")}
              className={cn(
                "inline-flex h-7 items-center rounded-md px-2.5 text-[11.5px] font-medium transition-colors",
                scope === "project"
                  ? "bg-surface text-fg shadow-sm"
                  : "text-fg-muted hover:text-fg",
              )}
              aria-pressed={scope === "project"}
            >
              项目
            </button>
          )}
        </div>
      </header>

      {/* 工具条 */}
      <div className="flex shrink-0 items-center gap-1.5 px-3 pb-2">
        <Button
          size="sm"
          variant="secondary"
          isDisabled={!fsReady || !skillsRoot}
          onPress={() => {
            void handleNewSkill();
          }}
        >
          <FolderPlus className="h-3.5 w-3.5" strokeWidth={1.75} />
          新建技能
        </Button>
        <Button
          size="sm"
          variant="secondary"
          isDisabled={!fsReady || !skillsRoot}
          onPress={() => {
            void handleNewFile();
          }}
        >
          <FilePlus className="h-3.5 w-3.5" strokeWidth={1.75} />
          新建文件
        </Button>
        <Button
          size="sm"
          variant="ghost"
          isDisabled={!fsReady || !skillsRoot || (!selectedPath && !selectedDir)}
          onPress={() => {
            void handleDelete();
          }}
        >
          <Trash2 className="h-3.5 w-3.5" strokeWidth={1.75} />
          删除
        </Button>
        {!fsReady ? (
          <span className="ml-1 text-[11.5px] text-fg-faint">需 uTools 真机</span>
        ) : null}
      </div>

      <div className="flex min-h-0 flex-1 gap-0 px-3 pb-3">
        <aside
          className="flex w-[12rem] shrink-0 flex-col overflow-hidden rounded-panel bg-surface sm:w-[14rem]"
          aria-label="技能文件树"
        >
          {emptyScopeHint ? (
            <div className="px-2.5 py-3 text-[12px] leading-relaxed text-fg-faint">
              {emptyScopeHint}
            </div>
          ) : (
            <SkillsFileTree
              rootPath={skillsRoot}
              selectedPath={selectedPath}
              onSelectFile={(p) => {
                void selectFile(p);
              }}
              onSelectDir={selectDir}
              refreshKey={refreshKey}
            />
          )}
        </aside>

        <div className="ml-2 min-h-0 min-w-0 flex-1 overflow-hidden rounded-panel bg-surface">
          {loadingFile ? (
            <div className="flex h-full items-center justify-center text-[12.5px] text-fg-faint">
              加载中…
            </div>
          ) : (
            <SkillsEditorPane
              filePath={selectedPath}
              content={content}
              dirty={dirty}
              saving={saving}
              disabled={!fsReady || !selectedPath}
              onChange={(v) => {
                setContent(v);
                setDirty(v !== savedContent);
              }}
              onSave={() => {
                void handleSave();
              }}
              onCopy={() => {
                void copyText(content);
              }}
            />
          )}
        </div>
      </div>
    </div>
  );
}
