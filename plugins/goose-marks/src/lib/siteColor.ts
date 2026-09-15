/**
 * 站点占位图标配色与一级域名工具。
 *
 * 配色：拿不到 favicon 时按域名稳定哈希从固定调色板取一组「浅色底 + 同色系深字」。
 * 颜色全部为实色 hex，不用 color-mix()/oklch()/hsl() 变量派生，保证 uTools
 * 内置 Chromium 108 下不失效。算法稳定 → 同一域名永远同色；首次渲染时还会把
 * 结果写入 bookmark.icon.bgColor 持久化，之后即使调色板调整也不变色。
 */

export interface SiteColor {
  bg: string
  fg: string
}

// 低饱和浅底 + 同色系深字，覆盖暖灰界面下的常见色相，互相区分度足够
const SITE_PALETTE: SiteColor[] = [
  { bg: '#FBE4DB', fg: '#A0492A' }, // 珊瑚
  { bg: '#F8EAD3', fg: '#85590B' }, // 杏黄
  { bg: '#F3F0CE', fg: '#6E6512' }, // 橄榄
  { bg: '#E2EFD8', fg: '#4A722F' }, // 草绿
  { bg: '#DAEEE2', fg: '#2F6B4F' }, // 青绿
  { bg: '#D8ECEA', fg: '#2A6B66' }, // 松石
  { bg: '#DCEBF6', fg: '#2F5F8A' }, // 天蓝
  { bg: '#E2E4F5', fg: '#4A5490' }, // 靛蓝
  { bg: '#EAE4F5', fg: '#6B4E9C' }, // 紫
  { bg: '#F5E4EF', fg: '#94476F' }, // 品红
  { bg: '#F7E3E4', fg: '#9C4048' }, // 玫红
  { bg: '#EAE4DB', fg: '#6E5B40' }, // 暖棕
]

const hashSeed = (seed: string): number => {
  let h = 0
  for (let i = 0; i < seed.length; i++) h = (Math.imul(h, 31) + seed.charCodeAt(i)) >>> 0
  return h
}

/** 按种子（一般用一级域名）稳定分配一组占位配色。 */
export function siteColorOf(seed: string): SiteColor {
  return SITE_PALETTE[hashSeed(seed || '?') % SITE_PALETTE.length]
}

/**
 * 由持久化的底色反查同组文字色：bgColor 命中调色板时返回配套 fg；
 * 用户手动自设的颜色不在调色板内则返回 null，由调用方决定文字色。
 */
export function siteFgForBg(bg: string | undefined): string | null {
  if (!bg) return null
  const hit = SITE_PALETTE.find((c) => c.bg.toLowerCase() === bg.toLowerCase())
  return hit ? hit.fg : null
}

/**
 * 常见多级公共后缀（量的权衡：不引完整 PSL，覆盖国内常见场景），
 * 用于把 www.zhidao.baidu.com 收敛成 baidu.com。
 */
const MULTI_PART_SUFFIXES = new Set([
  'com.cn', 'net.cn', 'org.cn', 'gov.cn', 'edu.cn', 'ac.cn', 'bj.cn', 'sh.cn',
  'com.tw', 'org.tw', 'com.hk', 'org.hk', 'com.mo',
  'co.jp', 'or.jp', 'ne.jp', 'ac.jp', 'go.jp',
  'co.kr', 'or.kr', 'com.sg', 'com.my', 'com.au', 'net.au', 'co.nz',
  'co.uk', 'org.uk', 'ac.uk', 'gov.uk',
  'com.br', 'com.mx', 'co.in', 'com.tr', 'com.vn', 'co.th', 'com.ph', 'co.id',
])

/** 取一级域名（注册域）：www.zhidao.baidu.com → baidu.com；解析失败原样返回。 */
export function registeredDomainOf(host: string): string {
  const h = (host || '').trim().toLowerCase().replace(/\.$/, '')
  if (!h) return host
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(h) || h === 'localhost') return h
  const parts = h.split('.')
  if (parts.length <= 2) return h
  const last2 = parts.slice(-2).join('.')
  if (MULTI_PART_SUFFIXES.has(last2) && parts.length >= 3) {
    return parts.slice(-3).join('.')
  }
  return last2
}
