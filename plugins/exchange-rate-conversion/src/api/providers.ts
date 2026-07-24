// 汇率数据源渠道定义
//
// 分两组：海外 / 国内
// 所有渠道均需 API Key，注册后获取

export type ProviderRegion = 'overseas' | 'cn'

export interface ProviderMeta {
  id: string
  name: string
  /** 区域：海外 / 国内 */
  region: ProviderRegion
  desc: string
  signupUrl: string
  freeQuota: string
  supportsHistory: boolean
  docsUrl: string
  /** base 货币是否固定为某种（如 OXR 免费层固定 USD），用于前端做中转转换 */
  fixedBase?: string
}

export const PROVIDERS: ProviderMeta[] = [
  // ─── 海外 ─────────────────────────────────────────
  {
    id: 'openexchangerate',
    name: 'Open Exchange Rates',
    region: 'overseas',
    desc: '老牌汇率数据，覆盖 200+ 货币。免费层 base 仅限 USD，自动中转转换',
    signupUrl: 'https://openexchangerates.org/signup',
    freeQuota: '1000 次/月 (免费)',
    supportsHistory: true,
    docsUrl: 'https://docs.openexchangerates.org/',
    fixedBase: 'USD',
  },
  {
    id: 'exchangeratehost',
    name: 'ExchangeRate.host',
    region: 'overseas',
    desc: '基于 ECB 数据，免费层支持历史汇率',
    signupUrl: 'https://exchangerate.host/signup',
    freeQuota: '100 次/月 (免费)',
    supportsHistory: true,
    docsUrl: 'https://exchangerate.host/documentation',
  },
  {
    id: 'fixer',
    name: 'Fixer.io',
    region: 'overseas',
    desc: 'ECB 数据源，老牌稳定，历史端点完善',
    signupUrl: 'https://fixer.io/signup',
    freeQuota: '100 次/月 (免费)',
    supportsHistory: true,
    docsUrl: 'https://fixer.io/documentation',
  },
  {
    id: 'currencyapi',
    name: 'CurrencyAPI',
    region: 'overseas',
    desc: '覆盖广泛货币，含加密货币，精度高',
    signupUrl: 'https://currencyapi.com/pricing',
    freeQuota: '300 次/月 (免费)',
    supportsHistory: true,
    docsUrl: 'https://currencyapi.com/docs/',
  },
  // ─── 国内 ─────────────────────────────────────────
  {
    id: 'juhe',
    name: '聚合数据',
    region: 'cn',
    desc: '国内常用汇率接口，支持人民币兑全球主要货币',
    signupUrl: 'https://www.juhe.cn/docs/api/id/80',
    freeQuota: '100 次/天 (免费)',
    supportsHistory: false,
    docsUrl: 'https://www.juhe.cn/docs/api/id/80',
    fixedBase: 'CNY',
  },
  {
    id: 'jisu',
    name: '极速数据',
    region: 'cn',
    desc: '国内汇率服务，支持主流货币实时汇率',
    signupUrl: 'https://www.jisuapi.com/api/exchange/',
    freeQuota: '100 次/天 (免费)',
    supportsHistory: false,
    docsUrl: 'https://www.jisuapi.com/api/exchange/',
    fixedBase: 'CNY',
  },
  {
    id: 'aliyun',
    name: '阿里云 - 汇率查询',
    region: 'cn',
    desc: '阿里云市场汇率接口，数据稳定，支持主要货币',
    signupUrl: 'https://market.aliyun.com/products/57000002/cmapi00032937.html',
    freeQuota: '需订阅 (有免费试用)',
    supportsHistory: false,
    docsUrl: 'https://market.aliyun.com/products/57000002/cmapi00032937.html',
    fixedBase: 'CNY',
  },
  {
    id: 'huaweicloud',
    name: '华为云 - 汇率',
    region: 'cn',
    desc: '华为云市场汇率查询，覆盖主流货币',
    signupUrl: 'https://market.huaweicloud.com/',
    freeQuota: '需订阅 (有免费试用)',
    supportsHistory: false,
    docsUrl: 'https://market.huaweicloud.com/',
    fixedBase: 'CNY',
  },
]

export function getProvider(id: string): ProviderMeta | undefined {
  return PROVIDERS.find((p) => p.id === id)
}

// ─── 配置存储 ──────────────────────────────────────────

const CFG_KEY = 'rate.providerConfig.v2'

export interface ProviderConfig {
  active: string
  keys: Record<string, string>
}

export function loadConfig(): ProviderConfig {
  const def: ProviderConfig = { active: 'openexchangerate', keys: {} }
  try {
    const raw = localStorage.getItem(CFG_KEY)
    if (!raw) return def
    const obj = JSON.parse(raw)
    return {
      active: typeof obj.active === 'string' ? obj.active : def.active,
      keys: obj.keys && typeof obj.keys === 'object' ? obj.keys : {},
    }
  } catch {
    return def
  }
}

export function saveConfig(cfg: ProviderConfig) {
  try {
    localStorage.setItem(CFG_KEY, JSON.stringify(cfg))
  } catch {
    /* ignore */
  }
}

export function getActiveKey(): string | undefined {
  const cfg = loadConfig()
  return cfg.keys[cfg.active]
}

export function hasKey(providerId?: string): boolean {
  const cfg = loadConfig()
  const id = providerId || cfg.active
  const k = cfg.keys[id]
  return typeof k === 'string' && k.trim().length > 0
}
