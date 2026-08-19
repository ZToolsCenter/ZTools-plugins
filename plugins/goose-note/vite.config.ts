import path from "path";
import { rmSync } from "node:fs";
import { defineConfig, createLogger } from "vite";
import react from "@vitejs/plugin-react";
import AutoImport from "unplugin-auto-import/vite";
import { codeInspectorPlugin } from "code-inspector-plugin";
import { debugMinify, debugSourcemap, isDebugBuild } from "./vite.debug";

const hostTarget = "utools";

// 构建目标区分：
// - 默认（app）：input=index.html → dist/，完整功能（plugin A 鹅的笔记）。行为与改动前一致。
// - GOOSE_BUILD_TARGET=quicknote：input=quicknote.html → dist-quicknote/，精简（plugin B 鹅的小窗）。
//   通过 __GOOSE_LITE__ 标志 + 重型依赖 alias 到空壳，把 katex/mermaid/prettier/PDF/echarts
//   等「文档级」代码排除出小窗包（约省 9MB），小窗只保留快速记文字/标题/清单/代码高亮等。
const isQuicknoteBuild = process.env.GOOSE_BUILD_TARGET === "quicknote";

// 小窗精简构建专用：把这些「仅经动态 import 进入图」的重型 JS 依赖 alias 到极小空壳，
// 确保它们不被打进 dist-quicknote（消费点已被 __GOOSE_LITE__ 短路，运行时不会真正调用）。
//
// 必须用「精确正则」只匹配裸包名 / 精确子路径的 JS import，不能用字符串前缀别名——
// 否则会误伤 index.css 里的 `@import "katex/dist/katex.min.css"`（被改写成空壳目录下的
// 不存在路径而构建失败）。katex CSS（~23KB）保留无妨，这里只剥离 katex 的 JS（~256KB）。
const liteEmptyModule = path.resolve(__dirname, "./src/lib/build/lite-empty.ts");
// pi-ai provider-env 静态 require("node:fs")（仅 Bun sandbox 回退，浏览器不可达）；
// alias 掉以免 Vite 外部化并打警告。
const nodeFsStubModule = path.resolve(__dirname, "./src/lib/build/node-fs-stub.ts");
const liteStubAliases: { find: RegExp; replacement: string }[] = isQuicknoteBuild
  ? [
      { find: /^katex$/, replacement: liteEmptyModule },
      { find: /^mermaid$/, replacement: liteEmptyModule },
      { find: /^echarts$/, replacement: liteEmptyModule },
      { find: /^@react-pdf\/renderer$/, replacement: liteEmptyModule },
      { find: /^@blocknote\/xl-pdf-exporter$/, replacement: liteEmptyModule },
      { find: /^prettier\/standalone$/, replacement: liteEmptyModule },
      { find: /^prettier\/plugins\/.+$/, replacement: liteEmptyModule },
      // AI（小窗砍掉「向 AI 提问」）：精确匹配包名，不碰 `@blocknote/xl-ai/style.css`（CSS 保留）。
      { find: /^@blocknote\/xl-ai$/, replacement: liteEmptyModule },
      { find: /^@blocknote\/xl-ai\/locales$/, replacement: liteEmptyModule },
      { find: /^@ai-sdk\/openai$/, replacement: liteEmptyModule },
      { find: /^@ai-sdk\/openai-compatible$/, replacement: liteEmptyModule },
      { find: /^@ai-sdk\/anthropic$/, replacement: liteEmptyModule },
    ]
  : [];

const logger = createLogger();
const originalWarnOnce = logger.warnOnce.bind(logger);
const originalWarn = logger.warn.bind(logger);
const isKatexFontWarning = (msg: string) =>
  msg.includes("KaTeX_") && msg.includes("didn't resolve at build time");
logger.warnOnce = (msg, options) => {
  if (isKatexFontWarning(msg)) return;
  originalWarnOnce(msg, options);
};
logger.warn = (msg, options) => {
  if (isKatexFontWarning(msg)) return;
  originalWarn(msg, options);
};

// Vite 8 底层是 rolldown。分包用 rolldown 原生 codeSplitting.groups，
// 不用已废弃的 output.manualChunks（rolldown 文档：manualChunks 与 codeSplitting 同时配置时
// manualChunks 会被忽略；这里统一走 codeSplitting）。
//
// 约定：
// - test 用 [\\/] 兼容 Windows 路径分隔符（rolldown 官方建议）。
// - priority 越大越先匹配；命中后该模块从其它组移除。兜底组 priority 最低。
// - entriesAware:true 让组按"被哪些入口/动态 import 链使用"再细分子 chunk，
//   保住源码里精心做的懒加载边界（docx 静态、pdf/jszip 动态 import），
//   避免把 docx + react-pdf + jszip 强行并进一个 3.5MB 大 chunk 后全量 eager 下载。
type ChunkGroup = {
  name: string;
  test: RegExp;
  priority: number;
  entriesAware?: boolean;
};

