# AGENTS.md

## 项目沟通与修改原则

- 默认使用中文沟通，代码标识保持原文。
- 修改前先确认 `git status --short --branch`，保护用户已有未提交改动。
- 只做用户明确要求的最小改动；处理 PR review 时，不顺手补未要求的新能力。
- 修改后至少执行与影响范围匹配的验证；前端改动默认优先跑 `npm run build`。

## ZTools 插件发布流程

本仓库是独立插件仓库，插件市场 PR 由 `ztools publish` 管理。处理
`ZToolsCenter/ZTools-plugins` 上的插件 PR 时，必须按下面顺序执行：

1. 在本地插件仓库修改代码和文档，不直接用 GitHub API 手写 PR 分支内容。
2. 本地验证通过后，先 `git add` / `git commit` 生成插件仓库提交。
3. 将本地提交推送到当前仓库的 `origin/master`。
4. 确认工作区干净后运行 `ztools publish`，让 CLI 同步 `plugins/<plugin-name>/` 到 fork 分支并更新 PR。
5. `ztools publish` 成功后，再核对 PR 链接、head commit 和本地 `ztools-last-publish` 标签。

注意：

- `ztools publish` 会拒绝脏工作区；不要在有未提交改动时直接运行。
- 不要手动 force 更新 `hxxxy/ZTools-plugins:plugin/port-use-win`，除非是在修复自己误操作造成的错误 PR head。
- 如果 review 只要求解决 `window.ztools` 可能未定义的问题，就只保护 `window.ztools` 调用；不要补 `getRunningServices()` 等未要求的新功能。
- 若文档声称存在未实现能力，应删除或更正文档描述，而不是默认实现额外 preload API。

## 当前插件要点

- 插件入口配置在 `public/plugin.json`。
- Preload 能力在 `public/preload/services.js`。
- 页面和 ZTools API 调用集中在 `src/App.vue`。
- 最小构建验证命令是 `npm run build`。
