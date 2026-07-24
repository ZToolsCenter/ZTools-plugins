/**
 * Median Cut 颜色量化算法
 * 
 * 将图像像素集合量化为指定数量的代表色。
 * 核心流程:
 * 1. 将所有像素放入一个 VBox(颜色盒子)
 * 2. 反复将 VBox 按颜色通道中位数切分为两个子 VBox
 * 3. 直到达到目标颜色数量
 * 4. 每个 VBox 的平均色即为代表色
 */

/** 数值自然排序比较函数 */
function naturalOrder(a: number, b: number): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** 数组求和 */
function sumArray(array: number[]): number {
  return array.reduce((a, b) => a + b, 0);
}

/**
 * 优先队列 - 存储 VBox 对象，按比较器排序
 * 延迟排序: dirty 标记确保只在需要时才排序
 */
class PQueue {
  private sorted: VBox[] = [];
  private dirty = false;

  constructor(private comparator: (a: VBox, b: VBox) => number) {}

  push(item: VBox): void {
    this.sorted.push(item);
    this.dirty = true;
  }

  peek(index?: number): VBox {
    if (this.dirty) this.sort();
    if (index === undefined) index = this.sorted.length - 1;
    return this.sorted[index];
  }

  pop(): VBox | undefined {
    if (this.dirty) this.sort();
    return this.sorted.pop();
  }

  size(): number {
    return this.sorted.length;
  }

  map<T>(fn: (item: VBox, index: number) => T): T[] {
    return this.sorted.map(fn);
  }

  private sort(): void {
    this.sorted.sort(this.comparator);
    this.dirty = false;
  }
}

/** 颜色直方图: 5位R + 5位G + 5位B → 像素计数 */
type HistoMap = (number | undefined)[];

/** 将 RGB 各通道右移3位(5位精度)后计算直方图索引 */
function getColorIndex(r: number, g: number, b: number): number {
  return (r << 10) + (g << 5) + b;
}

/**
 * VBox - 颜色空间中的长方体
 * 代表 RGB 颜色空间的一个子区域，用于量化算法中的切分操作
 * r1/r2, g1/g2, b1/b2 定义了该长方体在5位精度下的边界
 */
class VBox {
  r1: number; r2: number;
  g1: number; g2: number;
  b1: number; b2: number;
  histo: HistoMap;
  private _volume?: number;
  private _count?: number;
  private _count_set = false;
  private _avg?: number[];

  constructor(r1: number, r2: number, g1: number, g2: number, b1: number, b2: number, histo: HistoMap) {
    this.r1 = r1; this.r2 = r2;
    this.g1 = g1; this.g2 = g2;
    this.b1 = b1; this.b2 = b2;
    this.histo = histo;
  }

  /** 计算长方体的体积(像素范围乘积) */
  volume(force?: boolean): number {
    if (!this._volume || force) {
      this._volume = (this.r2 - this.r1 + 1) * (this.g2 - this.g1 + 1) * (this.b2 - this.b1 + 1);
    }
    return this._volume;
  }

  /** 统计长方体内像素总数 */
  count(force?: boolean): number {
    if (!this._count_set || force) {
      let c = 0;
      for (let r = this.r1; r <= this.r2; r++) {
        for (let g = this.g1; g <= this.g2; g++) {
          for (let b = this.b1; b <= this.b2; b++) {
            c += this.histo[getColorIndex(r, g, b)] || 0;
          }
        }
      }
      this._count = c;
      this._count_set = true;
    }
    return this._count;
  }

  copy(): VBox {
    return new VBox(this.r1, this.r2, this.g1, this.g2, this.b1, this.b2, this.histo);
  }

