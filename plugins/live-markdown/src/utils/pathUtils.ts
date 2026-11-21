import {
  WorkspaceDirectoryNode,
  WorkspaceFileNode,
  WorkspaceScanResult
} from "../types/typora";

/**
 * Cross-platform parent directory extraction supporting both POSIX `/` and Windows `\`.
 */
export function getParentPath(targetPath: string): string {
  if (!targetPath) return "";
  const normalized = targetPath.replace(/[\\/]+$/, "");
  const lastSlash = Math.max(
    normalized.lastIndexOf("/"),
    normalized.lastIndexOf("\\")
  );
  if (lastSlash <= 0) return "";
  return normalized.slice(0, lastSlash);
}

function normalizeForComparison(input: string): string {
  let unified = input.replace(/\\/g, "/");
  if (/^[a-zA-Z]:/.test(unified)) {
    unified = unified[0].toLowerCase() + unified.slice(1);
  }
  if (unified === "/" || /^[a-z]:\/$/.test(unified)) return unified;
  return unified.replace(/\/+$/, "");
}

/**
 * Checks whether `targetPath` equals or resides inside `parentDir`.
 */
export function isPathInside(targetPath: string, parentDir: string): boolean {
  if (!targetPath || !parentDir) return false;
  const target = normalizeForComparison(targetPath);
  const parent = normalizeForComparison(parentDir);
  if (!target || !parent) return false;
  if (target === parent) return true;
  const prefix = parent.endsWith("/") ? parent : `${parent}/`;
  return target.startsWith(prefix);
}

/**
 * Finds the workspace whose rootDir contains `targetPath` (preferring deepest nested root).
 */
export function findOwningWorkspace<T extends { rootDir: string }>(
  workspaces: T[],
  targetPath: string | null | undefined
): T | null {
  if (!targetPath || workspaces.length === 0) return null;
  let best: T | null = null;
  let bestLen = -1;
  for (const ws of workspaces) {
    if (isPathInside(targetPath, ws.rootDir)) {
      const len = normalizeForComparison(ws.rootDir).length;
      if (len > bestLen) {
        best = ws;
        bestLen = len;
      }
    }
  }
  return best;
}

export function injectDirectoryChildren(
  node: WorkspaceDirectoryNode,
  targetDirPath: string,
  newChildren: Array<WorkspaceDirectoryNode | WorkspaceFileNode>
): WorkspaceDirectoryNode {
  if (node.path === targetDirPath) {
    return {
      ...node,
      children: newChildren,
      childrenLoaded: true
    };
  }
  return {
    ...node,
    children: node.children.map((child) =>
      child.type === "directory"
        ? injectDirectoryChildren(child, targetDirPath, newChildren)
        : child
    )
  };
}

function mergeDirectorySubtrees(
  freshNode: WorkspaceDirectoryNode,
  existingNode: WorkspaceDirectoryNode
): WorkspaceDirectoryNode {
  if (!freshNode.childrenLoaded && existingNode.childrenLoaded) {
    return existingNode;
  }
  const existingDirs = new Map<string, WorkspaceDirectoryNode>();
  for (const child of existingNode.children) {
    if (child.type === "directory") {
      existingDirs.set(child.path, child);
    }
  }
  return {
    ...freshNode,
    children: freshNode.children.map((child) => {
      if (child.type !== "directory") return child;
      const prevDir = existingDirs.get(child.path);
      return prevDir ? mergeDirectorySubtrees(child, prevDir) : child;
    })
  };
}

function collectFilesFromTree(
  node: WorkspaceDirectoryNode,
  seen = new Set<string>(),
  out: WorkspaceFileNode[] = []
): WorkspaceFileNode[] {
  for (const child of node.children) {
    if (child.type === "file") {
      if (!seen.has(child.path)) {
        seen.add(child.path);
        out.push(child);
      }
    } else {
      collectFilesFromTree(child, seen, out);
    }
  }
  return out;
}

