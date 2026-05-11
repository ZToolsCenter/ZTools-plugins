/**
 * 滚动同步Composable
 * 实现表格/网格视图中的源表和目标表同步滚动功能
 */

import { ref, onUnmounted, type Ref } from 'vue'

/**
 * 滚动同步Composable
 * @param viewMode - 视图模式引用（split/unified）
 */
export function useScrollSync(viewMode: Ref<string>) {
    /** 源表格元素引用 */
    const sourceTableRef = ref<HTMLElement | null>(null)
    /** 目标表格元素引用 */
    const targetTableRef = ref<HTMLElement | null>(null)
    /** 差异条元素引用 */
    const diffBarRef = ref<HTMLElement | null>(null)

    /** 是否正在执行程序化滚动（避免循环触发） */
    let isProgrammaticScroll = false
    /** 滚动超时定时器 */
    let scrollTimeout: ReturnType<typeof setTimeout> | null = null
    /** 当前滚动目标元素 */
    let activeScrollTarget: HTMLElement | null = null
    /** 同步滚动超时定时器 */
    let syncScrollTimeout: ReturnType<typeof setTimeout> | null = null

    /**
     * 滚动到指定单元格
     * @param row - 行索引
     * @param col - 列索引
     * @param getElement - 获取元素的函数
     */
    const scrollToCell = (row: number, col: number, getElement: (r: number, c: number) => HTMLElement | null) => {
        const el = getElement(row, col)
        if (!el) return

        isProgrammaticScroll = true
        if (scrollTimeout) clearTimeout(scrollTimeout)
        scrollTimeout = setTimeout(() => {
            isProgrammaticScroll = false
        }, 1000)

        requestAnimationFrame(() => {
            el.scrollIntoView({ behavior: 'smooth', block: 'center' })
        })
    }

    /**
     * 同步滚动处理函数
     * 在 split 模式下同步源表、目标表和差异条的滚动位置
     * @param e - 滚动事件对象
     */
    const syncScroll = (e: Event) => {
        if (isProgrammaticScroll || viewMode.value !== 'split') return
        const source = sourceTableRef.value
        const target = targetTableRef.value
        const diffBar = diffBarRef.value
        if (!source || !target || !diffBar) return

        const scrollTarget = e.target as HTMLElement

        if (activeScrollTarget && activeScrollTarget !== scrollTarget) return
        activeScrollTarget = scrollTarget

        if (syncScrollTimeout) clearTimeout(syncScrollTimeout)
        syncScrollTimeout = setTimeout(() => {
            activeScrollTarget = null
        }, 50)

        if (scrollTarget === source) {
            if (target.scrollTop !== source.scrollTop) target.scrollTop = source.scrollTop
            if (diffBar.scrollTop !== source.scrollTop) diffBar.scrollTop = source.scrollTop
            if (target.scrollLeft !== source.scrollLeft) target.scrollLeft = source.scrollLeft
        } else if (scrollTarget === target) {
            if (source.scrollTop !== target.scrollTop) source.scrollTop = target.scrollTop
            if (diffBar.scrollTop !== target.scrollTop) diffBar.scrollTop = target.scrollTop
            if (source.scrollLeft !== target.scrollLeft) source.scrollLeft = target.scrollLeft
        } else if (scrollTarget === diffBar) {
            if (source.scrollTop !== diffBar.scrollTop) source.scrollTop = diffBar.scrollTop
            if (target.scrollTop !== diffBar.scrollTop) target.scrollTop = diffBar.scrollTop
        }
    }

    onUnmounted(() => {
        if (scrollTimeout) clearTimeout(scrollTimeout)
        if (syncScrollTimeout) clearTimeout(syncScrollTimeout)
    })

    return {
        sourceTableRef,
        targetTableRef,
        diffBarRef,
        scrollToCell,
        syncScroll,
    }
}