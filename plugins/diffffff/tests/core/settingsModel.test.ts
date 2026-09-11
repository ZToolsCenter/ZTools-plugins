/**
 * 设置持久化纯模型单元测试（roadmap 任务 INT-007）。
 *
 * 覆盖 `src/core/settingsModel.ts` 的三个出口：
 * - `defaultSettings`：全字段默认值与各 store 缺省值一致（precision 'smart'、
 *   showCollapsed true、viewMode 'split'、language 'auto'、contextLines 3、
 *   autoSaveHistory true 等），且每次调用返回全新对象；
 * - `normalizeSettings`：非对象输入整体兜底 / 逐字段非法回退各字段默认 /
 *   contextLines 钳制 [0,10] 与取整 / ignoreRules 逐条形状过滤 / 合法值
 *   原样透传 / schemaVersion 恒重写为当前版本 / 未知字段丢弃；
 * - `migrateSettings`：版本路由 —— 缺失 / 非有限数字版本按 v1 归一化（数据
 *   保全优先）、当前版本正常归一化、未来版本整体回退默认（不可降级解读）；
 *   往返一致性 normalize(migrate(x)) 与 migrate 自身幂等。
 *
 * stores/settings.ts 的编排层依赖 window.ztools 宿主，不在 vitest 覆盖范围
 * （不强行 mock 宿主），本文件以 core 层测试覆盖其全部纯逻辑。
 */
import { describe, expect, it } from 'vitest'
import {
  SETTINGS_SCHEMA_VERSION,
  defaultSettings,
  migrateSettings,
  normalizeSettings,
} from '../../src/core/settingsModel'

/* -------------------------------------------------------------------------- */
/* defaultSettings                                                            */
/* -------------------------------------------------------------------------- */

describe('defaultSettings', () => {
  it('全字段默认值与各 store 缺省值一致', () => {
    expect(defaultSettings()).toEqual({
      schemaVersion: SETTINGS_SCHEMA_VERSION,
      precision: 'smart',
      language: 'auto',
      viewMode: 'split',
      showCollapsed: true,
      wrapLongLines: false,
      contextLines: 3,
      ignoreWhitespace: false,
      ignoreCase: false,
      ignoreRules: [],
      autoSaveHistory: true,
    })
  })

  it('每次调用返回全新对象（深等但不共享引用，调用方可安全改写）', () => {
    const a = defaultSettings()
    const b = defaultSettings()
    expect(a).not.toBe(b)
    expect(a).toEqual(b)
  })
})

/* -------------------------------------------------------------------------- */
/* normalizeSettings：非对象兜底与逐字段归一化                                    */
/* -------------------------------------------------------------------------- */

describe('normalizeSettings 非对象输入', () => {
  it('null / undefined / 原始值 / 数组 → 等价全默认', () => {
    const fallback = defaultSettings()
    expect(normalizeSettings(null)).toEqual(fallback)
    expect(normalizeSettings(undefined)).toEqual(fallback)
    expect(normalizeSettings(42)).toEqual(fallback)
    expect(normalizeSettings('settings')).toEqual(fallback)
    expect(normalizeSettings(['split'])).toEqual(fallback)
  })
})

