# Changelog

本文件记录「代码模板」插件每次版本更新的内容。

## 1.2.0 - 2026-08-14

### 新增

- 变量占位符插值：模板代码支持 `${1}`、`${2:默认值}` 占位符，复制时弹窗依次填写并自动替换生成最终代码
- 模板置顶：列表项与详情页支持置顶/取消置顶，置顶模板始终排在最前，与使用次数排序互不干扰
- 直接搜索：在 ZTools 直接输入任意关键词即可打开插件并搜索对应模板（`over` 全局触发）
- 进入自动定位：输入关键词进入插件时自动过滤列表，唯一匹配自动选中并复制
- 编辑视图新增占位符语法提示，README 补充占位符语法说明

### 优化

- 删除 `index.html` 中未使用的 highlight.js CDN 引用，避免离线/内网环境白屏
- 修复深色模式下滚动条样式选择器无效的问题（非法 `&` 前缀）
- 搜索过滤对缺失字段做防御处理，导入时校验 name/code 合法性，避免脏数据导致列表崩溃
- 合并两处 `onMounted`，删除冗余的 `langExportMap` 映射与 preload 中未使用的读写函数
- 清理无用代码：删除 `main.css` 中未使用的 CSS 变量与 `textarea` 规则、`App.vue` 中不会触发的开发模式提示

## 1.1.1 - 2026-05-19

### 优化

- 优化模板列表显示方式：语言和复制次数改为标签形式显示，标题不再被遮挡
- 语言标签使用深蓝背景（`type="info"` `effect="dark"`）与其他标签区分
- 复制次数标签使用绿色边框（`type="success"`），数字前显示复制图标

## 1.1.0 - 2026-05-18

### 新增

- 快捷键 `Alt+1~5` 快速复制使用次数最多的前 5 个模板
- 快捷键 `Alt+Insert` 快速新增模板，自动填入剪贴板内容
- 模板列表前 5 项显示快捷键提示标签
- 添加快捷键帮助提示栏

### 优化

- 进入插件时调用 `subInputBlur` 让插件应用获得焦点，确保快捷键生效
- `setSubInput` 的 `isFocus` 设为 `false`，避免焦点被 ZTools 搜索框抢占

### 根据提交记录补充

- 防止快捷键长按重复触发，编辑模式下 Alt+Insert 增加二次确认

## 1.0.4 - 2026-05-11

### 修复

- 修复复制操作时 `ztools.db.put` 报 `An object could not be cloned` 错误：`handleCopy` 中 `{ ...toRaw(tpl) }` 展开后嵌套属性（如 `tags` 数组）仍为 Vue 响应式代理，Electron `sendSync` 的 `structuredClone` 无法序列化代理对象，改为手动构造纯数据对象

### 根据提交记录补充

- 修改插件分类
- 添加开发分类

## 1.0.3 - 2026-05-09

### 修复

- 修复复制次数（usageCount）切换页面后丢失的问题：`handleCopy` 中 `db.put` 未等待结果确认，`loadTemplates` 重新加载后覆盖了未持久化的修改，现在等待 `put` 成功后再同步更新 UI 状态
- 使用 `toRaw` 脱除响应式代理，避免传给 `ztools.db` 时序列化问题

## 1.0.2 - 2026-05-07

### 优化

- Shiki 初始化逻辑从 `<script setup>` 移至模块级 `<script>` 块，避免组件重新挂载时重复初始化
- 清理未使用的变量

## 1.0.1 - 2026-05-07

### 优化

- **内存占用优化**：详情视图用 Shiki 替代 CodeMirror，纯 HTML 输出无编辑器运行时开销
- 编辑视图 CodeMirror 改为异步懒加载，减少首屏加载
- Shiki 使用 JS 正则引擎替代 WASM，减少 622KB 加载体积
- 修复 `darkMedia` 事件监听器在模块顶层执行导致 HMR 累积泄漏
- 修复 Shiki highlighter 未 `dispose` 的 HMR 泄漏
- `defineAsyncComponent` 移至模块级避免 HMR 重复创建
- 添加 `import.meta.hot.dispose` 清理 Shiki 实例

## 1.0.0 - 2026-05-06

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
