import type { EditorConfig } from '../types';

export interface DetectedEditor {
  name: string;
  path: string;
}

/***********************编辑器路径归一化*********************/
export function normalizeEditorPath(path: string): string {
  return path
    .trim()
    .replace(/^"|"$/g, '')
    .replace(/\//g, '\\')
    .replace(/\.(cmd|bat|exe)$/i, '')
    .toLowerCase();
}

/***********************扫描结果合并*********************/
export function mergeDetectedEditors(
  currentEditors: EditorConfig[] = [],
  detectedEditors: DetectedEditor[] = [],
): EditorConfig[] {
  const nextEditors = [...currentEditors];
  const existingPaths = new Set(nextEditors.map(editor => normalizeEditorPath(editor.path)));

  for (const editor of detectedEditors) {
    const path = editor.path.trim();
    if (!path) continue;

    const normalizedPath = normalizeEditorPath(path);
    if (existingPaths.has(normalizedPath)) continue;

    nextEditors.push({
      id: crypto.randomUUID(),
      name: editor.name.trim() || path.split(/[\\/]/).pop()?.replace(/\.\w+$/, '') || 'Editor',
      path,
    });
    existingPaths.add(normalizedPath);
  }

  return nextEditors;
}
