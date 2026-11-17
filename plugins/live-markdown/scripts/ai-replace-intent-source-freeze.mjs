import fs from "node:fs";
import path from "node:path";

export function sourceHashMap(root, relativePaths, hash) {
  return Object.fromEntries(relativePaths.map((relativePath) => {
    const source = fs.readFileSync(path.join(root, relativePath));
    return [relativePath, { sha256: hash(source), bytes: source.byteLength }];
  }));
}

export function collectAiSourceModules(server, sourceRoot) {
  return [...server.moduleGraph.idToModuleMap.keys()]
    .map((id) => id.split("?")[0])
    .filter((id) => id.startsWith(path.join(sourceRoot, "src/core/ai") + path.sep) && id.endsWith(".ts"))
    .map((id) => path.relative(sourceRoot, id))
    .sort();
}

export function frozenSnapshot(sourceRoot, sourcePaths, hash) {
  return {
    capturedAt: new Date().toISOString(),
    entrypoints: [
      "src/core/ai/intentPlanner.ts",
      "src/core/ai/intentContext.ts",
      "src/core/ai/intentBinder.ts"
    ],
    loadedSourceModules: sourcePaths,
    files: sourceHashMap(sourceRoot, sourcePaths, hash)
  };
}

export function createOrReadSourceFreeze({ snapshot, sourceRoot, acceptanceRoot, label, sourceFreezePath }) {
  if (fs.existsSync(sourceFreezePath)) {
    const frozen = JSON.parse(fs.readFileSync(sourceFreezePath, "utf8"));
    if (JSON.stringify(frozen.files) !== JSON.stringify(snapshot.files)) {
      throw new Error("Frozen planner source differs from current production imports; use a new acceptance directory for a new baseline");
    }
    return frozen;
  }
  fs.mkdirSync(path.join(acceptanceRoot, "source-freeze", label), { recursive: true });
  for (const relativePath of snapshot.loadedSourceModules) {
    const destination = path.join(acceptanceRoot, "source-freeze", label, relativePath);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.copyFileSync(path.join(sourceRoot, relativePath), destination, fs.constants.COPYFILE_EXCL);
  }
  fs.writeFileSync(sourceFreezePath, `${JSON.stringify(snapshot, null, 2)}\n`, { flag: "wx" });
  return snapshot;
}

export function assertFrozenSourceStillLoaded(sourceFreeze, sourceRoot, hash) {
  const current = sourceHashMap(sourceRoot, sourceFreeze.loadedSourceModules, hash);
  for (const relativePath of sourceFreeze.loadedSourceModules) {
    if (current[relativePath]?.sha256 !== sourceFreeze.files[relativePath]?.sha256) {
      throw new Error(`Production AI intent source changed during replay: ${relativePath}`);
    }
  }
}
