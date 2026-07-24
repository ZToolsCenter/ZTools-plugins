# Changelog

## 2.0.0

### Changed

- `text-case-tool` 重命名并重构为 `char-transform`（字符转换）
- 新 UI：实时转换列表、点击复制、筛选、快捷键 `⌘/Ctrl+1~N`
- 共享逻辑迁移至 `lib/char-transform.js`、`lib/char-transform-app.js`

### Added

- 驼峰/蛇形/常量/短横线、Base64、MD5、URL 编解码等转换类型
- `docs/prds/char-transform.md` 需求文档

## 1.1.0

### Changed

- `text-case-tool` 迁移至 Vue 3 + ztools-ui + Vite
- 新增 `lib/text-case-app.js` 应用层逻辑（TDD 覆盖，23 项测试）
- `lib/` 核心模块改为 ESM，preload 使用 `lib/text-transform.cjs`
- 发布包 `release/text-case-tool-1.1.0` 已验证构建
- `template/` 已通过 `sync-template.sh` 同步为标准脚手架

### Added

- `scripts/sync-template.sh` — 发布后同步标准 template
- `vue-router` 作为 ztools-ui 对等依赖

## 1.0.0

### Added

- ZTools 插件 monorepo 工作区（plugins / release / template / docs/prds）
- 文本大小写转换示例插件
- TDD 单元测试与自动化脚本
- 集成 [ztools-ui](https://ui.ohmyztools.cc/) 组件库
