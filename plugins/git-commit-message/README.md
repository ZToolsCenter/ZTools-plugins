# git-commit-message

> 快速生成带 Gitmoji 的 Git 提交信息。

这是一个使用 **Vue 3 + Vite + TypeScript** 构建的 ZTools 插件。用户选择 Gitmoji 类型、填写提交摘要和可选信息后，点击生成即可复制一条符合 Conventional Commit 风格的提交消息。

## 功能

- 常用 Gitmoji 推荐，覆盖新增、修复、优化、文档、UI、重构、测试、CI、依赖、安全等高频场景
- 支持搜索更多 Gitmoji 类型，可按中文名称、英文 shortcode、commit type 或关键词搜索
- 自动生成 Gitmoji + Conventional Commit 格式
- 支持可选 scope、详细说明和关联 issue
- 点击“生成并复制”后写入系统剪贴板
- 自动保存最近 20 条生成历史
- 支持查看历史、再次复制历史项、清空历史记录
- 支持 `Ctrl + Enter` / `Cmd + Enter` 快速生成
- 支持明暗色模式

## 输出示例

```text
✨ feat(auth): 添加登录页
```

带正文和 issue 时：

```text
🐛 fix(auth): 修复登录过期判断

避免 token 已失效时仍展示已登录状态

Refs #123
```

## 使用方式

1. 在 ZTools 中搜索 `git commit`、`commit message`、`提交信息` 或 `生成提交消息` 打开插件。
2. 输入提交摘要，按需填写影响范围、详细说明和关联 issue。
3. 选择合适的 Gitmoji 类型，或通过搜索框查找更细的类型。
4. 点击“生成并复制”，然后把提交信息粘贴到 Git 客户端或终端中。

## 常用类型映射

| 类型 | 输出 |
| --- | --- |
| 新增 | `✨ feat` |
| 修复 | `🐛 fix` |
| 热修复 | `🚑️ fix` |
| 优化 | `⚡️ perf` |
| 文档 | `📝 docs` |
| 样式/UI | `💄 style` |
| 重构 | `♻️ refactor` |
| 测试 | `✅ test` |
| 配置 | `🔧 chore` |
| 构建 | `👷 build` |
| CI | `💚 ci` |
| 依赖升级 | `⬆️ chore` |
| 依赖降级 | `⬇️ chore` |
| 删除代码 | `🔥 chore` |
| 移动/重命名 | `🚚 chore` |
| 破坏性变更 | `💥 feat` |
| 安全 | `🔒️ fix` |
| 类型 | `🏷️ types` |
| 国际化 | `🌐 feat` |
| 可访问性 | `♿️ a11y` |
| 数据库 | `🗃️ db` |
| 日志 | `🔊 chore` |
| 回滚 | `⏪️ revert` |
| 发布版本 | `🔖 release` |

搜索框可以继续查找更多类型，例如 `lock`、`依赖`、`ui`、`database`、`revert`。

## 历史记录

每次成功生成并复制提交信息后，插件会把完整消息保存到本地历史记录中，最多保留最近 20 条。历史记录保存在当前设备的浏览器/ZTools 本地存储里，不会写入 Git 仓库，也不会上传。

清空历史只会删除本地保存的记录，不影响已经复制或提交过的内容。

## 本地存储

插件仅使用本地存储保存历史记录，存储键为 `git-commit-message:history`。插件不会读取 Git 仓库内容，也不会把提交信息发送到任何远程服务。

## 快速开始

```bash
npm install
npm run dev
```

开发服务器默认运行在 `http://localhost:5173`，ZTools 会通过 `src-ztools/plugin.json` 中的 development 配置加载开发版本。

## 构建

```bash
npm run build
```

构建产物会输出到 `src-ztools/dist/`。`src-ztools/` 目录就是完整的 ZTools 插件目录。

## 项目结构

```text
.
├── src-ztools/
│   ├── logo.png
│   ├── plugin.json
│   └── preload/
│       ├── package.json
│       └── services.js
├── src/
│   ├── CommitMessage/
│   │   └── index.vue
│   ├── App.vue
│   ├── env.d.ts
│   ├── main.css
│   └── main.ts
├── index.html
├── vite.config.js
├── tsconfig.json
└── package.json
```
