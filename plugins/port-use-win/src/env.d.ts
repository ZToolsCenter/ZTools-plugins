/// <reference types="vite/client" />
/// <reference types="@ztools-center/ztools-api-types" />

declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<Record<string, never>, Record<string, never>, unknown>
  export default component
}

declare global {
  interface PortUsage {
    protocol: string
    processName: string
    pid: number
    state: string
    localAddress: string
    localHost: string
    localPort: string
    remoteAddress: string
    remoteHost: string
    remotePort: string
  }

  interface Services {
    getPortUsage: () => PortUsage[]
    killProcess: (pid: number) => { pid: number; processName?: string }
  }

  interface Window {
    services?: Services
    servicesLoadError?: string
  }
}

export {}
