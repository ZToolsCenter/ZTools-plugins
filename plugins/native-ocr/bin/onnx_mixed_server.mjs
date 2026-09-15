// 图文混排服务进程：MFD 检测公式区域 → 裁切 → 调用现有公式引擎识别 → 与文本行按阅读顺序合并。
// 协议与 onnx_formula_server.mjs / onnx_ocr_server.mjs 完全一致（stdin/stdout 走换行分隔 JSON）：
//   <- {"id":1,"op":"detect"|"mixed"|"formulas","imagePath":"/abs.png","boxes":[...],
//        "textLines":[{text,box,chars:[{c,box}]}],"longSide":768,"conf":0.25,"iou":0.7,
//        "boxPad":2,"filterTinyText":true}
//   -> {"event":"ready"} / {"event":"fatal","error":"..."}
//   -> {"id":1,"ok":true,"engine":"mixed","image":{w,h},"boxes":[...],"segments":[...],"markdown":"...","raw":{...}}
//   -> {"id":1,"ok":true,"engine":"formulas","image":{w,h},"items":[{type,score,box,latex}]}
// 注：op 缺省视为 "mixed"；op="detect" 仅做 MFD 检测（供 UI 画框）；op="formulas" 检测+逐框识别、
//     不做文本合并（供「公式识别」页签一图多公式）。boxPad 为公式框裁剪外扩像素数（0–40，默认 2）。
//     filterTinyText（默认 true）：识别结果为纯 1–2 个字母/数字的「疑似普通文字」框（MFD 对普通
//     段落里的单字母/双字母的误检）直接丢弃，不进 items / 不参与文本合并。

import os from 'node:os';
import path from 'node:path';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { PNG } from 'pngjs';
import { ImageRaw } from './onnx_image_raw.mjs';
import { loadFormulaSessions, recognizeFormula } from './onnx_formula_core.mjs';
import {
  detectFormulaBoxes,
  loadMfdSession,
  checkMfdModel,
  clampBoxPad,
  isTrivialFormulaLatex
} from './onnx_mfd_core.mjs';

const IDLE_TIMEOUT = 60 * 60; // 识别后冷启动 2-4s，15min 太短——延长到 60min，降低二次使用的等待

// 长驻服务：单张坏图（极端尺寸/奇异输入）可能触发原生推理异常。拦截未处理异常，
// 仅记录日志、不让整个进程退出——该次请求会由其调用方的超时机制判失败，而非拖垮服务。
process.on('uncaughtException', (err) => {
  process.stderr.write(`[mixed] uncaughtException: ${err && err.stack ? err.stack : err}\n`);
});
process.on('unhandledRejection', (reason) => {
  process.stderr.write(`[mixed] unhandledRejection: ${reason && reason.stack ? reason.stack : reason}\n`);
});

// 合并规则纯函数已抽至 onnx_mixed_merge.mjs（0.7.8：修复公式字形重复输出为文本，
// 供协议层与 tests/run.mjs 共用）。
import {
  mergeSegments,
  filterCjkFormulaBoxes,
} from './onnx_mixed_merge.mjs';

// ---------------------------------------------------------------------------
// 裁切工具
// ---------------------------------------------------------------------------

function cropToTempPng(src, box, margin = 2) {
  let [x1, y1, x2, y2] = box;
  x1 = Math.max(0, Math.floor(x1 - margin));
  y1 = Math.max(0, Math.floor(y1 - margin));
  x2 = Math.min(src.width, Math.ceil(x2 + margin));
  y2 = Math.min(src.height, Math.ceil(y2 + margin));
  const w = x2 - x1;
  const h = y2 - y1;
  if (w < 4 || h < 4) return null;
  const crop = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const si = ((y1 + y) * src.width + (x1 + x)) * 4;
      const di = (y * w + x) * 4;
      crop[di] = src.data[si];
      crop[di + 1] = src.data[si + 1];
      crop[di + 2] = src.data[si + 2];
      crop[di + 3] = 255;
    }
  }
  const png = new PNG({ width: w, height: h });
  png.data = Buffer.from(crop);
  const dir = mkdtempSync(path.join(os.tmpdir(), 'mfd-crop-'));
  const p = path.join(dir, 'crop.png');
  writeFileSync(p, PNG.sync.write(png));
  return { path: p, dir };
}

// ---------------------------------------------------------------------------
// 协议主循环
// ---------------------------------------------------------------------------