  /** 计算长方体内所有像素的加权平均色(RGB) */
  avg(force?: boolean): number[] {
    if (this._avg && !force) return this._avg;

    const histo = this.histo;
    let ntot = 0, mult_r = 0, mult_g = 0, mult_b = 0;

    if (this.r1 === this.r2 && this.g1 === this.g2 && this.b1 === this.b2) {
      this._avg = [this.r1 << 3, this.g1 << 3, this.b1 << 3];
    } else {
      for (let r = this.r1; r <= this.r2; r++) {
        for (let g = this.g1; g <= this.g2; g++) {
          for (let b = this.b1; b <= this.b2; b++) {
            const hval = histo[getColorIndex(r, g, b)] || 0;
            ntot += hval;
            mult_r += hval * (r + 0.5) * 8;
            mult_g += hval * (g + 0.5) * 8;
            mult_b += hval * (b + 0.5) * 8;
          }
        }
      }
      if (ntot) {
        this._avg = [~~(mult_r / ntot), ~~(mult_g / ntot), ~~(mult_b / ntot)];
      } else {
        this._avg = [~~(8 * (this.r1 + this.r2 + 1) / 2), ~~(8 * (this.g1 + this.g2 + 1) / 2), ~~(8 * (this.b1 + this.b2 + 1) / 2)];
      }
    }
    return this._avg;
  }

  /** 判断像素是否在此长方体范围内 */
  contains(pixel: number[]): boolean {
    const rval = pixel[0] >> 3;
    const gval = pixel[1] >> 3;
    const bval = pixel[2] >> 3;
    return rval >= this.r1 && rval <= this.r2 &&
           gval >= this.g1 && gval <= this.g2 &&
           bval >= this.b1 && bval <= this.b2;
  }
}

/** 简单颜色映射 - 当去重后像素数 <= 目标数时直接使用 */
class SimpleCMap {
  private colors: number[][];
  constructor(colors: number[][]) {
    this.colors = colors;
  }
  palette(): number[][] {
    return this.colors;
  }
  map(pixel: number[]): number {
    return pixel;
  }
}

/**
 * CMap - 颜色映射表
 * 存储量化后的 VBox 集合，提供调色板和像素映射功能
 */
class CMap {
  vboxes: CMapPQueue;

  constructor() {
    this.vboxes = new CMapPQueue((a, b) => naturalOrder(a.vbox.count() * a.vbox.volume(), b.vbox.count() * b.vbox.volume()));
  }

  push(vbox: VBox): void {
    this.vboxes.push({ vbox, color: vbox.avg() });
  }

  /** 返回所有代表色组成的调色板 */
  palette(): number[][] {
    return this.vboxes.map(item => item.color);
  }

  size(): number {
    return this.vboxes.size();
  }

  /** 将像素映射到最近的代表色 */
  map(pixel: number[]): number {
    for (let i = 0; i < this.vboxes.size(); i++) {
      if (this.vboxes.peek(i).vbox.contains(pixel)) {
        return this.vboxes.peek(i).color;
      }
    }
    return this.nearest(pixel);
  }

  /** 欧氏距离找最近代表色 */
  private nearest(pixel: number[]): number {
    let minDist: number | undefined;
    let best: number[] = pixel;
    for (let i = 0; i < this.vboxes.size(); i++) {
      const color = this.vboxes.peek(i).color;
      const dist = Math.sqrt(
        Math.pow(pixel[0] - color[0], 2) +
        Math.pow(pixel[1] - color[1], 2) +
        Math.pow(pixel[2] - color[2], 2)
      );
      if (minDist === undefined || dist < minDist) {
        minDist = dist;
        best = color;
      }
    }
    return best;
  }
}

/** CMap 专用的优先队列 - 存储 {vbox, color} 对象 */
class CMapPQueue {
  private sorted: { vbox: VBox; color: number[] }[] = [];
  private dirty = false;

  constructor(private comparator: (a: { vbox: VBox; color: number[] }, b: { vbox: VBox; color: number[] }) => number) {}

  push(item: { vbox: VBox; color: number[] }): void {
    this.sorted.push(item);
    this.dirty = true;
  }

