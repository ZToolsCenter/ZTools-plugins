/**
 * 技能目录树纯数据结构（不读盘）。
 */

import { normalizePath } from "./pathGuard";

export type SkillTreeNode = {
  name: string;
  path: string;
  kind: "dir" | "file";
  children?: SkillTreeNode[];
};

export type SkillTreeEntry = {
  name: string;
  path: string;
  isDirectory: boolean;
  isFile: boolean;
};

/** 过滤隐藏项：名称以 `.` 开头的（`.` / `..` 本身也不应出现） */
export function filterVisibleEntries<T extends { name: string }>(
  entries: T[],
): T[] {
  return entries.filter((e) => !e.name.startsWith("."));
}

/**
 * 由扁平一层 entries 构建树节点列表。
 * 排序：目录在前，再按 name localeCompare。
 * 当前仅一层；若 path 含相对 root 的多段，挂到对应父节点下。
 */
export function buildTreeFromEntries(
  root: string,
  entries: SkillTreeEntry[],
): SkillTreeNode[] {
  const nRoot = normalizePath(root);
  const visible = filterVisibleEntries(entries);

  // 相对 root 的路径段 → 节点
  type MutableNode = SkillTreeNode & { children?: MutableNode[] };
  const top: MutableNode[] = [];
  const dirMap = new Map<string, MutableNode>();

  const ensureDir = (absPath: string, name: string): MutableNode => {
    const key = normalizePath(absPath);
    const existing = dirMap.get(key);
    if (existing) return existing;
    const node: MutableNode = {
      name,
      path: key,
      kind: "dir",
      children: [],
    };
    dirMap.set(key, node);
    return node;
  };

  for (const entry of visible) {
    const abs = normalizePath(entry.path);
    const name = entry.name;
    const kind: "dir" | "file" = entry.isDirectory ? "dir" : "file";

    // 相对 root 的路径
    let rel = abs;
    if (abs === nRoot) continue;
    const prefix = nRoot.endsWith("/") ? nRoot : `${nRoot}/`;
    if (abs.startsWith(prefix)) {
      rel = abs.slice(prefix.length);
    } else {
      // path 已是相对或仅 name
      rel = abs.includes("/") ? abs.replace(/^\//, "") : name;
    }

    const parts = rel.split("/").filter(Boolean);
    if (parts.length === 0) continue;

    // 确保中间目录
    let parentPath = nRoot;
    let parentChildren = top;
    for (let i = 0; i < parts.length - 1; i++) {
      const seg = parts[i]!;
      parentPath = normalizePath(`${parentPath}/${seg}`);
      let dirNode = dirMap.get(parentPath);
      if (!dirNode) {
        dirNode = ensureDir(parentPath, seg);
        parentChildren.push(dirNode);
      }
      if (!dirNode.children) dirNode.children = [];
      parentChildren = dirNode.children;
    }

    const leafName = parts[parts.length - 1]!;
    const leafPath =
      parts.length === 1 && !abs.startsWith(prefix) && abs === name
        ? normalizePath(`${nRoot}/${leafName}`)
        : abs.startsWith(prefix) || abs.startsWith(nRoot)
          ? abs
          : normalizePath(`${nRoot}/${rel}`);

    if (kind === "dir") {
      const dirNode = ensureDir(leafPath, leafName);
      if (!parentChildren.includes(dirNode)) {
        parentChildren.push(dirNode);
      }
    } else {
      parentChildren.push({
        name: leafName,
        path: leafPath,
        kind: "file",
      });
    }
  }

  const sortNodes = (nodes: MutableNode[]): SkillTreeNode[] => {
    nodes.sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === "dir" ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    for (const n of nodes) {
      if (n.children) {
        n.children = sortNodes(n.children);
      }
    }
    return nodes;
  };

  return sortNodes(top);
}

/** 常见文本扩展名白名单 */
const TEXT_EXTENSIONS = new Set([
  "md",
  "txt",
  "json",
  "yml",
  "yaml",
  "ts",
  "js",
  "mjs",
  "cjs",
  "tsx",
  "jsx",
  "css",
  "html",
  "xml",
  "sh",
  "py",
  "toml",
  "env",
]);

/** 常见二进制扩展名 */
const BINARY_EXTENSIONS = new Set([
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "ico",
  "bmp",
  "svg",
  "pdf",
  "zip",
  "gz",
  "tar",
  "tgz",
  "7z",
  "rar",
  "woff",
  "woff2",
  "ttf",
  "otf",
  "eot",
  "mp3",
  "mp4",
  "wav",
  "webm",
  "mov",
  "avi",
  "exe",
  "dll",
  "so",
  "dylib",
  "bin",
  "wasm",
  "node",
  "parquet",
  "sqlite",
  "db",
]);

/**
 * 是否像可编辑文本文件。
 * 无扩展名当文本；白名单扩展名 true；常见二进制 false。
 */
export function isProbablyTextFile(fileName: string): boolean {
  const base = fileName.replace(/\\/g, "/").split("/").pop() ?? fileName;
  const dot = base.lastIndexOf(".");
  if (dot <= 0 || dot === base.length - 1) {
    // 无扩展名或隐藏文件名如 `.env`（以 . 开头且无第二段点时 lastIndex 为 0）
    if (base.startsWith(".") && !base.slice(1).includes(".")) {
      // `.env` → 扩展名 env
      const ext = base.slice(1).toLowerCase();
      if (TEXT_EXTENSIONS.has(ext)) return true;
      if (BINARY_EXTENSIONS.has(ext)) return false;
      return true;
    }
    // 无扩展名当文本
    if (dot < 0) return true;
  }
  const ext = base.slice(dot + 1).toLowerCase();
  if (TEXT_EXTENSIONS.has(ext)) return true;
  if (BINARY_EXTENSIONS.has(ext)) return false;
  // 未知扩展名：保守当非文本，避免误开二进制
  return false;
}
