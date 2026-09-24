/* 把 vite 构建产物 dist/ 组装成 uTools 插件目录 utools-dist/。
   产物结构：index.html + assets/ + preload.js + plugin.json + logo.png
   用法：bun run build:utools（会先 vite build --mode utools） */
import { cpSync, mkdirSync, rmSync, existsSync, copyFileSync, writeFileSync, readdirSync, unlinkSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");
const dist = resolve(root, "dist");
const out = resolve(root, "utools-dist");
const utoolsDir = resolve(root, "utools");
const packageJson = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));

// GOOSE_DEBUG=1：保留 .map，方便在 uTools 开发者工具里调试未压缩源码。
// 正式发布（未设置）：剥离 .map，保持离线包整洁、不外泄源码映射。
const isDebug = process.env.GOOSE_DEBUG === "1";

if (!existsSync(dist)) {
  console.error("✗ dist/ 不存在，请先运行 vite build --mode utools");
  process.exit(1);
}

// Chromium 108 兼容红线：构建产物不得包含 uTools 7.8 无法解析的现代颜色语法。
const forbiddenColorSyntax = /color-mix\(|oklch\(|(?:^|[^a-z])lab\(|(?:^|[^a-z])lch\(/i;
for (const file of readdirSync(resolve(dist, "assets"))) {
  if (!file.endsWith(".css")) continue;
  const css = readFileSync(resolve(dist, "assets", file), "utf8");
  if (forbiddenColorSyntax.test(css)) {
    throw new Error(`uTools Chromium 108 不兼容：dist/assets/${file} 含现代颜色语法`);
  }
}

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

// 1. 拷贝前端构建产物
cpSync(dist, out, { recursive: true });

// 1b. 正式发布剥离 sourcemap（debug 构建保留）
if (!isDebug) {
  const assetsDir = resolve(out, "assets");
  if (existsSync(assetsDir)) {
    let removed = 0;
    for (const f of readdirSync(assetsDir)) {
      if (f.endsWith(".map")) {
        unlinkSync(resolve(assetsDir, f));
        removed++;
      }
    }
    if (removed) console.log(`  ↳ 已剥离 ${removed} 个 sourcemap（正式发布）`);
  }
}

// 2. 拷贝 preload.js、它的纯逻辑依赖 + plugin.json
copyFileSync(resolve(utoolsDir, "preload.js"), resolve(out, "preload.js"));
copyFileSync(resolve(utoolsDir, "process-role.cjs"), resolve(out, "process-role.cjs"));
copyFileSync(resolve(utoolsDir, "plugin-state.cjs"), resolve(out, "plugin-state.cjs"));
copyFileSync(resolve(utoolsDir, "window-provider.cjs"), resolve(out, "window-provider.cjs"));
copyFileSync(resolve(utoolsDir, "network-provider.cjs"), resolve(out, "network-provider.cjs"));
copyFileSync(resolve(utoolsDir, "port-provider.cjs"), resolve(out, "port-provider.cjs"));
copyFileSync(resolve(utoolsDir, "plugin.json"), resolve(out, "plugin.json"));

// 3. logo：使用仓库内专用的 256×256 PNG；构建时直接解析 PNG 头验证，跨平台一致。
const logoSrc = resolve(utoolsDir, "logo.png");
const logoOut = resolve(out, "logo.png");
if (!existsSync(logoSrc)) throw new Error("utools/logo.png 不存在");
const logo = readFileSync(logoSrc);
if (logo.length < 24 || logo.toString("hex", 1, 4) !== "504e47") {
  throw new Error("utools/logo.png 不是有效 PNG");
}
const logoWidth = logo.readUInt32BE(16);
const logoHeight = logo.readUInt32BE(20);
if (logoWidth > 256 || logoHeight > 256) {
  throw new Error(`uTools logo 尺寸必须 ≤256×256，当前为 ${logoWidth}×${logoHeight}`);
}
copyFileSync(logoSrc, logoOut);

// 4. 明确声明 CommonJS，保证 preload.js 在任何 Node 加载器下都按 CJS 解析
writeFileSync(
  resolve(out, "package.json"),
  JSON.stringify({ name: "prockill-utools", version: packageJson.version, type: "commonjs" }, null, 2)
);

console.log("✓ uTools 插件已生成: " + out);
console.log("  在 uTools 开发者工具中以「项目目录」方式加载该文件夹，或打包成 .upx 分发。");
