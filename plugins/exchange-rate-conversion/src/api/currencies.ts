// 货币元数据 - 基于 frankfurter.app 支持的货币（数据源：欧洲央行 ECB）
// 完整列表见 https://api.frankfurter.app/currencies

export interface Currency {
  code: string
  name: string
  /** 中文名 */
  cn: string
  /** emoji 旗帜（基于区域代码） */
  flag: string
  /** 是否为基础货币（frankfurter 以 EUR 为基准，但查询时任意货币都可作为 from） */
}

// 区域代码 -> emoji 旗帜辅助函数
function flag(code: string): string {
  // ISO 国家代码 -> regional indicator symbols
  if (code === 'EUR') return '🇪🇺'
  const cp = code
    .toUpperCase()
    .split('')
    .map((c) => 0x1f1e6 + (c.charCodeAt(0) - 65))
  return String.fromCodePoint(...cp)
}

export const CURRENCIES: Currency[] = [
  { code: 'CNY', name: 'Chinese Renminbi', cn: '人民币', flag: flag('CN') },
  { code: 'USD', name: 'US Dollar', cn: '美元', flag: flag('US') },
  { code: 'EUR', name: 'Euro', cn: '欧元', flag: '🇪🇺' },
  { code: 'GBP', name: 'Pound Sterling', cn: '英镑', flag: flag('GB') },
  { code: 'JPY', name: 'Japanese Yen', cn: '日元', flag: flag('JP') },
  { code: 'HKD', name: 'Hong Kong Dollar', cn: '港元', flag: flag('HK') },
  { code: 'KRW', name: 'South Korean Won', cn: '韩元', flag: flag('KR') },
  { code: 'SGD', name: 'Singapore Dollar', cn: '新加坡元', flag: flag('SG') },
  { code: 'AUD', name: 'Australian Dollar', cn: '澳元', flag: flag('AU') },
  { code: 'CAD', name: 'Canadian Dollar', cn: '加元', flag: flag('CA') },
  { code: 'CHF', name: 'Swiss Franc', cn: '瑞士法郎', flag: flag('CH') },
  { code: 'SEK', name: 'Swedish Krona', cn: '瑞典克朗', flag: flag('SE') },
  { code: 'NOK', name: 'Norwegian Krone', cn: '挪威克朗', flag: flag('NO') },
  { code: 'NZD', name: 'New Zealand Dollar', cn: '新西兰元', flag: flag('NZ') },
  { code: 'THB', name: 'Thai Baht', cn: '泰铢', flag: flag('TH') },
  { code: 'MYR', name: 'Malaysian Ringgit', cn: '林吉特', flag: flag('MY') },
  { code: 'INR', name: 'Indian Rupee', cn: '印度卢比', flag: flag('IN') },
  { code: 'RUB', name: 'Russian Ruble', cn: '俄罗斯卢布', flag: flag('RU') },
  { code: 'BRL', name: 'Brazilian Real', cn: '巴西雷亚尔', flag: flag('BR') },
  { code: 'ZAR', name: 'South African Rand', cn: '南非兰特', flag: flag('ZA') },
  { code: 'MXN', name: 'Mexican Peso', cn: '墨西哥比索', flag: flag('MX') },
  { code: 'TRY', name: 'Turkish Lira', cn: '土耳其里拉', flag: flag('TR') },
]

const MAP: Record<string, Currency> = CURRENCIES.reduce(
  (m, c) => {
    m[c.code] = c
    return m
  },
  {} as Record<string, Currency>
)

export function getCurrency(code: string): Currency | undefined {
  return MAP[code]
}
