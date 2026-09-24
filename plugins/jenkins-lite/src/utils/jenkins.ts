import type { JobInfo, BuildInfo, JenkinsView } from '../types'

// 生产环境通过 preload 调用 Node.js 的 http 模块
// 开发环境通过 window.services.jenkins (由 mockZtools.ts 提供)

export class JenkinsClient {
  constructor(
    private jenkinsUrl: string,
    private username: string,
    private apiToken: string
  ) {}

  async testConnection(): Promise<{ success: boolean; error?: string }> {
    return (window.services as any).jenkins.testConnection(this.jenkinsUrl, this.username, this.apiToken)
  }

  async getJobs(): Promise<{ data: JobInfo[]; error: string | null }> {
    return (window.services as any).jenkins.getJobs(this.jenkinsUrl, this.username, this.apiToken)
  }

  async getBuilds(jobName: string): Promise<{ data: BuildInfo[]; error: string | null }> {
    return (window.services as any).jenkins.getBuilds(this.jenkinsUrl, this.username, this.apiToken, jobName)
  }

  async triggerBuild(jobName: string): Promise<{ error: string | null }> {
    return (window.services as any).jenkins.triggerBuild(this.jenkinsUrl, this.username, this.apiToken, jobName)
  }

  async getViews(): Promise<{ data: JenkinsView[]; error: string | null }> {
    return (window.services as any).jenkins.getViews(this.jenkinsUrl, this.username, this.apiToken)
  }

  async getViewJobs(viewName: string): Promise<{ data: JobInfo[]; error: string | null }> {
    return (window.services as any).jenkins.getViewJobs(this.jenkinsUrl, this.username, this.apiToken, viewName)
  }

  async getBuildConsole(jobName: string, buildNumber: number): Promise<{ data: string; error: string | null }> {
    return (window.services as any).jenkins.getBuildConsole(this.jenkinsUrl, this.username, this.apiToken, jobName, buildNumber)
  }
}
