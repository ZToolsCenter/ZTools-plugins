// 可调试构建开关：`GOOSE_DEBUG=1 pnpm build`（或 build:debug）
//
// 正式构建（默认）：sourcemap = 'hidden' + 压缩 → 产物 JS 不含 //# sourceMappingURL，
//   .map 写盘后由 scripts/utools-build.js removeMapFiles() 删除（不外泄、不增体积）。
// 调试构建（GOOSE_DEBUG=1）：sourcemap = true + 不压缩 → 产物 JS 含 sourceMappingURL，
//   removeMapFiles() 跳过保留 .map，uTools 开发者工具(Chromium DevTools) Sources 面板直读 src/。
//
// 关联：vite.config.ts 读取这些导出；scripts/utools-build.js 用同一 env 判断是否保留 .map。

export const isDebugBuild = process.env.GOOSE_DEBUG === "1";

// 调试：完整 sourcemap（含 sourcesContent，devtools 可还原 src/）；正式：'hidden'（写盘后删）
export const debugSourcemap: boolean | "hidden" = isDebugBuild ? true : "hidden";

// 调试：关闭压缩，devtools 还原后可读；正式：默认压缩（esbuild）
export const debugMinify: boolean = !isDebugBuild;
