// ONNX 公式识别（LaTeX OCR）独立服务进程，用于 native-ocr ZTools 插件。
// 镜像 onnx_ocr_server.mjs 的协议：stdin/stdout 走换行分隔 JSON。
//   <- {"id": 1, "imagePath": "/path/img.png"}
//   -> {"event": "ready"}
//   -> {"id": 1, "ok": true, "text": "\\frac{a}{b}", "items": [{"text": "..."}]}
//   -> {"id": 1, "ok": false, "error": "..."}
//   -> {"event": "fatal", "error": "..."}
// 推理核心在 onnx_formula_core.mjs（可被 import）；本文件只是协议薄封装，零行为变化。
// 模型来自 RapidAI/RapidLaTeXOCR（MIT）的 GitHub Release v0.0.0。

import path from 'node:path';
import { loadFormulaSessions, recognizeFormula } from './onnx_formula_core.mjs';

const IDLE_TIMEOUT = 60 * 60; // 识别后冷启动 2-4s，15min 太短——延长到 60min，降低二次使用的等待

async function main() {
  const sessions = await loadFormulaSessions().catch((err) => {
    process.stdout.write(JSON.stringify({ event: 'fatal', error: `公式模型加载失败：${err && err.message ? err.message : err}` }) + '\n');
    process.exit(1);
  });

  const timer = setTimeout(() => process.exit(0), IDLE_TIMEOUT * 1000);
  timer.unref?.();
  process.stdout.write(JSON.stringify({ event: 'ready' }) + '\n');

  let buffer = '';
  for await (const chunk of process.stdin) {
    buffer += chunk.toString('utf8');
    let nl;
    while ((nl = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (!line) continue;
      let request;
      try { request = JSON.parse(line); } catch (_) { continue; }
      const response = { id: request.id };
      try {
        const imagePath = String(request.imagePath || '');
        if (!imagePath) throw new Error('imagePath is required');
        if (path.extname(imagePath).toLowerCase() === '.webp') {
          throw new Error('公式识别暂不支持 WebP，请转存 PNG');
        }
        const r = await recognizeFormula(sessions, imagePath, { withScore: true });
        response.ok = true;
        response.text = r.text;
        // decodeScore = 解码器长度归一平均对数概率，供前端置信度可视化。
        response.decodeScore = Number.isFinite(r.raw) ? r.raw : null;
        response.items = [{ text: r.text, decodeScore: response.decodeScore }];
      } catch (err) {
        response.ok = false;
        response.error = err && err.message ? err.message : String(err);
      }
      process.stdout.write(JSON.stringify(response) + '\n');
      timer.refresh?.();
    }
  }
  process.exit(0);
}

main().catch((err) => {
  process.stdout.write(JSON.stringify({ event: 'fatal', error: err && err.message ? err.message : String(err) }) + '\n');
  process.exit(1);
});
