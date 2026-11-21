import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseV2Cli, resolveV2ConfigPaths, pluginRoot, resolvePluginPath } from "./scenario-v2-paths.mjs";
import { verifyV2ToolSnapshot } from "./scenario-v2-snapshot.mjs";

async function main() {
  const options = parseV2Cli(process.argv.slice(2));
  const resolved = resolveV2ConfigPaths(options);
  const frozen = verifyV2ToolSnapshot({ configPath: options.configPath, toolManifestPath: resolved.toolManifestPath });
  const runnerRelative = options.mode === "controlled"
    ? "scripts/ai-scenario-eval/scenario-v2-controlled-runner.mjs"
    : "scripts/ai-scenario-eval/scenario-v2-runner.mjs";
  const runnerPath = resolvePluginPath(path.join(resolved.toolRoot, runnerRelative), "frozen v2 runner", { mustExist: true });
  if (!frozen.manifest.files[runnerRelative]) throw new Error(`Selected v2 runner is absent from the frozen tool manifest: ${runnerRelative}`);
  const runner = await import(pathToFileURL(runnerPath).href);
  const run = options.mode === "controlled" ? runner.runControlledScenariosV2 : runner.runRealScenariosV2;
  if (typeof run !== "function") throw new Error(`Frozen runner does not export the ${options.mode} scenario entry point.`);
  const report = await run({ pluginRoot, options, resolved });
  console.log(JSON.stringify({
    status: report.status,
    variant: options.variant,
    caseSetId: resolved.caseSetId,
    mode: options.mode,
    expected: options.mode === "controlled" ? report.expectedTotal : report.expectedTotal,
    actual: options.mode === "controlled" ? report.actualTotal : report.executedTotal,
    output: path.relative(pluginRoot, options.mode === "controlled" ? path.join(resolved.outputRoot, `${options.variant}-controlled-${options.runId}`, "controlled-report.json") : path.join(resolved.runDirectory, "run-report.json"))
  }));
  if (report.status !== "passed") process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error?.stack ?? String(error));
    process.exitCode = 1;
  });
}
