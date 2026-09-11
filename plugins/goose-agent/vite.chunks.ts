/**
 * uTools vendor 分包策略。
 *
 * Vite 8 底层用 rolldown，rollup 的 `output.manualChunks` 会被忽略，
 * 必须用 rolldown 原生的 `output.codeSplitting.groups`
 * （配 `rolldownOptions.output` 使用；旧名 advancedChunks 已 deprecated）。
 *
 * 目标：把体积大、更新频率低的第三方库拆成独立 chunk，避免业务代码改动
 * 触发整包失效，并让首屏 bundle 更小、缓存命中更稳。
 *
 * priority 越大越先匹配；命中后该模块从其它组移除。test 用 `[\\/]`
 * 兼容 Windows 路径分隔符（rolldown 官方建议）。
 *
 * 注意：当前业务代码只直接用到 input/tooltip/input-group/dropdown-menu 四个
 * ui 组件，recharts / embla / react-day-picker 等仅被未引用的 ui 组件提及，
 * 会被 tree-shaking 丢弃；charts 组若无模块命中则不会生成空 chunk。
 *
 * ## 变更页 @pierre/diffs + shiki（约 10MB）
 *
 * 配合 `App.tsx` 对 ChangesPage 的 `React.lazy`：
 * - **不要**把 shiki / @pierre 强制打进同一命名组再与首屏共享 runtime。
 *   强制 `pierre-diffs` 组时，Vite 的 dynamic-import preload helper 会落在该
 *   大 chunk 上，entry 为用 helper 而**静态 import** 整包，首屏又回到 MB 级。
 * - vendor 兜底用负向前瞻排除 pierre/shiki 及相关 hast 依赖，让它们只留在
 *   lazy 异步图（`changes-*.js` + 按需语言/主题 chunk）。
 *
 * ## Streamdown + mermaid / shiki（对话 Markdown）
 *
 * streamdown 核心进 vendor；@streamdown/code 依赖 shiki、@streamdown/mermaid
 * 依赖 mermaid。shiki / mermaid 从 vendor 排除，由对话路径按需拆 chunk，
 * 避免变更页 pierre 与对话高亮互相绑死首屏。
 *
 * ## 技能编辑 CodeMirror 6（ADR 0016）
 *
 * 配合 `App.tsx` 对 SkillsEditorPage 的 `React.lazy`：
 * - vendor 兜底排除 @codemirror / @uiw/react-codemirror / @lezer，只留在
 *   技能页异步 chunk，避免进首屏。
 */
export const codeSplittingGroups = [
  // React 运行时（react / react-dom / scheduler）—— 最稳定，单独长期缓存
  {
    name: "react-vendor",
    test: /[\\/]node_modules[\\/](react|react-dom|scheduler|react-is)[\\/]/,
    priority: 50,
  },
  // @base-ui/react —— 在用组件的底层无障碍原语
  {
    name: "base-ui",
    test: /[\\/]node_modules[\\/]@base-ui[\\/]/,
    priority: 40,
  },
  // 图标库 —— 即便按需引入也常占可观体积，拆出便于观测
  {
    name: "icons",
    test: /[\\/]node_modules[\\/]lucide-react[\\/]/,
    priority: 30,
  },
  // 图表库（recharts 及其 d3-* 依赖）；被 tree-shaking 丢弃时此组不生成
  {
    name: "charts",
    test: /[\\/]node_modules[\\/](recharts|d3-[^\\/]+|victory-vendor|internmap)[\\/]/,
    priority: 30,
  },
  // Office 生成/解析（Artifact 工具懒路径；勿进首屏 vendor）
  {
    name: "office-libs",
    test: /[\\/]node_modules[\\/](docx|exceljs|pptxgenjs|officeparser|jszip|pako|@xlsx|xlsx)[\\/]/,
    priority: 28,
  },
  // 其余第三方统一归入 vendor（兜底，优先级最低）
  // 显式排除：变更页 pierre/shiki、streamdown 的 mermaid、技能页 CodeMirror/lezer、office 大库
  {
    name: "vendor",
    test: /[\\/]node_modules[\\/](?!@pierre[\\/]|@shikijs[\\/]|shiki(?:[\\/]|$)|@streamdown[\\/]|mermaid(?:[\\/]|$)|hast-util-to-html[\\/]|lru_map[\\/]|property-information[\\/]|space-separated-tokens[\\/]|comma-separated-tokens[\\/]|html-void-elements[\\/]|stringify-entities[\\/]|ccount[\\/]|character-entities-html4[\\/]|character-entities-legacy[\\/]|@codemirror[\\/]|@uiw[\\/]react-codemirror[\\/]|@lezer[\\/]|crelt(?:[\\/]|$)|style-mod(?:[\\/]|$)|w3c-keyname(?:[\\/]|$)|docx(?:[\\/]|$)|exceljs(?:[\\/]|$)|pptxgenjs(?:[\\/]|$)|officeparser(?:[\\/]|$))/,
    priority: 1,
  },
];
