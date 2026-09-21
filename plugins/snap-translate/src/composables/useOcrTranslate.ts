/**
 * OCR → 翻译 管线（纯消费方：全部走宿主 provider 聚合 API）。
 *
 * 宿主真实契约（ZTools preload）：
 *   ztools.translate(text, { from?, to?, providerId? })
 *   ztools.providers.invokeProvider(type, input, providerId?)
 *   ztools.providers.getProviders(type?) → [{ id, type, key, label, isDefault, ... }]
 *   providerId 形如 plugin:snap-translate:microsoft
 *
 * 翻译回退：默认渠道失败后，按 getProviders('translation') 列表轮询其它渠道，
 * 优先 microsoft（免密钥）→ google → baidu → youdao，再试列表中剩余项。
 *
 * 凭据配置：在本插件「截图翻译设置」填写，经 registerProvider 注入宿主；
 * 宿主「设置 → 提供商」里启用/设默认。
 */

import { resolveTargetLang, loadSavedTargetLang, loadSavedFromLang } from './useLang'
import { boxFromOcrLine, type PinOverlayLine } from '../pinOverlay'

/** OCR 不可用（无默认 provider / provider 报错）。 */
export class OcrUnavailableError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'OcrUnavailableError'
  }
}

export interface OcrTranslateResult {
  lines: SnapLine[]
  targetLang: string
  detectedFrom?: string
  translateOk: boolean
  translateError?: string
  diagnostics: string[]
  ocrProvider?: string
  translateProvider?: string
  confidence?: number
}

export interface OcrOnlyResult {
  lines: SnapLine[]
  confidence?: number
  diagnostics: string[]
  ocrProvider?: string
}

export interface OcrBoxesResult {
  lines: SnapLine[]
  boxes: PinOverlayLine[]
  confidence?: number
  diagnostics: string[]
  ocrProvider?: string
}

/** 偏好顺序：微软免密钥优先（google 反代常挂）。 */
const PREFERRED_KEYS = ['microsoft', 'ai-translation', 'google', 'baidu', 'youdao'] as const

interface ProviderChannel {
  id: string
  key?: string
  label?: string
  isDefault?: boolean
}

function pushLog(logs: string[], msg: string): void {
  const line = `[snap-translate] ${msg}`
  logs.push(line)
  try {
    console.info(line)
  } catch (_) {
    /* ignore */
  }
}

/** 供结果窗低调展示：provider id / key → 人类可读名称。 */
export function prettyProviderName(id?: string): string {
  const raw = String(id || '').trim()
  if (!raw || raw === 'default') return '宿主默认'
  const key = raw.includes(':') ? raw.split(':').pop()! : raw
  const map: Record<string, string> = {
    microsoft: '微软翻译',
    google: '谷歌翻译',
    baidu: '百度翻译',
    youdao: '有道翻译',
    'ai-translation': 'AI 翻译',
    ocr: '微信 OCR',
    paddle: 'Paddle OCR',
    'ai-ocr': 'AI 识图'
  }
  return map[key] || key
}

/** 解析宿主「设置→提供商」里某类型的默认项 id（失败则回退 'default'）。 */
async function resolveDefaultProviderId(
  type: 'ocr' | 'translation',
  logs: string[]
): Promise<string> {
  try {
    const getProviders = window.ztools?.providers?.getProviders
    if (typeof getProviders !== 'function') return 'default'
    const list = (await getProviders(type)) as any[]
    if (!Array.isArray(list) || list.length === 0) return 'default'
    const def = list.find((p) => p && p.isDefault) || list[0]
    return String(def?.id || def?.key || 'default')
  } catch (err: any) {
    pushLog(
      logs,
      `getProviders(${type}) failed: ` + (err?.message ? String(err.message) : String(err))
    )
    return 'default'
  }
}

async function resolveDefaultOcrProvider(logs: string[]): Promise<string> {
  return resolveDefaultProviderId('ocr', logs)
}

async function runOcr(
  image: string,
  logs: string[]
): Promise<{ blocks: string[]; confidence?: number; provider: string }> {
  let out: OcrProviderOutput
  pushLog(logs, 'OCR: calling ztools.ocr …')
  try {
    out = await window.ztools.ocr(image)
  } catch (err: any) {
    const msg = err?.message ? String(err.message) : String(err)
    pushLog(logs, 'OCR failed: ' + msg)
    throw new OcrUnavailableError(msg)
  }
  if (!out || typeof out.text !== 'string') {
    pushLog(logs, 'OCR invalid shape: ' + JSON.stringify(out).slice(0, 200))
    throw new OcrUnavailableError('OCR 提供商返回了无效结果')
  }
  let blocks =
    Array.isArray(out.blocks) && out.blocks.length > 0 ? out.blocks : out.text.split('\n')
  blocks = blocks.map((b) => String(b ?? '').trim()).filter((b) => b.length > 0)
  const provider = await resolveDefaultOcrProvider(logs)
  pushLog(logs, `OCR ok: ${blocks.length} blocks, provider=${provider}, confidence=${out.confidence ?? 'n/a'}`)
  return { blocks, confidence: out.confidence, provider }
}

