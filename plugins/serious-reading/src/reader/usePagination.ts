import { useEffect, useRef, useState } from 'react'

/** 简单的高度测量分页：渲染内容到隐藏容器，按节点 height 累加断页。 */
export function usePaginate(html: string, fontSize: number, lineHeight: number) {
  const [pages, setPages] = useState<string[]>([''])
  const measureRef = useRef<HTMLDivElement>(null)

  useLayoutPaginate(() => {
    const measure = measureRef.current
    if (!measure) return
    const pageH = window.innerHeight - 48
    const pageW = window.innerWidth - 64
    measure.style.width = pageW + 'px'
    measure.style.fontSize = fontSize + 'px'
    measure.style.lineHeight = String(lineHeight)
    measure.innerHTML = html
    // 文本节点包 span 以便测量
    const nodes: { height: number; html: string }[] = []
    measure.childNodes.forEach((node) => {
      if (node.nodeType === 3 && node.textContent?.trim()) {
        const span = document.createElement('span')
        span.textContent = node.textContent
        measure.replaceChild(span, node)
        nodes.push({ height: span.offsetHeight, html: span.outerHTML })
      } else if (node.nodeType === 1) {
        const el = node as HTMLElement
        nodes.push({ height: el.offsetHeight, html: el.outerHTML })
      }
    })
    const result: string[] = []
    let cur = ''
    let used = 0
    for (const n of nodes) {
      if (used + n.height > pageH && used > 0) {
        result.push(cur)
        cur = ''
        used = 0
      }
      cur += n.html
      used += n.height
    }
    if (cur) result.push(cur)
    measure.innerHTML = ''
    setPages(result.length ? result : [''])
  }, [html, fontSize, lineHeight, window.innerHeight, window.innerWidth])

  return { pages, measureRef }
}

import { useLayoutEffect } from 'react'
function useLayoutPaginate(fn: () => void, deps: any[]) {
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useLayoutEffect(fn, deps)
  // debounce re-paginate on resize handled by signal in deps (window size)
}