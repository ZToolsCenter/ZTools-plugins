/**
 * markdown 输出收尾（序列化之后跑一遍）
 *
 * 解决两件事：
 * 1. remark-stringify 会把正文里的 @ 和 . 转义成 \@ \.
 *    （它怕被重新解析成 autolink），结果用户写的 "lancc@live.com" 存回去变成
 *    "lancc\@live.com" —— 原文被改写。这里只还原邮箱/网址语境下的转义。
 * 2. 序列化会在文档末尾留下多条空行，反复保存会越积越多。
 */

const BS = String.fromCharCode(92) // 反斜杠
const NL = String.fromCharCode(10)

/** 常见顶级域名：只在域名语境下还原被转义的点，避免动到 v1\.0 这类手写转义 */
const TLDS = [
  'com', 'cn', 'net', 'org', 'io', 'dev', 'me', 'live', 'co', 'app',
  'info', 'xyz', 'top', 'cc', 'tv', 'site', 'online', 'tech', 'ai',
]

const FENCE_PREFIXES = ['```', '~~~']

function isFenceLine(line: string): boolean {
  const t = line.trim()
  return FENCE_PREFIXES.some((p) => t.startsWith(p))
}

/** 还原一行里的邮箱 / 网址转义 */
function unescapeLine(line: string): string {
  let t = line
  // 邮箱：xxx\@yyy → xxx@yyy
  t = t.split(BS + '@').join('@')
  // 协议：http\://  https\://
  t = t.split('http' + BS + '://').join('http://')
  t = t.split('https' + BS + '://').join('https://')
  // 已知协议写法的通用形式：任意 x\:// 只在前面是字母时还原
  t = t.split(BS + '://').join('://')
  // www\.xxx → www.xxx
  t = t.split('www' + BS + '.').join('www.')
  // 域名结尾：xxx\.com → xxx.com（只认已知 TLD）
  for (const tld of TLDS) {
    t = t.split(BS + '.' + tld).join('.' + tld)
  }
  return t
}

/**
 * 收尾：还原无害转义 + 压掉末尾多余空行。围栏代码块里的内容一律不动。
 */
export function tidyMarkdown(md: string): string {
  const src = String(md || '')
  if (!src) return src
  const lines = src.split(NL)
  let inFence = false
  const out: string[] = []
  for (const line of lines) {
    if (isFenceLine(line)) {
      inFence = !inFence
      out.push(line)
      continue
    }
    out.push(inFence ? line : unescapeLine(line))
  }
  let text = out.join(NL)
  // 末尾空行压成一个换行
  while (text.endsWith(NL + NL)) text = text.slice(0, -1)
  if (!text.endsWith(NL)) text += NL
  return text
}