const codeSplittingGroups: ChunkGroup[] = [
  // React 运行时：优先级最高，确保 react / react-dom / 调度器不被卷进 blocknote 等组
  {
    name: "vendor-react",
    test: /[\\/]node_modules[\\/](react|react-dom|scheduler|use-sync-external-store|zustand)[\\/]/,
    priority: 50,
  },
  // ProseMirror 内核（blocknote 底层）
  {
    name: "vendor-prosemirror",
    test: /[\\/]node_modules[\\/]prosemirror-[^\\/]+[\\/]/,
    priority: 40,
  },
  // BlockNote 编辑器（core + react + mantine）
  {
    name: "vendor-blocknote",
    test: /[\\/]node_modules[\\/]@blocknote[\\/](core|react|mantine)[\\/]/,
    priority: 39,
  },
  // 文档导出：docx / pdf / zip。entriesAware 让其按实际使用入口拆分，
  // 用户只导出 Word 时不会被迫下载 react-pdf / xl-pdf-exporter 的体积。
  {
    name: "vendor-export",
    test: /[\\/]node_modules[\\/](docx|jszip|@react-pdf[\\/]renderer|@blocknote[\\/]xl-pdf-exporter)[\\/]/,
    priority: 38,
    entriesAware: true,
  },
  // AI SDK — 较大，单独隔离方便缓存
  {
    name: "vendor-ai",
    test: /[\\/]node_modules[\\/](ai|@ai-sdk[\\/][^\\/]+|@blocknote[\\/]xl-ai)[\\/]/,
    priority: 30,
  },
  // Mermaid（源码里 MermaidView 用 `await import("mermaid")` 懒加载）。
  // 必须 entriesAware:true，否则会被下面的兜底 vendor 组卷进 eager vendor.js（曾达 7MB），
  // 让源码的懒加载边界失效。这里只匹配 mermaid 私有依赖（cytoscape/dagre/roughjs/khroma…），
  // d3/dayjs/uuid 等共享依赖交给 rolldown 按引用关系自动归并，避免重复打包。
  {
    name: "vendor-mermaid",
    test: /[\\/]node_modules[\\/](mermaid|@mermaid-js[\\/][^\\/]+|cytoscape|cytoscape-[^\\/]+|dagre-d3-es|roughjs|khroma|@braintree[\\/]sanitize-url|d3-sankey|@upsetjs[\\/]venn\.js|stylis|ts-dedent)[\\/]/,
    priority: 37,
    entriesAware: true,
  },
  // KaTeX（MathView 用 `await import("katex")` 懒加载；rehype-katex 走导出链）。
  // entriesAware:true 保住懒加载边界。
  {
    name: "vendor-katex",
    test: /[\\/]node_modules[\\/]katex[\\/]/,
    priority: 36,
    entriesAware: true,
  },
  // Markdown / HTML 序列化管线（unified / remark / rehype / micromark / mdast / hast /
  // markdown-it / lowlight / highlight.js / lowlight 解析）。
  // 该管线经 @/lib/export 被 stores 静态引用 → 仍是 eager，但单独命名成块便于缓存，
  // 把它从 7MB 兜底 vendor.js 里剥出来。
  {
    name: "vendor-markdown",
    test: /[\\/]node_modules[\\/](unified|remark-[^\\/]+|rehype-[^\\/]+|hast-[^\\/]+|hastscript|mdast-[^\\/]+|micromark|micromark-[^\\/]+|markdown-it|markdown-table|lowlight|highlight\.js|prosemirror-highlight|property-information|space-separated-tokens|comma-separated-tokens|decode-named-character-reference|character-entities[^\\/]*|trim-lines|trough|vfile|vfile-[^\\/]+|bail|is-plain-obj|zwitch|html-void-elements|web-namespaces|ccount|escape-string-regexp|mdurl|entities|linkify-it|uc\.micro|punycode\.js|devlop)[\\/]/,
    priority: 35,
  },
  // Prettier standalone + 插件（useFormatCode 用 `await import("prettier/standalone")` 懒加载）。
  // entriesAware:true 保住懒加载边界，否则 ~1MB prettier 被卷进 eager vendor.js。
  {
    name: "vendor-prettier",
    test: /[\\/]node_modules[\\/]prettier[\\/]/,
    priority: 34,
    entriesAware: true,
  },
  // 可视化（echarts 经 MarkdownArtifact 的 React.lazy 边界懒加载）。
  // entriesAware:true 保住懒加载边界，避免 1.1MB echarts 被卷进 eager vendor.js。
  {
    name: "vendor-echarts",
    test: /[\\/]node_modules[\\/](echarts|zrender)[\\/]/,
    priority: 25,
    entriesAware: true,
  },
  // 动画
  {
    name: "vendor-motion",
    test: /[\\/]node_modules[\\/](framer-motion|motion-dom|motion-utils)[\\/]/,
    priority: 24,
  },
  // 拖拽
  {
    name: "vendor-dnd",
    test: /[\\/]node_modules[\\/]@dnd-kit[\\/]/,
    priority: 23,
  },
  // 路由
  {
    name: "vendor-router",
    test: /[\\/]node_modules[\\/](react-router|react-router-dom)[\\/]/,
    priority: 22,
  },
  // JSON 渲染
  {
    name: "vendor-json-render",
    test: /[\\/]node_modules[\\/]@json-render[\\/]/,
    priority: 21,
  },
  // Radix + 自建 UI 原语 + 图标/命令面板
  {
    name: "vendor-ui",
    test: /[\\/]node_modules[\\/](@radix-ui[\\/][^\\/]+|@floating-ui[\\/][^\\/]+|lucide-react|cmdk|sonner|class-variance-authority|clsx|tailwind-merge|date-fns)[\\/]/,
    priority: 20,
  },
  // 兜底：其余 node_modules
  {
    name: "vendor",
    test: /[\\/]node_modules[\\/]/,
    priority: 1,
  },
];

