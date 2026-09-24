# Jenkins Lite (ztools-jenkins)

ZTools 启动器插件 — 轻量级 Jenkins 辅助工具。在 ZTools 主入口搜索 / 命令面板直接访问，支持多实例管理、Folder 下钻、一键构建、构建历史、收藏。

## 技术栈

- **Vue 3** + **TypeScript**（Composition API + `<script setup>`）
- **Vite 6** 构建
- **fflate** 用于打包脚本
- 单元测试：**Vitest** + `@vue/test-utils`
- 类型：`@ztools-center/ztools-api-types`

## 命令

```bash
npm run dev      # vite 本地开发（端口 5180，对应 plugin.json development.main）
npm run build    # vue-tsc 类型检查 + vite 构建 + prepare-package + create-zip
npm run test     # vitest run
```

> **每次改完代码自动跑一次 `npm run build` 验证** —— vue-tsc 会暴露类型错误，vite 构建会暴露模板 / 资源问题，create-zip 会暴露打包脚本问题。任何一步失败都不算改完。

## 核心功能

- **多实例管理**：添加 / 编辑 / 删除多个 Jenkins 实例，配置项（名称、URL、用户名、API Token）；保存前必须测试连接通过
- **Job 树形下钻**：Folder / 组织目录 / 多分支流水线目录可逐级展开；`JobItem.vue` 递归渲染
- **视图筛选**：按 Jenkins 视图过滤 Job
- **搜索**：ZTools 主入口搜索打开会预填 + 自动聚焦；支持嵌套目录
- **收藏**：作为特殊视图项存在；收藏时记录所在视图，跳转时还原
- **一键构建**：带确认弹窗；构建记录写入历史
- **构建历史**：右侧面板（`App.vue` 固定 320px 宽）；点击条目跳转 Jenkins 详情页
- **启动状态恢复**：自动停留上次的实例 + 视图 + 选中的 Job（含嵌套路径）
- **暗黑模式**：跟随 ZTools 主题
- **数据本地持久化**：基于 ZTools `dbStorage`，不上传任何数据

## 项目结构

```
src/
├── App.vue                    # 主布局：Sidebar + 主区（jobs-panel + history-panel）
├── main.ts                    # Vue 入口
├── main.css                   # 全局样式 + CSS 变量（深/浅色主题）
├── env.d.ts                   # 环境声明
├── components/
│   ├── Sidebar.vue            # 左侧栏：实例切换 + 视图导航 + 页脚版本号
│   ├── JobsList.vue           # Job 列表容器（含视图切换 / 搜索 / 收藏过滤）
│   ├── JobItem.vue            # 递归渲染 Folder + Job；树形缩进在这里
│   ├── BuildHistory.vue       # 右侧构建历史面板
│   └── SettingsModal.vue      # 实例配置弹窗
├── composables/
│   ├── useInstances.ts        # 实例 CRUD + 切换 + testConnection
│   ├── useFavorites.ts        # 收藏状态 + 跨视图跳转
│   └── useBuildPolling.ts     # 构建状态轮询
├── types/                     # TypeScript 类型定义
├── utils/                     # 通用工具
├── i18n/                      # 国际化文案
└── dev/                       # 开发期辅助
```

## 版本号同步约定

每次升版本必须**全量**更新以下 4 处，否则会出现页脚显示旧版本：

| 文件 | 字段 |
|---|---|
| `package.json` | `"version"` |
| `plugin.json` | `"version"` |
| `public/plugin.json` | `"version"` |
| `src/components/Sidebar.vue:100` | `const version = '...'`（页脚"开源 vX.X.X"渲染源） |

**检查命令**（项目根执行）：
```bash
grep -rn 'X\.Y\.0' --include='*.ts' --include='*.vue' --include='*.json' --include='*.md' \
  --exclude-dir=node_modules --exclude-dir=dist
```
（CHANGELOG.md 历史条目里的旧版本号是发布记录，不要改。）

## 发布流程

1. 更新 4 处版本号（见上表）
2. 在 `CHANGELOG.md` 顶部加新版本条目，原"最新"标记下移
3. `npm run build` 通过后 `git commit -m "chore: 版本号升至 vX.Y.Z"`
4. 创建 annotated tag：`git tag -a vX.Y.Z -m "vX.Y.Z: <一句话概括>"`
5. 推送：`git push origin master --follow-tags`

`ztools-last-publish` tag 由发布工作流维护，不要手动改。

## UI 约定

- **无 emoji**：UI 内禁止出现 ⭐ ✅ 等 emoji，统一用 CSS mask / 边框三角形等绘制图标
- **CSS mask 图标**：`.star-icon`、`.github-icon`、`.play-icon`、`.folder-arrow`（展开/收起）
- **长名称 hover 全名**：通过原生 `title="..."` 属性实现（无需额外组件）
- **布局**：左 Sidebar `200px` + 中 `flex:1` + 右 history `320px`，要扩中间区先收右栏
- **行高**：Job 列表每行紧凑（padding 5px 12px），树缩进 `margin-left: 10px`

## 快捷指令（plugin.json features[].cmds）

- `jenkins` / `Jenkins` / `j` / `jl` — 打开插件
- `构建` / `build` — 触发构建
- `jenkins收藏` / `jenkins-fav` — 收藏视图
