# Changelog

本项目遵循 [Semantic Versioning](https://semver.org/lang/zh-CN/)。

## 1.0.0 - 2026-08-15

Docker Lite 首个完整版本：可视化 Docker 容器管理插件，覆盖容器全生命周期（查看 / 管理 / 创建）+ 终端 + 日志。

### 新增

**核心容器管理**
- 双栏容器列表：分组展示（compose 项目 / kubernetes / 独立容器），状态点与中文状态配色，搜索与「全部 / 运行中」筛选
- 容器详情：镜像 / ID / 状态 / 创建时间、端口映射、目录挂载、重启策略动态调整
- 快捷操作：启动 / 停止 / 重启 / 暂停 / 继续 / 删除容器 / 完整删除（含镜像与卷），操作前统一 confirm 弹窗确认
- 快速访问：打开宿主机映射目录、浏览器访问本地映射端口、还原 docker run 启动命令

**实时日志**
- 容器实时日志（跟随 / 暂停 / 滚到底部），行首时间戳高亮（支持多种日期格式）
- compose 项目聚合日志，点击分组查看

**终端**
- 内嵌 xterm 终端：每容器独立会话保活（切换容器不中断），本地行编辑、命令面板（镜像常用命令 + 历史捕获）
- 快速终端页签（内嵌）+ 打开终端（跳转系统 iTerm2/Terminal 等）

**创建模块**
- 多源镜像搜索：Docker Hub 官方（支持代理）/ 轩辕 / 毫秒，聚合展示 logo / 星 / 拉取量 / 官方标记
- 镜像版本号二级获取（tags API，可搜索筛选）
- 快速创建容器：容器名 / 端口 / 环境变量 / 目录挂载 / 重启策略，创建前预检名称与端口冲突
- 创建任务后台运行：多镜像并行，进度实时显示，完成后自动选中新容器并高亮

**资源管理**
- 镜像 / 卷 / 网络列表管理（删除）
- 清理垃圾：system df 占用统计、清理未使用 / 全面清理 / 清理卷 / 清理构建缓存（带警告）

**连接与设置**
- 远程 Docker 连接：Docker context 选择 + 自定义 DOCKER_HOST（弹窗测试连接），默认选中当前默认 context
- 代理配置（搜索被墙源）
- Docker 加速器：动态解析可用镜像加速器，生成各平台 daemon.json 配置

**UI / 体验**
- 统一 CSS 体系：自定义下拉（CSelect）、全局按钮、confirm 弹窗，跨平台无系统原生控件
- Docker 官方 logo、simple-icons 品牌图标、k8s/compose 分组图标

### 修复

- Docker CLI 路径探测跨平台（macOS / Linux snap / Windows），解决 GUI 启动 PATH 缺失
- Docker credential helper 找不到（注入扩展 PATH）
- Docker Hub 官方搜索字段解析（repo_name）、TLS/代理连接问题、chunked 响应解码
- 终端提示符累积、会话保活、切换容器消失
- 轮询 diff 更新解决卡顿；加速器失败内置兜底；镜像名/端口预检

### 技术

- Vue 3 + Vite + TypeScript
- xterm.js 内嵌终端、simple-icons 品牌图标
- Node child_process 执行 docker CLI（JSON 解析）
- vitest 单元测试（69 用例）
