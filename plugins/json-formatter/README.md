# JSON 格式化（ZTools 插件）

一个完全离线的 JSON/JSON5 格式化、校验与树形查看工具。项目结构参考同级的 `sql-formatter-ztools`，交互能力参考 JSON-handle，但实现为独立、无广告、无网络权限的 ZTools 插件。

![JSON 格式化插件界面](docs/screenshot.png)

## 功能

- 标准 JSON 与 JSON5（注释、尾逗号、未加引号 key）解析
- 固定 2 空格缩进与递归 Key 排序
- 可折叠树形视图、类型着色、节点路径/值复制与节点编辑
- 清晰的解析错误行列提示
- 粘贴自动识别、输入自动格式化、本地偏好保存与快捷键
- 浅色/深色主题与自适应全屏布局，所有数据仅在本地处理

## 开发与打包

```bash
npm install
npm run dev
npm test
npm run build
npm run package
npm run verify
```

发布产物位于 `release/`：

- `json-formatter-1.0.0.zpx`：ZTools 安装包
- `json-formatter-1.0.0.zip`：兼容 ZIP 安装包

快捷键：`Ctrl + Enter` 立即格式化，`Ctrl + Shift + C` 复制结果，`Ctrl + Shift + V` 从剪贴板粘贴。

## 发布到 ZTools 插件中心

发布采用 ZTools 官方 CLI 的 fork + Pull Request 流程。首次发布前请准备好 Node.js 16+、Git、npm（或 pnpm）以及可登录的 GitHub 账号。

### 1. 安装发布工具

```bash
npm install -g @ztools-center/plugin-cli
```

### 2. 发布前检查

确认根目录中的 `plugin.json` 已填写正确的 `name`、`title`、`description`、`author` 和 `version`，并同步更新 `package.json`、`public/plugin.json` 与 `CHANGELOG.md` 中的版本信息。然后执行：

```bash
npm ci
npm test
npm run build
npm run package
npm run verify
git status
```

发布要求当前目录已经初始化为 Git 仓库、至少有一次提交，并且 `git status` 显示工作区干净。因此，发布前需要提交本次改动：

```bash
git add .
git commit -m "chore: release v1.0.0"
```

### 3. 创建发布 PR

在项目根目录运行：

```bash
ztools publish
```

首次运行时，CLI 会通过 GitHub Device Flow 引导授权，并自动完成以下操作：

1. Fork 并同步 `ZToolsCenter/ZTools-plugins`。
2. 将插件源码复制到中心仓库的 `plugins/json-formatter/` 目录。
3. 推送 `plugin/json-formatter` 分支。
4. 创建或复用一个 Draft Pull Request。

### 4. 完成 GitHub 审核准备

CLI 输出 Pull Request 地址后，还需要在 GitHub 页面手动完成：

1. 在 PR 描述中上传 1–2 张插件截图或演示 GIF。
2. 逐项确认并勾选自检清单。
3. 点击 **Ready for review**，将 Draft PR 转为正式审核状态。

维护者审核并合并 PR 后，插件才会正式进入 ZTools 插件中心。

### 后续版本

更新 `plugin.json` 等文件中的版本号和 `CHANGELOG.md`，完成测试并提交后，再次运行 `ztools publish`。如果审核者直接修改过远端 PR 分支，先同步贡献再发布：

```bash
ztools pull-contributions
ztools publish
```

详细机制和故障排查请参考 [ZTools 发布与协作流程](https://ztoolscenter.github.io/ZTools-doc/publish-and-update.html)。
