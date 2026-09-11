/**
 * 技能编辑页路径根解析（纯逻辑 + 可选 preload 桥）。
 */

import {
  joinPath,
  normalizeDir,
  resolveGlobalSkillsRoot,
  resolveProjectSkillsRoot,
} from "@/lib/agent/localContext";

export type SkillsEditorScope = "global" | "project";

/**
 * 从已知 skill 绝对路径反推 skills 根（…/.agents/skills）。
 * 例：/Users/x/.agents/skills/foo/SKILL.md → /Users/x/.agents/skills
 */
export function inferSkillsRootFromSkillPath(skillPath: string): string | null {
  const n = normalizeDir(skillPath.replace(/\\/g, "/"));
  const marker = "/.agents/skills";
  const idx = n.toLowerCase().indexOf(marker);
  if (idx < 0) return null;
  // 保留原始大小写前缀
  const rawIdx = n.indexOf("/.agents/skills");
  const cut = rawIdx >= 0 ? rawIdx : idx;
  return n.slice(0, cut + marker.length);
}

/** 经 preload 取全局 skills 根；无桥时返回 null */
export function getGlobalSkillsRootFromBridge(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const api = window.gooseAiContext?.getGlobalSkillsRoot;
    if (typeof api === "function") {
      const root = api()?.trim();
      return root ? normalizeDir(root) : null;
    }
  } catch {
    /* ignore */
  }
  return null;
}

/**
 * 从 listLocalSkills 第一条 path 反推全局 skills 根。
 */
export function guessGlobalSkillsRootFromDiscovered(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const files = window.gooseAiContext?.listLocalSkills?.() ?? [];
    for (const f of files) {
      const root = inferSkillsRootFromSkillPath(f.path);
      if (root) return root;
    }
  } catch {
    /* ignore */
  }
  return null;
}

export type ResolveEditorSkillsRootOpts = {
  homeDir?: string | null;
  workspaceRoot?: string | null;
};

/**
 * 解析编辑页 skills 根路径。
 * - global：preload getGlobalSkillsRoot → homeDir → 已发现 skill 反推
 * - project：workspaceRoot 拼 .agents/skills；无工作区返回 null
 */
export function resolveEditorSkillsRoot(
  scope: SkillsEditorScope,
  opts: ResolveEditorSkillsRootOpts = {},
): string | null {
  if (scope === "project") {
    const ws = opts.workspaceRoot?.trim();
    if (!ws) return null;
    return resolveProjectSkillsRoot(ws);
  }

  const fromBridge = getGlobalSkillsRootFromBridge();
  if (fromBridge) return fromBridge;

  const home = opts.homeDir?.trim();
  if (home) return resolveGlobalSkillsRoot(home);

  return guessGlobalSkillsRootFromDiscovered();
}

/** 技能包目录：skillsRoot/<name> */
export function resolveSkillPackageDir(
  skillsRoot: string,
  skillName: string,
): string {
  return joinPath(normalizeDir(skillsRoot), skillName);
}

/** 技能包 SKILL.md */
export function resolveSkillMdPath(
  skillsRoot: string,
  skillName: string,
): string {
  return joinPath(resolveSkillPackageDir(skillsRoot, skillName), "SKILL.md");
}
