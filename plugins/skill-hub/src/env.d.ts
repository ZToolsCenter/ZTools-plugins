/// <reference types="vite/client" />
/// <reference types="@ztools-center/ztools-api-types" />

declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<Record<string, never>, Record<string, never>, unknown>
  export default component
}

interface DirEntry {
  name: string
  path: string
  isDirectory: boolean
  isFile: boolean
  isSymlink: boolean
}

interface StatResult {
  exists: boolean
  isDirectory?: boolean
  isFile?: boolean
  isSymlink?: boolean
  size?: number
  mtime?: string
}

interface SkillScanResult {
  name: string
  dir: string
  skillFile: string
  content: string
  manifest: {
    name: string
    description: string
    author: string
    tags: string[]
    format: string
    language: string
  }
}

interface Services {
  readFile: (file: string) => string
  writeTextFile: (text: string) => string
  writeImageFile: (base64Url: string) => string | undefined

  expandPath: (p: string) => string
  homeDir: () => string
  isWindows: () => boolean
  isMacOS: () => boolean
  pathJoin: (...parts: string[]) => string
  pathExists: (p: string) => boolean
  mkdir: (dir: string) => void
  openFolder: (dir: string) => void
  readDir: (dir: string) => DirEntry[]
  readFileText: (filePath: string) => string
  writeFile: (filePath: string, content: string) => void
  removeFile: (filePath: string) => void
  copyFile: (src: string, dest: string) => void
  stat: (p: string) => StatResult

  createSymlink: (target: string, linkPath: string) => string
  readSymlink: (linkPath: string) => string | null

  downloadFile: (url: string) => Promise<Buffer>
  downloadFileTo: (url: string, destPath: string) => Promise<string>

  fetchGitHubAPI: (url: string, token?: string) => Promise<any>
  fetchGitHubText: (url: string, token?: string) => Promise<string>

  extractZip: (zipPath: string, dest: string) => string
  extractBufferZip: (buffer: ArrayBuffer, dest: string) => string
  extractTarGz: (tarPath: string, dest: string) => Promise<string>

  scanForSkills: (rootDir: string) => SkillScanResult[]
  scanForSkillFiles: (dirs: string[]) => SkillScanResult[]
  parseSkillFile: (filePath: string) => { content: string; manifest: SkillScanResult['manifest'] } | null

  checkSkillUpdate: (repo: string, skillPath: string, token?: string, branch?: string) => Promise<string>
  updateSkillFromGitHub: (repo: string, skillPath: string, targetDir: string, token?: string, branch?: string) => Promise<boolean>

  getStateDir: () => string
}

declare global {
  interface Window {
    services: Services
    ztools: ZToolsApi
  }
}

export {}
