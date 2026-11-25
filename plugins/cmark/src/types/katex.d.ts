/** KaTeX 的 auto-render 子模块没有自带类型声明 */
declare module 'katex/contrib/auto-render' {
  export interface RenderMathOptions {
    delimiters?: Array<{ left: string; right: string; display: boolean }>
    throwOnError?: boolean
    ignoredTags?: string[]
    errorCallback?: (msg: string, err: Error) => void
  }
  export default function renderMathInElement(el: HTMLElement, options?: RenderMathOptions): void
}