async function main() {
  // 启动即校验 MFD 与公式模型是否就绪，缺失则明确 fatal（二者必须都存在）。
  await checkMfdModel().catch((err) => {
    process.stdout.write(
      JSON.stringify({ event: 'fatal', error: `MFD 模型缺失：${err && err.message ? err.message : err}` }) + '\n'
    );
    process.exit(1);
  });
  const mfd = await loadMfdSession().catch((err) => {
    process.stdout.write(
      JSON.stringify({ event: 'fatal', error: `MFD 模型加载失败：${err && err.message ? err.message : err}` }) + '\n'
    );
    process.exit(1);
  });
  const formula = await loadFormulaSessions().catch((err) => {
    process.stdout.write(
      JSON.stringify({ event: 'fatal', error: `公式模型加载失败：${err && err.message ? err.message : err}` }) + '\n'
    );
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
        const longSide = Number(request.longSide) || 768;
        const conf = request.conf != null ? Number(request.conf) : 0.25;
        const iou = request.iou != null ? Number(request.iou) : 0.7;
        const boxPad = clampBoxPad(request.boxPad != null ? request.boxPad : 2);
        const filterTiny = request.filterTinyText !== false;
        const op = String(request.op || 'mixed');
        const src = await ImageRaw.open(imagePath);
        // 调用方若已自行 detect（UI 需要先画框、再遮罩公式区域后跑文本 OCR），可直接回传 boxes 复用，
        // 省掉一次重复推理。
        const given = Array.isArray(request.boxes) && request.boxes.length
          ? request.boxes
              .filter((b) => b && Array.isArray(b.box) && b.box.length === 4)
              .map((b) => ({
                type: b.type === 'isolated' ? 'isolated' : 'embedding',
                score: Number(b.score) || 0,
                box: b.box.map(Number),
              }))
          : null;
        const mfdResult = given
          ? { boxes: given, image: { w: src.width, h: src.height } }
          : await detectFormulaBoxes(mfd, src, { longSide, conf, iou });
        const boxes = mfdResult.boxes;

        if (op === 'detect') {
          response.ok = true;
          response.image = mfdResult.image;
          response.boxes = boxes;
          process.stdout.write(JSON.stringify(response) + '\n');
          timer.refresh?.();
          continue;
        }

        // op === "formulas"：多公式模式 —— 只检测+逐框识别，不做文本合并（供「公式识别」页签使用）。
        if (op === 'formulas') {
          const items = [];
          const tmpFiles = [];
          for (const b of boxes) {
            const item = { type: b.type, score: b.score, box: b.box, latex: '' };
            const crop = cropToTempPng(src, b.box, boxPad);
            if (crop) {
              tmpFiles.push(crop);
              // decodeScore = 解码器长度归一平均对数概率（raw），供前端置信度可视化。
              try {
                const r = await recognizeFormula(formula, crop.path, { withScore: true });
                item.latex = r.text;
                item.decodeScore = Number.isFinite(r.raw) ? r.raw : null;
              } catch (_) { item.latex = ''; }
            }
            // 疑似普通文字（纯 1–2 字母/数字）框：MFD 对段落单字母/双字母的误检，直接丢弃。
            if (filterTiny && isTrivialFormulaLatex(item.latex, item.type)) continue;
            items.push(item);
          }
          for (const c of tmpFiles) { try { rmSync(c.dir, { recursive: true, force: true }); } catch (_) {} }
          response.ok = true;
          response.engine = 'formulas';
          response.image = mfdResult.image;
          response.items = items;
          process.stdout.write(JSON.stringify(response) + '\n');
          timer.refresh?.();
          continue;
        }

        // op === "mixed"：识别每个公式框 + 合并
        const textLines = Array.isArray(request.textLines)
          ? request.textLines
              .filter((t) => t && t.text != null && Array.isArray(t.box) && t.box.length === 4)
              .map((t) => {
                const line = { text: String(t.text), box: t.box.map(Number) };
                // 逐字符框（可选）：用于把「一行文字里夹着行内公式」的整行按公式区间切开。
                // 需与 box 同一坐标空间（原图像素、左上原点），由调用方一并换算。
                if (Array.isArray(t.chars) && t.chars.length) {
                  line.chars = t.chars.map((ch) => {
                    if (!ch || !Array.isArray(ch.box) || ch.box.length !== 4) {
                      return { c: ch && ch.c, box: null };
                    }
                    return { c: ch && ch.c, box: ch.box.map(Number) };
                  });
                }
                return line;
              })
          : [];

        // 防呆：本服务要求 textLines 用「原图像素坐标、左上原点」。各文本引擎的坐标空间不同
        // （macOS Vision 返回归一化 0..1 且原点在左下），调用方必须先换算。这里只做提示，
        // 避免坐标空间不匹配时静默合并出乱序结果。
        const warnings = [];
        if (
          textLines.length > 0
          && mfdResult.image.w > 2
          && textLines.every((t) => t.box.every((v) => v >= -0.001 && v <= 1.001))
        ) {
          warnings.push(
            'textLines 的所有坐标都落在 0..1，疑似归一化坐标；'
            + '本服务要求原图像素坐标（左上原点），否则合并顺序与丢弃判定都会错。'
          );
        }

        const tmpFiles = [];
        const keptBoxes = [];
        // 0.7.14：先用逐字符框剔除「套在中文正文上」的 MFD 误检框（框内 CJK ≥2），
        // 既避免正文前缀被吞成乱码公式，也省掉这些误检框的公式解码开销。
        const candidates = filterCjkFormulaBoxes(boxes, textLines, warnings);
        for (const b of candidates) {
          const crop = cropToTempPng(src, b.box, boxPad);
          if (!crop) {
            b.latex = '';
            keptBoxes.push(b);
            continue;
          }
          tmpFiles.push(crop);
          try {
            // decodeScore = 解码器长度归一平均对数概率（raw），随 box 流向前端置信度可视化。
            const r = await recognizeFormula(formula, crop.path, { withScore: true });
            b.latex = r.text;
            b.decodeScore = Number.isFinite(r.raw) ? r.raw : null;
          } catch (_) {
            b.latex = '';
          }
          // 疑似普通文字（纯 1–2 字母/数字）框：MFD 对段落单字母/双字母的误检，
          // 从 boxes 移除后再合并——文本行保持原样，不会被切成假公式段。
          if (filterTiny && isTrivialFormulaLatex(b.latex, b.type)) continue;
          keptBoxes.push(b);
        }
        for (const c of tmpFiles) {
          try { rmSync(c.dir, { recursive: true, force: true }); } catch (_) {}
        }

        const { segments, markdown } = mergeSegments(keptBoxes, textLines, warnings);
        response.ok = true;
        response.engine = 'mixed';
        response.image = mfdResult.image;
        response.boxes = keptBoxes.map((b) => ({ type: b.type, score: b.score, box: b.box }));
        response.segments = segments;
        response.markdown = markdown;
        if (warnings.length) response.warnings = warnings;
        response.raw = { image: mfdResult.image, boxes: keptBoxes, textLines, segments };
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