/** 列出宿主已安装的 translation 渠道（含 plugin:f-provider:*）。 */
export async function listTranslationChannels(logs: string[]): Promise<ProviderChannel[]> {
  try {
    const getProviders = window.ztools?.providers?.getProviders
    if (typeof getProviders !== 'function') {
      pushLog(logs, 'getProviders unavailable')
      return []
    }
    const list = (await getProviders('translation')) as any[]
    if (!Array.isArray(list) || list.length === 0) {
      pushLog(logs, 'getProviders(translation): empty — 请在本插件设置页配置翻译，并在宿主设置→提供商中启用')
      return []
    }
    const channels: ProviderChannel[] = list.map((p) => ({
      id: String(p.id),
      key: typeof p.key === 'string' ? p.key : undefined,
      label: typeof p.label === 'string' ? p.label : undefined,
      isDefault: !!p.isDefault
    }))
    pushLog(
      logs,
      'channels: ' +
        channels
          .map((c) => `${c.id}${c.isDefault ? '*' : ''}${c.label ? `(${c.label})` : ''}`)
          .join(', ')
    )
    return channels
  } catch (err: any) {
    pushLog(logs, 'getProviders failed: ' + (err?.message ? String(err.message) : String(err)))
    return []
  }
}

function rankChannels(channels: ProviderChannel[]): ProviderChannel[] {
  const score = (c: ProviderChannel): number => {
    const key = c.key || ''
    const pref = PREFERRED_KEYS.indexOf(key as (typeof PREFERRED_KEYS)[number])
    // 非默认优先于已失败的默认：排序时 default 放最后一档但仍尝试
    const prefScore = pref >= 0 ? pref : 50
    const defaultPenalty = c.isDefault ? 100 : 0
    return prefScore + defaultPenalty
  }
  return [...channels].sort((a, b) => score(a) - score(b))
}

async function invokeTranslate(
  text: string,
  to: string,
  providerId: string | undefined,
  logs: string[],
  tag: string,
  from = 'auto'
): Promise<TranslateProviderOutput | null> {
  try {
    const src = from && from !== 'auto' ? from : 'auto'
    const opts: { from: string; to: string; providerId?: string } = { from: src, to }
    if (providerId) opts.providerId = providerId
    pushLog(logs, `translate: ${tag}${providerId ? ` id=${providerId}` : ''} ${src} → ${to}`)
    const out = await window.ztools.translate(text, opts)
    if (out && typeof out.text === 'string' && out.text.length > 0) {
      pushLog(logs, `translate ${tag} ok (len=${out.text.length})`)
      return out
    }
    pushLog(logs, `translate ${tag}: empty/invalid`)
    return null
  } catch (err: any) {
    pushLog(logs, `translate ${tag} failed: ` + (err?.message ? String(err.message) : String(err)))
    return null
  }
}

/**
 * 翻译一次文本：宿主默认 → 按 getProviders 列表回退（正确 providerId）。
 * 全部失败抛错（含诊断）；调用方不应再对同一失败集做逐行重试。
 */
export async function translateWithFallback(
  text: string,
  to: string,
  logs: string[],
  from = 'auto'
): Promise<{ text: string; detectedFrom?: string; provider: string }> {
  // 1) 宿主默认（设置→提供商 里选的默认翻译）
  const def = await invokeTranslate(text, to, undefined, logs, 'default', from)
  if (def) {
    // 展示时用宿主默认的真实 id，而不是笼统的 'default'
    const providerId = await resolveDefaultProviderId('translation', logs)
    return { text: def.text, detectedFrom: def.detectedFrom, provider: providerId }
  }

  // 2) 列出已注入宿主的 translation 渠道并按偏好轮询
  const channels = rankChannels(await listTranslationChannels(logs))
  if (channels.length === 0) {
    // 最后兜底：按 f-provider 约定 id 硬试（插件已装但 getProviders 失败时）
    for (const key of PREFERRED_KEYS) {
      for (const id of [`plugin:snap-translate:${key}`, `plugin:f-provider:${key}`]) {
        const out = await invokeTranslate(text, to, id, logs, key, from)
        if (out) {
          return { text: out.text, detectedFrom: out.detectedFrom, provider: id }
        }
      }
    }
    throw new Error(
      '没有可用的翻译提供商。请：1) 打开「截图翻译设置」配置凭据（推荐微软免密钥）；2) 在宿主「设置 → 提供商」启用并设默认。详情: ' +
        logs
          .filter((l) => l.includes('translate') || l.includes('channel') || l.includes('getProviders'))
          .map((l) => l.replace(/^\[snap-translate\]\s*/, ''))
          .join(' | ')
    )
  }

  for (const ch of channels) {
    // 默认已试过，跳过同 id 再打一次
    if (ch.isDefault) continue
    const out = await invokeTranslate(text, to, ch.id, logs, ch.key || ch.label || ch.id, from)
    if (out) {
      return { text: out.text, detectedFrom: out.detectedFrom, provider: ch.id }
    }
  }

  // 若默认是唯一渠道且已失败，再显式用其 id 打一次（某些宿主 default 与 id 路径不一致）
  const onlyDefault = channels.find((c) => c.isDefault)
  if (onlyDefault) {
    const out = await invokeTranslate(text, to, onlyDefault.id, logs, 'default-by-id', from)
    if (out) {
      return { text: out.text, detectedFrom: out.detectedFrom, provider: onlyDefault.id }
    }
  }

  throw new Error(
    '全部翻译通道失败。请在「截图翻译设置」配置可用翻译（推荐微软），并在宿主「设置 → 提供商」启用。详情: ' +
      logs
        .filter((l) => l.includes('translate') || l.includes('channel'))
        .map((l) => l.replace(/^\[snap-translate\]\s*/, ''))
        .join(' | ')
  )
}

