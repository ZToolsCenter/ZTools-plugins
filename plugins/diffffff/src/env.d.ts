/// <reference types="vite/client" />
/// <reference types="@ztools-center/ztools-api-types" />

declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<Record<string, never>, Record<string, never>, unknown>
  export default component
}

// Preload services 类型声明（对应 public/preload/services.js，最小桥接 v1）
interface Services {
  /**
   * 读取本地文本文件（同步）
   * @param path 文件路径，必须为非空字符串
   * @param encoding 文本编码：'utf-8'（默认，接受别名 'utf8'）、'gbk'、
   *        'utf-16'（按 utf-16le 解码）、'utf-16be'（INT-005：API 级能力，
   *        TextDecoder 原生标签；UI 编码选择器仅暴露前三项，BE 文件极少、
   *        UI 保持精简）
   * @returns 解码后的文本内容；BOM 敏感编码（utf-8/utf-16le/utf-16be）默认
   *          剥除对应 BOM，GBK 无 BOM
   * @throws path 非法、编码不在白名单、或文件不存在/读取失败时抛出带中文信息的 Error；
   *         注意非法字节序列（如 GBK 文件用错编码读）不抛错，按 TextDecoder
   *         标准以 U+FFFD 替换符呈现
   */
  readTextFile: (
    path: string,
    encoding?: 'utf-8' | 'utf8' | 'gbk' | 'utf-16' | 'utf-16be',
  ) => string
  /**
   * 弹出系统「打开文件」对话框（单选文件）
   * @param filters 可选的文件类型过滤器，如 [{ name: '文本文件', extensions: ['txt'] }]
   * @returns 所选文件的路径（宿主返回数组时取首个）；用户取消或未选择时返回 null
   * @throws filters 非数组，或元素缺少 name/extensions 时抛出中文错误
   */
  pickOpenFile: (filters?: { name: string, extensions: string[] }[]) => string | null
  /**
   * 读取系统剪贴板纯文本
   * @returns 剪贴板文本内容；剪贴板为空或读取失败时返回空字符串
   */
  readClipboardText: () => string
}

declare global {
  interface Window {
    services: Services
    /**
     * ZTools 宿主 API（由宿主注入，浏览器 dev / preview 环境不存在）。
     * 类型来自 @ztools-center/ztools-api-types 的 ZToolsApi（宿主全局 `ztools`
     * 的同一接口；本项目此前只经 preload services 间接消费，本任务起
     * App.vue 直接消费其中的 getWindowType / onPluginDetach，故在此挂到
     * Window 上；消费方必须做空值兜底 —— 缺失时视为浏览器 dev，走降级
     * 行为，不抛错）。注意宿主 API 类型声明文件在全局只声明了 `declare var
     * ztools`，不含 Window 挂载，因此需要这里自行补充。
     */
    ztools?: ZToolsApi
  }

  /**
   * Electron 渲染层拖入的 File 对象携带的本地路径（UI-003）。
   *
   * Electron 会给拖入渲染层的 File 注入非标准 own 属性 `path`（文件本地
   * 绝对路径字符串）；纯浏览器 dev 环境没有该属性，且新版 Electron（≥32，
   * 改用 webUtils.getPathForFile() 取代 File.path）也可能不再注入，
   * 因此声明为可选。消费方（useDropLoad）必须做空值兜底：
   * 取不到路径时提示改用「打开文件」按钮，不做渲染层直读。
   */
  interface FileWithPath extends File {
    path?: string
  }
}

export {}
