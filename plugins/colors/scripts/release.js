#!/usr/bin/env node
/**
 * release.js — 一键发版
 *
 * 用法：node scripts/release.js <版本号>
 * 示例：node scripts/release.js 1.5.0
 *
 * 流程：检查命令 → check-all → 更新版本号 → changelog → fmt → commit → tag
 * 不自动 push，由用户确认后手动执行
 */

import { execSync } from "child_process";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

function run(cmd) {
  return execSync(cmd, { cwd: root, encoding: "utf-8" });
}

function git(cmd) {
  return execSync(cmd, { cwd: root, encoding: "utf-8", stdio: "pipe" }).trim();
}

// ── 1. 检查参数 ──────────────────────────────────────────────
const version = process.argv[2];
if (!version || !/^\d+\.\d+\.\d+$/.test(version)) {
  console.error("❌ 用法：node scripts/release.js <版本号>");
  console.error("   示例：node scripts/release.js 1.5.0");
  process.exit(1);
}

const tag = `v${version}`;
const commitMsg = `Release ${version}`;

// ── 2. 检查必要命令 ──────────────────────────────────────────
for (const cmd of ["git", "git-cliff"]) {
  try {
    execSync(`${cmd} --version`, { stdio: "ignore" });
  } catch {
    console.error(`❌ 未检测到 ${cmd}，请先安装`);
    if (cmd === "git-cliff") {
      console.error("\n  macOS:       brew install git-cliff");
      console.error("  Windows:     scoop install git-cliff");
      console.error("  Linux:       yay -S git-cliff");
      console.error("  通用:        cargo install git-cliff");
    }
    process.exit(1);
  }
}

// ── 3. 安全检查 ──────────────────────────────────────────────
const tagExists = git(`git tag -l "${tag}"`);
if (tagExists) {
  console.error(`❌ Tag ${tag} 已存在！不能重复使用版本号`);
  process.exit(1);
}

const dirty = git("git status --porcelain");
if (dirty) {
  console.error("❌ 工作区有未提交的修改，请先 commit 或 stash");
  process.exit(1);
}

// 检查 HEAD 是否是 main 分支之后的提交（可以不在 main 上，但必须基于 main）
function isAncestor(ancestor, descendant) {
  try {
    execSync(`git merge-base --is-ancestor ${ancestor} ${descendant}`, {
      cwd: root,
      stdio: "pipe",
    });
    return true;
  } catch {
    return false;
  }
}

if (!isAncestor("origin/main", "HEAD")) {
  console.error("❌ 当前 HEAD 不是 main 分支之后的提交");
  console.error("   请确保已基于最新的 main 分支开发");
  process.exit(1);
}

// ── 4. check-all（先验证，不改文件）──────────────────────────
console.log("🔍 执行 check-all ...");
try {
  run("npm run check-all");
  console.log("✅ check-all 通过\n");
} catch {
  console.error("❌ check-all 失败，请修复后再发版");
  process.exit(1);
}

// ── 5. 更新版本号（check-all 通过后才改）─────────────────────
const changelogPath = resolve(root, "CHANGELOG.md");
if (!existsSync(changelogPath)) {
  writeFileSync(
    changelogPath,
    "# Changelog\n\n所有对本项目的重要变动都会记录在此文件中。\n\n",
    "utf-8",
  );
}

for (const { path: rel, label } of [
  { path: "package.json", label: "package.json" },
  { path: "public/plugin.json", label: "plugin.json" },
]) {
  const fp = resolve(root, rel);
  const raw = readFileSync(fp, "utf-8");
  const next = raw.replace(/("version"\s*:\s*")[^"]+(")/, `$1${version}$2`);
  if (raw !== next) {
    writeFileSync(fp, next, "utf-8");
    console.log(`✅ ${label} → ${version}`);
  }
}

// ── 6. 生成 CHANGELOG ─────────────────────────────────────────
console.log("\n📝 生成 CHANGELOG.md ...");
for (const cmd of [
  `git-cliff --unreleased --prepend CHANGELOG.md --offline --tag "${tag}"`,
  `git-cliff --latest --prepend CHANGELOG.md --offline --tag "${tag}"`,
]) {
  try {
    run(cmd);
    break;
  } catch {}
}

// ── 8. commit + tag ──────────────────────────────────────────
console.log("\n📦 提交中 ...");
run(`git add package.json public/plugin.json CHANGELOG.md`);
run(`git add -u`);
run(`git commit -m "${commitMsg}"`);
run(`git tag ${tag}`);
console.log(`✅ commit: ${commitMsg}`);
console.log(`✅ tag: ${tag}`);

// ── 9. 提示下一步 ────────────────────────────────────────────
console.log(`
🎉 版本 ${version} 已在本地就绪！

   下一步：

   1. git branch release_${version}    从当前 commit 创建 release 分支
   2. git checkout main                切换到 main
   3. git merge release_${version} --ff-only    快进合并到 main
   4. git push origin main --tags      推送 main 和 tag 到远程
   5. npm run publish                  发布到插件商

   or 单条命令：
   git branch release_${version} && git checkout main && git merge release_${version} --ff-only && git push origin main --tags && npm run publish
`);
