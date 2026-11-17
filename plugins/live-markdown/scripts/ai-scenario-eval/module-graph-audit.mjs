import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

function isWithin(parent, child) {
  const relative = path.relative(parent, child);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

function moduleFilePath(id) {
  const clean = id.split("?")[0];
  if (clean.startsWith("file://")) return fileURLToPath(clean);
  return path.isAbsolute(clean) ? path.resolve(clean) : null;
}

function graphPaths(server) {
  return [...server.moduleGraph.idToModuleMap.keys()]
    .map(moduleFilePath)
    .filter(Boolean)
    .sort();
}

function requireCachePaths(frozenRequire) {
  return Object.keys(frozenRequire.cache ?? {}).map((value) => path.resolve(value)).sort();
}

function packageRootFor(filePath, packageName) {
  let current = path.dirname(filePath);
  while (current !== path.dirname(current)) {
    const packagePath = path.join(current, "package.json");
    if (fs.existsSync(packagePath)) {
      try {
        const metadata = JSON.parse(fs.readFileSync(packagePath, "utf8"));
        if (metadata.name === packageName) return { root: current, metadata };
      } catch { /* Ignore unrelated or malformed parent manifests. */ }
    }
    current = path.dirname(current);
  }
  throw new Error(`Could not find package metadata for ${packageName} from ${filePath}`);
}

function nodeModulesDirectory(packageRoot) {
  const absolute = path.resolve(packageRoot);
  const segments = absolute.split(path.sep);
  const index = segments.lastIndexOf("node_modules");
  if (index < 0) return null;
  return path.join(path.parse(absolute).root, ...segments.slice(1, index + 1));
}

function dependencyRecord(packageName, resolvedPath, pluginRoot, frozenRoot, resolvedVia) {
  const { root, metadata } = packageRootFor(resolvedPath, packageName);
  const nodeModulesRoot = nodeModulesDirectory(root);
  return {
    name: packageName,
    version: metadata.version ?? null,
    resolvedPath,
    packageRoot: root,
    resolvedVia,
    nodeModulesRoot,
    resolvedFromAncestorNodeModules: Boolean(nodeModulesRoot && !isWithin(frozenRoot, nodeModulesRoot)),
    resolvedFromPluginAncestorNodeModules: Boolean(nodeModulesRoot && !isWithin(pluginRoot, nodeModulesRoot)),
    resolvedOutsideFrozenSnapshot: !isWithin(frozenRoot, root)
  };
}

function fileHash(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function isMarkdownPackagePath(filePath) {
  const segments = filePath.split(path.sep);
  return segments.some((segment, index) => segment === "node_modules" && segments[index + 1] === "@lezer" && segments[index + 2] === "markdown");
}

/** Validate every Vite-loaded source path and record modules resolved outside the frozen tree. */
export function auditModuleGraph({ server, pluginRoot, frozenRoot, sourceManifest, viteResolvedPath, frozenRequire }) {
  const paths = graphPaths(server);
  const nodePaths = requireCachePaths(frozenRequire);
  const sourceRoots = ["src", "preload"].map((directory) => ({
    directory,
    live: path.join(pluginRoot, directory),
    frozen: path.join(frozenRoot, directory)
  }));
  const loadedSourceModules = [];
  const loadedMarkdownPaths = [];

  for (const modulePath of [...paths, ...nodePaths]) {
    for (const source of sourceRoots) {
      if (isWithin(source.live, modulePath) && !isWithin(source.frozen, modulePath)) {
        throw new Error(`Vite module graph escaped the frozen ${source.directory}/ snapshot: ${modulePath}`);
      }
      if (isWithin(source.frozen, modulePath)) {
        const relative = path.relative(frozenRoot, modulePath).split(path.sep).join("/");
        const expected = sourceManifest.files[relative]?.sha256;
        if (!expected || !fs.existsSync(modulePath) || fs.lstatSync(modulePath).isSymbolicLink()) {
          throw new Error(`Vite loaded a source module outside the frozen source manifest: ${relative}`);
        }
        const actual = fileHash(modulePath);
        if (actual !== expected) throw new Error(`Vite loaded a changed frozen source module: ${relative}`);
        loadedSourceModules.push(relative);
      }
    }
    if (isMarkdownPackagePath(modulePath)) loadedMarkdownPaths.push(modulePath);
  }

  const vitePath = fileURLToPath(viteResolvedPath);
  let markdownPaths = [...new Set(loadedMarkdownPaths)].sort();
  let markdownResolvedVia = "vite-module-graph";
  if (!markdownPaths.length) {
    markdownPaths = [frozenRequire.resolve("@lezer/markdown")];
    markdownResolvedVia = "frozen-source-resolution-fallback";
  }
  return {
    moduleCount: paths.length,
    nodeRequireCacheModuleCount: nodePaths.length,
    modulePaths: paths,
    nodeRequireCachePaths: nodePaths,
    loadedSourceModules: [...new Set(loadedSourceModules)].sort(),
    dependencies: {
      vite: dependencyRecord("vite", vitePath, pluginRoot, frozenRoot, "runner-import-resolution"),
      "@lezer/markdown": markdownPaths.map((resolvedPath) => dependencyRecord("@lezer/markdown", resolvedPath, pluginRoot, frozenRoot, markdownResolvedVia))
    }
  };
}
