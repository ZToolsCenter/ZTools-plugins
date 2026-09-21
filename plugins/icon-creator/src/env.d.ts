/// <reference types="vite/client" />
/// <reference types="@ztools-center/ztools-api-types" />

declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<Record<string, never>, Record<string, never>, unknown>
  export default component
}

// Preload services 类型声明（对应 public/preload/services.js）
interface Services {
  readFile: (file: string) => string
  writeTextFile: (text: string, ext?: string) => string
  writeTextFileToPath: (text: string, filePath: string) => string
  writeSvgFile: (svgText: string, fileName?: string) => string
  writeImageFile: (base64Url: string, fileName?: string) => string | undefined
  writeZipFile: (zipBlob: Blob, fileName?: string) => Promise<string>
  /** 图片写入到指定绝对路径（父目录自动创建，同名覆盖），文件名由调用方保证合法。 */
  writeImageFileToPath: (base64Url: string, filePath: string) => string | undefined
  /** 二进制（base64 编码）写入到下载目录，扩展名以传入文件名为准。 */
  writeBinaryFile: (base64: string, fileName?: string) => string
  /** 二进制（base64 编码）写入到指定绝对路径，父目录自动创建，同名覆盖。 */
  writeBinaryFileToPath: (base64: string, filePath: string) => string
}

// 插件工具处理器注册结果，由 ZTools 宿主在 MCP 工具被调用时回调执行。
interface ZtoolsRegisterToolHandler {
  (input: unknown): unknown
}

declare global {
  interface ThemeInfo {
    isDark: boolean
    primaryColor?: string
    customColor?: string
    windowMaterial: string
  }

  interface Window {
    services: Services
    ztools: ZToolsApi & {
      getThemeInfo(): ThemeInfo
      onThemeChange(callback: (theme: ThemeInfo) => void): void
      /**
       * 注册 MCP 工具处理器（用于 ZTools 内置 MCP 服务对外暴露）。
       * 工具必须先在 plugin.json 的 tools 字段中声明，名称需小写 snake_case。
       */
      registerTool(name: string, handler: ZtoolsRegisterToolHandler): void
    }
  }
}

export {}
