/**
 * 文本管理Composable
 * 提供基本的文本管理功能
 */

import { ref } from 'vue'

/**
 * 文本管理Composable
 */
export function useTextDiff() {
    /** 源文本内容 */
    const sourceText = ref('')
    /** 目标文本内容 */
    const targetText = ref('')

    /**
     * 交换源文本和目标文本
     */
    const swapTexts = () => {
        const temp = sourceText.value
        sourceText.value = targetText.value
        targetText.value = temp
    }

    return {
        sourceText,
        targetText,
        swapTexts,
    }
}
