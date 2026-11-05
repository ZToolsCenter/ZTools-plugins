#!/usr/bin/env bash
# ============================================================
# 打包 科研小盒 (micro-tools) 为 ZTools 可安装的 .zpx
#
# .zpx 格式 = brotli 压缩的 Electron ASAR（ZTools ≥ 2.3.1 采用；
#            ZTools 安装时先解压，再按 ASAR 读取 plugin.json）
#
# 用法：  bash pack.sh [输出路径]          （默认正式版本路径，预览版请另指定）
# 产物：  ../micro-tools-v<版本>.zpx      （生成在插件目录上一级，方便直接分发）
#
# 关键：只打包明确列出的运行文件，绝不包含密钥、测试输入、测试脚本或临时文件。
# ============================================================
set -euo pipefail
cd "$(dirname "$0")"

[ -f plugin.json ] || { echo "❌ 未找到 plugin.json，请在插件项目根目录运行。" >&2; exit 1; }

# 从 plugin.json 读取版本号，用于产物命名（版本统一以 plugin.json 为准）
VERSION="$(grep -o '"version"[[:space:]]*:[[:space:]]*"[^"]*"' plugin.json | head -1 | sed -E 's/.*"([^"]+)"$/\1/')"
[[ -n "$VERSION" ]] || { echo "❌ 无法从 plugin.json 读取 version。" >&2; exit 1; }
OUT="${1:-../micro-tools-v${VERSION}.zpx}"

FILE_LIST="$(mktemp)"
trap 'rm -f "$FILE_LIST"' EXIT
printf '%s\n' plugin.json preload.js features/journals/journal-tools.js index.html index.js index.css features/research/research.css \
  features/research/research-core.js features/research/research-metrics.js features/research/research-report.js features/research/research-prompts.js features/research/research-service.js features/research/research-ui.js shared/local-credentials.js shared/ai-connection.js \
  features/research/research-tools.js features/research/research-agent-report.js \
  features/english/english-core.js features/english/english-generation.js features/english/english-agent.js features/english/english-ui.js features/english/english-extras.js features/english/english-translation.js features/english/english-network.js features/english/english-catalog.js features/english/english-domains.js features/english/english-community.js features/english/english-community-service.js assets/data/english-catalog-default.json features/english/english.css assets/data/english-seed.json assets/data/english-wordbook-biomedical.json features/english/english-service.js features/english/english-activity.js features/english/english-dictionary.js features/english/english-wordbooks.js features/english/english-wordbook-ui.js features/english/english-sheet-worker.js vendor/sheetjs/xlsx.full.min.js vendor/sheetjs/LICENSE vendor/sheetjs/README.md \
  features/english/english-recorder.js features/english/english-sounds.js features/english/english-prepared-audio.js assets/audio/english-starter-audio.json features/english/english-speech.js vendor/ms-edge-tts/english-speech-token.js vendor/ms-edge-tts/english-speech-vendor.cjs features/english/english-audio-loader.js features/english/english-pdf.mjs vendor/pdfjs/english-pdf-vendor.mjs vendor/pdfjs/english-pdf-worker.mjs vendor/ENGLISH-LICENSES.txt vendor/lucide/LICENSE vendor/lucide/brain.svg vendor/lucide/chart-no-axes-column.svg vendor/lucide/chart-no-axes-combined.svg vendor/lucide/circuit-board.svg vendor/lucide/cog.svg vendor/lucide/cpu.svg vendor/lucide/dna.svg vendor/lucide/earth.svg vendor/lucide/flask-conical.svg vendor/lucide/gem.svg vendor/lucide/graduation-cap.svg vendor/lucide/heart-pulse.svg vendor/lucide/microscope.svg vendor/lucide/network.svg vendor/lucide/orbit.svg vendor/lucide/pill.svg vendor/lucide/stethoscope.svg vendor/lucide/wheat.svg \
  assets/audio/english-voice-samples/andrew.mp3 assets/audio/english-voice-samples/ava.mp3 assets/audio/english-voice-samples/emma.mp3 assets/audio/english-voice-samples/ryan.mp3 assets/audio/english-voice-samples/sonia.mp3 assets/audio/english-voice-samples/manifest.json \
  assets/data/english-catalog-samples/catalog.json assets/data/english-catalog-samples/communication.json assets/data/english-catalog-samples/bioinformatics.json assets/data/english-catalog-samples/paper-reading.json assets/data/english-catalog-samples/README.md \
  assets/data/journals/manifest.json assets/data/journals/2026-v1/journals.json.gz assets/data/journals/2026-v1/ccf.json.gz assets/images/logo.png assets/images/logo.svg assets/images/agent-guide-material.png assets/images/agent-guide-prompt.png assets/images/agent-guide-preview.png README.md CHANGELOG.md docs/images/home.png docs/english-material-spec-v1.md docs/materials/english-material-v1.schema.json docs/materials/course-example.json docs/materials/wordbook-example.json > "$FILE_LIST"
