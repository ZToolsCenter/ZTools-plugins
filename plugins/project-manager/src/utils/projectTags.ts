import type { Project } from '../types';

/***********************项目标签归一化*********************/

/** 统一清理标签输入，避免空格造成同名标签无法复用 */
export function normalizeProjectTag(tag: string): string {
  return tag.trim().replace(/\s+/g, ' ');
}

/** 清理、去空、去重，并保留用户输入顺序 */
export function normalizeProjectTags(tags: readonly string[] = []): string[] {
  const tagSet = new Set<string>();
  for (const tag of tags) {
    const normalized = normalizeProjectTag(tag);
    if (normalized) {
      tagSet.add(normalized);
    }
  }
  return Array.from(tagSet);
}

/***********************标签聚合与筛选*********************/

/** 从所有项目中聚合可复用标签，用于新增/编辑项目和 Dashboard 筛选 */
export function collectProjectTags(projects: readonly Project[]): string[] {
  const tagSet = new Set<string>();
  for (const project of projects) {
    for (const tag of normalizeProjectTags(project.tags ?? [])) {
      tagSet.add(tag);
    }
  }
  return Array.from(tagSet).sort();
}

/** 判断项目是否包含所有选中标签 */
export function projectMatchesSelectedTags(project: Project, selectedTags: readonly string[]): boolean {
  const normalizedSelectedTags = normalizeProjectTags(selectedTags);
  if (normalizedSelectedTags.length === 0) return true;

  const projectTagSet = new Set(normalizeProjectTags(project.tags ?? []));
  return normalizedSelectedTags.every((tag) => projectTagSet.has(tag));
}
