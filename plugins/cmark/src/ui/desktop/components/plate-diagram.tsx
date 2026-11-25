/**
 * 代码块内的图表预览：```mermaid 画流程图 / 时序图，```echarts 用 option JSON 画统计图
 *
 * 图表不占用独立节点类型 —— Markdown 里图表本来就是代码块，
 * 保持这个形态，Obsidian / GitHub 打开也是对的。
 * 这里只在代码块下方追加一块渲染结果，源码仍然可编辑。
 */
import { useEffect, useRef, useState } from 'react'

export function Diagram({ kind, code }: { kind: 'mermaid' | 'echarts'; code: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const [err, setErr] = useState('')
  // 切主题后要重画：mermaid/echarts 的配色是渲染时写进 SVG/canvas 的，
  // 只改 CSS 变量它们不会跟着变
  const [themeTick, setThemeTick] = useState(0)

  useEffect(() => {
    const onTheme = () => setThemeTick((t) => t + 1)
    window.addEventListener('cmark-theme', onTheme)
    return () => window.removeEventListener('cmark-theme', onTheme)
  }, [])

  useEffect(() => {
    let alive = true
    let chart: { dispose: () => void } | null = null
    let roRef: ResizeObserver | null = null

    void (async () => {
      if (!ref.current) return
      try {
        if (kind === 'mermaid') {
          const mermaid = (await import('mermaid')).default
          // 深色下用 base + 显式 themeVariables：内置 dark 主题的节点描边是暗渐变，
          // 连线也太淡，实际看不清。这里把线、节点、文字全部指定成高对比色。
          const isDark = document.documentElement.getAttribute('data-theme') === 'dark'
          mermaid.initialize({
            startOnLoad: false,
            securityLevel: 'loose',
            theme: isDark ? 'base' : 'default',
            themeVariables: isDark
              ? {
                  darkMode: true,
                  background: '#21262d',
                  primaryColor: '#1f2a37',
                  primaryTextColor: '#e6edf3',
                  primaryBorderColor: '#58a6ff',
                  secondaryColor: '#21262d',
                  tertiaryColor: '#161b22',
                  mainBkg: '#1f2a37',
                  nodeBorder: '#58a6ff',
                  nodeTextColor: '#e6edf3',
                  lineColor: '#c9d1d9',
                  textColor: '#e6edf3',
                  titleColor: '#e6edf3',
                  edgeLabelBackground: '#161b22',
                  clusterBkg: '#161b22',
                  clusterBorder: '#30363d',
                  fontSize: '14px',
                }
              : {},
          })
          const id = 'mmd-' + Math.random().toString(36).slice(2, 9)
          const { svg } = await mermaid.render(id, code)
          if (alive && ref.current) ref.current.innerHTML = svg
        } else {
          const echarts = await import('echarts')
          // 注意：这里不能 await requestAnimationFrame 再 init。
          // 等一帧的写法在开发期 StrictMode 双挂载 + 组件重建时会拿到失效的 ref，
          // 代码直接静默 return，图表就是一片空白。ref 在同步阶段一定有效，先 init。
          if (!alive || !ref.current) return
          const el = ref.current as HTMLDivElement
          const existing = echarts.getInstanceByDom(el)
          if (existing) existing.dispose()
          // 必须用 svg renderer：canvas 的位图内容不能被 cloneNode 复制，
          // 导出（走编辑区 DOM 快照）拿到的会是一块空白画布；SVG 是真实 DOM，能连样式带走。
          const dark = document.documentElement.getAttribute('data-theme') === 'dark'
          // 用注册主题而不是 setOption 里的 baseStyle：
          // categoryAxis/valueAxis 是主题的键名，直接放进 setOption 会被忽略，
          // 结果分割线还是 echarts 默认的浅灰 #E0E6F1，深色底上比外框轴线还显眼。
          const themeName = dark ? 'cmark-echarts-dark' : 'cmark-echarts-light'
          const axisLine = dark ? '#7d8894' : '#b8c2cc'
          const splitLine = dark ? 'rgba(255,255,255,0.20)' : '#dbe1e8'
          const axisLabel = dark ? '#b1bac4' : '#4a5560'
          const textColor = dark ? '#e6edf3' : '#1f2328'
          echarts.registerTheme(themeName, {
            backgroundColor: 'transparent',
            textStyle: { color: textColor },
            title: { textStyle: { color: textColor, fontWeight: 600 } },
            legend: { textStyle: { color: axisLabel } },
            tooltip: {
              backgroundColor: dark ? '#1c2128' : '#ffffff',
              borderColor: dark ? '#30363d' : '#d0d7de',
              textStyle: { color: textColor },
            },
            categoryAxis: {
              axisLine: { show: true, lineStyle: { color: axisLine } },
              axisTick: { lineStyle: { color: axisLine } },
              axisLabel: { color: axisLabel },
              splitLine: { show: true, lineStyle: { color: splitLine, type: 'dashed' } },
            },
            valueAxis: {
              axisLine: { show: true, lineStyle: { color: axisLine } },
              axisTick: { lineStyle: { color: axisLine } },
              axisLabel: { color: axisLabel },
              splitLine: { show: true, lineStyle: { color: splitLine, type: 'dashed' } },
            },
            logarithmicAxis: {
              axisLine: { lineStyle: { color: axisLine } },
              axisLabel: { color: axisLabel },
              splitLine: { lineStyle: { color: splitLine, type: 'dashed' } },
            },
          })
          const inst = echarts.init(el, themeName, { renderer: 'svg' })
          // option 顶层的 height/width 不是 echarts 的合法配置项，
          // 但会被当成画布尺寸用，和容器实际尺寸打架：实测容器 320 却按 400 排版，
          // SVG 高度又写 320，X 轴分类标签和柱子底部全被裁到可视区外。
          const opt = JSON.parse(code) as Record<string, unknown>
          delete opt.height
          delete opt.width

          inst.setOption(opt)
          chart = inst
          // 尺寸在第一帧可能还没定型，下一拍按真实容器尺寸纠正一次。
          // 空参 resize() 读的是 echarts 自己缓存的尺寸，纠正不了，必须显式传。
          const fix = () => {
            if (!alive) return
            try {
              const w = el.clientWidth
              const h = el.clientHeight
              if (!w || !h) return
              const g = inst as unknown as { getWidth: () => number; getHeight: () => number }
              if (g.getWidth() !== w || g.getHeight() !== h) inst.resize({ width: w, height: h })
            } catch (e) {}
          }
          setTimeout(fix, 0)
          setTimeout(fix, 150)
          // 窗口/侧栏/字号变化都会改变容器宽度，只靠初始化后的两次纠正是撑不住的：
          // 监听容器尺寸变化，随时 resize
          const ro = new ResizeObserver(() => {
            if (!alive) return
            try {
              const w = el.clientWidth
              const h = el.clientHeight
              if (w && h) inst.resize({ width: w, height: h })
            } catch (e) {}
          })
          ro.observe(el)
          roRef = ro
        }
        if (alive) setErr('')
      } catch (e) {
        if (alive) setErr((e as Error)?.message || '渲染失败')
      }
    })()

    return () => {
      alive = false
      try {
        roRef?.disconnect()
      } catch (e) {}
      if (chart) {
        try {
          chart.dispose()
        } catch (e) {}
        chart = null
      }
    }
  }, [kind, code, themeTick])

  return (
    <>
      <div
        className="diagram-canvas"
        ref={ref}
        style={kind === 'echarts' ? { width: '100%', height: 320 } : undefined}
      />
      {err ? <div className="diagram-err">{err}</div> : null}
    </>
  )
}
