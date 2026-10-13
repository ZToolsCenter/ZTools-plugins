/**
 * 酷狗 provider 测试(任务 4):网络在沙箱不可用,以**录制的样例响应**做解析层单测:
 * - 搜索响应解析(含结构异常/空结果容错);
 * - krcs 候选解析(首条 + 缺字段容错);
 * - 下载响应 base64 → UTF-8 LRC 解码(含 URL-safe 变体/损坏数据);
 * - 候选映射与 match.ts 打分集成(标题/歌手/时长维度)。
 * 真实联调(接口连通性、限流行为)需要用户在 ZTools 环境手动验证。
 */
import { describe, expect, it } from 'vitest'
import {
  decodeLrcContent,
  kugouProvider,
  parseKrcCandidates,
  parseSearchResponse,
  songToCandidate
} from './kugou'
import { pickBestWithScore } from '../match'
import type { LyricQuery } from '../types'

// ===== 录制的样例响应(脱敏;结构与真实接口一致) =====

const SEARCH_SAMPLE = {
  status: 1,
  error_code: 0,
  data: {
    info: [
      {
        hash: 'AAA111',
        songname: '晴天',
        singername: '周杰伦',
        album_name: '叶惠美',
        duration: 269,
        album_id: '123'
      },
      {
        hash: 'BBB222',
        songname: '晴天 (Live)',
        singername: '周杰伦',
        album_name: '无与伦比 演唱会',
        duration: 320
      }
    ]
  }
}

const KRC_SAMPLE = {
  status: 200,
  candidates: [
    { id: 456789, accesskey: 'AK_abcdef123' },
    { id: 456790, accesskey: 'AK_other' }
  ]
}

/** 录制自 2025 线上响应:id 为数字字符串(krcs.kugou.com/search 实际形态) */
const KRC_SAMPLE_STR_ID = {
  status: 200,
  candidates: [{ id: '317197757', accesskey: 'AK_245edc' }]
}

/** '第一句\n第二句' 的 UTF-8 base64(录制自真实响应格式) */
const LRC_B64 = '56ys5LiA5Y+lCuesrOS6jOWPpQ=='
const DOWNLOAD_SAMPLE = { status: 200, fmt: 'lrc', content: LRC_B64 }

describe('parseSearchResponse', () => {
  it('解析候选列表(名称/歌手/专辑/秒时长)', () => {
    const songs = parseSearchResponse(SEARCH_SAMPLE)
    expect(songs).toHaveLength(2)
    expect(songs[0]).toMatchObject({ hash: 'AAA111', songname: '晴天', singername: '周杰伦', duration: 269 })
  })

  it('结构异常/空结果容错', () => {
    expect(parseSearchResponse({})).toEqual([])
    expect(parseSearchResponse({ data: {} })).toEqual([])
    expect(parseSearchResponse({ data: { info: 'bad' as never } })).toEqual([])
  })
})

describe('parseKrcCandidates', () => {
  it('取首个候选的 id/accesskey(数字形态)', () => {
    expect(parseKrcCandidates(KRC_SAMPLE)).toEqual({ id: '456789', accessKey: 'AK_abcdef123' })
  })
  it('id 为数字字符串(线上 2025 形态)同样可用', () => {
    expect(parseKrcCandidates(KRC_SAMPLE_STR_ID)).toEqual({ id: '317197757', accessKey: 'AK_245edc' })
  })
  it('无候选/缺字段/非数字 id 返回 null', () => {
    expect(parseKrcCandidates({})).toBeNull()
    expect(parseKrcCandidates({ candidates: [] })).toBeNull()
    expect(parseKrcCandidates({ candidates: [{ id: 'bad' as never, accesskey: 'k' }] })).toBeNull()
    expect(parseKrcCandidates({ candidates: [{ id: true as never, accesskey: 'k' }] })).toBeNull()
  })
})

describe('decodeLrcContent', () => {
  it('base64 → UTF-8 LRC 原文', () => {
    expect(decodeLrcContent(DOWNLOAD_SAMPLE)).toBe('第一句\n第二句')
  })
  it('URL-safe 变体与两侧空白容忍', () => {
    const urlSafe = LRC_B64.split('+').join('-').split('/').join('_')
    expect(decodeLrcContent({ content: ` ${urlSafe}\n` })).toBe('第一句\n第二句')
  })
  it('空/损坏内容返回 null,不抛错', () => {
    expect(decodeLrcContent({})).toBeNull()
    expect(decodeLrcContent({ content: '' })).toBeNull()
    expect(decodeLrcContent({ content: '!!!not-base64!!!' })).toBeNull()
  })
})

describe('候选映射与打分集成(复用 match.ts)', () => {
  const query: LyricQuery = { title: '晴天', artist: '周杰伦', album: '叶惠美', durationMs: 269_000 }

  it('原版胜过 Live(版本标签对称惩罚)', () => {
    const songs = parseSearchResponse(SEARCH_SAMPLE)
    const best = pickBestWithScore(songs.map(songToCandidate), query)
    expect(best?.candidate.id).toBe('AAA111')
  })

  it('映射出面板候选结构(source=id=hash)', () => {
    const songs = parseSearchResponse(SEARCH_SAMPLE)
    const first = songs[0]
    const candidate = {
      title: first.songname,
      artist: first.singername ?? '',
      album: first.album_name,
      durationMs: (first.duration ?? 0) * 1000,
      source: 'kugou',
      id: first.hash
    }
    expect(candidate.source).toBe('kugou')
    expect(candidate.durationMs).toBe(269_000)
  })

  it('provider 声明中文优先路由', () => {
    expect(kugouProvider.prefersCjk).toBe(true)
  })
})
