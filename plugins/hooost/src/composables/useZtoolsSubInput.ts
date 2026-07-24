import { computed, onMounted, onUnmounted, ref } from 'vue'
import type { ComputedRef } from 'vue'
import { createEventHook, useEventListener } from '@vueuse/core'
import type { EventHookOn } from '@vueuse/core'

export interface UseSubInputResult {
  /**
   * 当前子输入框的值，只读
   */
  value: ComputedRef<string>

  /**
   * 设置子输入框的值
   * @param value 子输入框的值
   */
  setSubInput(value: string): void

  /**
   * 注册子输入框
   */
  register(autoFocus?: boolean): void

  /**
   * 当数据变更
   */
  onChanged: EventHookOn<string>

  /**
   * 当搜索时，按下Enter触发
   */
  onSearch: EventHookOn<string>

  /**
   * 当数据清空时，按下Enter触发
   */
  onClear: EventHookOn<void>
}

/**
 * 子输入框 hook
 * @param initialValue 子输入框初始值
 * @param placeholder 占位符
 * @param isFocus 是否聚焦，默认true
 * @param bindFindShortcut 是否绑定搜索快捷键，默认true
 * 绑定后可通过 macOS 的 Command + F 或 Windows 的 Ctrl + F
 * 重新聚焦并选中当前子输入框内容
 */
export function useZtoolsSubInput(
  initialValue: string = '',
  placeholder?: string,
  isFocus?: boolean,
  bindFindShortcut: boolean = true
): UseSubInputResult {
  const ztoolsWithSubInput = ztools as typeof ztools & {
    subInputFocus?: () => boolean
    subInputSelect?: () => boolean
  }

  // 是否在注册中
  let registering = false

  // 子输入框的值
  const subInput = ref(initialValue)
  // 子输入的包装值
  const subInputWrap = computed(() => subInput.value)

  // 当数据变化的hook
  const onChangedHook = createEventHook<string>()
  // 当搜索时的hook
  const onSearchHook = createEventHook<string>()
  // 当搜索时的hook
  const onClearHook = createEventHook<void>()

  // 键盘按下的事件监听
  function handleKeyDown(e: KeyboardEvent): void {
    const isFindShortcut =
      e.key.toLowerCase() === 'f' && (e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey

    if (bindFindShortcut && isFindShortcut) {
      e.preventDefault()
      e.stopPropagation()
      focusSubInput(true)
      return
    }

    if (e.key === 'Enter' && subInput.value) {
      void onSearchHook.trigger(subInput.value)
      e.preventDefault()
      e.stopPropagation()
    }
  }

  // 重新注册并聚焦子输入框，必要时选中现有内容
  function focusSubInput(select = false): void {
    register(true)

    let retryCount = 0
    const timer = window.setInterval(() => {
      const handled = select
        ? ztoolsWithSubInput.subInputSelect?.()
        : ztoolsWithSubInput.subInputFocus?.()

      retryCount++
      if (handled || retryCount >= 10) {
        window.clearInterval(timer)
      }
    }, 50)
  }

  function register(autoFocus = isFocus): void {
    if (registering) {
      return
    }
    registering = true
    // 先移除之前的
    ztools.removeSubInput()
    // 注册新的
    const interval = setInterval(() => {
      const res = ztools.setSubInput(
        ({ text }) => {
          if (subInput.value !== text) {
            subInput.value = text
            onChangedHook.trigger(text)
            if (!text) {
              onClearHook.trigger()
            }
          }
        },
        placeholder,
        autoFocus
      )
      // 如果注册成功
      if (res) {
        // 设置初始值
        if (subInput.value) {
          ztools.setSubInputValue(subInput.value)
          onChangedHook.trigger(subInput.value)
        } else if (initialValue) {
          ztools.setSubInputValue(initialValue)
        }
        // 清除定时器
        clearInterval(interval)
        registering = false
      }
    }, 100)
  }

  onMounted(() => {
    // 注册子输入框
    register()
    window.addEventListener('keydown', handleKeyDown)
  })

  onUnmounted(() => {
    ztools.removeSubInput()
    window.removeEventListener('keydown', handleKeyDown)
  })

  function setSubInput(val: string): void {
    subInput.value = val
    ztools.setSubInputValue(subInput.value)
  }

  useEventListener(window, 'all', () => {
    register()
    window.addEventListener('keydown', handleKeyDown)
  })

  return {
    value: subInputWrap,
    setSubInput,
    register,
    onChanged: onChangedHook.on,
    onSearch: onSearchHook.on,
    onClear: onClearHook.on,
  }
}
