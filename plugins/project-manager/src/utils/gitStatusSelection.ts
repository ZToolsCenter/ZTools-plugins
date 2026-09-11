export type GitStatusArea = 'staged' | 'unstaged' | 'conflicted';

/** Use a NUL separator because Git paths cannot contain NUL. */
export function gitStatusSelectionKey(area: GitStatusArea, path: string): string {
  return `${area}\0${path}`;
}

export function isGitStatusSelected(
  selected: ReadonlySet<string>,
  area: GitStatusArea,
  path: string,
): boolean {
  return selected.has(gitStatusSelectionKey(area, path));
}

export function selectedGitStatusFiles<T extends { path: string }>(
  selected: ReadonlySet<string>,
  area: GitStatusArea,
  files: readonly T[],
): T[] {
  return files.filter(file => isGitStatusSelected(selected, area, file.path));
}
