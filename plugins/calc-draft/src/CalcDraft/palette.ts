export const PALETTE = [
  '#1E58B4', // 靛蓝
  '#3A7A44', // 墨绿
  '#B8781E', // 赭石
  '#7A4A9A', // 青莲
  '#C0444A', // 朱砂
  '#1E7A78', // 竹月
  '#8A5A2E', // 熟褐
  '#4A5A8A', // 黛蓝
  '#B04A7A', // 胭脂
  '#2E6E4E'  // 松绿
]

export function colorForSeq(seq: number): string {
  // 无效序号（NaN/0/负数，如未完成的 @1# 引用）回退到极淡墨
  if (!Number.isFinite(seq) || seq < 1) return paletteDark ? '#aebadb' : '#8b94b5'
  const index = ((seq - 1) % PALETTE.length + PALETTE.length) % PALETTE.length
  const color = PALETTE[index]
  return paletteDark ? lighten(color) : color
}

// 深色模式下把墨色系提亮（色板原为浅色纸面设计）
let paletteDark = false
export function setPaletteDark(dark: boolean) {
  paletteDark = dark
}

function lighten(hex: string, amount = 0.55): string {
  const n = hex.replace('#', '')
  const r = parseInt(n.slice(0, 2), 16)
  const g = parseInt(n.slice(2, 4), 16)
  const b = parseInt(n.slice(4, 6), 16)
  const mix = (c: number) => Math.round(c + (255 - c) * amount)
  return `rgb(${mix(r)}, ${mix(g)}, ${mix(b)})`
}

