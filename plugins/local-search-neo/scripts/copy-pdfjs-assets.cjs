const fs = require("node:fs");
const path = require("node:path");

const rootDir = path.resolve(__dirname, "..");
const source = path.join(rootDir, "node_modules", "pdfjs-dist", "wasm");
const target = path.join(rootDir, "public", "pdfjs", "wasm");

if (!fs.existsSync(source)) {
  throw new Error(`PDF.js wasm 资源目录不存在：${source}`);
}

fs.rmSync(target, { force: true, recursive: true });
fs.mkdirSync(path.dirname(target), { recursive: true });
fs.cpSync(source, target, { recursive: true });

console.log(`已复制 ${path.relative(rootDir, source)} -> ${path.relative(rootDir, target)}`);
