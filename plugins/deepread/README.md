# DeepRead 深读

DeepRead 深读是一个面向 ZTools 的本地阅读插件，主打低调阅读、书架管理、分页阅读和用户自定义书源解析。

插件本身不内置书源，不提供作品内容，也不托管任何第三方资源。在线书源能力仅用于解析用户自行导入的合法书源。

## 功能概览

- 本地 `.txt` / `.md` 文件导入与书架管理。
- 阅读进度保存、分页阅读、目录跳转、书内搜索和自动翻页。
- 独立底栏阅读窗口，支持低调外观、透明度、尺寸、主题、字号和行距设置。
- 鼠标移出隐藏、快捷隐藏、滚轮翻页和键盘翻页。
- 支持用户自行导入阅读 APP 常见 JSON 书源。
- 支持多书源在线搜索、详情读取、目录预览和加入书架。
- 支持图片验证码输入、访问验证页打开、验证 Cookie 保存和单书源重试。
- 首次使用会展示免责声明，用户同意后才能继续使用插件。

## 使用方式

### 本地阅读

1. 打开 DeepRead 深读。
2. 点击“导入”选择本地 `.txt` 或 `.md` 文件。
3. 在书架中选择书籍开始阅读。
4. 可通过目录弹窗、书内搜索弹窗、滚轮或键盘控制阅读进度。

### 在线书源

1. 进入“书源设置”。
2. 通过“剪切板导入”“导入链接”或“JSON 导入”添加书源。
3. 启用需要使用的书源。
4. 进入“找书”，输入书名或作者进行搜索。
5. 从搜索结果或详情页点击“加入书架”。

注意：

- DeepRead 不内置、不推荐任何书源仓库。
- 用户导入的书源和通过书源获取的内容由用户自行判断合法性。
- 遇到验证码或访问验证时，插件只提示用户手动完成验证，不提供自动破解能力。

## 开发

```bash
npm install
npm run dev
```

浏览器开发入口通常是：

```text
http://localhost:5173
```

如果要让 ZTools 在开发时接入 Vite 服务，可以临时在 `public/plugin.json` 中添加 `development.main` 指向本地开发地址。正式构建和发布时不要保留开发入口。

## 构建

```bash
npm run build
```

构建产物会输出到 `dist/`。

Vite 会把 `public/` 下的插件静态资源复制到 `dist/`，包括：

- `public/plugin.json`
- `public/preload/services.js`
- `public/verify.html`
- `public/logo.png`

## 本地安装

先执行：

```bash
npm run build
```

然后在 ZTools 中安装以下任一目录：

- 推荐安装 `dist/`
- 也可以安装项目根目录，此时根目录 `plugin.json` 会指向 `dist/index.html`

不要直接安装 `public/` 目录。`public/` 只是待复制的静态资源目录，不包含构建后的页面入口。

## 版本管理

发布前需要同步更新：

- `package.json`
- `package-lock.json`
- `plugin.json`
- `CHANGELOG.md`

当前项目使用语义化版本号。普通功能修复和体验优化通常提升 patch 版本，例如：

```text
1.1.2 -> 1.1.3
```

## 官方发布流程

本项目通过 ZTools 官方插件发布命令提交到官方插件仓库。

### 1. 提交本地变更

发布命令要求当前项目是 Git 仓库，并且相关变更已经提交。

```bash
git status --short
git add .
git commit -m "feat: 优化在线书源验证与首次使用合规提示"
```

确认工作区干净：

```bash
git status --short
```

没有输出表示工作区干净。

### 2. 执行构建

```bash
npm run build
```

### 3. 使用官方发布命令

```bash
ztools publish
```

命令会自动完成以下流程：

- 校验插件项目和 `plugin.json`。
- 检查 GitHub 登录状态。
- 检查或复用个人 fork。
- 同步上游 `ZToolsCenter/ZTools-plugins`。
- 将当前插件文件同步到官方插件仓库的 `plugins/deepread/`。
- 生成发布 commit。
- 推送插件分支。
- 创建 draft Pull Request。

### 4. 发布排错

如果发布过程中出现：

```text
Could not resolve host: github.com
```

说明当前网络或 DNS 无法解析 GitHub。可以先确认：

```bash
Resolve-DnsName github.com
git ls-remote https://github.com/azhu949/ZTools-plugins.git HEAD
```

DNS 恢复后重新执行：

```bash
ztools publish
```

注意：当前使用的 ZTools CLI 中，`ztools publish --help` 也可能直接进入发布流程。需要查看帮助时，优先使用官方文档，不要在准备不足时对 `publish` 子命令追加参数试探。

## 目录结构

```text
DeepRead/
  public/
    plugin.json
    preload/services.js
    verify.html
  src/
    App.vue
    bookSource.ts
    main.css
  CHANGELOG.md
  plugin.json
  package.json
  README.md
```

## 免责声明

DeepRead 深读仅作为本地阅读和用户自定义书源解析工具提供。

本插件不提供、不托管、不上传、不分发任何第三方作品、书籍内容、书源或书源仓库。用户自行导入的本地文件、书源、搜索结果、章节内容及其合法性，均由用户自行判断并承担相应责任。

使用本插件时，请遵守所在地法律法规和相关作品的版权要求。请勿使用本插件获取、保存、分享或传播未授权作品内容，也请勿绕过付费、登录、验证码、访问控制或其他技术保护措施。

如果发现导入的书源或内容可能侵犯他人权益，请立即停止使用并删除相关内容。

## 开源协议

本项目基于 MIT License 开源，详见 [LICENSE](./LICENSE)。