describe('normalizeSettings 逐字段非法回退', () => {
  it('precision：白名单外回退 smart，四个合法值透传', () => {
    expect(normalizeSettings({ precision: 'bogus' }).precision).toBe('smart')
    expect(normalizeSettings({ precision: 3 }).precision).toBe('smart')
    expect(normalizeSettings({ precision: undefined }).precision).toBe('smart')
    for (const precision of ['smart', 'line', 'word', 'char'] as const) {
      expect(normalizeSettings({ precision }).precision).toBe(precision)
    }
  })

  it('language：非字符串 / 空串回退 auto，非空字符串透传（不校验候选清单）', () => {
    expect(normalizeSettings({ language: 42 }).language).toBe('auto')
    expect(normalizeSettings({ language: '' }).language).toBe('auto')
    expect(normalizeSettings({ language: 'auto' }).language).toBe('auto')
    expect(normalizeSettings({ language: 'python' }).language).toBe('python')
  })

  it('viewMode：白名单外回退 split，split / unified 透传', () => {
    expect(normalizeSettings({ viewMode: 'grid' }).viewMode).toBe('split')
    expect(normalizeSettings({ viewMode: 'SPLIT' }).viewMode).toBe('split')
    expect(normalizeSettings({ viewMode: 'split' }).viewMode).toBe('split')
    expect(normalizeSettings({ viewMode: 'unified' }).viewMode).toBe('unified')
  })

  it('布尔字段：非布尔回退各字段默认（含 autoSaveHistory 默认 true）', () => {
    const s = normalizeSettings({
      showCollapsed: 'yes',
      wrapLongLines: 1,
      ignoreWhitespace: null,
      ignoreCase: 0,
      autoSaveHistory: undefined,
    })
    expect(s.showCollapsed).toBe(true)
    expect(s.wrapLongLines).toBe(false)
    expect(s.ignoreWhitespace).toBe(false)
    expect(s.ignoreCase).toBe(false)
    expect(s.autoSaveHistory).toBe(true)
  })

  it('布尔字段合法值透传：false 的默认项可关、true 的默认项可开', () => {
    const s = normalizeSettings({
      showCollapsed: false,
      wrapLongLines: true,
      ignoreWhitespace: true,
      ignoreCase: true,
      autoSaveHistory: false,
    })
    expect(s.showCollapsed).toBe(false)
    expect(s.wrapLongLines).toBe(true)
    expect(s.ignoreWhitespace).toBe(true)
    expect(s.ignoreCase).toBe(true)
    expect(s.autoSaveHistory).toBe(false)
  })

  it('schemaVersion 恒重写为当前版本；未知字段丢弃', () => {
    const s = normalizeSettings({ schemaVersion: 999, futureField: 'x' })
    expect(s.schemaVersion).toBe(SETTINGS_SCHEMA_VERSION)
    expect('futureField' in s).toBe(false)
    // 已移除的「实时对比默认值」字段按未知字段处理：旧持久化数据载入时自然忽略。
    expect('realtimeDefault' in normalizeSettings({ realtimeDefault: true })).toBe(false)
  })
})

/* -------------------------------------------------------------------------- */
/* normalizeSettings：contextLines 钳制                                        */
/* -------------------------------------------------------------------------- */

describe('normalizeSettings contextLines 钳制 [0, 10]', () => {
  it('越界钳到边界而非回退默认：-5 → 0、11 → 10、99 → 10', () => {
    expect(normalizeSettings({ contextLines: -5 }).contextLines).toBe(0)
    expect(normalizeSettings({ contextLines: 11 }).contextLines).toBe(10)
    expect(normalizeSettings({ contextLines: 99 }).contextLines).toBe(10)
  })

  it('边界值与小数：0 / 10 原样保留，2.9 向下取整为 2', () => {
    expect(normalizeSettings({ contextLines: 0 }).contextLines).toBe(0)
    expect(normalizeSettings({ contextLines: 10 }).contextLines).toBe(10)
    expect(normalizeSettings({ contextLines: 3.9 }).contextLines).toBe(3)
    expect(normalizeSettings({ contextLines: -0.5 }).contextLines).toBe(0)
  })

  it('非有限数字 / 非数字类型回退默认 3', () => {
    expect(normalizeSettings({ contextLines: Number.NaN }).contextLines).toBe(3)
    expect(normalizeSettings({ contextLines: Number.POSITIVE_INFINITY }).contextLines).toBe(3)
    expect(normalizeSettings({ contextLines: '3' }).contextLines).toBe(3)
    expect(normalizeSettings({ contextLines: null }).contextLines).toBe(3)
  })
})

/* -------------------------------------------------------------------------- */
/* normalizeSettings：ignoreRules 逐条形状过滤                                  */
/* -------------------------------------------------------------------------- */

describe('normalizeSettings ignoreRules', () => {
  it('非数组 → 空数组', () => {
    expect(normalizeSettings({ ignoreRules: 'x' }).ignoreRules).toEqual([])
    expect(normalizeSettings({ ignoreRules: {} }).ignoreRules).toEqual([])
    expect(normalizeSettings({ ignoreRules: 42 }).ignoreRules).toEqual([])
    expect(normalizeSettings({}).ignoreRules).toEqual([])
  })

  it('条目形状校验：四字段类型全对的条目保留，残缺 / 类型不符的丢弃，顺序不变', () => {
    const s = normalizeSettings({
      ignoreRules: [
        { id: 'a', pattern: '\\d+', flags: 'g', enabled: true },
        null,
        'nope',
        { id: 'b', pattern: 'x' }, // 缺 flags / enabled
        { id: 'c', pattern: '', flags: 'g', enabled: false }, // 空 pattern 形状合法 → 保留
        { id: 3, pattern: 'y', flags: 'g', enabled: true }, // id 非字符串
        { id: 'd', pattern: 7, flags: 'g', enabled: true }, // pattern 非字符串
        { id: 'e', pattern: 'z', flags: 1, enabled: true }, // flags 非字符串
        { id: 'f', pattern: 'w', flags: 'g', enabled: 'yes' }, // enabled 非布尔
        { id: 'h', pattern: '[A-Z]+', flags: 'gi', enabled: true },
      ],
    })
    expect(s.ignoreRules).toEqual([
      { id: 'a', pattern: '\\d+', flags: 'g', enabled: true },
      { id: 'c', pattern: '', flags: 'g', enabled: false },
      { id: 'h', pattern: '[A-Z]+', flags: 'gi', enabled: true },
    ])
  })

  it('合法条目浅拷贝：产物与输入对象不共享引用', () => {
    const raw = { id: 'a', pattern: '\\d+', flags: 'g', enabled: true }
    const s = normalizeSettings({ ignoreRules: [raw] })
    expect(s.ignoreRules[0]).not.toBe(raw)
    expect(s.ignoreRules[0]).toEqual(raw)
  })
})

