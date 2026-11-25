/**
 * AI 生成：工具栏最左侧那个按钮
 *
 * 走 ZTools 宿主提供的 ztools.aiChat（流式），模型列表来自 ztools.allAiModels。
 * 生成结果不直接覆盖正文，先给预览，确认后插入到光标处。
 */
import { useCallback, useEffect, useState } from 'react'
import { useNotes } from '../../../service/store/notes'
import { hostApi, noteState } from '../../../runtime/legacy-bridge'

/**
 * 宿主模型字段不统一：
 *   ZTools  { value, label, providerLabel, modelId }
 *   uTools  { id, label, description, icon, cost }   ← 没有 value，之前直接读 m.value 会得到 undefined
 */
type AiModel = {
  id?: string
  value?: string
  label?: string
  name?: string
  modelId?: string
  providerLabel?: string
}

/** 归一化成 { value, label }，两个宿主都能用 */
function normalizeModels(list: unknown): { value: string; label: string }[] {
  const arr = Array.isArray(list) ? list : []
  return arr
    .map((m) => {
      const o = m as AiModel
      const value = String(o.value ?? o.id ?? o.modelId ?? '')
      const label = String(o.label ?? o.name ?? value)
      return { value, label }
    })
    .filter((m) => m.value !== '')
}

type Zt = {
  allAiModels?: () => Promise<AiModel[]>
  /** uTools >= 7.0 与 ZTools 都有：非流式调用，model 可省略（uTools 默认 deepseek-v3） */
  ai?: (
    option: { model?: string; messages: { role: string; content: string }[] },
    streamCallback?: (chunk: unknown) => void
  ) => Promise<{ content?: string }>
  aiChat?: (
    option: { model?: string; messages: { role: string; content: string }[]; temperature?: number },
    cb?: (payload: unknown) => void
  ) => Promise<unknown>
  redirectAiModelsSetting?: () => void
}

const zt = () => hostApi() as unknown as Zt


/* ---------------- 三个预设助手（提示词原文取自 V1.0.0） ---------------- */

const PRESETS: Record<'mermaid' | 'echarts' | 'table', string> = {
  mermaid: `
    ## 定位
    - 智能助手名称 ： Mermaid 图表生成助手
    - 主要功能 ：根据用户输入的内容生成 Mermaid 图表代码
    - Mermaid 版本 : 11.12.0

    ## 要求
    - 生成的代码要符合 Mermaid 语法，准确表达用户需求
    - 根据用户输入的内容绘制最合适的图表类型
    - 确保生成的 Mermaid 代码可以正确渲染
    - 输出不要包含任何解释或其他内容
  
    ## 输出格式：
    \`\`\`mermaid
    Mermaid 图表代码
    \`\`\`
  `,
  echarts: `
    ## 定位
    - 智能助手名称 ：ECharts 统计图表生成助手
    - 主要功能 ：根据用户输入的内容生成 JSON 格式的 ECharts 配置代码
    - ECharts 版本 : 6.0.0

    ## 要求
    - 只支持 ECharts 基础图表类型：柱状图（bar）、折线图（line）、饼图（pie）、散点图（scatter）
    - 根据用户输入的内容选择最合适的图表类型
    - 默认图表高度是 300, 可根据图表内容设置合适的图表高度：返回的 JSON 增加 "height" 字段，例如 { "height": 300, ... }
    - 不理解内容或数据格式错误时，返回一个空的 ECharts 配置代码
    - 输出不要包含任何解释或其他内容

    ## 输出格式：
    \`\`\`echarts
    JSON 格式的 ECharts 配置代码
    \`\`\`
  `,
  table: `
    ## 定位
    - 智能助手名称 ： Markdown 表格生成助手
    - 主要功能 ：根据用户输入的内容生成 Markdown 表格

    ## 要求
    - 确保生成的 Markdown 表格可以正确渲染

    ## 输出
    - 只能返回一个 Markdown 表格
    - 不要包含任何解释或其他内容
    - 不理解用户内容或用户内容无法转为表格时，输出 "fail"
  `,
}

