// 简单验证 Everything Neon addon 的导出和 query 原始返回。
//
// 运行前提：
// 1. 必须先构建 release addon：npm run build:addon
// 2. Windows 上 Everything 正在运行，且数据库已加载完成
//
// 常用命令：
//   npm run test:everything-addon
//   npm run test:everything-addon -- --query "folder: aaa.pdf" --max-results 20
//   npm run test:everything-addon -- --query "ext:pdf" --max-results 10 --sort modified-desc
//   npm run test:everything-addon -- --query AppData --match-path
//
// 输出说明：
// - 直接 require addon/index.node，不经过 preload 或 Vue。
// - 查询结果是 addon 的 everything.query 原始返回，适合检查字段 shape。

const path = require("node:path");

const DEFAULT_QUERY = "*.exe";
const DEFAULT_MAX_RESULTS = 5;
const DEFAULT_SORT_MODE = "modified-desc";

const options = parseArgs(process.argv.slice(2));
const addonPath = path.resolve(__dirname, "..", "addon", "index.node");
const { everything } = require(addonPath);

main();

function main() {
  printTitle("addon");
  console.log("path:", addonPath);
  console.log("exports:", Object.keys(everything));

  printTitle("Everything 状态");
  console.log("isRunning:", everything.isRunning());
  console.log("isDbLoaded:", everything.isDbLoaded());

  printTitle("Everything 版本");
  try {
    console.log(everything.getVersion());
  } catch (error) {
    console.error("getVersion 调用失败:", formatError(error));
  }

  if (!everything.isRunning() || !everything.isDbLoaded()) {
    process.exitCode = 1;
    return;
  }

  printTitle("query");
  console.log("query:", options.query);
  console.log("maxResults:", options.maxResults);
  console.log("sortMode:", options.sortMode);
  console.log("matchPath:", options.matchPath);

  try {
    const result = everything.query(
      options.query,
      options.maxResults,
      options.sortMode,
      options.matchPath,
    );
    console.log("total:", result.total);
    console.log("returned:", result.items.length);
    console.table(result.items);
  } catch (error) {
    console.error("query 调用失败:", formatError(error));
    process.exitCode = 1;
  }
}

function parseArgs(args) {
  const options = {
    query: DEFAULT_QUERY,
    maxResults: DEFAULT_MAX_RESULTS,
    sortMode: DEFAULT_SORT_MODE,
    matchPath: false,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const next = args[index + 1];

    if ((arg === "--query" || arg === "-q") && next !== undefined) {
      options.query = next;
      index += 1;
      continue;
    }

    if ((arg === "--max-results" || arg === "--max" || arg === "-n") && next) {
      options.maxResults = Number(next);
      index += 1;
      continue;
    }

    if ((arg === "--sort" || arg === "-s") && next) {
      options.sortMode = next;
      index += 1;
      continue;
    }

    if (arg === "--match-path") {
      options.matchPath = true;
      continue;
    }

    if (arg === "--help" || arg === "-h") {
      printHelpAndExit();
    }

    if (!arg.startsWith("-") && options.query === DEFAULT_QUERY) {
      options.query = arg;
      continue;
    }

    if (!arg.startsWith("-") && options.maxResults === DEFAULT_MAX_RESULTS) {
      options.maxResults = Number(arg);
      continue;
    }
  }

  assertPositiveInteger(options.maxResults, "--max-results");
  return options;
}

function printHelpAndExit() {
  console.log(`Usage: node scripts/test-everything-addon.cjs [options]

Options:
  --query, -q <search>       Everything 查询语句，默认 ${DEFAULT_QUERY}
  --max-results, -n <number> 返回结果数量，默认 ${DEFAULT_MAX_RESULTS}
  --sort, -s <mode>          Everything 排序方式，默认 ${DEFAULT_SORT_MODE}
  --match-path               同时匹配路径和文件名
  -h, --help                 显示帮助

Examples:
  node scripts/test-everything-addon.cjs
  node scripts/test-everything-addon.cjs --query "folder: aaa.pdf" --max-results 20
  node scripts/test-everything-addon.cjs --query AppData --match-path
  node scripts/test-everything-addon.cjs "ext:pdf" 10
`);
  process.exit(0);
}

function printTitle(title) {
  console.log(`\n=== ${title} ===`);
}

function assertPositiveInteger(value, name) {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} 必须是正整数`);
  }
}

function formatError(error) {
  return error instanceof Error ? error.message : String(error);
}
