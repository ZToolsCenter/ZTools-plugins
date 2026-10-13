import { describe, expect, it } from 'vitest'
import { cleanArtist, cleanTitle, normalizeText } from './clean-title'

describe('cleanTitle', () => {
  it('strips junk bracket notes', () => {
    expect(cleanTitle('晴天 (Live)')).toBe('晴天')
    expect(cleanTitle('晴天【Remastered 2011】')).toBe('晴天')
    expect(cleanTitle('晴天 (Official Music Video)')).toBe('晴天')
    expect(cleanTitle('晴天(Live 现场版)')).toBe('晴天')
  })

  it('strips trailing dash suffixes like - Remastered', () => {
    expect(cleanTitle('Yesterday - Remastered 2009')).toBe('Yesterday')
    expect(cleanTitle('Yesterday - Live at BBC')).toBe('Yesterday')
  })

  it('drops "song - artist" when the right side matches known artist', () => {
    expect(cleanTitle('晴天 - 周杰伦', '周杰伦')).toBe('晴天')
    expect(cleanTitle('Shape of You - Ed Sheeran', 'Ed Sheeran')).toBe('Shape of You')
  })

  it('keeps "song - subtitle" when artist unknown or right side not artist', () => {
    // 歌手未知:不能猜,保留
    expect(cleanTitle('双截棍 - 周杰伦风格改编')).toBe('双截棍 - 周杰伦风格改编')
    // 右侧不是歌手:保留副标题
    expect(cleanTitle('晴天 - 叶惠美版', '周杰伦')).toBe('晴天 - 叶惠美版')
  })

  it('keeps meaningful parentheses (non-junk)', () => {
    expect(cleanTitle('稻香(2003)')).toBe('稻香(2003)')
  })

  it('collapses whitespace', () => {
    expect(cleanTitle('  晴天   (Live) ')).toBe('晴天')
  })
})

describe('cleanArtist', () => {
  it('strips featuring parts', () => {
    expect(cleanArtist('周杰伦 feat. 杨瑞代')).toBe('周杰伦')
    expect(cleanArtist('Artist A featuring B')).toBe('Artist A')
    expect(cleanArtist('A ft. B')).toBe('A')
  })

  it('keeps only the first of multi-artist separators', () => {
    expect(cleanArtist('周杰伦 / 杨瑞代')).toBe('周杰伦')
    expect(cleanArtist('A、B')).toBe('A')
  })

  it('handles empty input', () => {
    expect(cleanArtist('')).toBe('')
  })
})

describe('normalizeText', () => {
  it('removes case, spaces and punctuation', () => {
    expect(normalizeText('Shape of You!')).toBe('shapeofyou')
    expect(normalizeText('晴天 (Live)')).toBe('晴天live')
    expect(normalizeText('A-B_C')).toBe('abc')
  })
})
