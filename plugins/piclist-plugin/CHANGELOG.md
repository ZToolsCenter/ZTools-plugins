# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - 2026-05-11

### Added

- ✨ **图片上传功能**
  - 支持点击选择本地图片文件上传
  - 支持拖拽图片到上传区域进行上传
  - 支持多图片同时上传
  - 显示上传进度条

- ✨ **剪贴板上传支持**
  - 支持粘贴剪贴板中的图片直接上传
  - 支持粘贴图片URL进行上传
  - 支持通过文件路径上传图片

- ✨ **设置页面**
  - 配置 PicList 服务地址和端口
  - 支持 HTTP/HTTPS 协议切换
  - API Key 鉴权配置
  - 复制 URL 格式选择（Markdown、HTML、URL、UBB、自定义）
  - 历史记录最大保存条数配置（1-500）
  - 配置持久化到本地数据库
  - 测试连接功能

- ✨ **历史记录页面**
  - 查看所有已上传的图片记录
  - 图片预览（新窗口打开）
  - 一键复制图片链接（按配置格式）
  - 删除单条记录
  - 清空全部历史记录

- ✨ **关于页面**
  - 功能介绍
  - 技术栈展示
  - 相关链接

- ✨ **服务状态检测**
  - 首页加载时自动检测 PicList 服务连接状态
  - 服务未启动时显示警告提示

- ✨ **响应式设计**
  - 现代化紫色渐变主题
  - 流畅的动画效果
  - 统一的设计语言

### Changed

- 📦 项目基于 Vue 3 + Vite + TypeScript + Element Plus 构建
- 📦 使用 ZTools API 进行数据持久化存储

### Fixed

- 🐛 修复页面滚动问题
- 🐛 修复 URL 格式提取问题（支持 Markdown、HTML、UBB 格式）
- 🐛 修复文件上传时路径参数类型错误

### Known Issues

- 暂无已知问题

## [Unreleased]

### Planned Features

- [ ] 支持更多图床平台
- [ ] 图片批量操作
- [ ] 图片压缩功能
- [ ] 自定义图床配置
- [ ] 快捷键支持

---

*Changelog format: Added (✨), Changed (📦), Fixed (🐛), Deprecated (⚠️), Removed (🗑️), Security (🔒)*