/** 整段只译一次。行数对不齐就按最短对齐，多出的原文行译文留空。 */
async function translateMerged(
  blocks: string[],
  to: string,
  logs: string[],
  from = 'auto'
): Promise<{ lines: string[]; detectedFrom?: string; provider: string }> {
  const merged = blocks.join('\n')
  const out = await translateWithFallback(merged, to, logs, from)
  const parts = out.text.split('\n')
  if (parts.length !== blocks.length) {
    pushLog(logs, `merge align miss: src=${blocks.length} dst=${parts.length} → keep merged`)
  }
  const lines = blocks.map((_, i) => parts[i] ?? '')
  if (parts.length === 1 && blocks.length > 1) {
    lines[0] = out.text
  }
  return { lines, detectedFrom: out.detectedFrom, provider: out.provider }
}

/** 纯 OCR（快速路径）。 */
export async function ocrOnly(image: string): Promise<OcrOnlyResult> {
  const diagnostics: string[] = []
  const { blocks, confidence, provider } = await runOcr(image, diagnostics)
  const lines: SnapLine[] = blocks.map((text) => ({ text, translated: '' }))
  return { lines, confidence, diagnostics, ocrProvider: provider }
}

/**
 * 贴图 OCR：与直接 OCR 同一优先级——先宿主默认，默认挂了再回退微信/Paddle。
 * 仅回退路径可能带检测框（供译文覆盖）；宿主默认一般只有文字。
 */
export async function ocrWithBoxes(image: string): Promise<OcrBoxesResult> {
  const diagnostics: string[] = []
  // 1) 宿主默认 OCR
  try {
    const { blocks, confidence, provider } = await runOcr(image, diagnostics)
    return {
      lines: blocks.map((text) => ({ text, translated: '' })),
      boxes: [],
      confidence,
      diagnostics,
      ocrProvider: provider
    }
  } catch (err: any) {
    pushLog(
      diagnostics,
      'host default OCR failed → wechat/paddle fallback: ' +
        (err?.message ? String(err.message) : String(err))
    )
  }
  // 2) 微信明细（带框）
  try {
    const detail = window.services?.ocrImageDetail
    if (typeof detail === 'function') {
      const d = await detail(image)
      if (d?.ok && Array.isArray(d.lines) && d.lines.length) {
        const boxes = d.lines
          .map((l) => boxFromOcrLine(l))
          .filter((b): b is PinOverlayLine => !!b)
        if (boxes.length) {
          pushLog(diagnostics, `OCR detail fallback: ${boxes.length} boxes`)
          return {
            lines: boxes.map((b) => ({ text: b.text, translated: '' })),
            boxes,
            confidence: d.lines.length
              ? d.lines.reduce((s, l) => s + (Number(l.rate) || 0), 0) / d.lines.length
              : undefined,
            diagnostics,
            ocrProvider: 'ocr'
          }
        }
      } else if (d && d.ok === false && d.error) {
        pushLog(diagnostics, 'ocrImageDetail: ' + d.error)
      }
    }
  } catch (err: any) {
    pushLog(diagnostics, 'ocrImageDetail failed: ' + (err?.message ? String(err.message) : String(err)))
  }
  // 3) Paddle（带框）
  try {
    const paddleReady = window.services?.paddleStatus?.().ready
    if (paddleReady && typeof window.services.paddleRecognize === 'function') {
      const p = await window.services.paddleRecognize(image)
      const boxes = Array.isArray(p?.boxes)
        ? p.boxes.map((b) => boxFromOcrLine(b)).filter((b): b is PinOverlayLine => !!b)
        : []
      if (boxes.length) {
        pushLog(diagnostics, `Paddle OCR fallback: ${boxes.length} boxes`)
        return {
          lines: boxes.map((b) => ({ text: b.text, translated: '' })),
          boxes,
          confidence: p.confidence,
          diagnostics,
          ocrProvider: 'paddle'
        }
      }
    }
  } catch (err: any) {
    pushLog(diagnostics, 'paddleRecognize boxes failed: ' + (err?.message ? String(err.message) : String(err)))
  }
  throw new OcrUnavailableError(
    'OCR 全部失败（宿主默认 / 微信 / Paddle）。请在宿主「设置 → 提供商」设默认 OCR，或在本插件设置安装微信/Paddle。详情: ' +
      diagnostics.map((l) => l.replace(/^\[snap-translate\]\s*/, '')).join(' | ')
  )
}

