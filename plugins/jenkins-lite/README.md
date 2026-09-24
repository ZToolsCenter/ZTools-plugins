# Jenkins Lite

> 告别繁琐的 Jenkins 网页操作，把 Job 列表、构建历史、一键触发装进你的启动器。

[![version](https://img.shields.io/badge/version-1.1.0-blue.svg)](./CHANGELOG.md)
![Vue](https://img.shields.io/badge/Vue-3-42b883.svg)
![Vite](https://img.shields.io/badge/Vite-6-646cff.svg)
![TypeScript](https://img.shields.io/badge/TypeScript-5-3178c6.svg)
![License](https://img.shields.io/badge/license-MIT-green.svg)

## 👋 简介

**Jenkins Lite** 是一款运行在 [ZTools](https://github.com/ztool-center/ztools) 上的轻量级 Jenkins 辅助插件。

打开启动器，输入 `jenkins`，即可在几毫秒内：

- 浏览所有 Job 及其当前状态（成功 / 失败 / 运行中 / 排队中 / 禁用）
- 按视图筛选，支持 Folder 嵌套
- 搜索 Job 名称
- 收藏高频 Job，点击直达
- 一键触发构建，带确认防误触
- 实时查看构建历史，点击跳转到 Jenkins 详情页

不需要打开浏览器、不需要记忆 Job URL、不需要在 Jenkins 漫长的页面里翻找。**一切都在你的启动器里完成。**

## 🎯 为什么需要 Jenkins Lite

| 痛点 | Jenkins Lite 的做法 |
| --- | --- |
| 每次想看构建状态都要打开 Jenkins 网页，等页面加载 | 在启动器里直接看到所有 Job 状态 |
| 想触发构建要在网页上点好几层 | `Enter` 一键构建，二次确认防误触 |
| 常用 Job 散落在不同 Folder，找起来很麻烦 | 侧边栏一键收藏，常用 Job 集中入口 |
| 同时维护多套 Jenkins（测试 / 预发 / 生产） | 多实例管理，下拉切换 |
| 想找一个 Job 却只记得名字片段 | 在当前列表内实时模糊搜索 |
| 构建历史只能去 Jenkins 看 | 右侧实时滚动展示最近构建记录 |

## ✨ 功能特性

### 实例管理
- 新增 / 编辑 / 删除多个 Jenkins 实例
- 实例下拉切换，互不干扰
- 保存前必须**测试连接通过**，避免配置错误
- 表单采用两列布局，录入更高效

### Job 浏览
- 显示所有 Jenkins Job，支持 **Folder 嵌套**
- 按 **视图（View）** 快速筛选
- Job 状态实时展示：🟢 成功 / 🔴 失败 / 🔵 运行中 / 🟡 排队中 / ⚪ 禁用
- 长 Job 名 hover 显示完整名称

### 搜索
- 当前视图内按名称模糊搜索
- 支持从 ZTools 主搜索框带关键词打开，自动聚焦搜索框

### 收藏
- 一键收藏常用 Job
- 收藏作为独立视图，过滤展示已收藏 Job
- 收藏时记录所在视图，点击收藏自动跳回原视图
- 最近访问的 Job 自动选中

### 一键构建
- `Enter` 触发构建，二次确认弹窗
- 构建中状态实时反馈
- 构建完成系统通知

### 构建历史
- 右侧面板展示当前 Job 的构建记录
- 单行显示：状态 + 编号 + 结果 + 耗时
- 时间信息（开始 / 结束）完整展示年月日时分
- 点击构建记录直接跳转到 Jenkins 详情页

### 体验细节
- 跟随系统 **暗色模式**
- 统一 SVG 图标（非 emoji），细节更精致
- 数据 **本地持久化**，重启不丢失

## ⌨️ 快捷指令

| 指令 | 说明 |
| --- | --- |
| `jenkins` / `Jenkins` | 打开 Jenkins Lite |
| `jenkins lite` | 打开 Jenkins Lite |
| `构建` / `build` | 直接进入构建入口 |
| `jenkins收藏` / `jenkins-fav` | 进入收藏视图 |
| 任意文字 → `jenkins` | 在 Jenkins 任务中搜索 |

## 🚀 快速开始

1. 从 ZTools 插件市场下载 **Jenkins Lite**
2. 在 ZTools 中输入 `jenkins` 唤起插件
3. 首次打开会引导你添加第一个 Jenkins 实例：
   - **名称**：自定义显示名
   - **URL**：Jenkins 服务地址（如 `https://jenkins.example.com`）
   - **用户名**：Jenkins 账号
   - **API Token**：在 Jenkins 「用户 → 配置 → API Token」生成
4. 点击 **测试连接**，通过后保存即可使用

## 🔒 数据安全

Jenkins Lite **完全开源、完全本地**：

- ✅ Jenkins 地址、用户名、API Token **仅保存在你的本机**
- ✅ **不向任何服务器上传任何数据**
- ✅ 全部源码公开，可审计

开源仓库：[github.com/kshq1996/ztools-jenkins](https://github.com/kshq1996/ztools-jenkins)

## ❓ 常见问题

**Q: API Token 在哪里生成？**
A: 登录 Jenkins → 右上角用户 → 配置 → API Token → 「新增 Token」。

**Q: 能否支持 Jenkins 免登录 / Anonymous？**
A: 支持，API Token 字段留空即可。

**Q: 实例配置错误怎么办？**
A: 新版要求保存前必须测试通过；若旧实例连接失败，可在侧边栏下拉菜单「编辑」重新配置。

**Q: 数据存在哪里？**
A: 通过 ZTools 的 `dbStorage` API 保存在本机，与其他 ZTools 数据隔离，不会上传。

## 📄 开源协议

[MIT](./LICENSE)

## 🙏 致谢

- 特别感谢 [ZTools](https://github.com/ztool-center/ztools) 提供优秀的插件平台，让启动器生态得以繁荣
- 感谢所有为 Jenkins 长期贡献的开发者，让 CI/CD 成为日常

---

**⭐ 如果 Jenkins Lite 帮你节省了时间，欢迎给个 Star！**