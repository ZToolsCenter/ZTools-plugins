/**
 * 主题管理Composable
 * 提供主题模式切换、暗黑模式检测等功能
 */

import { ref, onMounted, onUnmounted } from 'vue'

/**
 * 全局窗口类型扩展
 */
declare global {
    interface Window {
        ztools?: {
            isDarkColors?: () => boolean
            dbStorage?: {
                setItem?: (key: string, value: any) => void
                getItem?: (key: string) => any
            }
        }
    }
}

const STORAGE_KEY = "theme-mode"

/**
 * 主题模式类型
 */
export type ThemeMode = 'system' | 'light' | 'dark'

// 核心：单例存储变量（放在函数外部，全局唯一）
let themeInstance: {
    themeMode: ReturnType<typeof ref<ThemeMode>>
    isDark: ReturnType<typeof ref<boolean>>
    setThemeMode: (mode: ThemeMode) => void
    cycleTheme: () => void
    _init: () => void
    _destroy: () => void
} | null = null

/**
 * 内部创建主题实例的核心函数（抽离逻辑，避免重复创建）
 */
const createThemeInstance = () => {
    /** 当前主题模式 */
    const themeMode = ref<ThemeMode>('system')
    /** 是否为暗黑模式 */
    const isDark = ref(true)
    /** 媒体查询列表，用于监听系统主题变化 */
    let mediaQuery: MediaQueryList | null = null
    /** 标记是否已初始化事件监听，防止重复绑定 */
    let isInitialized = false

    /**
     * 获取系统主题
     * @returns 是否为暗黑模式
     */
    const getSystemTheme = (): boolean => {
        if (window.ztools?.isDarkColors) {
            return window.ztools.isDarkColors()
        }
        return window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? true
    }

    /**
     * 更新主题应用状态
     */
    const updateTheme = () => {
        let dark: boolean
        if (themeMode.value === 'system') {
            dark = getSystemTheme()
        } else {
            dark = themeMode.value === 'dark'
        }
        isDark.value = dark

        // 禁用过渡动画，避免切换时闪烁
        document.documentElement.classList.add('no-theme-transition')

        requestAnimationFrame(() => {
            document.documentElement.classList.toggle('dark', dark)

            // 恢复过渡动画，确保下次切换能平滑过渡
            requestAnimationFrame(() => {
                document.documentElement.classList.remove('no-theme-transition')
            })
        })
    }

    /**
     * 设置主题模式
     * @param mode - 主题模式
     */
    const setThemeMode = (mode: ThemeMode) => {
        themeMode.value = mode
        if (window.ztools?.dbStorage?.setItem) {
            window.ztools.dbStorage.setItem(STORAGE_KEY, mode)
        } else {
            localStorage.setItem(STORAGE_KEY, mode)
        }
        updateTheme()
    }

    /**
     * 循环切换主题模式
     * 顺序：system -> light -> dark -> system
     */
    const cycleTheme = () => {
        const modes: ThemeMode[] = ['system', 'light', 'dark']
        const currentIndex = modes.indexOf(themeMode.value)
        const nextIndex = (currentIndex + 1) % modes.length
        setThemeMode(modes[nextIndex])
    }

    /**
     * 初始化主题
     * 从存储中读取保存的主题设置并应用
     */
    const initTheme = () => {
        const saved = window.ztools?.dbStorage?.getItem(STORAGE_KEY) as ThemeMode | null ?? localStorage.getItem(STORAGE_KEY) as ThemeMode | null
        if (saved && ['system', 'light', 'dark'].includes(saved)) {
            themeMode.value = saved
        }
        updateTheme()
    }

    /**
     * 处理系统主题变化事件
     * 仅当主题模式为 system 时更新主题
     */
    const handleSystemThemeChange = () => {
        if (themeMode.value === 'system') {
            updateTheme()
        }
    }

    /**
     * 初始化主题和事件监听（对外暴露的初始化方法）
     */
    const _init = () => {
        if (isInitialized) return // 已初始化则跳过，防止重复绑定
        initTheme()
        mediaQuery = window.matchMedia?.('(prefers-color-scheme: dark)')
        mediaQuery?.addEventListener('change', handleSystemThemeChange)
        isInitialized = true
    }

    /**
     * 销毁事件监听（对外暴露的销毁方法）
     */
    const _destroy = () => {
        if (!isInitialized) return
        mediaQuery?.removeEventListener('change', handleSystemThemeChange)
        isInitialized = false
    }

    return {
        themeMode,
        isDark,
        setThemeMode,
        cycleTheme,
        _init,
        _destroy
    }
}

/**
 * 主题管理Composable（单例模式）
 * 管理应用的主题切换和系统主题检测
 */
export function useTheme() {
    // 核心：如果没有实例则创建，有则直接返回已有实例
    if (!themeInstance) {
        themeInstance = createThemeInstance()
    }

    // 自动初始化（兼容原有 onMounted 逻辑）
    onMounted(() => {
        themeInstance?._init()
    })

    // 自动销毁（全局主题建议注释，避免其他组件失效，可手动调用）
    onUnmounted(() => {
        // themeInstance?._destroy() 
    })

    return {
        themeMode: themeInstance.themeMode,
        isDark: themeInstance.isDark,
        setThemeMode: themeInstance.setThemeMode,
        cycleTheme: themeInstance.cycleTheme
    }
}