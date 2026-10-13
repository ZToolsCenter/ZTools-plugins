/**
 * 匹配样例表(阶段 1 验收):每条样例给"手机推送的原始元数据 + 候选列表 + 期望命中
 * (候选下标或 null)",覆盖任务书要求的全部场景:
 * Live/Remix 误配、短标题误配、简繁、全半角、feat 歌手、中英歌手名、专辑不同同名歌、
 * 翻唱、纯音乐/伴奏、重制、加速/降调、别名译名、歌词内容反校验、序奖励、白名单歌手等。
 * 流程与 LyricsManager 一致:原始 title/artist → cleanTitleDetailed/cleanArtist → 组查询 → 打分。
 */
import { describe, expect, it } from 'vitest'
import { cleanArtist, cleanTitleDetailed, parseArtists } from './clean-title'
import { pickBestWithScore } from './match'
import type { LyricQuery } from './types'
import type { Candidate } from './match'

interface SampleCase {
  name: string
  title: string
  artist: string
  album?: string
  durationMs?: number
  candidates: Candidate[]
  /** 期望命中的候选下标;null 表示应返回 null(宁缺毋滥) */
  expect: number | null
}

const DUR = 269_000 // 4:29

/** 与 LyricsManager.buildQuery 相同的查询组装 */
function runCase(c: SampleCase): ReturnType<typeof pickBestWithScore> {
  const cleaned = cleanTitleDetailed(c.title, c.artist)
  const query: LyricQuery = {
    title: cleaned.title,
    artist: cleanArtist(c.artist),
    album: c.album ?? '',
    durationMs: c.durationMs ?? DUR,
    rawTitle: c.title,
    rawArtist: c.artist,
    allArtists: parseArtists(c.artist),
    versionTags: [...cleaned.tags]
  }
  return pickBestWithScore(c.candidates, query)
}

function assertCase(c: SampleCase): void {
  const best = runCase(c)
  if (c.expect === null) {
    expect(best, `${c.name}: 应返回 null`).toBeNull()
  } else {
    expect(best, `${c.name}: 应命中候选 #${c.expect}`).not.toBeNull()
    expect(best?.candidate, c.name).toBe(c.candidates[c.expect])
  }
}

