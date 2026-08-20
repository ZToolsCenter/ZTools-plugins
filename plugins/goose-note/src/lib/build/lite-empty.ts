/**
 * 速记小窗（plugin B / dist-quicknote）精简构建专用空壳模块。
 *
 * vite.config.ts 在 GOOSE_BUILD_TARGET=quicknote 的构建里，把
 * katex / mermaid / prettier / @react-pdf/renderer / @blocknote/xl-pdf-exporter /
 * echarts 这些「文档级重型依赖」alias 到本模块，确保它们不被打进小窗包
 * （整体省下约 9MB 未压缩体积）。
 *
 * 这些依赖的消费点在 lite 构建里已被 __GOOSE_LITE__ 短路（math/mermaid 退化为
 * 纯代码块、代码格式化按钮隐藏、PDF/图表入口仅存在于 plugin A），运行时不会真正
 * 调用本空壳。下面的导出仅为满足构建期的 import 解析，并在万一被调用时安全降级（不抛硬错）。
 */

const noop = (): void => {};
const passthroughAsync = async (input?: unknown): Promise<unknown> => input ?? "";

// 默认导出：Proxy 兜底任意属性访问 / 调用，避免 undefined 触发硬崩溃。
// 必须实现 toString / valueOf / @@toPrimitive：否则顶层
// `[aiDocumentFormats.html.systemPrompt, "..."].join("\n")` 一类代码
// 会在小窗启动时抛 "Cannot convert object to primitive value"。
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const stub: any = new Proxy(noop, {
  get: (_target, prop) => {
    if (prop === Symbol.toPrimitive) return () => "";
    if (prop === "toString" || prop === "valueOf") return () => "";
    if (prop === Symbol.toStringTag) return "LiteStub";
    // Promise 解包探测：避免被 await 时当 thenable 递归挂起。
    if (prop === "then") return undefined;
    return stub;
  },
  apply: () => stub,
});

export default stub;

// 具名导出兜底：覆盖消费方可能解构的具名符号（prettier.format / @react-pdf 的 Font 等）。
export const format = passthroughAsync;
export const Font = {
  register: noop,
  registerHyphenationCallback: noop,
};

// AI 具名导出兜底（小窗砍掉 AI：@blocknote/xl-ai + @ai-sdk/* alias 到本模块）。
// ESM 具名 import 要求被 import 的符号存在，否则链接报错；这些全是 stub，
// 因小窗里 AI 用法已被 __GOOSE_LITE__ 门控为死代码，运行时不会真正调用。
export const AIExtension = stub;
export const AIMenu = stub;
export const AIMenuController = stub;
export const PromptSuggestionMenu = stub;
export const getDefaultAIMenuItems = stub;
export const useAIDictionary = () => ({
  ai_menu: {
    status: { thinking: "", editing: "", error: "" },
    input_placeholder: "",
    actions: {},
  },
  ai_default_commands: {},
});
export const ClientSideTransport = stub;
export const aiDocumentFormats = stub;
// 行内 AI 自定义 transport 从 xl-ai 解构的辅助（小窗死代码，仅满足链接）
export const getProviderOverrides = stub;
export const injectDocumentStateMessages = stub;
export const toolDefinitionsToToolSet = stub;
export const zh = stub; // @blocknote/xl-ai/locales 的 zh
export const createOpenAI = stub;
export const createOpenAICompatible = stub;
export const createAnthropic = stub;
