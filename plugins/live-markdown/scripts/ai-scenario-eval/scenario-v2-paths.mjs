import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
export const pluginRoot = path.resolve(scriptDirectory, "../..");
export const defaultV2Config = path.join(pluginRoot, ".cache/acceptance/ai-scenarios/v2-r4/tool-source/config.json");

export function isWithin(parent, child) {
  const relative = path.relative(path.resolve(parent), path.resolve(child));
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

export function resolvePluginPath(value, label, { base = pluginRoot, mustExist = false } = {}) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} must be a non-empty path.`);
  const absolute = path.resolve(base, value);
  if (!isWithin(pluginRoot, absolute)) throw new Error(`${label} escaped the plugin directory: ${value}`);
  assertNoSymlinkPath(absolute);
  if (mustExist && !fs.existsSync(absolute)) throw new Error(`${label} does not exist: ${path.relative(pluginRoot, absolute)}`);
  return absolute;
}

export function assertNoSymlinkPath(target) {
  const absolute = path.resolve(target);
  if (!isWithin(pluginRoot, absolute)) throw new Error(`Scenario evaluation path escaped the plugin directory: ${target}`);
  let current = absolute;
  while (current !== pluginRoot) {
    if (fs.existsSync(current) && fs.lstatSync(current).isSymbolicLink()) {
      throw new Error(`Scenario evaluation refuses symlink path components: ${path.relative(pluginRoot, current)}`);
    }
    current = path.dirname(current);
  }
}

export function assertFreshOutputPath(target, label = "Evaluation output") {
  assertNoSymlinkPath(target);
  if (fs.existsSync(target)) throw new Error(`${label} already exists; refusing to overwrite: ${path.relative(pluginRoot, target)}`);
}

function parseArguments(argv) {
  const values = new Map();
  for (const argument of argv) {
    const match = /^--([a-z-]+)=(.*)$/u.exec(argument);
    if (!match) throw new Error(`Arguments must use --name=value syntax: ${argument}`);
    if (!new Set(["config", "case-set", "variant", "source-root", "source-manifest", "run", "mode"]).has(match[1])) {
      throw new Error(`Unknown scenario evaluation argument: --${match[1]}`);
    }
    if (values.has(match[1])) throw new Error(`Duplicate scenario evaluation argument: --${match[1]}`);
    values.set(match[1], match[2]);
  }
  return values;
}

export function parseV2Cli(argv) {
  const values = parseArguments(argv);
  const variant = values.get("variant");
  const runId = values.get("run");
  const mode = values.get("mode") ?? "real";
  const caseSetId = values.get("case-set") ?? null;
  if (!variant || !["A", "B"].includes(variant)) throw new Error("Usage: --variant=A|B --run=<id> [--mode=real|controlled] [--case-set=<id>] [--source-root=<path>] [--source-manifest=<path>] [--config=<path>]");
  if (!runId || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,39}$/u.test(runId)) throw new Error("--run must be a safe, non-empty run id.");
  if (!new Set(["real", "controlled"]).has(mode)) throw new Error("--mode must be real or controlled.");
  if (caseSetId && !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/u.test(caseSetId)) throw new Error("--case-set must be a safe case-set identifier.");
  return {
    configPath: resolvePluginPath(values.get("config") ?? defaultV2Config, "config path", { mustExist: true }),
    variant,
    runId,
    mode,
    caseSetId,
    sourceRootOverride: values.has("source-root") ? resolvePluginPath(values.get("source-root"), "source root", { mustExist: true }) : null,
    sourceManifestOverride: values.has("source-manifest") ? resolvePluginPath(values.get("source-manifest"), "source manifest", { mustExist: true }) : null
  };
}

export function resolveV2ConfigPaths(options) {
  const config = JSON.parse(fs.readFileSync(options.configPath, "utf8"));
  if (config.schemaVersion !== 2 || typeof config.caseSets !== "object" || !config.caseSets || typeof config.sourceVariants !== "object") {
    throw new Error("Unsupported v2 evaluation config; expected schemaVersion 2, caseSets, and sourceVariants.");
  }
  const toolRoot = path.dirname(options.configPath);
  const caseSetId = options.caseSetId ?? config.defaultCaseSetId;
  const caseRelative = config.caseSets[caseSetId];
  if (typeof caseRelative !== "string") throw new Error(`Unknown case set in frozen config: ${caseSetId}`);
  const caseManifestPath = resolvePluginPath(caseRelative, "case manifest", { base: toolRoot, mustExist: true });
  const toolManifestPath = resolvePluginPath(config.toolManifestPath, "tool manifest", { base: toolRoot, mustExist: true });
  const outputRoot = resolvePluginPath(config.outputRoot, "output root");
  const variantConfig = config.sourceVariants[options.variant];
  if (!variantConfig || typeof variantConfig.sourceRoot !== "string" || typeof variantConfig.sourceManifest !== "string") {
    throw new Error(`Variant ${options.variant} is missing a source root or manifest in the frozen config.`);
  }
  const sourceRoot = options.sourceRootOverride ?? resolvePluginPath(variantConfig.sourceRoot, `${options.variant} source root`, { mustExist: true });
  const inferredManifest = path.join(path.dirname(sourceRoot), "source-manifest.json");
  const sourceManifestPath = options.sourceManifestOverride ?? (options.sourceRootOverride ? inferredManifest : resolvePluginPath(variantConfig.sourceManifest, `${options.variant} source manifest`, { mustExist: true }));
  assertNoSymlinkPath(sourceManifestPath);
  if (!fs.existsSync(sourceManifestPath)) throw new Error(`Source manifest does not exist: ${path.relative(pluginRoot, sourceManifestPath)}`);
  const runDirectory = path.join(outputRoot, `${options.variant}-${options.runId}`);
  assertNoSymlinkPath(runDirectory);
  return {
    ...options, config, caseSetId, toolRoot, toolManifestPath, caseManifestPath,
    sourceRoot, sourceManifestPath, outputRoot, runDirectory
  };
}
