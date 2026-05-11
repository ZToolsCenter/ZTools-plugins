/**
 * 自动格式化Composable
 * 提供代码自动格式化功能，支持防抖处理
 */

import { watch, type Ref } from 'vue'
import { formatCode } from '@/utils/formatter'
import { useAutoFormatSettings } from '@/composables/useAutoFormat'

const DELAYED_FORMAT_MS = 3000

/**
 * 自动格式化Composable
 * 根据设置自动格式化输入的代码
 */
export function useAutoFormat() {
    const { autoFormat } = useAutoFormatSettings()

    /** 源文本格式化定时器 */
    let sourceTimer: ReturnType<typeof setTimeout> | null = null
    /** 目标文本格式化定时器 */
    let targetTimer: ReturnType<typeof setTimeout> | null = null

    /**
     * 执行自动格式化
     * @param text - 文本引用
     * @param lang - 语言类型
     */
    const performAutoFormat = (text: Ref<string>, lang: string) => {
        if (autoFormat.value === 'off') return

        const formatted = formatCode(text.value, lang)
        if (formatted !== text.value) {
            text.value = formatted
        }
    }

    watch(
        autoFormat,
        (mode) => {
            if (mode === 'off') {
                clearTimeout(sourceTimer ?? undefined)
                clearTimeout(targetTimer ?? undefined)
            }
        }
    )

    return {
        autoFormat,
        scheduleAutoFormat: (text: Ref<string>, lang: string, side: 'source' | 'target') => {
            if (autoFormat.value === 'off') return

            const timer = side === 'source' ? sourceTimer : targetTimer
            if (timer) clearTimeout(timer)

            const delay = autoFormat.value === 'immediate' ? 10 : DELAYED_FORMAT_MS
            const newTimer = setTimeout(() => performAutoFormat(text, lang), delay)
            if (side === 'source') sourceTimer = newTimer
            else targetTimer = newTimer
        },
        immediateFormat: (text: Ref<string>, lang: string) => {
            if (autoFormat.value === 'off') return
            setTimeout(() => performAutoFormat(text, lang), 10)
        }
    }
}