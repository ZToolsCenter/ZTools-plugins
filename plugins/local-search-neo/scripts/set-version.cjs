/**
 * 统一插件版本修改脚本
 *
 * 功能：
 * 同步更新 package.json、package-lock.json（包含顶层及 packages[""]）和 public/plugin.json（及根目录 plugin.json）中的插件版本号，
 * 并自动调用 npm run format 完成标准格式化。
 *
 * 使用方法：
 * 1. 查看当前版本及帮助：
 *    node scripts/set-version.cjs
 *
 * 2. 直接指定新版本号：
 *    npm run version:set -- 1.2.0
 *    # 或
 *    node scripts/set-version.cjs 1.2.0
 *
 * 3. 使用 SemVer 自动递增：
 *    npm run version:set -- patch   # 补丁更新：如 1.1.1 -> 1.1.2
 *    npm run version:set -- minor   # 特性更新：如 1.1.1 -> 1.2.0
 *    npm run version:set -- major   # 主版本更新：如 1.1.1 -> 2.0.0
 */

const fs = require("node:fs");
const path = require("node:path");
const { execSync } = require("node:child_process");

const rootDir = path.resolve(__dirname, "..");
const packageJsonPath = path.join(rootDir, "package.json");
const packageLockJsonPath = path.join(rootDir, "package-lock.json");
const publicPluginJsonPath = path.join(rootDir, "public", "plugin.json");
const rootPluginJsonPath = path.join(rootDir, "plugin.json");

const SEMVER_REGEX = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+([0-9A-Za-z.-]+))?$/;

function readJson(filePath) {
  const content = fs.readFileSync(filePath, "utf8");
  return JSON.parse(content);
}

function writeJson(filePath, data) {
  const content = `${JSON.stringify(data, null, 2)}\n`;
  fs.writeFileSync(filePath, content, "utf8");
}

function runFormatter() {
  try {
    console.log("\n正在自动执行代码格式化 (npm run format)...");
    execSync("npm run format", { cwd: rootDir, stdio: "inherit" });
  } catch {
    console.warn("⚠️ 自动格式化执行失败，请后续手动运行 npm run format");
  }
}

function computeNextVersion(currentVersion, bumpTypeOrVersion) {
  const arg = (bumpTypeOrVersion || "").trim();

  if (SEMVER_REGEX.test(arg)) {
    return arg;
  }

  const match = currentVersion.match(SEMVER_REGEX);
  if (!match) {
    throw new Error(`当前 package.json 版本号 "${currentVersion}" 不符合 SemVer 格式`);
  }

  let major = parseInt(match[1], 10);
  let minor = parseInt(match[2], 10);
  let patch = parseInt(match[3], 10);

  switch (arg.toLowerCase()) {
    case "patch":
      patch += 1;
      return `${major}.${minor}.${patch}`;
    case "minor":
      minor += 1;
      patch = 0;
      return `${major}.${minor}.${patch}`;
    case "major":
      major += 1;
      minor = 0;
      patch = 0;
      return `${major}.${minor}.${patch}`;
    default:
      throw new Error(
        `无效的版本号或递增类型: "${arg}"。支持: <具体版本号如 1.2.0> | patch | minor | major`,
      );
  }
}

function main() {
  const targetArg = process.argv[2];

  if (!fs.existsSync(packageJsonPath)) {
    console.error("错误: 未找到 package.json 文件");
    process.exit(1);
  }

  const packageJson = readJson(packageJsonPath);
  const currentVersion = packageJson.version || "0.0.0";

  if (!targetArg) {
    console.log(`当前插件版本: ${currentVersion}`);
    console.log("\n用法:");
    console.log("  node scripts/set-version.cjs <新版本号 | patch | minor | major>");
    console.log("\n示例:");
    console.log("  node scripts/set-version.cjs 1.2.0");
    console.log("  node scripts/set-version.cjs patch  # 1.1.1 -> 1.1.2");
    console.log("  node scripts/set-version.cjs minor  # 1.1.1 -> 1.2.0");
    console.log("  node scripts/set-version.cjs major  # 1.1.1 -> 2.0.0");
    console.log("  npm run version:set -- 1.2.0");
    process.exit(0);
  }

  let newVersion;
  try {
    newVersion = computeNextVersion(currentVersion, targetArg);
  } catch (err) {
    console.error(`错误: ${err.message}`);
    process.exit(1);
  }

  if (newVersion === currentVersion) {
    console.log(`版本号未发生变化，保持: ${currentVersion}`);
    process.exit(0);
  }

  console.log(`\n准备更新插件版本: ${currentVersion} -> ${newVersion}\n`);
  const updatedFiles = [];

  // 1. 更新 package.json
  packageJson.version = newVersion;
  writeJson(packageJsonPath, packageJson);
  updatedFiles.push("package.json");

  // 2. 更新 package-lock.json (如果存在)
  if (fs.existsSync(packageLockJsonPath)) {
    const lockJson = readJson(packageLockJsonPath);
    lockJson.version = newVersion;
    if (lockJson.packages && lockJson.packages[""]) {
      lockJson.packages[""].version = newVersion;
    }
    writeJson(packageLockJsonPath, lockJson);
    updatedFiles.push("package-lock.json");
  }

  // 3. 更新 public/plugin.json (如果存在)
  if (fs.existsSync(publicPluginJsonPath)) {
    const pluginJson = readJson(publicPluginJsonPath);
    pluginJson.version = newVersion;
    writeJson(publicPluginJsonPath, pluginJson);
    updatedFiles.push("public/plugin.json");
  }

  // 4. 更新根目录 plugin.json (如果存在)
  if (fs.existsSync(rootPluginJsonPath)) {
    const rootPluginJson = readJson(rootPluginJsonPath);
    rootPluginJson.version = newVersion;
    writeJson(rootPluginJsonPath, rootPluginJson);
    updatedFiles.push("plugin.json");
  }

  for (const file of updatedFiles) {
    console.log(`  [OK] ${file}`);
  }

  // 5. 自动执行格式化
  runFormatter();

  console.log(`\n🎉 版本号已成功统一更新为 ${newVersion} 并完成格式化！\n`);
}

main();
