/**
 * 可调试构建开关。
 *
 * 通过环境变量 GOOSE_DEBUG=1 开启「可调试构建」：
 *   - build.sourcemap = true  → 生成独立 .map（external，sources 指向真实 src/ 路径）
 *   - build.minify   = false  → 产物不压缩，uTools 开发者工具可直读源码
 *   - utools/scripts/build.js 在 debug 时跳过 removeMapFiles()，保留 .map
 *
 * 未设置时走正式发布：minify 默认压缩，sourcemap 会在打包时删除。
 */
export const isDebugBuild = process.env.GOOSE_DEBUG === "1";

/**
 * uTools 平台的 sourcemap：
 *   - debug：true（生成 external .map，build.js 保留）
 *   - 正式：'hidden'（生成 .map 供本地排查，JS 不带 sourceMappingURL，
 *           随后 build.js 的 removeMapFiles() 会删掉，分发包不含 .map）
 */
export const debugSourcemap: boolean | "hidden" = isDebugBuild ? true : "hidden";

/** debug 构建关闭压缩，正式构建保持默认压缩（undefined = 让 Vite 用默认 minifier） */
export const debugMinify: false | undefined = isDebugBuild ? false : undefined;
