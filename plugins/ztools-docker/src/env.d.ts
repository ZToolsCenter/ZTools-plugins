/// <reference types="vite/client" />
/// <reference types="@ztools-center/ztools-api-types" />

declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<Record<string, never>, Record<string, never>, unknown>
  export default component
}

import type {
  ContainerSummary,
  ContainerDetail,
  DockerResult,
  DockerError,
  LogHandle,
  ComposeProject,
  TerminalInfo,
  OpenTerminalResult,
  DockerConnection,
  DockerContext,
  ShellHandle,
  ImageSearchResult,
  DaemonConfigPath,
  DockerImage,
  DockerVolume,
  DockerNetwork
} from './types'

interface DockerService {
  listContainers(): Promise<DockerResult<{ containers: ContainerSummary[] }>>
  listComposeProjects(): Promise<DockerResult<{ projects: ComposeProject[] }>>
  listContexts(): Promise<DockerResult<{ contexts: DockerContext[] }>>
  setConnection(conn: DockerConnection): void
  getConnection(): DockerConnection
  inspectContainer(id: string): Promise<DockerResult<{ container: ContainerDetail }>>
  startContainer(id: string): Promise<DockerResult<{}>>
  stopContainer(id: string): Promise<DockerResult<{}>>
  restartContainer(id: string): Promise<DockerResult<{}>>
  pauseContainer(id: string): Promise<DockerResult<{}>>
  unpauseContainer(id: string): Promise<DockerResult<{}>>
  removeContainer(id: string): Promise<DockerResult<{}>>
  updateRestartPolicy(id: string, policy: string): Promise<DockerResult<{}>>
  getRunCommand(id: string): Promise<DockerResult<{ command: string }>>
  createContainer(args: string[]): Promise<DockerResult<{ id?: string }>>
  checkContainerName(name: string): Promise<{ ok: boolean; used?: boolean; error?: string }>
  checkPorts(ports: string[]): Promise<{ ok: boolean; occupied?: string[]; error?: string }>
  removeContainerFully(id: string): Promise<DockerResult<{}>>
  listImages(): Promise<DockerResult<{ images: DockerImage[] }>>
  removeImage(ref: string): Promise<DockerResult<{}>>
  imageExists(image: string): Promise<boolean>
  pullImage(image: string, onData: (data: string) => void, onError: (err: DockerError) => void): LogHandle
  listVolumes(): Promise<DockerResult<{ volumes: DockerVolume[] }>>
  removeVolume(name: string): Promise<DockerResult<{}>>
  listNetworks(): Promise<DockerResult<{ networks: DockerNetwork[] }>>
  removeNetwork(id: string): Promise<DockerResult<{}>>
  systemDf(): Promise<DockerResult<{ stdout: string }>>
  systemPrune(all: boolean): Promise<DockerResult<{}>>
  volumePrune(): Promise<DockerResult<{}>>
  builderPrune(): Promise<DockerResult<{}>>
  /**
   * 流式跟随容器日志（docker logs -f --tail 200）。
   * - onData: 每次收到完整日志行时调用，ANSI 颜色码已清洗。
   * - onError: 在以下情况调用，调用方务必以 code 字段区分——
   *     DOCKER_ERROR/DAEMON_DOWN/DOCKER_NOT_FOUND：真正错误；
   *     LOG_CLOSED：日志流正常结束或调用 handle.stop() 后的正常信号，
   *     应视为流结束而非错误；spawn 失败时可能先收到错误回调、
   *     紧接着再收到一次 LOG_CLOSED，属于预期行为。
   * - 返回 handle，调用 handle.stop() 可停止跟随并终止子进程。
   */
  followLogs(id: string, onData: (line: string) => void, onError: (err: DockerError) => void): LogHandle
  followComposeLogs(configFile: string, onData: (line: string) => void, onError: (err: DockerError) => void): LogHandle
  attachContainerShell(id: string, onData: (data: string) => void, onError: (err: DockerError) => void): ShellHandle
}

interface TerminalsService {
  detectTerminals(): TerminalInfo[]
  openTerminal(id: string, command: string): Promise<OpenTerminalResult>
}

interface RegistryService {
  searchImages(
    query: string,
    source: string
  ): Promise<{ ok: boolean; results?: ImageSearchResult[]; error?: string }>
  fetchImageTags(
    source: string,
    imageName: string
  ): Promise<{ ok: boolean; tags?: string[]; error?: string }>
  fetchMirrors(): Promise<{ ok: boolean; mirrors?: string[]; offline?: boolean; error?: string }>
  generateDaemonJson(mirrors: string[]): string
  daemonConfigPath(): DaemonConfigPath
  setProxy(value: string): void
}

interface Services {
  docker: DockerService
  terminals: TerminalsService
  registry: RegistryService
}

declare global {
  interface Window {
    services: Services
  }
}

export {}
