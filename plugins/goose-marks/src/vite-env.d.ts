/// <reference types="vite/client" />

declare const __APP_VERSION__: string

// uTools 全局 API（由 preload/preload.cjs 注入）的完整类型见 src/types/global.d.ts。
// 此处不再重复声明 UToolsApi / Window —— 旧骨架的最小子集里带有 [key: string]: unknown
// 索引签名，会把 setFeature/ai/getFeatures 等方法解析成 unknown（不可调用），
// 与 global.d.ts 的完整声明冲突。统一以 global.d.ts 为准。
