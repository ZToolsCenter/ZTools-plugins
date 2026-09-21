// 图文混排合并纯函数模块 —— 从 onnx_mixed_server.mjs 抽出，供协议层与 tests/run.mjs 共用。
// 坐标约定：box = [x1, y1, x2, y2] 原图像素、左上原点；文本行 chars = [{c, box}] 同坐标系。

// ---------------------------------------------------------------------------
// 合并规则（冻结，前端依赖）
// ---------------------------------------------------------------------------

export function vOverlapRatio(a, b) {
  const inter = Math.min(a[3], b[3]) - Math.max(a[1], b[1]);
  if (inter <= 0) return 0;
  const ha = a[3] - a[1];
  const hb = b[3] - b[1];
  const minH = Math.min(ha, hb);
  return minH > 0 ? inter / minH : 0;
}

export function iouOf(a, b) {
  const ix1 = Math.max(a[0], b[0]);
  const iy1 = Math.max(a[1], b[1]);
  const ix2 = Math.min(a[2], b[2]);
  const iy2 = Math.min(a[3], b[3]);
  const iw = Math.max(0, ix2 - ix1);
  const ih = Math.max(0, iy2 - iy1);
  const inter = iw * ih;
  const ua = (a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - inter;
  return ua <= 0 ? 0 : inter / ua;
}

// 文本行被公式框覆盖的水平比例（仅统计与文本行在垂直方向有交叠的公式框）。
export function horizontalCoverage(lineBox, formulaBoxes) {
  let covered = 0;
  for (const fb of formulaBoxes) {
    const iy1 = Math.max(fb.box[1], lineBox[1]);
    const iy2 = Math.min(fb.box[3], lineBox[3]);
    if (iy2 <= iy1) continue;
    const ix1 = Math.max(fb.box[0], lineBox[0]);
    const ix2 = Math.min(fb.box[2], lineBox[2]);
    if (ix2 > ix1) covered += ix2 - ix1;
  }
  const lw = lineBox[2] - lineBox[0];
  return lw > 0 ? covered / lw : 0;
}

// 规则1：把所有项（公式框 + 文本行）按垂直重叠比 > 0.5 聚成行（贪心）。
export function groupIntoLines(items) {
  const sorted = [...items].sort(
    (a, b) => a.box[1] - b.box[1] || a.box[0] - b.box[0]
  );
  const lines = [];
  for (const it of sorted) {
    let placed = false;
    for (const line of lines) {
      if (vOverlapRatio(it.box, line.box) > 0.5) {
        line.items.push(it);
        line.box = [
          Math.min(line.box[0], it.box[0]),
          Math.min(line.box[1], it.box[1]),
          Math.max(line.box[2], it.box[2]),
          Math.max(line.box[3], it.box[3]),
        ];
        placed = true;
        break;
      }
    }
    if (!placed) lines.push({ items: [it], box: [...it.box] });
  }
  return lines;
}

export function formulaMarkdown(type, latex) {
  if (type === 'isolated') return `$$\n${latex}\n$$`;
  return `$${latex}$`; // embedding
}

// 把一个文本行按公式框的横向区间切成**有序片段**（文本段 / 公式段交替），得到真正的
// 「图文混排」阅读顺序。依赖文本行上的逐字符框 chars（macOS Vision 的 boundingBox(for:)）。
// 缺少 chars、长度不匹配、或没有任何字符落在公式区内时返回 null，调用方降级处理。
export function splitLinePieces(textItem, formulaItems) {
  const text = textItem.text != null ? String(textItem.text) : '';
  const chars = Array.isArray(textItem.chars) ? textItem.chars : null;
  const box = textItem.box;
  if (!text || !chars || chars.length !== text.length) return null;
  if (!formulaItems.length) return null;
  if (!Array.isArray(box) || box[2] <= box[0]) return null;

  const owner = new Array(text.length).fill(-1);
  // 0.7.8 去重修复：MFD 框常比 Vision 字符序列略窄（上下标/边缘笔画伸出框外），仅按原框
  // 判归属会把公式边缘字符留在文本 run 里，公式内容重复输出为文本。判定前把公式框水平
  // 外扩 pad（随字符宽度自适应，clamp 2–8px），让边缘字符稳定归入公式。
  let charW = 0;
  let charN = 0;
  for (const c of chars) {
    const cb = c && c.box;
    if (cb && cb[2] - cb[0] > 0) {
      charW += cb[2] - cb[0];
      charN += 1;
    }
  }
  const pad = Math.min(8, Math.max(2, Math.round((charN ? charW / charN : 10) * 0.3)));
  for (let fi = 0; fi < formulaItems.length; fi += 1) {
    const fbox = formulaItems[fi].box;
    const fb = [fbox[0] - pad, fbox[1], fbox[2] + pad, fbox[3]];
    for (let i = 0; i < text.length; i += 1) {
      if (owner[i] !== -1) continue;
      const cb = chars[i] && chars[i].box;
      if (!cb) continue;
      const cx = (cb[0] + cb[2]) / 2;
      // 容差 1px：字符框与公式框来自两个独立模型，边界处常有 1px 内的错位。
      if (cx >= fb[0] - 1 && cx <= fb[2] + 1 && Math.min(cb[3], fb[3]) - Math.max(cb[1], fb[1]) > 0) {
        owner[i] = fi;
      }
    }
  }
  // 平滑：Vision 对空白字符返回零面积框（x=0,w=0），其 center 落在所有公式区间之外，
  // 于是夹在公式字符序列中间的空格会「打断」归属，导致同一公式被切成两段（重复输出）
  // 外加一个只含空格的文本段。若某未归属字符两侧最近的非空归属字符属于同一公式，
  // 说明该字符本就夹在公式内部，直接并入。
  for (let i = 1; i < text.length - 1; i += 1) {
    if (owner[i] !== -1) continue;
    let prev = i - 1;
    while (prev >= 0 && owner[prev] === -1) prev -= 1;
    let next = i + 1;
    while (next < text.length && owner[next] === -1) next += 1;
    if (prev >= 0 && next < text.length && owner[prev] === owner[next]) owner[i] = owner[prev];
  }
  if (!owner.some((o) => o !== -1)) return null;

  const pieces = [];
  let run = '';
  let runX1 = null;
  let runX2 = null;
  const flush = () => {
    if (!run) return;
    pieces.push({
      kind: 'text',
      text: run,
      box: [runX1 == null ? box[0] : runX1, box[1], runX2 == null ? box[2] : runX2, box[3]],
    });
    run = '';
    runX1 = null;
    runX2 = null;
  };
  let i = 0;
  while (i < text.length) {
    const o = owner[i];
    if (o === -1) {
      // Vision 对空白字符返回零面积框（x=0,y=1,w=0,h=0），直接采用会把 runX1 拉回 0，
      // 让「紧跟在公式后的空格开头文本段」排序时跑到行首。故只采信面积为正的字符框。
      const cb = chars[i] && chars[i].box;
      const usable = cb && cb[2] - cb[0] > 0 && cb[3] - cb[1] > 0 ? cb : null;
      run += text[i];
      if (usable) {
        if (runX1 == null) runX1 = usable[0];
        runX2 = usable[2];
      }
      i += 1;
    } else {
      flush();
      const f = formulaItems[o];
      pieces.push({
        kind: 'formula',
        type: f.type,
        latex: f.latex || '',
        score: f.score,
        decodeScore: f.decodeScore != null ? f.decodeScore : null,
        box: f.box,
        formulaIndex: o,
      });
      while (i < text.length && owner[i] === o) i += 1;
    }
  }
  flush();
  return pieces;
}

// 行内拼接：两个相邻公式会拼出 `$$`（`$a$$b$`）。在 Markdown 里 `$$` 是「行间公式」定界符，
// 解析器会因此错位，渲染结果不可预期。故当已累积内容以 `$` 结尾、且下一段以 `$` 开头时插入
// 一个空格隔断。纯文本内容零改动；同时也顺带挡住「独立公式 $$ 紧跟行内公式 $」拼成 `$$$`。
export function joinMarkdownParts(parts) {
  let out = '';
  for (const part of parts) {
    if (out.endsWith('$') && part.startsWith('$')) out += ' ';
    out += part;
  }
  return out;
}

// 0.7.8/0.7.13 降级去重：splitLinePieces 失败（无 chars / 长度不匹配 / 无字符归属）时，
// 整行文本原样保留会让公式字形以文本形式重复输出。按框类型分级丢弃：
//   isolated（独立公式）：覆盖 ≥0.20 即丢——独立公式旁同行的少量标签文字价值低，
//                          重复输出公式的代价高（实测截图中该行覆盖达 0.8+）；
//   embedding（行内公式）：覆盖 ≥0.35 才丢——行内公式宿主行含大量正文，阈值须保守。
// 两类都要求公式框与文本行垂直重叠 >0.5（同一视觉行才适用）。
const FORMULA_COVER_DROP_ISOLATED = 0.2;
const FORMULA_COVER_DROP_EMBEDDING = 0.35;

function shouldDropDegradeLine(textItem, formulaItems) {
  for (const f of formulaItems) {
    if (vOverlapRatio(textItem.box, f.box) <= 0.5) continue;
    const threshold = f.type === 'isolated' ? FORMULA_COVER_DROP_ISOLATED : FORMULA_COVER_DROP_EMBEDDING;
    if (horizontalCoverage(textItem.box, [f]) >= threshold) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// 0.7.14 MFD 正文误检过滤：MFD 对正文里的数学符号/单字母偶发误检（实测在说明文字
// 「e、i、π、1、0--五个…」上出框，把正文前缀吞成乱码公式）。真实公式裁切区域内几乎
// 不会出现 CJK 字符，而误检框大多套在中文正文上。用逐字符框统计公式框内 **中心点落入**
// 的 CJK 字符数，≥2 判为误检并丢弃该框（1 个视为框边缘裁切，保留）。
// 依赖 textLines 的逐字符框（macOS Vision 提供）；无 chars 时跳过过滤，保持原行为。
// ---------------------------------------------------------------------------
const CJK_CHAR_RE = /[\u3000-\u303f\u3400-\u4dbf\u4e00-\u9fff\uff01-\uff5e]/;

export function filterCjkFormulaBoxes(boxes, textLines, warnings) {
  if (!Array.isArray(boxes) || !boxes.length) return boxes;
  if (!Array.isArray(textLines) || !textLines.length) return boxes;
  const kept = [];
  for (const b of boxes) {
    const box = b && b.box;
    if (!Array.isArray(box)) {
      kept.push(b);
      continue;
    }
    let cjk = 0;
    outer: for (const tl of textLines) {
      if (!tl || !Array.isArray(tl.chars)) continue;
      for (const ch of tl.chars) {
        const cb = ch && Array.isArray(ch.box) ? ch.box : null;
        if (!cb) continue;
        const cx = (cb[0] + cb[2]) / 2;
        const cy = (cb[1] + cb[3]) / 2;
        if (cx >= box[0] && cx <= box[2] && cy >= box[1] && cy <= box[3] && CJK_CHAR_RE.test(ch.c || '')) {
          cjk += 1;
          if (cjk >= 2) break outer;
        }
      }
    }
    if (cjk >= 2) {
      if (Array.isArray(warnings)) {
        warnings.push(
          `已丢弃疑似正文误检的公式框 [${box.map((v) => Math.round(v)).join(',')}]（框内含 ${cjk} 个 CJK 字符，避免正文被吞成乱码公式）`
        );
      }
      continue;
    }
    kept.push(b);
  }
  return kept;
}

// 合并：返回 segments（按阅读顺序）与 markdown 字符串。warnings（可选数组）用于把
// 降级丢弃决策透传给前端展示，便于「公式被重复输出/文本丢失」类反馈定位。
export function mergeSegments(boxes, textLines, warnings) {
  // 规则2：丢弃与**独立公式**框 IoU>0.1、或被公式框覆盖>60%宽度的文本行。
  const keptText = [];
  for (const tl of textLines) {
    const box = tl.box;
    let drop = false;
    for (const b of boxes) {
      // 只有独立公式才可能「整行就是公式」。行内公式（embedding）按定义嵌在文本行内部，
      // 其与宿主行的重合绝不能导致整行被丢弃 —— 实测 Vision 把含行内公式的整行读成一条
      // observation，若按 IoU>0.1 一刀切，整行文字会被静默丢掉（已复现）。
      if (b.type === 'isolated' && iouOf(box, b.box) > 0.1) {
        drop = true;
        break;
      }
      if (horizontalCoverage(box, [b]) > 0.6) {
        drop = true;
        break;
      }
    }
    if (!drop) keptText.push(tl);
  }

  // 规则1：公式框 + 保留文本行 一起聚行。
  const items = [];
  for (const b of boxes) {
    items.push({ kind: 'formula', type: b.type, score: b.score, latex: b.latex || '', box: b.box, decodeScore: b.decodeScore != null ? b.decodeScore : null });
  }
  for (const tl of keptText) {
    items.push({ kind: 'text', text: tl.text, box: tl.box, score: 1, chars: tl.chars });
  }

  const lines = groupIntoLines(items);
  // 规则4：行自上而下排序。
  lines.sort((a, b) => a.box[1] - b.box[1]);

  const segments = [];
  const mdLines = [];
  lines.forEach((line, lineNumber) => {
    // 规则3：行内按 x1 排序。
    line.items.sort((a, b) => a.box[0] - b.box[0]);
    const formulaItems = line.items.filter((it) => it.kind !== 'text');
    const textItems = line.items.filter((it) => it.kind === 'text');

    // 优先：用逐字符框把文本行按公式区间切开，得到真正交错的顺序。
    // 否则「一行文字里夹着行内公式」只能整行文字在前、公式堆在后，顺序是错的。
    const pieces = [];
    const consumed = new Set();
    let split = false;
    for (const ti of textItems) {
      const parts = splitLinePieces(ti, formulaItems);
      if (parts) {
        split = true;
        for (const p of parts) {
          if (p.kind === 'formula') consumed.add(p.formulaIndex);
          pieces.push(p);
        }
      } else if (shouldDropDegradeLine(ti, formulaItems)) {
        // 0.7.8 降级去重：切不开（无 chars 等）且公式覆盖明显 → 丢整行，不重复输出公式。
        split = true; // 公式框全部由下方「未消费补回」输出，避免公式丢失。
        if (Array.isArray(warnings)) {
          warnings.push(
            `已丢弃与公式重叠的文本行「${String(ti.text || '').slice(0, 24)}」（切分失败且公式框覆盖明显，避免公式重复输出）`
          );
        }
        continue;
      } else {
        pieces.push({ kind: 'text', text: ti.text, box: ti.box });
      }
    }
    // 未被任何文本行「吃掉」的公式（含 split 失败的兜底）按自身框补回。
    formulaItems.forEach((f, fi) => {
      if (split && consumed.has(fi)) return;
      pieces.push(f);
    });
    // 文本段的 box 由字符框推出，因此能与公式段正确交错排序。
    pieces.sort((a, b) => a.box[0] - b.box[0] || a.box[2] - b.box[2]);

    const mdParts = [];
    for (const it of pieces) {
      if (it.kind === 'text') {
        segments.push({
          type: 'text',
          text: it.text,
          box: it.box,
          score: 1,
          lineNumber,
        });
        mdParts.push(it.text);
      } else {
        segments.push({
          type: it.type,
          latex: it.latex,
          text: formulaMarkdown(it.type, it.latex),
          box: it.box,
          score: it.score,
          decodeScore: it.decodeScore != null ? it.decodeScore : null,
          lineNumber,
        });
        mdParts.push(formulaMarkdown(it.type, it.latex));
      }
    }
    // 规则5：行内拼接（含 `$$` 隔断），行间用 \n。
    mdLines.push(joinMarkdownParts(mdParts));
  });
  const markdown = mdLines.join('\n');
  return { segments, markdown };
}
