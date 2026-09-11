# Docker Lite 🐳

> 可视化的 Docker 容器管理插件，旨在降低 Docker 的使用门槛，让容器管理变得一目了然。支持在线检索镜像、一键创建容器、直观管理容器启停状态、端口与目录映射，实时日志与终端一应俱全。

Docker Lite 是 [ZTools](https://github.com/ztool-center/ztools) 启动器的插件，基于 **Vue 3 + Vite + TypeScript** 构建。无需记忆复杂命令，点点鼠标即可完成日常 Docker 运维。

---

## ✨ 功能特性

### 📦 容器管理

- **双栏容器列表**：按 **compose 项目 / kubernetes / 独立容器** 自动分组，状态点 + 中文配色
- **容器详情**：镜像 / ID / 状态 / 创建时间、端口映射、目录挂载
- **一键操作**：启动 / 停止 / 重启 / 暂停 / 继续 / 删除容器 / **完整删除**（含镜像与卷）
- **重启策略**：动态调整 `no / always / unless-stopped / on-failure`
- **快速访问**：打开宿主机映射目录、浏览器访问映射端口
- **启动命令还原**：根据容器当前参数逆向生成等效 `docker run` 命令

### 📜 实时日志

- 容器实时日志：跟随 / 暂停 / 滚到底部
- **行首时间戳高亮**（支持 ISO / redis `13 Aug 2026` / 斜杠等多种日期格式）
- **compose 项目聚合日志**：点击分组查看整个项目的日志

### 🖥 终端

- **快速终端**：内嵌 xterm 终端，**每容器独立会话保活**（切换容器不中断）
- 本地行编辑、命令面板（镜像常用命令模板 + 历史命令一键复用）
- **打开终端**：跳转系统终端（iTerm2 / Terminal 等）

### 🔍 创建容器

- **多源镜像搜索**：Docker Hub 官方 / 轩辕 / 毫秒，聚合展示 logo / 星 / 拉取量 / 官方标记
- **版本号二级获取**：镜像可用版本列表，输入可搜索筛选
- **快速创建**：容器名 / 端口 / 环境变量 / 目录挂载 / 重启策略
- **创建前预检**：容器名重复、端口占用实时检测
- **后台并行创建**：多镜像同时拉取，进度实时显示，完成后自动选中新容器并高亮

### 🗂 资源管理

- 镜像 / 卷 / 网络列表管理
- **清理垃圾**：`system df` 占用统计、清理未使用 / 全面清理 / 清理卷 / 构建缓存（带警告确认）

### 🔌 连接与设置

- **远程 Docker**：context 选择 + 自定义 `DOCKER_HOST`（弹窗测试连接），默认选中当前默认 context
- **代理配置**：搜索被墙镜像源（如 Docker Hub 官方）
- **Docker 加速器**：动态解析可用镜像加速器，一键生成各平台 `daemon.json` 配置

---

## 🚀 快速开始

### 开发模式

```bash
npm install
npm run dev
```

开发服务器 `http://localhost:5173`，ZTools 加载插件时指向该地址即可热更新调试。

### 构建打包

```bash
npm run build
npm test
```

产物输出到 `dist/`，将 `dist/` 目录打包为插件应用（zip）导入 ZTools。

> ⚠️ 打包时只打包 `dist/` 目录内容，勿打包整个项目根目录。

---

## 📖 使用指南

1. **进入插件**：触发指令 `docker` / `容器` / `容器管理`，或从插件列表打开
2. **管理**：左侧容器列表（分组 / 筛选 / 搜索），右侧详情操作
3. **创建**：头部切到「创建」，搜索镜像 → 填参数 → 创建（后台自动拉取 + 跳转管理查看进度）
4. **终端**：选中容器 → 详情页「快速终端」页签；需要完整 TTY 时点「打开终端」跳系统终端
5. **日志**：「日志」页签实时查看，compose 分组点组头终端图标看项目聚合日志
6. **设置**：工具栏「设置」配置代理 / 生成 Docker 加速器 `daemon.json`

## 🧪 测试

```bash
npm test
```

vitest 单元测试覆盖 docker 命令解析、镜像搜索归一化、日志时间解析、启动命令还原等。

---

## 🛠 技术栈

| 技术 | 用途 |
|------|------|
| Vue 3 + Vite + TypeScript | 界面框架 |
| xterm.js + addon-fit | 内嵌终端 |
| simple-icons | 镜像品牌图标 |
| Node child_process | docker CLI 执行与 JSON 解析 |
| vitest | 单元测试 |

---

## 📁 项目结构

```
├── public/
│   ├── logo.png              # 插件图标（Docker 官方 logo）
│   ├── plugin.json           # 插件配置
│   └── preload/              # Node 能力层（CommonJS）
│       ├── docker.js         # Docker 命令封装（解析/执行/连接）
│       ├── registry.js       # 镜像搜索 / 加速器 / 代理
│       ├── terminals.js      # 系统终端检测与打开
│       └── services.js       # window.services 桥接
├── src/
│   ├── Containers/           # 容器管理界面
│   │   ├── index.vue         # 主页（管理/创建/设置）
│   │   ├── ContainerList.vue # 容器列表（分组/筛选）
│   │   ├── ContainerDetail.vue
│   │   ├── ContainerTerminal.vue  # 内嵌终端（会话池保活）
│   │   ├── ContainerLogs.vue      # 实时日志
│   │   ├── ComposeLogs.vue        # compose 聚合日志
│   │   ├── ImageMarket.vue        # 镜像搜索 + 创建
│   │   ├── ManageResources.vue    # 镜像/卷/网络/清理
│   │   ├── CSelect.vue            # CSS 自定义下拉
│   │   ├── labels.ts / logFormat.ts / imageBadge.ts / shellCommands.ts
│   └── types.ts / env.d.ts
└── tests/                   # vitest 单元测试
```

---

## 🙏 致谢

感谢以下项目与服务的支持：

- **[ZTools](https://github.com/ztool-center/ztools)** — 强大的启动器平台与插件 API
- **[Docker](https://www.docker.com/)** — 容器技术本身；logo 版权归 Docker 所有
- **[轩辕镜像](https://xuanyuan.cloud/)**、**[毫秒镜像](https://1ms.run/)** — 国内可用的 Docker Hub 镜像数据源
- **[Docker Hub](https://hub.docker.com/)** — 官方镜像仓库与 API
- **[simple-icons](https://simpleicons.org/)** — 品牌图标库（CC0）
- **[xterm.js](https://xtermjs.org/)** — 内嵌终端渲染
- **[DockerHub 加速器监控](https://tools.opsnote.top/registry-mirrors/)** — 可用加速器列表
- **[vitest](https://vitest.dev/)**、**[Vue 3](https://vuejs.org/)**、**[Vite](https://vitejs.dev/)** — 开源工具链

---

## 📄 开源协议

MIT © 康康学长
