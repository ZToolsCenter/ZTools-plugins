# 市场投稿草稿（GitHub Draft PR，待作者 review）

- 插件 ID：local-fsearch
- 显示名称：FSearch 文件搜索
- 公开作者：lifeek
- 版本：0.0.2
- 平台：darwin、win32
- 许可证：MIT；官方 ES 组件的 MIT 声明随包保留。
- 建议分类：系统工具（最终以官方支持的分类为准）。

## 简介

一个 ZTools 本地文件搜索插件：macOS 接入 FSearch，Windows 接入 Everything。支持名称/路径搜索、分类和筛选、引擎分页、预设、主搜索推送，以及图片缩略图与可缩放、自由拖动的独立大图预览。

Windows 需要单独安装并运行 Everything 完整客户端，ES 命令行工具已随包提供。macOS 需要独立安装 noahdunnagan/fsearch；正文、代码定义、Git 状态、常用优先和 Quick Look 仅在 macOS 提供。普通使用者无需安装 Node.js。

## 审核说明

- 统一插件清单、稳定 ID，版本保持 0.0.2，作者仅 lifeek。
- HTML/CSS/JS 与 Node 内置模块，无运行时 npm 第三方依赖、代码混淆、动态 eval 或自动下载。
- 子进程调用使用参数数组，无 shell；Windows 仅调用 ES 本地 IPC，macOS 使用固定 Socket / FSearch 标准路径和 qlmanage。
- ES 1.1.0.38 x64/ARM64/x86 为官方二进制；源代码地址、许可证和 SHA-256 清单见 vendor/es。
- 独立预览窗口加载插件内本地页面；窗口脚本和 CSP 随源码提交。
- 构建只复制显式白名单；work、测试数据、用户配置、索引和开发缓存均不进入包。
- 隐私、验证边界和依赖安装分别见 PRIVACY.md、VALIDATION.md、INSTALL.md。

## 投稿状态

当前材料用于向 ZToolsCenter/ZTools-plugins 提交 Draft PR。未进入正式审核、未合并、未发布；作者 review 并明确同意后才转为 Ready for review。截图使用相对仓库路径，可在本目录查看。

## 仍需用户完成

- [x] Windows 实机截图已使用隔离实例和合成公开样本采集，并人工逐张核查；见下方画廊。
- [ ] 手动验证 Windows 打开/定位/路径粘贴最终系统效果。
- [ ] 若双平台同时投稿，补 macOS 0.0.2 最新图片和入口验收；否则在 PR 明确说明验证边界，交由审核者决定。
- [ ] 确定作者源码仓库是否公开；不自动修改仓库可见性。
- [ ] 作者 review 草稿 PR 后决定是否转为 Ready for review。

现已准备 Windows 当前实机截图。历史 macOS 合成浏览器预览不作为当前实机证据。更新记录、作者身份和手工提交边界已写入本稿。

## Windows 实机截图

2026-11-19，隔离的 Windows ZTools 3.2.0，插件 0.0.2 / lifeek，真实 Everything 本地索引。文件与图片均为专门生成的公开演示样本；没有使用个人文档。仅捕获应用内容，不含整个桌面。未使用 computer use。

### Windows 名称搜索

![Windows 名称搜索](screenshots/market-0.0.2/01-windows-search.png)

真实 Everything 检索合成演示文件，限定通用目录；结果来自实际索引。

### 图片分类与缩略图

![图片分类与缩略图](screenshots/market-0.0.2/02-windows-images.png)

图片分类只显示三张程序生成的演示图片，可点击进入大图。

### 独立大图预览

![独立大图预览](screenshots/market-0.0.2/03-large-preview.png)

真实 ZTools 独立窗口内容，16:9 画布，显示缩放工具栏、图片尺寸和操作按钮。

### 主搜索推送

![主搜索推送](screenshots/market-0.0.2/04-main-push.png)

真实 ZTools 主搜索框输入 fs 示例-，最多五个匹配和更多结果入口。

### 独立预设指令

![独立预设指令](screenshots/market-0.0.2/05-preset-command.png)

在插件保存“演示文件”后，ZTools 主搜索能找到对应独立指令。
