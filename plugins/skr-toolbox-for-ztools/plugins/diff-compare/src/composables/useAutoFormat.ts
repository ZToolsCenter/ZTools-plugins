/**
 * 自动格式化设置管理Composable
 * 提供自动格式化功能的开关和持久化存储
 */

import { ref } from 'vue'

const STORAGE_KEY = 'auto-format'

export type AutoFormatMode = 'off' | 'delayed' | 'immediate'

/**
 * 自动格式化设置管理Composable
 */
export function useAutoFormatSettings() {
    /** 自动格式化模式：off-关闭, delayed-延迟3秒, immediate-立即 */
    const autoFormat = ref<AutoFormatMode>('off')

    /**
     * 加载设置
     */
    const loadSettings = () => {
        try {
            let stored = null
            if (window.ztools?.dbStorage?.getItem) {
                stored = window.ztools.dbStorage.getItem(STORAGE_KEY)
            } else {
                stored = localStorage.getItem(STORAGE_KEY)
            }
            if (stored !== null) {
                if (stored === 'delayed' || stored === 'immediate') {
                    autoFormat.value = stored
                } else {
                    autoFormat.value = 'off'
                }
            }
        } catch (e) {
            console.warn('加载自动格式化设置失败:', e)
        }
    }

    /**
     * 保存设置
     */
    const saveSettings = () => {
        try {
            if (window.ztools?.dbStorage?.setItem) {
                window.ztools.dbStorage.setItem(STORAGE_KEY, autoFormat.value)
            } else {
                localStorage.setItem(STORAGE_KEY, autoFormat.value)
            }
        } catch (e) {
            console.warn('保存自动格式化设置失败:', e)
        }
    }

    /**
     * 设置自动格式化模式
     * @param value - 格式化模式
     */
    const setAutoFormat = (value: AutoFormatMode) => {
        autoFormat.value = value
        saveSettings()
    }

    /**
     * 切换自动格式化（循环切换）
     */
    const toggleAutoFormat = () => {
        const modes: AutoFormatMode[] = ['off', 'delayed', 'immediate']
        const currentIdx = modes.indexOf(autoFormat.value)
        const nextIdx = (currentIdx + 1) % modes.length
        setAutoFormat(modes[nextIdx])
    }

    /**
     * 是否启用自动格式化
     */
    const isAutoFormatEnabled = (mode: AutoFormatMode) => mode !== 'off'

    // 初始化加载设置
    loadSettings()

    return {
        autoFormat,
        setAutoFormat,
        toggleAutoFormat,
        isAutoFormatEnabled
    }
}