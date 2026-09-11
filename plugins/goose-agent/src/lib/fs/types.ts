/** 与 preload `gooseFs.readDir` 对齐的目录条目 */
export interface DirEntry {
  name: string;
  isFile: boolean;
  isDirectory: boolean;
  path: string;
}

export interface ReadStatResult {
  ok: boolean;
  error?: string | null;
  content?: string | null;
}
