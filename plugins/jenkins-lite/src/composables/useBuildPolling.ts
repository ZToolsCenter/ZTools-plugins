import { ref, onUnmounted } from 'vue'
import type { BuildInfo } from '../types'
import { useInstances } from './useInstances'

let pollingInterval: ReturnType<typeof setInterval> | null = null
let currentPollingJob: string | null = null
const currentBuilds = ref<BuildInfo[]>([])

// 独立 watch 句柄池：key = `${jobName}#${buildNumber}`
const buildWatchers = new Map<string, ReturnType<typeof setInterval>>()

export function useBuildPolling() {
  const { currentClient } = useInstances()

  /**
   * 开始轮询指定 Job 的构建状态
   */
  const startPolling = (jobName: string, intervalMs = 10000) => {
    stopPolling()
    currentPollingJob = jobName

    // 立即获取一次
    fetchBuilds()

    // 设置轮询
    pollingInterval = setInterval(fetchBuilds, intervalMs)
  }

  /**
   * 停止轮询
   */
  const stopPolling = () => {
    if (pollingInterval) {
      clearInterval(pollingInterval)
      pollingInterval = null
    }
    currentPollingJob = null
  }

  /**
   * 获取构建列表
   */
  const fetchBuilds = async () => {
    if (!currentPollingJob || !currentClient.value) return

    const result = await currentClient.value.getBuilds(currentPollingJob)
    if (result.data) {
      currentBuilds.value = result.data
    }
  }

  /**
   * 检查是否有正在运行中的构建
   */
  const hasBuilding = () => {
    return currentBuilds.value.some(b => b.building)
  }

  /**
   * 获取最后完成的构建（状态不再是 building）
   */
  const getLastCompletedBuild = (): BuildInfo | null => {
    const completed = currentBuilds.value.filter(b => !b.building)
    return completed.length > 0 ? completed[0] : null
  }

  /**
   * 监听某个 build 是否结束（独立计时器，可并行多个，不影响 currentBuilds）
   * - 每 intervalMs 拉一次该 Job 的构建列表
   * - 找到 number === buildNumber 且 !building 时清掉定时器并 onComplete(build)
   * - 若 build 还没出现在队列里（刚 trigger），会继续轮询直至出现
   */
  const watchBuild = (
    jobName: string,
    buildNumber: number,
    onComplete: (build: BuildInfo) => void,
    intervalMs = 5000
  ) => {
    const key = `${jobName}#${buildNumber}`
    // 同一 build 已存在 watcher：先清掉旧的
    stopWatchingBuild(jobName, buildNumber)

    const tick = async () => {
      if (!currentClient.value) return
      const result = await currentClient.value.getBuilds(jobName)
      if (result.error || !result.data) return // 出错等下一轮
      const found = result.data.find(b => b.number === buildNumber)
      if (found && !found.building) {
        stopWatchingBuild(jobName, buildNumber)
        onComplete(found)
      }
    }

    // 立即跑一次，然后定时
    tick()
    const timer = setInterval(tick, intervalMs)
    buildWatchers.set(key, timer)
  }

  /**
   * 停止监听某个 build（buildNumber 缺省则清掉该 job 的所有 watcher；jobName 与 buildNumber 都缺省则清空全部）
   */
  const stopWatchingBuild = (jobName?: string, buildNumber?: number) => {
    if (buildNumber === undefined && (jobName === undefined || jobName === '')) {
      for (const timer of buildWatchers.values()) {
        clearInterval(timer)
      }
      buildWatchers.clear()
      return
    }
    if (buildNumber === undefined) {
      const prefix = `${jobName}#`
      for (const [key, timer] of buildWatchers) {
        if (key.startsWith(prefix)) {
          clearInterval(timer)
          buildWatchers.delete(key)
        }
      }
      return
    }
    const key = `${jobName}#${buildNumber}`
    const timer = buildWatchers.get(key)
    if (timer) {
      clearInterval(timer)
      buildWatchers.delete(key)
    }
  }

  /**
   * 清理
   */
  onUnmounted(() => {
    stopPolling()
    for (const timer of buildWatchers.values()) {
      clearInterval(timer)
    }
    buildWatchers.clear()
  })

  return {
    currentBuilds,
    startPolling,
    stopPolling,
    hasBuilding,
    getLastCompletedBuild,
    fetchBuilds,
    watchBuild,
    stopWatchingBuild
  }
}