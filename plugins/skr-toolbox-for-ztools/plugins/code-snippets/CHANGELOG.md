# Changelog

本文件记录「代码模板」插件每次版本更新的内容。

## [1.0.3] - 2026-05-09

### 修复

- 修复复制次数（usageCount）切换页面后丢失的问题：`handleCopy` 中 `db.put` 未等待结果确认，`loadTemplates` 重新加载后覆盖了未持久化的修改，现在等待 `put` 成功后再同步更新 UI 状态
- 使用 `toRaw` 脱除响应式代理，避免传给 `ztools.db` 时序列化问题

## [1.0.2] - 2026-05-07

### 优化

- Shiki 初始化逻辑从 `<script setup>` 移至模块级 `<script>` 块，避免组件重新挂载时重复初始化
- 清理未使用的变量

## [1.0.1] - 2026-05-07

### 优化

- **内存占用优化**：详情视图用 Shiki 替代 CodeMirror，纯 HTML 输出无编辑器运行时开销
- 编辑视图 CodeMirror 改为异步懒加载，减少首屏加载
- Shiki 使用 JS 正则引擎替代 WASM，减少 622KB 加载体积
- 修复 `darkMedia` 事件监听器在模块顶层执行导致 HMR 累积泄漏
- 修复 Shiki highlighter 未 `dispose` 的 HMR 泄漏
- `defineAsyncComponent` 移至模块级避免 HMR 重复创建
- 添加 `import.meta.hot.dispose` 清理 Shiki 实例

## [1.0.0] - 2026-05-06

### 新增

- 初始版本发布
- Vue 3 + TypeScript + Vite 项目搭建
- 模板 CRUD（新建、编辑、删除）
- 搜索过滤、按使用频率排序
- 一键复制到剪贴板
- JSON 导入/导出
- ElementPlus 组件按需自动导入（unplugin-auto-import + unplugin-vue-components）
- CodeMirror 语言扩展动态加载，减小首屏体积
- ZTools 插件清单（plugin.json）与 preload 服务脚本
- 双运行环境适配：ZTools 生产环境 / 独立浏览器开发环境
