import fs from "node:fs";
import path from "node:path";

const distDir = path.resolve("dist-utools");
const rootDir = path.resolve(".");
const incompatibleCssPatterns = [
  ["color-mix()", /color-mix\s*\(/i],
  ["oklch()", /oklch\s*\(/i],
  ["lab()", /(^|[^a-z-])lab\s*\(/i],
  ["lch()", /(^|[^a-z-])lch\s*\(/i],
];

if (!fs.existsSync(distDir)) {
  console.error("dist-utools 目录不存在");
  process.exit(1);
}

try {
  for (const file of fs.readdirSync(path.join(distDir, "assets"))) {
    if (!file.endsWith(".css")) continue;
    const cssPath = path.join(distDir, "assets", file);
    const css = fs.readFileSync(cssPath, "utf-8");
    // Tailwind 4 的 preflight 会生成一段仅用于现代浏览器的 placeholder
    // 渐进增强。项目已有显式 placeholder 颜色，uTools/Chrome 108 不需要它。
    const compatibleCss = css.replace(
      /@supports\s*\(color:color-mix\(in lab,\s*red,\s*red\)\)\{::placeholder\{color:color-mix\(in oklab,\s*currentcolor 50%,\s*transparent\)\}\}/gi,
      "",
    );
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
