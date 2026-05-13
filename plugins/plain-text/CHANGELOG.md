# 更新日志

## v1.0.2

### 修复

- 修复插件重新加载白屏问题（移除 development.main 配置，简化路由逻辑）
- 修复 Markdown 渲染 XSS 安全漏洞（引入 DOMPurify）
- 修复组件卸载时 debounce 定时器未清理导致内存泄漏

### 改进

- 开启 TypeScript strict 模式
- 更新 logo 图标

## v1.0.1

### 新增

- Markdown 双模式编辑，支持实时分栏预览
- 字号切换按钮（14/16/18/20px）
- 一键导出 .txt / .md 文件
- 多文稿管理（新建、切换、删除）
- 自动保存至 localStorage
- 行号显示
- 暗色模式适配
- Ctrl+S 快捷导出

## v1.0.0

- 初始版本，纯文本编辑基础功能