  peek(index?: number): { vbox: VBox; color: number[] } {
    if (this.dirty) this.sort();
    if (index === undefined) index = this.sorted.length - 1;
    return this.sorted[index];
  }

  pop(): { vbox: VBox; color: number[] } | undefined {
    if (this.dirty) this.sort();
    return this.sorted.pop();
  }

  size(): number {
    return this.sorted.length;
  }

  map<T>(fn: (item: { vbox: VBox; color: number[] }, index: number) => T): T[] {
    return this.sorted.map(fn);
  }

  private sort(): void {
    this.sorted.sort(this.comparator);
    this.dirty = false;
  }
}

/**
 * 中位切分: 将 VBox 沿最长维度在中位数处切分为两个子 VBox
 * @returns 两个子 VBox 的数组，或 null(无法切分时)
 */
function medianCutApply(histo: HistoMap, vbox: VBox): VBox[] | null {
  if (!vbox.count()) return null;

  const rw = vbox.r2 - vbox.r1 + 1;
  const gw = vbox.g2 - vbox.g1 + 1;
  const bw = vbox.b2 - vbox.b1 + 1;
  const maxw = Math.max(rw, gw, bw);

  if (vbox.count() === 1) return [vbox.copy()];

  let total = 0;
  const partialsum: Record<number, number> = [];
  const lookaheadsum: Record<number, number> = [];

  if (maxw === rw) {
    for (let r = vbox.r1; r <= vbox.r2; r++) {
      let s = 0;
      for (let g = vbox.g1; g <= vbox.g2; g++) {
        for (let b = vbox.b1; b <= vbox.b2; b++) {
          s += histo[getColorIndex(r, g, b)] || 0;
        }
      }
      total += s;
      partialsum[r] = total;
    }
  } else if (maxw === gw) {
    for (let g = vbox.g1; g <= vbox.g2; g++) {
      let s = 0;
      for (let r = vbox.r1; r <= vbox.r2; r++) {
        for (let b = vbox.b1; b <= vbox.b2; b++) {
          s += histo[getColorIndex(r, g, b)] || 0;
        }
      }
      total += s;
      partialsum[g] = total;
    }
  } else {
    for (let b = vbox.b1; b <= vbox.b2; b++) {
      let s = 0;
      for (let r = vbox.r1; r <= vbox.r2; r++) {
        for (let g = vbox.g1; g <= vbox.g2; g++) {
          s += histo[getColorIndex(r, g, b)] || 0;
        }
      }
      total += s;
      partialsum[b] = total;
    }
  }

  for (const key in partialsum) {
    lookaheadsum[key as any] = total - partialsum[key as any];
  }

  const dim = maxw === rw ? 'r' : maxw === gw ? 'g' : 'b';
  const dim1 = dim + '1' as 'r1' | 'g1' | 'b1';
  const dim2 = dim + '2' as 'r2' | 'g2' | 'b2';

  let left: VBox | null = null;
  let right: VBox | null = null;

  for (let d = (vbox as any)[dim1]; d <= (vbox as any)[dim2]; d++) {
    if (partialsum[d]! > total / 2) {
      const vbox1 = vbox.copy();
      const vbox2 = vbox.copy();

      const d1 = d - (vbox as any)[dim1];
      const d2 = (vbox as any)[dim2] - d;
      let half = d1 <= d2
        ? Math.min((vbox as any)[dim2] - 1, ~~(d + d2 / 2))
        : Math.max((vbox as any)[dim1], ~~(d - 1 - d1 / 2));

      while (!partialsum[half]) half++;
      let count2 = lookaheadsum[half];
      while (!count2 && partialsum[half - 1]) count2 = lookaheadsum[--half];

      (vbox1 as any)[dim2] = half;
      (vbox2 as any)[dim1] = (vbox1 as any)[dim2] + 1;

      left = vbox1;
      right = vbox2;
      break;
    }
  }

  if (!left) return null;
  return [left, right!].filter(v => v.count());
}

