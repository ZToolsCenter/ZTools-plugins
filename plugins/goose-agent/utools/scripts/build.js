import fs from "node:fs";
import path from "node:path";

const distDir = path.resolve("dist-utools");
const rootDir = path.resolve(".");
const incompatibleCssPatterns = [
  ["color-mix()", /color-mix\s*\(/i],
  ["oklch()", /oklch\s*\(/i],
  ["oklab()", /oklab\s*\(/i],
  ["lab()", /(^|[^a-z-])lab\s*\(/i],
  ["lch()", /(^|[^a-z-])lch\s*\(/i],
];

/**
 * uTools / Chromium 108：剥掉现代颜色函数与仅用于 color-mix 探测的 @supports。
 * HeroUI v3 主题默认 oklch + @supports(color-mix) 计算值；运行时靠 index.css 的 hex 覆盖。
 * 此处把残留 oklch/color-mix 声明清空为 transparent，避免旧内核整条声明失效且过构建门禁。
 */
function sanitizeCssForChrome108(css) {
  let out = css;

  // Tailwind preflight placeholder 渐进增强（历史特判）
  out = out.replace(
    /@supports\s*\(color:color-mix\(in lab,\s*red,\s*red\)\)\{::placeholder\{color:color-mix\(in oklab,\s*currentcolor 50%,\s*transparent\)\}\}/gi,
    "",
  );

  // 剥掉所有 color-mix 能力探测的 @supports 块（含一层嵌套规则）
  let prev;
  do {
    prev = out;
    out = out.replace(
      /@supports\s*\(\s*color\s*:\s*color-mix\([^)]*\)\s*\)\s*\{(?:[^{}]|\{[^{}]*\})*\}/gi,
      "",
    );
  } while (out !== prev);

  // 残留现代颜色函数 → transparent（后续 hex token 覆盖生效）
  // oklch/oklab 参数内无嵌套括号；color-mix 可能含逗号与空格
  out = out.replace(/oklch\([^)]*\)/gi, "transparent");
  out = out.replace(/oklab\([^)]*\)/gi, "transparent");
  out = out.replace(/color-mix\([^;{}]*\)/gi, "transparent");
  // 独立 lab()/lch()（避免误伤 --tw-leading 等）
  out = out.replace(/(^|[^a-z-])lab\([^)]*\)/gi, "$1transparent");
  out = out.replace(/(^|[^a-z-])lch\([^)]*\)/gi, "$1transparent");

  return out;
}

if (!fs.existsSync(distDir)) {
  console.error("dist-utools 目录不存在");
  process.exit(1);
}

try {
  for (const file of fs.readdirSync(path.join(distDir, "assets"))) {
    if (!file.endsWith(".css")) continue;
    const cssPath = path.join(distDir, "assets", file);
    const css = fs.readFileSync(cssPath, "utf-8");
    const compatibleCss = sanitizeCssForChrome108(css);
    fs.writeFileSync(cssPath, compatibleCss);

    const unsupported = incompatibleCssPatterns.find(([, pattern]) =>
      pattern.test(compatibleCss),
    );
    if (unsupported) {
      throw new Error(
        `${file} 仍包含 Chrome 108 不支持的 ${unsupported[0]} 颜色语法`,
      );
    }
  }

  const preloadSrc = path.join(rootDir, "utools/preload.cjs");
  if (fs.existsSync(preloadSrc)) {
    fs.copyFileSync(preloadSrc, path.join(distDir, "preload.js"));
  }

  // 与 preload 同级，保证 dist 内 require('./utools.js') 可解析
  const utoolsHostSrc = path.join(rootDir, "utools/utools.js");
  if (fs.existsSync(utoolsHostSrc)) {
    fs.copyFileSync(utoolsHostSrc, path.join(distDir, "utools.js"));
  }

  fs.writeFileSync(
    path.join(distDir, "package.json"),
    JSON.stringify({ type: "commonjs" }),
  );

  const logoSrc = path.join(rootDir, "public/logo.png");
  if (fs.existsSync(logoSrc)) {
    fs.copyFileSync(logoSrc, path.join(distDir, "logo.png"));
  }

  const pluginConfigPath = path.join(rootDir, "utools/plugin.json");
  if (fs.existsSync(pluginConfigPath)) {
    const pluginConfig = JSON.parse(
      fs.readFileSync(pluginConfigPath, "utf-8"),
    );
    pluginConfig.main = "index.html";
    pluginConfig.preload = "preload.js";
    fs.writeFileSync(
      path.join(distDir, "plugin.json"),
      JSON.stringify(pluginConfig, null, 2),
    );
  } else {
    console.error("未找到 plugin.json");
    process.exit(1);
  }

  function removeMapFiles(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        removeMapFiles(full);
      } else if (entry.name.endsWith(".map")) {
        fs.unlinkSync(full);
      }
    }
  }

  // GOOSE_DEBUG=1：保留 .map，让 uTools 开发者工具能映射回 src/ 源码；
  // 正式发布：删除 .map，避免分发包体积膨胀与源码暴露。
  const isDebugBuild = process.env.GOOSE_DEBUG === "1";
  if (isDebugBuild) {
    console.log("\n⚙ GOOSE_DEBUG=1：保留 sourcemap(.map)，跳过 removeMapFiles()");
  } else {
    removeMapFiles(distDir);
  }

  console.log(
    `\n✓ uTools ${isDebugBuild ? "可调试" : ""}构建完成 → ${path.relative(rootDir, distDir)}/`,
  );
} catch (e) {
  console.error(e);
  process.exit(1);
}
