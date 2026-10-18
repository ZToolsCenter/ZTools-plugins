/** 页面与 preload 桥接共享的类型定义。 */

/** 当前唤醒状态。 */
export interface AwakeStatus {
  /** 当前平台是否支持。 */
  supported: boolean
  /** 是否正在保持唤醒。 */
  active: boolean
  /** 状态文件存在但守护进程已失效（内部标记）。 */
  stale?: boolean
  /** 守护进程 PID。 */
  pid: number
  /** 本轮开始时间戳。 */
  startedAt: number
  /** 结束时间戳；null 表示一直保持。 */
  endsAt: number | null
  /** 本轮使用的时长（分钟，0 表示一直保持）。 */
  durationMinutes: number
  /** 是否同时保持屏幕点亮。 */
  keepDisplay: boolean
  /** 剩余秒数；null 表示一直保持。 */
  remainingSeconds: number | null
  /** 已保持秒数。 */
  elapsedSeconds: number
  /** 守护进程实际提交给 SetThreadExecutionState 的标志位。 */
  flags: number
}

/** 用户选择并持久化的配置。 */
export interface AwakeConfig {
  /** 唤醒时长（分钟，0 表示一直保持）。 */
  durationMinutes: number
  /** true 表示不允许息屏。 */
  keepDisplay: boolean
}

/** 启动参数。 */
export interface AwakeStartPayload {
  durationMinutes?: number
  keepDisplay?: boolean
  /** 运行中调整策略时保留剩余时长。 */
  preserveRemaining?: boolean
}

/** preload 暴露的业务能力。 */
export interface AwakeBridge {
  getConfig(): Promise<AwakeConfig>
  saveConfig(patch: Partial<AwakeConfig>): Promise<AwakeConfig>
  getStatus(): Promise<AwakeStatus>
  start(payload?: AwakeStartPayload): Promise<AwakeStatus>
  stop(): Promise<AwakeStatus>
  constants: {
    MIN_DURATION_MINUTES: number
    MAX_DURATION_MINUTES: number
    HEARTBEAT_INTERVAL_MS: number
    ES_CONTINUOUS: number
    ES_SYSTEM_REQUIRED: number
    ES_DISPLAY_REQUIRED: number
  }
}
