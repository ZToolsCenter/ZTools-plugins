// src/types.ts — docker 数据模型

export interface ContainerSummary {
  id: string
  names: string
  name: string
  image: string
  command: string
  created: string
  status: string
  ports: string
  state: 'running' | 'paused' | 'stopped'
  project?: string
}

export interface ComposeProject {
  name: string
  status: string
  configFiles: string
}

export interface TerminalInfo {
  id: string
  name: string
  path: string
  execType: 'applescript' | 'openargs' | 'none'
}

export interface OpenTerminalResult {
  ok: boolean
  message: string
  used?: string
  fallback?: boolean
}

export type ImageSource = 'dockerhub' | 'xuanyuan' | '1ms'

export interface ImageSearchResult {
  source: ImageSource
  name: string
  description: string
  stars: number
  pulls: string
  official: boolean
  logo: string
}

export interface DaemonConfigPath {
  path: string
  note: string
}

export interface DockerImage {
  id: string
  repository: string
  tag: string
  size: string
  created: string
}

export interface DockerVolume {
  name: string
  driver: string
  mountpoint: string
}

export interface DockerNetwork {
  id: string
  name: string
  driver: string
  scope: string
}

export interface PortMapping {
  containerPort: string
  bindings: string[]
}

export interface MountMapping {
  type: string
  source: string
  destination: string
  mode: string
  rw: boolean
}

export interface ContainerDetail {
  id: string
  name: string
  image: string | null
  created: string
  state: string | null
  restartPolicy: { name: string; maxRetryCount: number }
  ports: PortMapping[]
  mounts: MountMapping[]
}

export type DockerErrorCode =
  | 'DOCKER_NOT_FOUND'
  | 'DAEMON_DOWN'
  | 'DOCKER_ERROR'
  | 'LOG_CLOSED'
  | 'SHELL_CLOSED'

export interface DockerError {
  code: DockerErrorCode
  message: string
}

export type DockerConnection =
  | { type: 'local' }
  | { type: 'host'; host: string }
  | { type: 'context'; name: string }

export interface DockerContext {
  name: string
  description: string
  endpoint: string
  current: boolean
}

export type DockerResult<T> = ({ ok: true } & T) | { ok: false; error: DockerError }

export interface LogHandle {
  stop(): void
}

export interface ShellHandle {
  write(s: string): void
  stop(): void
}