// https://vite.dev/config/
export default defineConfig({
  customLogger: logger,
  base: "./", // utools 需要相对路径
  define: {
    __HOST_TARGET__: JSON.stringify(hostTarget),
    __GOOSE_LITE__: JSON.stringify(isQuicknoteBuild),
    __GOOSE_EDITOR_COMPACT__: JSON.stringify(isQuicknoteBuild),
    __GOOSE_EDITOR_AI__: JSON.stringify(!isQuicknoteBuild),
  },
  plugins: [
    {
      name: "exclude-guide-assets-from-utools",
      closeBundle() {
        const outDir = isQuicknoteBuild ? "dist-quicknote" : "dist";
        rmSync(path.resolve(__dirname, outDir, "guide"), { recursive: true, force: true });
      },
    },
    codeInspectorPlugin({
      bundler: "vite",
      hideConsole: true,
      hideDomPathAttr: true,
    }),
    react(),
    AutoImport({
      imports: [
        "react",
        {
          "lucide-react": [["*", "LucideIcons"]],
          clsx: ["clsx"],
        },
      ],
      dts: "src/auto-imports.d.ts",
      dirs: [
        "src/hooks",
        "src/stores",
        "src/lib",
        "src/components/ui",
        // 编辑器抽取后，原 src/lib / src/hooks 下被全 app 依赖的纯工具/hooks
        // 迁入此处，仍需保持自动导入以维持既有的全局符号（行为不变）。
        // 排除 cn.ts：编辑器自带的 cn 仅供编辑器内部显式 import，
        // 不进全局命名空间（全局 cn 仍由 src/lib/utils.ts 提供，行为不变）。
        "src/components/editor/utils",
        "!src/components/editor/utils/cn.ts",
        "src/components/editor/hooks",
        // 内聚 store（useContextMenu / useFormattingToolbarAi）从 src/stores 迁入此处，
        // 保留自动导入以维持既有全局符号（行为不变）。
        "src/components/editor/state",
      ],
    }),
    {
      name: "api-icon-middleware",
      configureServer(server) {
        server.middlewares.use("/api/icon", async (req, res) => {
          try {
            const urlObj = new URL(req.url || "", `http://${req.headers.host}`);
            const targetUrl = urlObj.searchParams.get("url");

            if (!targetUrl) {
              res.statusCode = 400;
              res.end(JSON.stringify({ error: "Missing url parameter" }));
              return;
            }

            const response = await fetch(targetUrl, {
              headers: {
                "User-Agent":
                  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
              },
            });
            const html = await response.text();
            const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
            const title = titleMatch ? titleMatch[1].trim() : new URL(targetUrl).hostname;

            const domain = new URL(targetUrl).hostname;
            const icon = `https://www.google.com/s2/favicons?domain=${domain}&sz=128`;

            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({ title, icon }));
          } catch (error) {
            console.error("API Error:", error);
            res.statusCode = 500;
            res.end(JSON.stringify({ error: "Failed to fetch metadata" }));
          }
        });
      },
    },
  ],
  resolve: {
    dedupe: [
      // React 单实例：dev 预构建 + 任何冷发现的非预构建模块都解析到同一份 react/react-dom，
      // 否则 @blocknote/xl-ai → @ai-sdk/react 的 Chat/useChat 会拿到第二份 React，
      // hooks dispatcher 为 null → useMemo 读 null → 整页白屏（Invalid hook call）。
      "react",
      "react-dom",
      // BlockNote 内核/视图层也强制单实例，保证编辑器与 xl-ai 共享同一 core/react 运行时。
      "@blocknote/core",
      "@blocknote/react",
      "@blocknote/mantine",
      "prosemirror-model",
      "prosemirror-state",
      "prosemirror-transform",
      "prosemirror-view",
      "prosemirror-tables",
    ],
    // 数组形式（含正则项）：小窗精简构建的空壳 alias 放最前，精确匹配重型包名；
    // 非小窗构建 liteStubAliases 为空数组，主应用解析与改动前完全一致。
    alias: [
      ...liteStubAliases,
      // 浏览器打包：吞掉 pi-ai 对 node:fs 的静态 require（见 node-fs-stub.ts）。
      { find: /^node:fs$/, replacement: nodeFsStubModule },
      { find: "@host-runtime", replacement: path.resolve(__dirname, "./src/lib/host/runtime.utools.ts") },

      { find: "@", replacement: path.resolve(__dirname, "./src") },
    ],
  },
  // dev 依赖预构建（esbuild）。显式 include 整条 BlockNote + AI SDK 链，
  // 让它们与主体在同一次预构建里共享同一份 react，杜绝"第二份 React 实例"导致的
  // useMemo/useState dispatcher 为 null 白屏。@ai-sdk/react 是 xl-ai 的 peer，
  // 不在 src 直接 import，必须显式列出，否则可能被冷发现成非预构建模块而引入第二份 React。
  optimizeDeps: {
    include: [
      "react",
      "react-dom",
      "react-dom/client",
      "react/jsx-runtime",
      "@blocknote/core",
      "@blocknote/react",
      "@blocknote/mantine",
      "@blocknote/xl-ai",
      "@blocknote/xl-pdf-exporter",
      "@ai-sdk/react",
      "@ai-sdk/openai",
      "@ai-sdk/anthropic",
      "@ai-sdk/openai-compatible",
      "ai",
    ],
  },
  server: {
    host: "0.0.0.0",
    port: 6001,
    sourcemapIgnoreList: false,
  },

  build: {
    // app → dist/；quicknote → dist-quicknote/（两个 uTools 插件各自独立打包，互不共享 chunk）。
    outDir: isQuicknoteBuild ? "dist-quicknote" : "dist",
    // 正式 'hidden'（写盘后由 utools-build 删）；GOOSE_DEBUG=1 时 true（保留，供 DevTools 还原 src/）
    sourcemap: debugSourcemap,
    minify: debugMinify,
    rolldownOptions: {
      // 单入口按构建目标切换：主应用打 index.html，小窗只打 quicknote.html。
      // 分开构建让 rolldown 各自按入口可达性裁剪——小窗图不含 workspace <App/>，
      // 自动甩掉 echarts / PDF 导出 / AI 图表等仅主应用需要的代码。
      input: isQuicknoteBuild
        ? { quicknote: path.resolve(__dirname, "quicknote.html") }
        : { index: path.resolve(__dirname, "index.html") },
      output: {
        // rolldown 原生分包；不用废弃的 manualChunks
        codeSplitting: {
          groups: codeSplittingGroups,
        },
        sourcemapIgnoreList: false,
        chunkFileNames: "chunks/[name].js",
        entryFileNames: "assets/[name].js",
        assetFileNames: "assets/[name][extname]",
      },
      onwarn(warning, warn) {
        if (warning.code === "INEFFECTIVE_DYNAMIC_IMPORT") return;
        // KaTeX CSS 里字体用相对路径引用自身，Vite 打包后基准目录变动导致此警告，运行时正常
        if (warning.code === "UNRESOLVED_IMPORT" && warning.message?.includes("fonts/KaTeX_")) return;
        if (warning.message?.includes("didn't resolve at build time") && warning.message?.includes("KaTeX_")) return;
        warn(warning);
      },
    },
    chunkSizeWarningLimit: 3000,
    reportCompressedSize: false,
  },
  logLevel: isDebugBuild ? "info" : "warn",
});