/**
 * 主量化函数: 将像素集合量化为 maxColors 个代表色
 * 
 * 流程:
 * 1. 像素去重，若去重后数量 <= maxColors 直接返回
 * 2. 构建5位精度直方图，找到颜色空间范围
 * 3. 第一轮切分: 目标 0.75 * maxColors
 * 4. 按 count*volume 排序后第二轮切分: 目标 maxColors
 * 5. 生成 CMap 颜色映射表
 */
export function quantize(pixels: number[][], maxColors: number): CMap | SimpleCMap | null | false {
  if (!Number.isInteger(maxColors) || maxColors < 1 || maxColors > 256) {
    throw new Error('Invalid maximum color count. It must be an integer between 1 and 256.');
  }

  if (!pixels.length || maxColors < 2 || maxColors > 256) return false;

  // 去重
  const uniquePixels: number[][] = [];
  const seen = new Set<string>();
  for (const pixel of pixels) {
    const key = pixel.join(',');
    if (!seen.has(key)) {
      seen.add(key);
      uniquePixels.push(pixel);
    }
  }

  // 如果去重后像素数 <= maxColors，直接返回简单 CMap
  if (uniquePixels.length <= maxColors) {
    return new SimpleCMap(uniquePixels);
  }

  // 构建直方图
  const histo: HistoMap = new Array(32768);
  pixels.forEach(pixel => {
    const idx = getColorIndex(pixel[0] >> 3, pixel[1] >> 3, pixel[2] >> 3);
    histo[idx] = (histo[idx] || 0) + 1;
  });

  // 找到颜色空间范围
  let rmin = 1e6, rmax = 0, gmin = 1e6, gmax = 0, bmin = 1e6, bmax = 0;
  pixels.forEach(pixel => {
    const r = pixel[0] >> 3;
    const g = pixel[1] >> 3;
    const b = pixel[2] >> 3;
    if (r < rmin) rmin = r; if (r > rmax) rmax = r;
    if (g < gmin) gmin = g; if (g > gmax) gmax = g;
    if (b < bmin) bmin = b; if (b > bmax) bmax = b;
  });

  const vbox = new VBox(rmin, rmax, gmin, gmax, bmin, bmax, histo);
  const pq = new PQueue((a, b) => naturalOrder(a.count(), b.count()));
  pq.push(vbox);

  /** 迭代切分: 从优先队列中取出 VBox 进行中位切分，直到达到目标数量 */
  function iterate(pq: PQueue, target: number): void {
    let A = pq.size(); // A = E.size()
    let I = 0;

    while (I < 1000) {
      if (A >= target || I++ > 1000) return; // if(A>=w||I++>1e3)return

      const P = pq.pop();
      if (!P) return;

      if (P.count()) {
        const B = medianCutApply(histo, P);
        const N = B ? B[0] : null;
        const j = B && B.length >= 2 ? B[1] : null;
        if (!N) return; // if(!N)return
        pq.push(N);
        if (j) {
          pq.push(j);
          A++; // j&&(E.push(j),A++)
        }
      } else {
        pq.push(P);
        I++; // I++ (only when count==0)
      }
    }
  }

  // 第一次切分: S(b, .75 * u) - u 是 maxColors，不是像素数！
  iterate(pq, 0.75 * maxColors);

  // 排序后放入新队列
  // 先把 pq 中的 vbox 全部取出排序
  const allVboxes: VBox[] = [];
  while (pq.size() > 0) {
    allVboxes.push(pq.pop()!);
  }
  allVboxes.sort((a, b) => naturalOrder(a.count() * a.volume(), b.count() * b.volume()));

  // 第二次切分
  const pq2 = new PQueue((a, b) => naturalOrder(a.count() * a.volume(), b.count() * b.volume()));
  allVboxes.forEach(v => pq2.push(v));
  iterate(pq2, maxColors);

  // 生成 CMap
  const cmap = new CMap();
  while (pq2.size() > 0) {
    cmap.push(pq2.pop()!);
  }

  return cmap;
}
