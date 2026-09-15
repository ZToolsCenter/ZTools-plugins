/// <reference types="vite/client" />
/// <reference types="@ztools-center/ztools-api-types" />

declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<Record<string, never>, Record<string, never>, unknown>
  export default component
}

// Preload services 类型声明（对应 public/preload/services.js）
interface JenkinsService {
  getJobs(url: string, username: string, apiToken: string): Promise<{ data: any[]; error: string | null }>
  getBuilds(url: string, username: string, apiToken: string, jobName: string): Promise<{ data: any[]; error: string | null }>
  triggerBuild(url: string, username: string, apiToken: string, jobName: string): Promise<{ error: string | null }>
  getViews(url: string, username: string, apiToken: string): Promise<{ data: any[]; error: string | null }>
  getViewJobs(url: string, username: string, apiToken: string, viewName: string): Promise<{ data: any[]; error: string | null }>
  testConnection(url: string, username: string, apiToken: string): Promise<{ success: boolean; error: string | null }>
}

interface Services {
  readFile: (file: string) => string
  writeTextFile: (text: string) => string
  writeImageFile: (base64Url: string) => string | undefined
  jenkins: JenkinsService
}

declare global {
  interface Window {
    services: Services
  }
}

export {}
