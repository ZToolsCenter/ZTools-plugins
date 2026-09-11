# Maven Lite

> 一款在 **ZTools** 中快速检索 Maven 依赖、浏览历史版本并一键复制依赖声明的开发者效率工具。
> 告别"浏览器搜索 → 复制 → 切回 IDE"的繁琐流程，让依赖管理行云流水。

![Vue 3](https://img.shields.io/badge/Vue-3.5-42b883) ![Vite](https://img.shields.io/badge/Vite-6-646cff) ![TypeScript](https://img.shields.io/badge/TypeScript-5-3178c6) ![License](https://img.shields.io/badge/License-MIT-green)

## ✨ 功能特性

### 三源聚合搜索

一次搜索同时查询三个数据源，单源故障不影响整体：

| 数据源 | 说明 |
|---|---|
| **Maven Central** | Solr 官方接口（需代理时可在设置中配置） |
| **阿里云 Maven 镜像** | 国内直连，结果自带版本，一级列表直接复制 |
| **CodeRead** | 社区镜像，二级版本页覆盖更多 Android / Graal 变体 |

- 全部 Tab 聚合去重并显示来源标签
- `com/org/dev/cn` 开头的 groupId 自动置顶

### 分类筛选

一级结果与二级版本面板均支持分类，判定智能、偏好记忆：

- **Android**：groupId / artifactId / 版本号含 `android`（如 `androidx.*`、`fastjson2-android`、`2.0.60.android8`）
- **非安卓**：其余 JVM / Kotlin 生态
- 当前分类持久化到 `dbStorage`，下次打开自动恢复

### 一键复制

| 快捷键 | 作用 |
|---|---|
| `m` | 复制 Maven `<dependency>` XML |
| `g` | 复制 Gradle `implementation 'g:a:v'` |
| `Enter` / `c` / `p` | 打开格式菜单（POM / Android） |
| `Cmd/Ctrl + K` | 显示 / 隐藏快捷键帮助 |

- **阿里云**结果自带版本 → 一级列表直接复制
- **Central / CodeRead** → 进入二级版本面板选版本（CodeRead 解析其版本页 HTML）
- 复制后自动写入剪贴板并粘贴到当前应用

### 历史版本浏览

- 版本号 + 发布时间 + `stable` / `snapshot` / `alpha` / `beta` 标签 + `LATEST` 徽章
- 按时间倒序，200 条分页加载更多
- 二级版本面板支持 Android / 非安卓筛选

### 其他

- 代理配置弹窗（默认关闭，可即时生效并持久化）
- 搜索防抖 700ms
- 暗夜模式跟随 ZTools
- 完整键盘导航 + 每行右侧快捷键提示

## 🚀 安装

### 打包

```bash
npm install
npm run build        # 产出 dist.zip
```

### 安装到 ZTools

```bash
unzip dist.zip -d <ZTools 插件目录>/ztools-maven/
```

> 生产构建已配置 `base: './'`，直接复制 `dist/` 内容或解压 `dist.zip` 即可。

### 触发方式

- 输入 `maven` 打开检索主面板
- 在 ZTools 主搜索框直接输入任意关键字 → 触发 `maven-search` 快速复制流程

## ⌨️ 快捷键

| 按键 | 一级结果列表 | 二级版本列表 |
|---|---|---|
| `↑` / `↓` | 上下移动 | 上下移动 |
| `←` / `→` | 切换数据源 Tab | `←` 返回结果列表 |
| `Shift` + `←` / `→` | 切换分类（全部 / Android / 非安卓） | 切换分类（全部 / Android / 非安卓） |
| `Enter` | 进入版本面板（阿里云直接复制） | 打开格式菜单 |
| `m` | 复制 Maven XML（阿里云）；进入二级（Central/CodeRead） | 复制 Maven XML |
| `g` | 复制 Gradle（阿里云）；进入二级（Central/CodeRead） | 复制 Gradle |
| `Esc` | 隐藏窗口 | 返回 / 退出 |

## 🛠️ 开发

```bash
npm install
npm run dev          # 开发模式（ZTools 自动加载 http://localhost:5173）
npm test             # 单元 + 集成 + 组件测试
npm run test:e2e     # Playwright 端到端
npm run build        # 生产构建 + dist.zip
```

### 技术栈

Vue 3 · Vite · TypeScript · Vitest · @vue/test-utils · jsdom · Playwright

## 📁 项目结构

```
ztools-maven/
├── plugin.json            # 插件配置（feature 注册）
├── preload.js             # Preload 服务（三源查询、代理、HTML 解析）
├── index.html
├── src/
│   ├── MavenUi/           # 主检索面板（搜索/结果/版本/菜单）
│   ├── MavenSearch/       # 快速复制面板（over-cmd 触发）
│   ├── MavenSettings/     # 代理设置弹窗
│   ├── lib/               # 纯函数（解析/版本标签/XML 构建/主题/缓存）
│   ├── App.vue            # 路由
│   ├── main.css           # 深浅主题 CSS 变量
│   └── env.d.ts
├── public/
│   ├── logo.png           # Maven 风格图标
│   └── plugin.json        # Vite 输入（与根 plugin.json 一致）
├── tests/                 # 单元 / 集成 / 组件 / E2E
└── docs/superpowers/      # 设计 spec 与实现计划
```

## 🙏 致谢

- [ZTools](https://github.com/ztool-center/ztools) —— 提供插件运行环境与强大的 API
- [Maven Central](https://search.maven.org/) —— 全球最大的 Java 构件仓库（Solr 搜索接口）
- [阿里云 Maven 镜像](https://maven.aliyun.com/) —— 国内高速依赖源
- [CodeRead](https://mvn.coderead.cn/) —— 社区维护的依赖镜像站（版本数据）
- [Vue.js](https://vuejs.org/) / [Vite](https://vitejs.dev/) —— 前端框架与构建工具
- [Vitest](https://vitest.dev/) / [Playwright](https://playwright.dev/) —— 测试工具

## 📄 开源协议

[MIT License](./LICENSE)

---

**祝你开发愉快！** 🎉