const cases: SampleCase[] = [
  // ==================== 正常命中 ====================
  {
    name: '完全相同的标题与歌手',
    title: '晴天', artist: '周杰伦', album: '叶惠美',
    candidates: [
      { title: '晴天', artist: '周杰伦', album: '叶惠美', durationMs: DUR },
      { title: '夜曲', artist: '周杰伦', album: '十一月的萧邦', durationMs: 226_000 }
    ],
    expect: 0
  },
  {
    name: '手机标题带"歌名 - 歌手"混入',
    title: '晴天 - 周杰伦', artist: '周杰伦',
    candidates: [{ title: '晴天', artist: '周杰伦', durationMs: DUR }],
    expect: 0
  },
  {
    name: '候选标题带 Official MV 噪音',
    title: '晴天', artist: '周杰伦',
    candidates: [{ title: '晴天 (Official Music Video)', artist: '周杰伦', durationMs: DUR }],
    expect: 0
  },
  {
    name: '时长未知(0)也允许按标题+歌手命中',
    title: '七里香', artist: '周杰伦', durationMs: 0,
    candidates: [{ title: '七里香', artist: '周杰伦', durationMs: 0 }],
    expect: 0
  },
  {
    name: '时长 ±3s 优先于 ±8s 的同名候选',
    title: '晴天', artist: '周杰伦',
    candidates: [
      { title: '晴天', artist: '周杰伦', durationMs: DUR + 8_000 },
      { title: '晴天', artist: '周杰伦', durationMs: DUR + 1_000 }
    ],
    expect: 1
  },

  // ==================== Live ====================
  {
    name: 'Live 候选让位给原版(对称惩罚)',
    title: '晴天', artist: '周杰伦',
    candidates: [
      { title: '晴天 (Live)', artist: '周杰伦', durationMs: 320_000 },
      { title: '晴天', artist: '周杰伦', durationMs: DUR }
    ],
    expect: 1
  },
  {
    name: '查询是 Live 版时反向对称:原版候选被惩罚',
    title: '晴天 (Live)', artist: '周杰伦', durationMs: 320_000,
    candidates: [
      { title: '晴天', artist: '周杰伦', durationMs: DUR },
      { title: '晴天 (Live)', artist: '周杰伦', durationMs: 320_000 }
    ],
    expect: 1
  },
  {
    name: '只有 Live 候选且时长接近 → 仍然命中(惩罚后最佳)',
    title: '晴天', artist: '周杰伦',
    candidates: [{ title: '晴天 (Live)', artist: '周杰伦', durationMs: DUR + 2_000 }],
    expect: 0
  },
  {
    name: '只有 Live 候选且时长差 >15s → 宁可不匹配',
    title: '晴天', artist: '周杰伦',
    candidates: [{ title: '晴天 (Live)', artist: '周杰伦', durationMs: DUR + 51_000 }],
    expect: null
  },
  {
    name: '现场版(中文关键词)对称命中',
    title: '朋友 (现场)', artist: '周华健', durationMs: 300_000,
    candidates: [
      { title: '朋友', artist: '周华健', durationMs: 240_000 },
      { title: '朋友 (现场版)', artist: '周华健', durationMs: 300_000 }
    ],
    expect: 1
  },

  // ==================== Remix / DJ / 加速 ====================
  {
    name: 'Remix 候选让位给原版',
    title: '海阔天空', artist: 'Beyond',
    candidates: [
      { title: '海阔天空 (Remix)', artist: 'Beyond', durationMs: DUR },
      { title: '海阔天空', artist: 'Beyond', durationMs: DUR }
    ],
    expect: 1
  },
  {
    name: 'Extended Mix 也是 remix 家族',
    title: '光年之外', artist: '邓紫棋',
    candidates: [
      { title: '光年之外 (Extended Mix)', artist: '邓紫棋', durationMs: DUR + 45_000 },
      { title: '光年之外', artist: '邓紫棋', durationMs: DUR }
    ],
    expect: 1
  },
  {
    name: 'DJ 版对称命中',
    title: '野狼disco (DJ版)', artist: '宝石Gem', durationMs: 260_000,
    candidates: [
      { title: '野狼disco', artist: '宝石Gem', durationMs: 240_000 },
      { title: '野狼disco (DJ版)', artist: '宝石Gem', durationMs: 260_000 }
    ],
    expect: 1
  },
  {
    name: 'Sped Up 候选让位给原版',
    title: 'Love Story', artist: 'Taylor Swift',
    candidates: [
      { title: 'Love Story (Sped Up)', artist: 'Taylor Swift', durationMs: 210_000 },
      { title: 'Love Story', artist: 'Taylor Swift', durationMs: 235_000 }
    ],
    expect: 1
  },
  {
    name: '查询是 Slowed+Reverb 时对称命中同版本',
    title: 'Snowman (Slowed + Reverb)', artist: 'Sia', durationMs: 200_000,
    candidates: [
      { title: 'Snowman', artist: 'Sia', durationMs: 170_000 },
      { title: 'Snowman (Slowed)', artist: 'Sia', durationMs: 200_000 }
    ],
    expect: 1
  },

  // ==================== 短标题保护 ====================
  {
    name: '单字标题不匹配包含它的更长标题(爱 vs 爱你)',
    title: '爱', artist: '莫文蔚',
    candidates: [
      { title: '爱你', artist: '王心凌', durationMs: DUR },
      { title: '爱情', artist: '莫文蔚', durationMs: DUR }
    ],
    expect: null
  },
  {
    name: '单字标题与自身命中',
    title: '爱', artist: '莫文蔚',
    candidates: [{ title: '爱', artist: '莫文蔚', durationMs: DUR }],
    expect: 0
  },
  {
    name: 'IF 不匹配 IF YOU(比例悬殊)',
    title: 'IF', artist: 'Big Bang',
    candidates: [{ title: 'IF YOU', artist: 'Big Bang', durationMs: DUR }],
    expect: null
  },
  {
    name: '短标题包含且比例 1.5 放行',
    title: '晴天', artist: '周杰伦',
    candidates: [{ title: '晴天吖', artist: '周杰伦', durationMs: DUR }],
    expect: 0
  },

  // ==================== 简繁 / 全半角 / 等价写法 ====================
  {
    name: '繁体标题 vs 简体候选',
    title: '晴天', artist: '周杰倫',
    candidates: [{ title: '晴天', artist: '周杰伦', durationMs: DUR }],
    expect: 0
  },
  {
    name: '繁体标题候选 vs 简体查询',
    title: '龍捲風', artist: '周杰伦',
    candidates: [{ title: '龙卷风', artist: '周杰伦', durationMs: DUR }],
    expect: 0
  },
  {
    name: '全角拉丁 vs 半角候选',
    title: 'Ｓｈａｐｅ ｏｆ Ｙｏｕ', artist: 'Ed Sheeran',
    candidates: [{ title: 'Shape of You', artist: 'Ed Sheeran', durationMs: DUR }],
    expect: 0
  },
  {
    name: 'Part II vs Part 2(罗马数字等价)',
    title: 'Trip Part II', artist: 'Audien',
    candidates: [{ title: 'Trip Part 2', artist: 'Audien', durationMs: DUR }],
    expect: 0
  },
  {
    name: '& vs and',
    title: 'Blood & Roses', artist: 'The Smithereens',
    candidates: [{ title: 'Blood and Roses', artist: 'The Smithereens', durationMs: DUR }],
    expect: 0
  },
  {
    name: '日文长音符/中点不失配',
    title: 'ラブ・ストーリー', artist: '玉置浩二',
    candidates: [{ title: 'ラブストーリー', artist: '玉置浩二', durationMs: DUR }],
    expect: 0
  },
  {
    name: '半角片假名 vs 全角片假名(NFKC)',
    title: 'ﾊﾟｲﾅｯﾌﾟﾙ', artist: 'サザンオールスターズ',
    candidates: [{ title: 'パイナップル', artist: 'サザンオールスターズ', durationMs: DUR }],
    expect: 0
  },

  // ==================== 歌手(拆分/别名/跨语言) ====================
  {
    name: 'feat 歌手:主歌手命中即可',
    title: '稻香', artist: '周杰伦 feat. 杨瑞代',
    candidates: [{ title: '稻香', artist: '周杰伦', durationMs: DUR }],
    expect: 0
  },
  {
    name: '多歌手交集:全命中优于半命中',
    title: '广岛之恋', artist: '莫文蔚 / 张洪量',
    candidates: [
      { title: '广岛之恋', artist: '莫文蔚', durationMs: DUR },
      { title: '广岛之恋', artist: '莫文蔚/张洪量', durationMs: DUR }
    ],
    expect: 1
  },
  {
    name: '中英歌手名:标题全等 + 时长接近时歌手权重降低',
    title: '七里香', artist: 'Jay Chou',
    candidates: [
      { title: '七里香', artist: '周杰伦', durationMs: DUR },
      { title: '七里香', artist: '群星', durationMs: DUR }
    ],
    expect: 0
  },
  {
    name: '歌手别名命中英文名',
    title: '十年', artist: 'Eason Chan',
    candidates: [{ title: '十年', artist: '陈奕迅', artistAliases: ['Eason Chan'], durationMs: DUR }],
    expect: 0
  },
  {
    name: '标题别名(译名)命中',
    title: '后来', artist: '刘若英',
    candidates: [{ title: 'Later', aliasNames: ['后来'], artist: '刘若英', durationMs: DUR }],
    expect: 0
  },
  {
    name: '固定名 AC/DC 不被拆散',
    title: 'Highway to Hell', artist: 'AC/DC',
    candidates: [{ title: 'Highway to Hell', artist: 'AC/DC', durationMs: DUR }],
    expect: 0
  },
  {
    name: 'Simon & Garfunkel 不被 & 拆散',
    title: 'The Sound of Silence', artist: 'Simon & Garfunkel',
    candidates: [{ title: 'The Sound of Silence', artist: 'Simon & Garfunkel', durationMs: DUR }],
    expect: 0
  },

  // ==================== 专辑 ====================
  {
    name: '同名歌:专辑匹配的候选胜出',
    title: '晴天', artist: '周杰伦', album: '叶惠美',
    candidates: [
      { title: '晴天', artist: '周杰伦', album: '某合辑', durationMs: DUR },
      { title: '晴天', artist: '周杰伦', album: '叶惠美', durationMs: DUR }
    ],
    expect: 1
  },
  {
    name: '专辑不同不扣分:合辑里的同名歌仍命中',
    title: '晴天', artist: '周杰伦', album: '叶惠美',
    candidates: [{ title: '晴天', artist: '周杰伦', album: '华语金曲合辑', durationMs: DUR }],
    expect: 0
  },

  // ==================== 翻唱 / 纯音乐 / 伴奏 / Demo ====================
  {
    name: '查询是翻唱时翻唱候选胜出',
    title: '晴天 (翻唱)', artist: '路人小王', durationMs: 271_000,
    candidates: [
      { title: '晴天', artist: '周杰伦', durationMs: DUR },
      { title: '晴天 (Cover)', artist: '路人小王', durationMs: 271_000 }
    ],
    expect: 1
  },
  {
    name: '纯音乐查询命中纯音乐候选',
    title: '夜曲 (纯音乐)', artist: '钢琴师', durationMs: 250_000,
    candidates: [{ title: '夜曲 (纯音乐)', artist: '钢琴师', durationMs: 250_000 }],
    expect: 0
  },
  {
    name: '伴奏查询命中伴奏候选而非原版',
    title: '晴天 (伴奏)', artist: '周杰伦', durationMs: DUR,
    candidates: [
      { title: '晴天', artist: '周杰伦', durationMs: DUR },
      { title: '晴天 (Instrumental)', artist: '周杰伦', durationMs: DUR }
    ],
    expect: 1
  },
  {
    name: 'Demo 查询命中 Demo 候选',
    title: '夜色温柔 (Demo)', artist: '虚拟歌手', durationMs: 240_000,
    candidates: [
      { title: '夜色温柔', artist: '虚拟歌手', durationMs: 236_000 },
      { title: '夜色温柔 (Demo)', artist: '虚拟歌手', durationMs: 240_000 }
    ],
    expect: 1
  },
  {
    name: '重制版轻惩罚:原版候选仍可胜出',
    title: 'Yesterday - Remastered 2011', artist: 'The Beatles',
    candidates: [
      { title: 'Yesterday', artist: 'The Beatles', durationMs: DUR },
      { title: 'Yesterday (Remastered 2011)', artist: 'The Beatles', durationMs: DUR }
    ],
    expect: 1
  },

  // ==================== 歌词内容反校验 ====================
  {
    name: '尾时间戳超时长 10s 以上:候选让位',
    title: '晴天', artist: '周杰伦',
    candidates: [
      {
        title: '晴天', artist: '周杰伦', album: '叶惠美', durationMs: DUR,
        synced: '[00:01.00]a\n[05:00.00]b\n[05:29.00]c'
      },
      {
        title: '晴天', artist: '周杰伦', album: '华语合辑', durationMs: DUR,
        synced: '[00:01.00]a\n[01:00.00]b\n[04:20.00]c'
      }
    ],
    expect: 1
  },
  {
    name: '查询中文而歌词几乎全拉丁:候选让位',
    title: '晴天', artist: '周杰伦',
    candidates: [
      {
        title: '晴天', artist: '周杰伦', durationMs: DUR,
        synced: '[00:01.00]la la la\n[01:00.00]yeah yeah\n[04:00.00]oh baby'
      },
      {
        title: '晴天', artist: '周杰伦', durationMs: DUR,
        synced: '[00:01.00]刮风这天\n[01:00.00]我试过握着你手\n[04:00.00]但偏偏雨渐渐'
      }
    ],
    expect: 1
  },
  {
    name: '查询拉丁而歌词几乎全中文:候选让位',
    title: 'Yesterday', artist: 'The Beatles',
    candidates: [
      {
        title: 'Yesterday', artist: 'The Beatles', durationMs: DUR,
        synced: '[00:01.00]昨天\n[01:00.00]所有烦恼仿佛远走\n[04:00.00]如今我渴望昨天'
      },
      {
        title: 'Yesterday', artist: 'The Beatles', durationMs: DUR,
        synced: '[00:01.00]Yesterday\n[01:00.00]All my troubles seemed so far away\n[04:00.00]Now it looks as though'
      }
    ],
    expect: 1
  },
  {
    name: '中文歌夹杂少量英文不受语言惩罚',
    title: '晴天', artist: '周杰伦',
    candidates: [
      {
        title: '晴天', artist: '周杰伦', durationMs: DUR,
        synced: '[00:01.00]刮风这天\n[01:00.00]我试过握着你手\n[04:00.00]but 雨渐渐'
      }
    ],
    expect: 0
  },
  {
    name: '平分序奖励:有时间轴胜过纯文本',
    title: '晴天', artist: '周杰伦',
    candidates: [
      { title: '晴天', artist: '周杰伦', durationMs: DUR, synced: null },
      {
        title: '晴天', artist: '周杰伦', durationMs: DUR,
        synced: '[00:01.00]刮风这天\n[01:00.00]我试过握着你手\n[04:00.00]但偏偏雨渐渐'
      }
    ],
    expect: 1
  },
  {
    name: '序奖励:行数多者胜(其余相同)',
    title: '晴天', artist: '周杰伦',
    candidates: [
      {
        title: '晴天', artist: '周杰伦', durationMs: DUR,
        synced: '[00:01.00]a\n[01:00.00]b'
      },
      {
        title: '晴天', artist: '周杰伦', durationMs: DUR,
        synced: '[00:01.00]a\n[00:20.00]b\n[00:40.00]c\n[01:00.00]d\n[01:20.00]e\n[01:40.00]f\n[02:00.00]g\n[02:20.00]h\n[02:40.00]i\n[03:00.00]j'
      }
    ],
    expect: 1
  },
  {
    name: '序奖励:有翻译胜过行数少(时间轴优先级最高不互斥)',
    title: '晴天', artist: '周杰伦',
    candidates: [
      {
        title: '晴天', artist: '周杰伦', durationMs: DUR,
        synced: '[00:01.00]a\n[00:20.00]b\n[00:40.00]c\n[01:00.00]d\n[01:20.00]e\n[01:40.00]f\n[02:00.00]g\n[02:20.00]h\n[02:40.00]i\n[03:00.00]j'
      },
      {
        title: '晴天', artist: '周杰伦', durationMs: DUR,
        synced: '[00:01.00]a\n[00:20.00]b\n[00:40.00]c\n[01:00.00]d\n[01:20.00]e\n[01:40.00]f\n[02:00.00]g\n[02:20.00]h\n[02:40.00]i\n[03:00.00]j',
        translation: '[00:01.00]A\n[00:20.00]B\n[00:40.00]C\n[01:00.00]D\n[01:20.00]E\n[01:40.00]F\n[02:00.00]G\n[02:20.00]H\n[02:40.00]I\n[03:00.00]J'
      }
    ],
    expect: 1
  },

  // ==================== 硬门槛 / 负面 ====================
  {
    name: '标题完全不相关 → null',
    title: '晴天', artist: '周杰伦',
    candidates: [{ title: '完全无关的歌', artist: '别人', durationMs: DUR }],
    expect: null
  },
  {
    name: '候选列表为空 → null',
    title: '晴天', artist: '周杰伦',
    candidates: [],
    expect: null
  },
  {
    name: '标题相近但歌手与时长都远 → null(宁缺毋滥)',
    title: '爱', artist: '莫文蔚', durationMs: 200_000,
    candidates: [{ title: '爱', artist: '某个完全不同的人', durationMs: 90_000 }],
    expect: null
  }
]

describe('匹配样例表', () => {
  for (const c of cases) {
    it(c.name, () => assertCase(c))
  }

  it('样例总数 ≥ 40(阶段 1 验收要求)', () => {
    expect(cases.length).toBeGreaterThanOrEqual(40)
  })
})
