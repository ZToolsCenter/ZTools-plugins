#!/usr/bin/env bash
# ============================================================
# 打包 科研小盒 (micro-tools) 为 ZTools 可安装的 .zpx
#
# .zpx 格式 = brotli 压缩的 Electron ASAR（ZTools ≥ 2.3.1 采用；
#            ZTools 安装时先解压，再按 ASAR 读取 plugin.json）
#
# 用法：  bash pack.sh                    （在插件项目根目录执行）
# 产物：  ../micro-tools-v<版本>.zpx      （生成在插件目录上一级，方便直接分发）
#
# 关键：只打包「git 跟踪的运行文件」，绝不包含 .git / .DS_Store /
#       node_modules / 本脚本 / 未跟踪的临时文件。
# ============================================================
set -euo pipefail
cd "$(dirname "$0")"

[ -f plugin.json ] || { echo "❌ 未找到 plugin.json，请在插件项目根目录运行。" >&2; exit 1; }

# 从 plugin.json 读取版本号，用于产物命名（版本统一以 plugin.json 为准）
VERSION="$(grep -o '"version"[[:space:]]*:[[:space:]]*"[^"]*"' plugin.json | head -1 | sed -E 's/.*"([^"]+)"$/\1/')"
[[ -n "$VERSION" ]] || { echo "❌ 无法从 plugin.json 读取 version。" >&2; exit 1; }
OUT="../micro-tools-v${VERSION}.zpx"

# 收集要打包的文件：git 跟踪文件（天然排除 .git / node_modules / 未跟踪文件），
# 再排除开发类文件：.gitignore、本打包脚本
if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "❌ 不在 git 仓库内：请先 git init && git add . && git commit（依赖 git 跟踪列表排除 .git）。" >&2
  exit 1
fi
git ls-files | grep -vE '^(\.gitignore|pack\.sh)$' > /tmp/mt_pack_files.txt
[ -s /tmp/mt_pack_files.txt ] || { echo "❌ 没有可打包的文件（git ls-files 为空），请先 git add 并提交。" >&2; exit 1; }

# 把文件复制到临时干净目录（保持目录结构）
TMP_SRC="$(mktemp -d)"
TMP_ASAR="${TMP_SRC}/plugin.asar"
while IFS= read -r f; do
  mkdir -p "${TMP_SRC}/$(dirname "$f")"
  cp "$f" "${TMP_SRC}/$f"
done < /tmp/mt_pack_files.txt

# 构造 ASAR 并 brotli 压缩为 .zpx（node 内置能力，无需安装 @electron/asar / 联网）
#
# ASAR 布局（与 @electron/asar 完全一致）：
#   [u32 4][u32 8+jsonLen][u32 4+jsonLen][u32 jsonLen][json][数据区]
#   文件元信息里 offset 为相对数据区起点的偏移（字符串形式）
node -e '
const fs = require("fs"), path = require("path"), zlib = require("zlib");
const SRC = process.argv[1], OUT = process.argv[2];
const list = fs.readFileSync(process.argv[3], "utf8").trim().split("\n").filter(Boolean);
const chunks = []; let off = 0; const tree = {};
for (const f of list) {
  const buf = fs.readFileSync(path.join(SRC, f));
  tree[f] = { size: buf.length, offset: String(off) };
  off += buf.length; chunks.push(buf);
}
const json = Buffer.from(JSON.stringify({ files: tree }), "utf8");
const head = Buffer.alloc(16);
head.writeUInt32LE(4, 0);
head.writeUInt32LE(8 + json.length, 4);
head.writeUInt32LE(4 + json.length, 8);
head.writeUInt32LE(json.length, 12);
const asar = Buffer.concat([head, json, ...chunks]);
fs.writeFileSync(OUT, zlib.brotliCompressSync(asar));
console.log("✔ 已生成 " + OUT + " (" + fs.statSync(OUT).size + " B，包内 " + list.length + " 个文件)");
' "$PWD" "$OUT" /tmp/mt_pack_files.txt

# 校验：解回 ASAR 并列出包内文件（应只见运行文件，无 .git / .DS_Store）
echo "--- 包内文件 ---"
node -e '
const fs = require("fs"), zlib = require("zlib");
const b = zlib.brotliDecompressSync(fs.readFileSync(process.argv[1]));
const jl = b.readUInt32LE(12);
const h = JSON.parse(b.slice(16, 16 + jl).toString("utf8"));
for (const [n, m] of Object.entries(h.files)) console.log("  /" + n + "  " + m.size + " B");
' "$OUT"

rm -rf "$TMP_SRC" /tmp/mt_pack_files.txt
echo "✅ 打包完成：${OUT}"