/**
 * 完整管线入口。
 * 通道全挂时只报一次错误，不再 13 行 × N 渠道刷日志。
 */
function resolveLangs(text: string, toLang?: string, fromLang?: string): { from: string; to: string } {
  const from = fromLang && fromLang !== 'auto' ? fromLang : loadSavedFromLang() || 'auto'
  const to =
    toLang && toLang !== 'auto' ? toLang : loadSavedTargetLang() || resolveTargetLang(text)
  return { from, to }
}

export async function ocrTranslate(
  image: string,
  toLang?: string,
  fromLang?: string
): Promise<OcrTranslateResult> {
  const diagnostics: string[] = []
  const { blocks, confidence, provider: ocrProvider } = await runOcr(image, diagnostics)

  if (blocks.length === 0) {
    pushLog(diagnostics, 'no text from OCR')
    return {
      lines: [],
      targetLang: toLang || 'zh-CN',
      translateOk: true,
      diagnostics,
      confidence,
      ocrProvider
    }
  }

  const { from, to } = resolveLangs(blocks.join('\n'), toLang, fromLang)
  pushLog(diagnostics, `langs ${from} → ${to}`)

  let translated: { lines: string[]; detectedFrom?: string; provider?: string } | null = null
  let translateError: string | undefined
  let translateProvider: string | undefined

  try {
    translated = await translateMerged(blocks, to, diagnostics, from)
    if (translated && translated.lines.every((l) => !l)) {
      translateError = '翻译结果为空'
      pushLog(diagnostics, translateError)
      translated = null
    } else if (translated) {
      translateProvider = translated.provider
    }
  } catch (err: any) {
    // 全部通道失败：不再逐行重试（避免日志爆炸）
    translated = null
    translateError = err?.message ? String(err.message) : String(err)
    pushLog(diagnostics, 'translate aborted (all channels failed once)')
  }

  if (!translated && !translateError) {
    translateError = '翻译不可用（未知原因，见诊断日志）'
  }

  const lines: SnapLine[] = blocks.map((text, i) => ({
    text,
    translated: translated ? (translated.lines[i] ?? '') : ''
  }))

  return {
    lines,
    targetLang: to,
    detectedFrom: translated?.detectedFrom,
    translateOk: !!translated,
    translateError,
    diagnostics,
    ocrProvider,
    translateProvider,
    confidence
  }
}

/** 仅翻译已有原文行（悬浮贴「翻译」按钮用）。 */
export async function translateLines(
  sourceLines: string[],
  toLang?: string,
  fromLang?: string
): Promise<OcrTranslateResult> {
  const diagnostics: string[] = []
  const blocks = sourceLines.map((s) => String(s ?? '').trim()).filter(Boolean)
  if (blocks.length === 0) {
    return { lines: [], targetLang: toLang || 'zh-CN', translateOk: true, diagnostics }
  }
  const { from, to } = resolveLangs(blocks.join('\n'), toLang, fromLang)
  pushLog(diagnostics, `translateLines ${from} → ${to} count=${blocks.length}`)

  let translated: { lines: string[]; detectedFrom?: string; provider?: string } | null = null
  let translateError: string | undefined
  try {
    translated = await translateMerged(blocks, to, diagnostics, from)
    if (translated && translated.lines.every((l) => !l)) {
      translated = null
      translateError = '翻译结果为空'
    }
  } catch (err: any) {
    translateError = err?.message ? String(err.message) : String(err)
    pushLog(diagnostics, 'translateLines failed: ' + translateError)
  }

  return {
    lines: blocks.map((text, i) => ({
      text,
      translated: translated ? (translated.lines[i] ?? '') : ''
    })),
    targetLang: to,
    detectedFrom: translated?.detectedFrom,
    translateOk: !!translated,
    translateError,
    diagnostics,
    translateProvider: translated?.provider
  }
}
