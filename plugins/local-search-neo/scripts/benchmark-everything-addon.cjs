// Everything 原生 addon 查询性能基准。
//
// 运行前提：
// 1. 必须先构建 release addon：npm run build:addon
// 2. addon 必须是 release 构建，否则性能数据没有参考意义
// 3. Windows 上 Everything 正在运行，且数据库已加载完成
//
// 常用命令：
//   npm run bench:everything
//   npm run bench:everything -- --max-results 1000 --runs 50
//   npm run bench:everything -- --max-results 500 --warmup 5 --runs 100 --sort name-asc
//
// 参数说明：
//   --max-results <number>  每次查询最多返回多少条结果，默认 100
//   --warmup <number>       每个查询正式统计前预热次数，默认 3
//   --runs <number>         每个查询正式测量次数，默认 20
//   --sort <mode>           Everything 排序方式，默认 modified-desc
//
// 输出说明：
// - 只测试 addon 的 everything.query 同步调用耗时。
// - 不包含 Vue 渲染、preload getFileInfo/stat、图标获取、预览等后处理成本。
// - rows 中 min/avg/median/p95/max 单位均为毫秒。

const { performance } = require("node:perf_hooks");
const path = require("node:path");

const DEFAULT_MAX_RESULTS = 100;
const DEFAULT_WARMUP_RUNS = 3;
const DEFAULT_MEASURE_RUNS = 20;
const DEFAULT_SORT_MODE = "modified-desc";

const queries = [
  {
    name: "空查询",
    search: "",
  },
  {
    name: "图片",
    search: "ext:jpg;jpeg;png;gif;webp;bmp;svg;ico",
  },
  {
    name: "视频",
    search: "ext:mp4;mkv;avi;mov;wmv;flv;webm",
  },
  {
    name: "PDF",
    search: "ext:pdf",
  },
  {
    name: "文件夹",
    search: "folder:",
  },
];

const options = parseArgs(process.argv.slice(2));
const addonPath = path.resolve(__dirname, "..", "addon", "index.node");
const { everything } = require(addonPath);

main();

function main() {
  printEnvironment();

  if (!everything.isRunning()) {
    console.error("Everything 未运行，无法测试。");
    process.exitCode = 1;
    return;
  }

  if (!everything.isDbLoaded()) {
    console.error("Everything 数据库尚未加载完成，无法测试。");
    process.exitCode = 1;
    return;
  }

  console.log("\n测试参数:");
  console.log(`  maxResults: ${options.maxResults}`);
  console.log(`  sortMode: ${options.sortMode}`);
  console.log(`  warmupRuns: ${options.warmupRuns}`);
  console.log(`  measureRuns: ${options.measureRuns}`);

  const rows = queries.map((query) => benchmarkQuery(query));
  console.log(
    "\n结果耗时（单位：ms，仅测试原生 addon 的 everything.query，不包含渲染和 preload stat/enrich）:",
  );
  console.table(rows);
}

function printEnvironment() {
  console.log("Everything addon benchmark");
  console.log(`addon: ${addonPath}`);
  console.log(`node: ${process.version}`);

  try {
    console.log("Everything version:", everything.getVersion());
  } catch (error) {
    console.warn("读取 Everything 版本失败:", error);
  }

  console.log("isRunning:", everything.isRunning());
  console.log("isDbLoaded:", everything.isDbLoaded());
}

function benchmarkQuery(query) {
  for (let index = 0; index < options.warmupRuns; index += 1) {
    everything.query(query.search, options.maxResults, options.sortMode);
  }

  const durations = [];
  let total = 0;
  let returned = 0;

  for (let index = 0; index < options.measureRuns; index += 1) {
    const startedAt = performance.now();
    const result = everything.query(query.search, options.maxResults, options.sortMode);
    const duration = performance.now() - startedAt;

    durations.push(duration);
    total = result.total;
    returned = result.items.length;
  }

  durations.sort((left, right) => left - right);

  return {
    name: query.name,
    search: query.search || "<empty>",
    total,
    returned,
    min: formatMs(durations[0]),
    avg: formatMs(average(durations)),
    median: formatMs(percentile(durations, 0.5)),
    p95: formatMs(percentile(durations, 0.95)),
    max: formatMs(durations[durations.length - 1]),
  };
}

function parseArgs(args) {
  const options = {
    maxResults: DEFAULT_MAX_RESULTS,
    warmupRuns: DEFAULT_WARMUP_RUNS,
    measureRuns: DEFAULT_MEASURE_RUNS,
    sortMode: DEFAULT_SORT_MODE,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const next = args[index + 1];

    if (arg === "--max-results" && next) {
      options.maxResults = Number(next);
      index += 1;
      continue;
    }

    if (arg === "--warmup" && next) {
      options.warmupRuns = Number(next);
      index += 1;
      continue;
    }

    if (arg === "--runs" && next) {
      options.measureRuns = Number(next);
      index += 1;
      continue;
    }

    if (arg === "--sort" && next) {
      options.sortMode = next;
      index += 1;
      continue;
    }

    if (arg === "--help" || arg === "-h") {
      printHelpAndExit();
    }
  }

  assertPositiveInteger(options.maxResults, "--max-results");
  assertNonNegativeInteger(options.warmupRuns, "--warmup");
  assertPositiveInteger(options.measureRuns, "--runs");

  return options;
}

function printHelpAndExit() {
  console.log(`Usage: node scripts/benchmark-everything-addon.cjs [options]

Options:
  --max-results <number>  每次查询最多返回多少条结果，默认 ${DEFAULT_MAX_RESULTS}
  --warmup <number>       每个查询预热次数，默认 ${DEFAULT_WARMUP_RUNS}
  --runs <number>         每个查询正式测量次数，默认 ${DEFAULT_MEASURE_RUNS}
  --sort <mode>           Everything 排序方式，默认 ${DEFAULT_SORT_MODE}
  -h, --help              显示帮助

Examples:
  npm run bench:everything
  npm run bench:everything -- --max-results 500 --runs 50
`);
  process.exit(0);
}

function assertPositiveInteger(value, name) {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} 必须是正整数`);
  }
}

function assertNonNegativeInteger(value, name) {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${name} 必须是非负整数`);
  }
}

function average(values) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function percentile(sortedValues, ratio) {
  if (sortedValues.length === 1) return sortedValues[0];

  const index = (sortedValues.length - 1) * ratio;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return sortedValues[lower];

  const weight = index - lower;
  return sortedValues[lower] * (1 - weight) + sortedValues[upper] * weight;
}

function formatMs(value) {
  return Number(value.toFixed(3));
}