/**
 * Preserves previously lazy-loaded subdirectory trees when refreshing a workspace shallowly.
 */
export function mergeLoadedWorkspaceSubtrees(
  fresh: WorkspaceScanResult,
  existing: WorkspaceScanResult | undefined
): WorkspaceScanResult {
  if (!existing || !fresh.isShallow) return fresh;
  const mergedTree = mergeDirectorySubtrees(fresh.tree, existing.tree);
  return {
    ...fresh,
    tree: mergedTree,
    files: collectFilesFromTree(mergedTree)
  };
}

/**
 * Check if a URL/path is already absolute or external (http, data, file, posix / or windows drive).
 */
export function isAbsoluteOrExternalUrl(url: string): boolean {
  const trimmed = String(url || "").trim();
  if (!trimmed) return true;
  if (/^(https?:|data:|blob:|file:|ftp:)/i.test(trimmed)) return true;
  if (trimmed.startsWith("/")) return true; // POSIX absolute
  if (/^[a-zA-Z]:[\\/]/.test(trimmed)) return true; // Windows absolute
  return false;
}

/**
 * Resolves a relative path against a base directory into a normalized absolute path.
 */
export function resolveRelativePath(baseDir: string, relativePath: string): string {
  if (!baseDir) return relativePath;
  const isWindows = /^[a-zA-Z]:[\\/]/.test(baseDir);
  const separator = isWindows ? "\\" : "/";

  // Normalize slashes to forward slashes for unified traversal
  const normBase = baseDir.replace(/\\/g, "/").replace(/\/+$/, "");
  const normRel = relativePath.replace(/\\/g, "/").replace(/^\.\//, "");

  const baseParts = normBase.split("/");
  const relParts = normRel.split("/");

  for (const part of relParts) {
    if (part === "." || part === "") continue;
    if (part === "..") {
      if (baseParts.length > (isWindows ? 1 : 0)) {
        baseParts.pop();
      }
    } else {
      baseParts.push(part);
    }
  }

  const resolved = baseParts.join(separator);
  return resolved;
}

/**
 * Transforms relative image URLs in Markdown text into absolute local paths
 * based on the active document directory.
 */
export function transformRelativeImageUrlsToAbsolute(
  markdownText: string,
  docPath?: string | null,
  rootUrlFromYaml?: string
): string {
  if (!markdownText || !docPath) return markdownText;
  const docDir = getParentPath(docPath);
  if (!docDir) return markdownText;

  // Determine base directory (respecting typora-root-url if provided)
  const effectiveBaseDir =
    rootUrlFromYaml && !isAbsoluteOrExternalUrl(rootUrlFromYaml)
      ? resolveRelativePath(docDir, rootUrlFromYaml)
      : docDir;

  // 1. Transform standard Markdown images: ![alt](url "title")
  let result = markdownText.replace(
    /!\[([^\]]*)\]\(\s*([^\s")]+)(?:\s+["']([^"']*)["'])?\s*\)/g,
    (fullMatch, alt, rawUrl, title) => {
      if (isAbsoluteOrExternalUrl(rawUrl)) {
        return fullMatch;
      }
      const absPath = resolveRelativePath(effectiveBaseDir, rawUrl);
      const titleSuffix = title ? ` "${title}"` : "";
      return `![${alt}](${absPath}${titleSuffix})`;
    }
  );

  // 2. Transform HTML <img ... src="..." ...> tags
  result = result.replace(/<img\s+([^>]*?)>/gi, (imgTag) => {
    return imgTag.replace(
      /\bsrc=(["'])([^"']+)\1/i,
      (srcAttr, quote, rawUrl) => {
        if (isAbsoluteOrExternalUrl(rawUrl)) {
          return srcAttr;
        }
        const absPath = resolveRelativePath(effectiveBaseDir, rawUrl);
        return `src=${quote}${absPath}${quote}`;
      }
    );
  });

  return result;
}