const PRESET_META: { key: 'mermaid' | 'echarts' | 'table'; label: string; d: string }[] = [
  {
    key: 'mermaid',
    label: '生成 Mermaid 流程图表',
    d: 'M14 9v2h-3V9H8.5V7H11V1H4v6h2.5v2H4v6h2.5v2H4v6h7v-6H8.5v-2H11v-2h3v2h7V9z',
  },
  {
    key: 'echarts',
    label: '生成 ECharts 统计图表',
    d: 'M4 9h4v11H4zm12 4h4v7h-4zm-6-9h4v16h-4z',
  },
  {
    key: 'table',
    label: '生成表格',
    d: 'M3 3v18h18V3zm8 16H5v-6h6zm0-8H5V5h6zm8 8h-6v-6h6zm0-8h-6V5h6z',
  },
]

/** 用数据层的 md 解析取块级节点（只用于判断类型，不插入） */
function toNodesSafe(md: string): unknown[] {
  try {
    const ndb = noteState() as unknown as { toNodes?: (md: string) => unknown } | undefined
    const out = ndb?.toNodes?.(md)
    return Array.isArray(out) ? out : []
  } catch (e) {
    return []
  }
}

export function AiPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [models, setModels] = useState<{ value: string; label: string }[]>([])
  const [model, setModel] = useState('')
  /** 宿主是否具备 AI 能力（两个宿主都有 ai，ZTools 另有流式 aiChat） */
  const [hostAi, setHostAi] = useState(false)
  const [prompt, setPrompt] = useState('')
  const [busy, setBusy] = useState(false)
  const [presetBusy, setPresetBusy] = useState<'mermaid' | 'echarts' | 'table' | null>(null)
  const [err, setErr] = useState('')
  const editorApi = useNotes((s) => s.editorApi)
  const setMessage = useNotes((s) => s.setMessage)

  useEffect(() => {
    if (!open) return
    setErr('')
    void (async () => {
      const z = zt()
      const canAi = typeof z?.ai === 'function' || typeof z?.aiChat === 'function'
      setHostAi(canAi)
      let arr: { value: string; label: string }[] = []
      try {
        arr = normalizeModels(await Promise.resolve(z?.allAiModels?.()).catch(() => []))
      } catch (e) {
        arr = []
      }
      if (!arr.length && canAi) {
        // uTools / ZTools 的 ai 都允许不传 model（uTools 默认 deepseek-v3），
        // 列出空的时候给一个默认项，别让三个按钮全灰掉。
        arr = [{ value: '', label: '默认模型' }]
      }
      setModels(arr)
      if (!canAi) {
        setErr('当前宿主没有可用的 AI 能力。uTools 需要先在开发者中心为插件开通 AI，ZTools 需要在设置里配置模型。')
        return
      }
      let saved = ''
      try { saved = window.localStorage.getItem('cmark-ai-model') || '' } catch (e) { saved = '' }
      const pick = arr.find((m) => m.value === saved) || arr[0]
      setModel(pick ? pick.value : '')
    })()
  }, [open])


  /** 预设按钮：用固定 system 提示词生成，成功后直接插入正文（与 V1.0.0 一致） */
  const runPreset = useCallback(
    async (kind: 'mermaid' | 'echarts' | 'table') => {
      if (!prompt.trim()) {
        setErr('请输入内容')
        return
      }
      const api = zt() as unknown as {
        ai?: (o: { model?: string; messages: { role: string; content: string }[] }) => Promise<{ content?: string }>
        aiChat?: (
          o: { model?: string; messages: { role: string; content: string }[]; temperature?: number },
          cb?: (p: unknown) => void
        ) => Promise<unknown>
      }
      if (typeof api?.ai !== 'function' && typeof api?.aiChat !== 'function') {
        setErr('当前宿主没有提供 AI 接口。uTools 需要在开发者中心为插件开通 AI 能力，ZTools 需要在设置里配置模型。')
        return
      }
      try { window.localStorage.setItem('cmark-ai-model', model) } catch (e) {}
      setBusy(true)
      setErr('')
      setPresetBusy(kind)
      try {
        let text = ''
        if (api.ai) {
          const r = await api.ai({
            // model 为空时不传：uTools 会走默认模型（deepseek-v3）
            ...(model ? { model } : {}),
            messages: [
              { role: 'system', content: PRESETS[kind] },
              { role: 'user', content: prompt },
            ],
          })
          text = String(r?.content || '')
        } else {
          const r = (await api.aiChat!({
            ...(model ? { model } : {}),
            messages: [
              { role: 'system', content: PRESETS[kind] },
              { role: 'user', content: prompt },
            ],
            temperature: 0.2,
          })) as { content?: string }
          text = String(r?.content || '')
        }
        text = text.trim()
        if (!text) {
          setErr('模型没有返回内容')
          return
        }

        if (kind === 'table') {
          const nodes = toNodesSafe(text)
          const onlyTable = nodes.length === 1 && (nodes[0] as { type?: string }).type === 'table'
          if (!onlyTable) {
            setErr('未能正确生成表格')
            return
          }
          editorApi?.insertMarkdown(text)
        } else {
          // 去掉首尾代码围栏，只留图表代码
          const body = text.replace(/^```(?:echarts|mermaid|json)/i, '').replace(/```$/, '').trim()
          editorApi?.insertMarkdown('```' + kind + '\n' + body + '\n```')
        }
        onClose()
        setMessage('已插入正文', 1600)
      } catch (e) {
        setErr('生成失败：' + ((e as Error)?.message || ''))
      } finally {
        setBusy(false)
        setPresetBusy(null)
      }
    },
    [prompt, model, editorApi, onClose, setMessage]
  )


  if (!open) return null

  return (
    <div className="ai-mask" onClick={onClose}>
      <div className="ai-panel" onClick={(e) => e.stopPropagation()}>
        <div className="ai-head">
          <span className="ai-spark" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="17" height="17" fill="currentColor">
              <path d="M12 2.2l2.36 5.44L20 10l-5.64 2.36L12 17.8l-2.36-5.44L4 10l5.64-2.36L12 2.2z" />
              <path d="M18.6 15.2l1.1 2.5 2.6 1.1-2.6 1.1-1.1 2.5-1.1-2.5-2.6-1.1 2.6-1.1 1.1-2.5z" opacity=".55" />
            </svg>
          </span>
          <span className="ai-title">AI 生成</span>
          <button className="ai-close" type="button" title="关闭 (Esc)" onClick={onClose}>
            <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
              <path d="M4 4l8 8M12 4l-8 8" />
            </svg>
          </button>
        </div>

        <div className="ai-modelrow">
          <span className="ai-mlabel">模型</span>
          <select
            className="ai-model"
            value={model}
            onChange={(e) => setModel(e.target.value)}
            title="选择模型"
          >
            {models.length === 0 ? <option value="">（没有可用模型）</option> : null}
            {models.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </select>
          {typeof zt()?.redirectAiModelsSetting === 'function' ? (
            <button
              type="button"
              className="ai-link"
              onClick={() => zt()?.redirectAiModelsSetting?.()}
              title="在 ZTools 设置里管理模型"
            >
              模型设置
            </button>
          ) : null}
        </div>

        <div className="ai-body">
          <textarea
            className="ai-input"
            value={prompt}
            placeholder="描述你要生成的内容，例如：把本周各渠道的成交量整理成柱状图"
            autoFocus
            onChange={(e) => setPrompt(e.target.value)}
          />
        </div>

        {busy ? <div className="ai-out">正在生成，请稍候…</div> : null}
        {err ? <div className="ai-err">{err}</div> : null}

        <div className="ai-dialog-btns">
          {PRESET_META.map((m) => (
            <button
              key={m.key}
              type="button"
              className="ai-preset-btn"
              disabled={busy || (!model && !hostAi)}
              title={m.label}
              onClick={() => void runPreset(m.key)}
            >
              <span className="ai-preset-ico" aria-hidden="true">
                <svg viewBox="0 0 24 24" width="17" height="17" fill="currentColor">
                  <path d={m.d} />
                </svg>
              </span>
              <span className="ai-preset-txt">{presetBusy === m.key ? '生成中…' : m.label}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
