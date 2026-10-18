# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - 2026-09-03

### Added

- 初始版本发布
- **通用目录迁移** — 不绑定具体软件，任何「源目录 → 目标目录 + 链接」的需求都可配置
- **预设外置配置** — 出厂预设集中在 `preload/config/presets.json`，增删改预设只改 JSON，不写逻辑；界面不展示任何品牌图标
- **Junction 无感知链接** — Windows Junction / 符号链接，程序完全感知不到数据已迁移
- **自定义目录** — 与预设同一套数据模型，统一在一张表格管理（.npm、.m2、.gradle、浏览器缓存等）
- **系统重装恢复** — `target-only` 状态一键重建链接，重装后无需重新下载
- **冲突处理** — 源与目标都存在实体目录时支持 prefer-source / prefer-target 两种策略
- **安全回滚** — 任何步骤失败自动回滚，源目录先备份为 `.backup-{timestamp}` 再操作
- **进程检测** — 迁移前强制检测关联进程，运行中拒绝执行
- **纯内存 dev mock** — 开发模式使用虚拟测试目录，零磁盘 IO，不触碰真实 IDE 数据

### 内置预设

- Visual Studio Code (`vscode`)
- Cursor (`cursor`)
- Qoder IDE (`qoder`)
- Qoder CN (`qoder-cn`)
- Windsurf (`windsurf`)
- VSCodium (`vscodium`)
- Trae (`trae`)

### 技术栈

- Vue 3.5 + TypeScript strict + Vite 6
- Pinia 状态管理
- Node.js CommonJS preload
- ZTools 宿主（`window.ztools` / `window.services`）

[1.0.0]: https://github.com/00001x/link-relay/releases/tag/v1.0.0
