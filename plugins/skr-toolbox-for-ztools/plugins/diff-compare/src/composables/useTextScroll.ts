/**
 * 文本滚动同步Composable
 * 实现左侧和右侧文本区域的同步滚动功能
 */

import { shallowRef } from 'vue'

/**
 * 文本滚动同步Composable
 * 管理双栏文本编辑器的滚动同步
 */
export function useTextScroll() {
    /** 左侧背景元素引用 */
    const leftBack = shallowRef<HTMLElement | null>(null)
    /** 右侧背景元素引用 */
    const rightBack = shallowRef<HTMLElement | null>(null)
    /** 左侧行号元素引用 */
    const leftLineNumbers = shallowRef<HTMLElement | null>(null)
    /** 右侧行号元素引用 */
    const rightLineNumbers = shallowRef<HTMLElement | null>(null)

    /**
     * 左侧文本区域滚动事件处理
     * 同步左侧背景和行号的滚动位置
     * @param e - 滚动事件对象
     */
    const onLeftScroll = (e: Event) => {
        const target = e.target as HTMLTextAreaElement
        if (leftBack.value) {
            leftBack.value.scrollTop = target.scrollTop
            leftBack.value.scrollLeft = target.scrollLeft
        }
        if (leftLineNumbers.value) {
            leftLineNumbers.value.scrollTop = target.scrollTop
        }
    }

    /**
     * 右侧文本区域滚动事件处理
     * 同步右侧背景和行号的滚动位置
     * @param e - 滚动事件对象
     */
    const onRightScroll = (e: Event) => {
        const target = e.target as HTMLTextAreaElement
        if (rightBack.value) {
            rightBack.value.scrollTop = target.scrollTop
            rightBack.value.scrollLeft = target.scrollLeft
        }
        if (rightLineNumbers.value) {
            rightLineNumbers.value.scrollTop = target.scrollTop
        }
    }

    return {
        leftBack,
        rightBack,
        leftLineNumbers,
        rightLineNumbers,
        onLeftScroll,
        onRightScroll
    }
}