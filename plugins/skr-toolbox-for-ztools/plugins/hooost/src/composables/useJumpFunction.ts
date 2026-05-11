import { useHistoryState } from '@/composables/useHistoryState'
import { nextTick, onMounted, watch } from 'vue'
import { onBeforeRouteUpdate, useRoute } from 'vue-router'

/**
 * 处理路由跳转功能的 hooks
 * @param handler 处理函数
 */
export function useJumpFunction<T = any>(handler: (data: Partial<T>) => void): void {
  const route = useRoute()
  // 处理对应 ztools code 进来的功能
  const handleJumpZtoolsCode = (): void => {
    const state = useHistoryState<T>()
    handler(state)
  }
  onMounted(() => {
    handleJumpZtoolsCode()
  })

  watch(
    () => route.fullPath,
    async (fullPath, oldFullPath) => {
      if (fullPath === oldFullPath) {
        return
      }
      await nextTick()
      handleJumpZtoolsCode()
    }
  )
  onBeforeRouteUpdate(() => {
    handleJumpZtoolsCode()
  })
}