printf '%s\n' vendor/proxy/node_modules/https-proxy-agent/LICENSE vendor/proxy/node_modules/https-proxy-agent/package.json vendor/proxy/node_modules/https-proxy-agent/dist/index.js vendor/proxy/node_modules/https-proxy-agent/dist/parse-proxy-response.js vendor/proxy/node_modules/agent-base/LICENSE vendor/proxy/node_modules/agent-base/package.json vendor/proxy/node_modules/agent-base/dist/index.js vendor/proxy/node_modules/agent-base/dist/helpers.js vendor/proxy/node_modules/debug/LICENSE vendor/proxy/node_modules/debug/package.json vendor/proxy/node_modules/debug/src/index.js vendor/proxy/node_modules/debug/src/node.js vendor/proxy/node_modules/debug/src/common.js vendor/proxy/node_modules/debug/src/browser.js vendor/proxy/node_modules/ms/index.js vendor/proxy/node_modules/ms/license.md vendor/proxy/node_modules/ms/package.json vendor/proxy/README.md >> "$FILE_LIST"
while IFS= read -r f; do
  [ -f "$f" ] || { echo "❌ 缺少运行文件：$f" >&2; exit 1; }
done < "$FILE_LIST"

node scripts/check-package.cjs --sources "$PWD" "$FILE_LIST" "$OUT"

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
  const parts = f.split("/"); let dir = tree;
  for (const segment of parts.slice(0, -1)) dir = (dir[segment] ||= {files:{}}).files;
  dir[parts[parts.length-1]] = { size: buf.length, offset: String(off) };
  off += buf.length; chunks.push(buf);
}
const json = Buffer.from(JSON.stringify({ files: tree }), "utf8");
const paddedLen = Math.ceil((4 + json.length) / 4) * 4;
const headerPayload = Buffer.alloc(paddedLen);
headerPayload.writeUInt32LE(json.length, 0);
json.copy(headerPayload, 4);
const head = Buffer.alloc(12);
head.writeUInt32LE(4, 0);
head.writeUInt32LE(4 + paddedLen, 4);
head.writeUInt32LE(paddedLen, 8);
const asar = Buffer.concat([head, headerPayload, ...chunks]);
fs.writeFileSync(OUT, zlib.brotliCompressSync(asar));
console.log("✔ 已生成 " + OUT + " (" + fs.statSync(OUT).size + " B，包内 " + list.length + " 个文件)");
' "$PWD" "$OUT" "$FILE_LIST"

# 校验真实安装包，避免源码可运行但漏打运行依赖。
node scripts/check-package.cjs "$OUT"

# 校验：解回 ASAR 并列出包内文件（应只见运行文件，无 .git / .DS_Store）
echo "--- 包内文件 ---"
node -e '
const fs = require("fs"), zlib = require("zlib");
const b = zlib.brotliDecompressSync(fs.readFileSync(process.argv[1]));
const jl = b.readUInt32LE(12);
const h = JSON.parse(b.slice(16, 16 + jl).toString("utf8"));
function listFiles(files, prefix="") { for (const [n,m] of Object.entries(files)) { const name=prefix+n; if(m.files) listFiles(m.files,name+"/"); else console.log("  /"+name+"  "+m.size+" B"); } }
listFiles(h.files);
' "$OUT"

echo "✅ 打包完成：${OUT}"
