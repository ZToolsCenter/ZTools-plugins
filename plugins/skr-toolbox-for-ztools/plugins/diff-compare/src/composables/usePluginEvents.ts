/**
 * 插件事件处理Composable
 * 处理插件进入和退出事件，管理当前对比模式
 */

import { shallowRef, onMounted, onUnmounted } from 'vue'

/**
 * 支持的差异对比模式
 */
export type DiffMode = 'text' | 'image' | 'excel' | 'word' | 'pdf'

/**
 * 插件代码到对比模式的映射表
 */
const MODE_MAP: Record<string, DiffMode> = {
    'diff-text': 'text',
    'diff-image': 'image',
    'diff-excel': 'excel',
    'diff-word': 'word',
    'diff-pdf': 'pdf',
}

/**
 * 插件事件处理函数
 * 管理插件的进入和退出事件，更新当前对比模式
 */
export function usePluginEvents() {
    /** 当前对比模式 */
    const currentMode = shallowRef<DiffMode>('text')

    /**
     * 处理插件进入事件
     * @param action - 包含插件代码的动作对象
     */
    const handlePluginEnter = (action: { code: string }) => {
        currentMode.value = MODE_MAP[action.code] || 'text'
    }

    /**
     * 组件挂载时注册插件事件监听
     */
    onMounted(() => {
        if (window.ztools) {
            window.ztools.onPluginEnter(handlePluginEnter)
            window.ztools.onPluginOut(() => {})
        }
    })

    /**
     * 组件卸载时清理事件监听
     */
    onUnmounted(() => {})

    return {
        currentMode
    }
}