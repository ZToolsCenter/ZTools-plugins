/**
 * Vitest 单元测试配置（随 ENG-001 引入 `npm test` 脚本而新增）。
 *
 * 不复用 vite.config.js：vitest 优先读取本文件，单测对象是纯 TS 引擎逻辑
 * （src/core），无需 Vue 插件与构建产物目录等 vite 专属配置。
 *
 * 关键点：`exclude` 在默认排除项（node_modules / dist 等）之外追加了
 * `tests/e2e/**` —— 该目录是 Playwright 用例（`npm run test:e2e` 单独执行），
 * 若被 vitest 收集会在加载 `@playwright/test` 的 `test()` 时直接报
 * 套件级错误，导致 `vitest run` 失败。
 */
import { configDefaults, defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    exclude: [...configDefaults.exclude, 'tests/e2e/**'],
  },
})
