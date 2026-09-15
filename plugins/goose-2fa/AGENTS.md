# Goose 2FA

仅面向 uTools 发布的 React、TypeScript 和 Vite 双因素验证码管理器。浏览器适配器只用于开发预览，不是产品平台。

## 目录

- `src/components/`：账号、分组、验证码、导入导出和回收站界面。
- `src/lib/`：OTP、二维码、Google Authenticator 迁移和数据校验。
- `src/platform/`：uTools 与浏览器预览适配器。
- `src/stores/`：账号状态。
- `utools/`：插件清单、preload 和打包脚本。

## 项目特有约束

- 只在 `main` 分支开发。
- `src/platform/utools.ts` 与 `utools/preload.cjs` 的桥接能力必须保持一致。
- uTools 7.8.0 使用 Electron 22 和 Chromium 108。关键视觉链路使用 hex、rgb 或传统 hsl 实色 token，不使用 `color-mix()`、`oklch()`、`lab()`、`lch()`、Tailwind 裸调色板色或 `/alpha` 颜色。
- 浏览器预览只能证明基础交互；uTools 兼容结论以真机为准。

## 验证

- 代码改动运行 `bun run build`。
- 改 OTP、导入导出、二维码或账号状态时运行 `bun run test`。
- 改颜色、悬停或选中态时，检查构建产物不存在 `color-mix|oklch|lab\(|lch\(`，并在 uTools 真机核对。
- 只有任务需要页面操作或视觉验收时才读取全局 `browser-use` skill。
