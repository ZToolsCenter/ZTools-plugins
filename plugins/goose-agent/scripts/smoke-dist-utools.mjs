#!/usr/bin/env node
/**
 * 无真机依赖的 dist-utools 冒烟：校验插件包结构与元数据。
 * 用法：先 `bun run build`，再 `node scripts/smoke-dist-utools.mjs`
 * 真机 E2E 仍见 scripts/e2e-utools-checklist.md
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, "dist-utools");
const errors = [];

function ok(cond, msg) {
  if (!cond) errors.push(msg);
}

ok(existsSync(dist), `缺少目录 ${dist}（请先 bun run build）`);

if (existsSync(dist)) {
  const pluginPath = join(dist, "plugin.json");
  ok(existsSync(pluginPath), "缺少 plugin.json");
  ok(existsSync(join(dist, "index.html")), "缺少 index.html");
  ok(existsSync(join(dist, "preload.js")), "缺少 preload.js");
  ok(existsSync(join(dist, "utools.js")), "缺少 utools.js（宿主能力模块）");
  ok(existsSync(join(dist, "logo.png")), "缺少 logo.png");

  if (existsSync(pluginPath)) {
    const plugin = JSON.parse(readFileSync(pluginPath, "utf8"));
    ok(plugin.pluginName === "鹅的 Agent", `pluginName 期望「鹅的 Agent」，实为 ${plugin.pluginName}`);
    ok(plugin.main === "index.html", "main 应为 index.html");
    ok(
      plugin.preload === "preload.js" || plugin.preload === "preload.cjs",
      `preload 异常: ${plugin.preload}`,
    );
    ok(
      plugin.pluginSetting?.height === 800,
      `pluginSetting.height 期望 800，实为 ${plugin.pluginSetting?.height}`,
    );
    const features = Array.isArray(plugin.features) ? plugin.features : [];
    ok(features.length > 0, "features 为空");
    const codes = features.map((f) => f?.code);
    ok(codes.includes("gooseAgent"), `features.code 需含 gooseAgent，实为 ${codes.join(",")}`);
    const cmds = features.flatMap((f) => f?.cmds ?? []);
    ok(
      cmds.some((c) => String(c).includes("Agent") || String(c).includes("鹅")),
      `cmds 应含 Agent/鹅 相关入口，实为 ${JSON.stringify(cmds)}`,
    );
  }

  const preloadPath = join(dist, "preload.js");
  if (existsSync(preloadPath)) {
    const preloadSrc = readFileSync(preloadPath, "utf8");
    ok(
      /require\s*\(\s*['"]\.\/utools\.js['"]\s*\)/.test(preloadSrc),
      "preload.js 应 require('./utools.js')",
    );
  }

  const assets = join(dist, "assets");
  if (existsSync(assets)) {
    const files = readdirSync(assets);
    ok(files.some((f) => f.endsWith(".js")), "assets 下无 js 产物");
    ok(files.some((f) => f.endsWith(".css")), "assets 下无 css 产物");

    // 入口与懒加载 chunk 引用完整性：避免重建后旧 hash 残留导致
    // Failed to fetch dynamically imported module
    const html = readFileSync(join(dist, "index.html"), "utf8");
    const entryMatch = html.match(/src="\.\/assets\/(index-[^"]+\.js)"/);
    if (entryMatch) {
      const entryFile = entryMatch[1];
      ok(files.includes(entryFile), `index.html 入口缺失: ${entryFile}`);
      if (files.includes(entryFile)) {
        const entrySrc = readFileSync(join(assets, entryFile), "utf8");
        const mapMatch = entrySrc.match(/m\.f\|\|\(m\.f=(\[[^\]]+\])/);
        if (mapMatch) {
          const refs = [...mapMatch[1].matchAll(/"\.\/([^"]+\.js)"/g)].map(
            (m) => m[1],
          );
          for (const ref of refs) {
            ok(
              existsSync(join(assets, ref)),
              `懒加载/依赖 chunk 缺失: assets/${ref}`,
            );
          }
          ok(
            refs.some((r) => r.startsWith("automations-")),
            "mapDeps 未包含 automations 懒加载 chunk",
          );
        } else {
          // 无 mapDeps 时至少检查 index.html 的 modulepreload
          const preloads = [
            ...html.matchAll(/href="\.\/assets\/([^"]+\.js)"/g),
          ].map((m) => m[1]);
          for (const ref of preloads) {
            ok(
              files.includes(ref),
              `modulepreload 缺失: assets/${ref}`,
            );
          }
        }
      }
    } else {
      errors.push("index.html 未找到 assets/index-*.js 入口");
    }
  } else {
    // 允许单文件构建形态
    const top = readdirSync(dist);
    ok(
      top.some((f) => f.endsWith(".js")) || existsSync(assets),
      "未见 js 产物",
    );
  }
}

if (errors.length) {
  console.error("[smoke-dist-utools] FAIL");
  for (const e of errors) console.error(" -", e);
  process.exit(1);
}

console.log("[smoke-dist-utools] OK — dist-utools 元数据与产物结构通过");
console.log("真机 E2E 请按 scripts/e2e-utools-checklist.md 在 uTools 内勾选。");
