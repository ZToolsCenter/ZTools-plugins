/**
 * 独立技能编辑页：可单测纯函数（无 React、可不依赖 window）。
 */

export {
  normalizePath,
  isPathInsideRoot,
  assertPathInsideRoot,
} from "./pathGuard";

export {
  isValidSkillDirName,
  buildNewSkillPackage,
  suggestNewTextFileName,
} from "./skillTemplate";

export type { SkillTreeNode, SkillTreeEntry } from "./treeModel";
export {
  buildTreeFromEntries,
  filterVisibleEntries,
  isProbablyTextFile,
} from "./treeModel";

export { shouldConfirmLeave, confirmLeaveMessage } from "./dirtyNav";

export {
  clearSkillsDiscoveryCache,
  getSkillsDiscoveryCacheEpoch,
  onSkillsDiscoveryCacheClear,
} from "./discoveryCache";

/** 路径根解析（编辑页接线） */
export {
  getGlobalSkillsRootFromBridge,
  guessGlobalSkillsRootFromDiscovered,
  inferSkillsRootFromSkillPath,
  resolveEditorSkillsRoot,
  resolveSkillMdPath,
  resolveSkillPackageDir,
  type ResolveEditorSkillsRootOpts,
  type SkillsEditorScope,
} from "./roots";

/** 额外模板 / 校验（与 skillTemplate 并存） */
export {
  buildSkillMdTemplate,
  validateSkillFileName,
  validateSkillPackageName,
} from "./text";
