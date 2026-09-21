# 发布流程（ZTools 插件中心）

发布命令：`npm run publish:plugin`（= `npm run build && cd plugin && ztools publish`）。

## 前置条件（ztools publish 会校验，不满足直接失败）

- 工作区干净：先提交或处理所有未跟踪/未提交改动
- `plugin/plugin.json` 的 `version` 已按语义化版本升级
- `plugin/CHANGELOG.md` 含当前版本节（缺失会交互式录入）

## 关键约定

- **从 `plugin/` 源码根发布，不要从 `plugin/dist` 发布。** 插件中心仓库保存的是插件源码，release 由中心 CI（`.github/workflows`）构建打包；所以 `vite.config.js` / `src/` / `package.json` / `scripts/` 必须保留在官方文件夹里。只提交 dist 产物会把构建文件删掉，中心 CI 无法打包（已踩过坑）。
- 本地发布状态：OAuth token 在 `~/.config/ztools/cli-config.json`，fork 缓存克隆在 `~/.config/ztools/ZTools-plugins`，每次发布在本地 HEAD 打 `ztools-last-publish` 标签。
- 增量发布：再次 `ztools publish` 在同一个 PR 分支 fast-forward 追加 commit，PR 链接不变；中心仓库无 `plugins/<id>/` 目录 = Add，已有 = Update。
- 审核者直推过 PR 分支后推送会被拒，用 `ztools pull-contributions` 三方合并回本地。

## 发布后收尾（gh 代劳网页操作）

PR 默认 draft。CLI 无法自动完成的点：

1. **截图**：PR 描述「截图/演示」嵌图，可用 fork 分支 raw URL 写进 body 前端：
   `https://raw.githubusercontent.com/<fork>/ZTools-plugins/plugin/<id>/plugins/<id>/docs/screenshots/<file>.png`
2. **自检清单**：先核实（无调试日志 / 无硬编码密钥 / diff 仅限 `plugins/<id>/`），再 `gh pr edit <n> -R ZToolsCenter/ZTools-plugins --body-file <file>`（正文先 `Write` 到临时文件再提交）。「已在本地 ZTools 客户端实测」只能作者本人确认，不要代勾。
3. **Ready for review**：`gh pr ready <n> -R ZToolsCenter/ZTools-plugins`。

## README 与截图位置

- 面向使用者的 README 放 `plugin/README.md`（随插件提交进官方仓库）。
- 界面截图唯一来源在 `plugin/docs/screenshots/`；根目录 `README.md` 用 `./plugin/docs/screenshots/...` 引用；`plugin/scripts/copy-plugin-files.mjs` 把 README 与三张界面截图复制进 `dist`（仅本地测试产物用，不发布）。