/* -------------------------------------------------------------------------- */
/* migrateSettings：版本路由与往返一致性                                         */
/* -------------------------------------------------------------------------- */

describe('migrateSettings 版本路由', () => {
  it('非对象输入 → 全默认', () => {
    expect(migrateSettings(null)).toEqual(defaultSettings())
    expect(migrateSettings('garbage')).toEqual(defaultSettings())
  })

  it('缺失 schemaVersion → 按 v1 逐字段归一化（合法字段保全，垃圾字段兜底）', () => {
    const migrated = migrateSettings({ precision: 'char', contextLines: 99, language: 'go' })
    expect(migrated.schemaVersion).toBe(SETTINGS_SCHEMA_VERSION)
    expect(migrated.precision).toBe('char')
    expect(migrated.contextLines).toBe(10) // 越界钳制而非丢弃
    expect(migrated.language).toBe('go')
    expect(migrated.viewMode).toBe('split') // 缺失字段回默认
  })

  it('schemaVersion 非有限数字（NaN / 字符串）→ 按 v1 归一化', () => {
    for (const version of [Number.NaN, '1', null]) {
      const migrated = migrateSettings({ schemaVersion: version, precision: 'word' })
      expect(migrated.schemaVersion).toBe(SETTINGS_SCHEMA_VERSION)
      expect(migrated.precision).toBe('word')
    }
  })

  it('schemaVersion 等于当前版本 → 正常归一化', () => {
    const raw = { ...defaultSettings(), ignoreRules: [{ id: 'a', pattern: 'x', flags: 'g', enabled: true }] }
    expect(migrateSettings(raw)).toEqual(normalizeSettings(raw))
  })

  it('未来版本（schemaVersion 大于当前）→ 整体回退默认设置（不可降级解读）', () => {
    const future = {
      ...defaultSettings(),
      schemaVersion: SETTINGS_SCHEMA_VERSION + 1,
      precision: 'line',
      someNewField: true,
    }
    const migrated = migrateSettings(future)
    expect(migrated).toEqual(defaultSettings())
    expect(migrated.precision).toBe('smart')
  })
})

describe('往返一致性（幂等）', () => {
  it('normalize(migrate(x)) 深等于 migrate(x)；migrate 与 normalize 自身幂等', () => {
    const messy = {
      schemaVersion: 1,
      precision: 'word',
      language: 'typescript',
      viewMode: 'unified',
      showCollapsed: false,
      wrapLongLines: true,
      contextLines: 7.8,
      ignoreWhitespace: true,
      ignoreCase: false,
      ignoreRules: [
        { id: 'a', pattern: '\\d+', flags: 'g', enabled: true },
        { junk: true },
      ],
      autoSaveHistory: false,
      unknownField: 1,
    }
    const once = migrateSettings(messy)
    expect(normalizeSettings(migrateSettings(messy))).toEqual(once)
    expect(migrateSettings(once)).toEqual(once)
    expect(normalizeSettings(once)).toEqual(once)

    // 全默认输入同样幂等。
    const base = defaultSettings()
    expect(migrateSettings(base)).toEqual(base)
    expect(normalizeSettings(base)).toEqual(base)
  })

  it('历史「恢复」写回的选项形状（含非法正则 pattern 条目）可无损往返', () => {
    // 形状合法但正则非法的规则条目照常保留（编译合法性归编辑期校验）。
    const withBadRegex = {
      ...defaultSettings(),
      ignoreRules: [{ id: 'r1', pattern: '[unclosed', flags: 'g', enabled: true }],
    }
    const migrated = migrateSettings(withBadRegex)
    expect(migrated.ignoreRules).toEqual([{ id: 'r1', pattern: '[unclosed', flags: 'g', enabled: true }])
    expect(normalizeSettings(migrated)).toEqual(migrated)
  })
})
