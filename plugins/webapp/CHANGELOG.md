# Changelog

本文档记录了 ZTools WebApp 插件的所有重要变更。

格式基于 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.0.0/)，
版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [1.0.0] - 2025-06-15

### 新增

- 使用 Electron webview 替代 iframe 加载网页，提升性能和安全性
- Basic Auth 支持 URL 内联认证（`https://user:pass@host`）
- 两阶段加载机制：首次使用内联认证建立会话，后续使用原始 URL 加载
- 拖动排序：支持拖动侧边栏图标调整应用顺序
- 开发者工具：Ctrl + 右键快速打开 webview 开发者工具
- 点击当前应用图标可刷新页面

### 安全改进

- URL 协议白名单校验，仅允许 http/https 协议
- 导入配置添加文件大小限制（1MB）和数量限制（100个）
- 图标 URL 添加协议校验，防止 XSS 攻击
- 使用 `crypto.randomUUID()` 替代 `Math.random()` 生成 ID
- 通过 emit 事件更新数据，避免直接修改 props

### 移除

- 移除后端反向代理服务
- 移除 Cookie Jar 持久化功能
- 简化 preload 脚本，仅保留配置读写功能

### 修复

- 修复 webview 事件监听器重复注册导致的内存泄漏
- 修复 Basic Auth 页面加载异常问题
- 修复 loading 状态在切换应用时无法正确关闭的问题
