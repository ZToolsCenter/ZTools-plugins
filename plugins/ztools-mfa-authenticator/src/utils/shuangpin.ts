export type ShuangpinScheme = 'off' | 'ziranma' | 'xiaohe' | 'pinyinjiajia' | 'microsoft' | 'sogou'

export const schemeLabels: Record<ShuangpinScheme, string> = {
  off: '关闭',
  ziranma: '自然码',
  xiaohe: '小鹤',
  pinyinjiajia: '拼音加加',
  microsoft: '微软',
  sogou: '搜狗',
}

interface SchemeMap {
  shengmu: Record<string, string>
  yunmu: Record<string, string>
}

const ziranma: SchemeMap = {
  shengmu: { q: 'q', w: 'w', e: 'e', r: 'r', t: 't', y: 'y', u: 'sh', i: 'ch', o: 'o', p: 'p', a: 'a', s: 's', d: 'd', f: 'f', g: 'g', h: 'h', j: 'j', k: 'k', l: 'l', z: 'z', x: 'x', c: 'c', v: 'zh', b: 'b', n: 'n', m: 'm' },
  yunmu: { q: 'iu', w: 'ia', r: 'uan', t: 'ue', y: 'uai', u: 'u', i: 'i', o: 'uo', p: 'un', a: 'a', s: 'ong', d: 'uang', f: 'en', g: 'eng', h: 'ang', j: 'an', k: 'ao', l: 'ai', z: 'ei', x: 'ie', c: 'iao', v: 'ui', b: 'ou', n: 'in', m: 'ian' },
}

const xiaohe: SchemeMap = {
  shengmu: { q: 'q', w: 'w', e: 'e', r: 'r', t: 't', y: 'y', u: 'sh', i: 'ch', o: 'o', p: 'p', a: 'a', s: 's', d: 'd', f: 'f', g: 'g', h: 'h', j: 'j', k: 'k', l: 'l', z: 'z', x: 'x', c: 'c', v: 'zh', b: 'b', n: 'n', m: 'm' },
  yunmu: { q: 'iu', w: 'ei', r: 'uan', t: 'ue', y: 'un', u: 'u', i: 'i', o: 'uo', p: 'ie', a: 'a', s: 'ong', d: 'ai', f: 'en', g: 'eng', h: 'ang', j: 'an', k: 'ao', l: 'in', z: 'ou', x: 'ia', c: 'ao', v: 'ui', b: 'ou', n: 'iao', m: 'ian' },
}

const pinyinjiajia: SchemeMap = {
  shengmu: { q: 'q', w: 'w', e: 'e', r: 'r', t: 't', y: 'y', u: 'sh', i: 'ch', o: 'o', p: 'p', a: 'a', s: 's', d: 'd', f: 'f', g: 'g', h: 'h', j: 'j', k: 'k', l: 'l', z: 'z', x: 'x', c: 'c', v: 'zh', b: 'b', n: 'n', m: 'm' },
  yunmu: { q: 'ei', w: 'en', r: 'uan', t: 'iang', y: 'uai', u: 'u', i: 'i', o: 'uo', p: 'un', a: 'a', s: 'ong', d: 'uang', f: 'eng', g: 'ang', h: 'an', j: 'iu', k: 'ao', l: 'ai', z: 'ie', x: 'ia', c: 'iao', v: 'ui', b: 'ou', n: 'in', m: 'ian' },
}

const microsoft: SchemeMap = {
  shengmu: { q: 'q', w: 'w', e: 'e', r: 'r', t: 't', y: 'y', u: 'sh', i: 'ch', o: 'o', p: 'p', a: 'a', s: 's', d: 'd', f: 'f', g: 'g', h: 'h', j: 'j', k: 'k', l: 'l', z: 'z', x: 'x', c: 'c', v: 'zh', b: 'b', n: 'n', m: 'm' },
  yunmu: { q: 'iu', w: 'ia', r: 'uan', t: 'ue', y: 'uai', u: 'u', i: 'i', o: 'uo', p: 'un', a: 'a', s: 'ong', d: 'uang', f: 'en', g: 'eng', h: 'ang', j: 'an', k: 'ao', l: 'ai', z: 'ei', x: 'ie', c: 'iao', v: 'ui', b: 'ou', n: 'in', m: 'ian' },
}

const sogou: SchemeMap = {
  shengmu: { q: 'q', w: 'w', e: 'e', r: 'r', t: 't', y: 'y', u: 'sh', i: 'ch', o: 'o', p: 'p', a: 'a', s: 's', d: 'd', f: 'f', g: 'g', h: 'h', j: 'j', k: 'k', l: 'l', z: 'z', x: 'x', c: 'c', v: 'zh', b: 'b', n: 'n', m: 'm' },
  yunmu: { q: 'iu', w: 'ia', r: 'uan', t: 'ue', y: 'uai', u: 'u', i: 'i', o: 'uo', p: 'un', a: 'a', s: 'ong', d: 'uang', f: 'en', g: 'eng', h: 'ang', j: 'an', k: 'ao', l: 'ai', z: 'ei', x: 'ie', c: 'iao', v: 'ui', b: 'ou', n: 'in', m: 'ian' },
}

const schemes: Record<Exclude<ShuangpinScheme, 'off'>, SchemeMap> = {
  ziranma,
  xiaohe,
  pinyinjiajia,
  microsoft,
  sogou,
}

export function expandShuangpin(input: string, scheme: ShuangpinScheme): string {
  if (scheme === 'off') return input
  const map = schemes[scheme]
  if (!map) return input

  const lower = input.toLowerCase()
  let result = ''
  let i = 0

  while (i < lower.length) {
    const ch = lower[i]

    if (!/[a-z]/.test(ch)) {
      result += ch
      i++
      continue
    }

    if (i + 1 < lower.length && /[a-z]/.test(lower[i + 1])) {
      const sm = map.shengmu[ch] ?? ch
      const ym = map.yunmu[lower[i + 1]] ?? lower[i + 1]
      result += sm + ym
      i += 2
    } else {
      result += ch
      i++
    }
  }

  return result
}
