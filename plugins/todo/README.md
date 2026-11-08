# 待办事项

简单的待办清单插件：只分为「待处理」和「已完成」两个分组，任务勾选完成后自动移入
已完成，取消勾选则自动回到待处理。

## 功能

- 双分组侧边栏：待处理 / 已完成，各自显示实时计数，点击切换。
- 底部输入框新建任务（Enter 或「添加」按钮），新任务始终进入待处理分组。
- 勾选复选框：待处理 → 自动进入已完成；取消勾选自动移回待处理。
- 双击任务或按 `Enter` / `i` 编辑文本，`Esc` 取消编辑。
- 悬浮删除按钮与 `dd` / `Delete` 快速删除。
- 搜索框按关键字过滤当前分组。
- 设置面板（`?` 打开、`Esc` 关闭）：渲染 Markdown、显示创建时间、两段确认清空已完成。
- 全部数据与设置通过 `ztools.dbStorage` 持久化，重进插件后自动恢复。

## Vim 快捷键

| 操作 | 按键 |
| --- | --- |
| 上一个 / 下一个任务 | `k` `↑` / `j` `↓` |
| 上一个 / 下一个分组 | `h` `←` / `l` `→` |
| 完成 / 取消完成 | `Space` |
| 编辑任务 | `Enter` / `i` |
| 新建任务 | `Tab` / `Ctrl + N` |
| 搜索待办 | `/` |
| 删除任务 | `dd` / `Delete` |
| 跳到顶部 / 底部 | `gg` / `G` |
| 打开设置 / 关闭设置 | `?` / `Esc` |

## 开发

```bash
npm install
npm run dev
```

开发页面运行在 `http://localhost:5173`，ZTools 从 `src-ztools/plugin.json` 的
`development.main` 加载；宿主不可用时页面回退到 localStorage 预览。

## 构建与校验

```bash
npm run build
python <skill-dir>/scripts/validate_plugin.py src-ztools
```

插件目录是 `src-ztools/`，包含 `plugin.json`、`logo.png`（源图标 `logo.svg`）、
`preload/` 以及 `dist/` 中的页面构建结果。

## 真实 ZTools 测试

```bash
npm run test:e2e
```

测试使用安装版 ZTools 和隔离数据目录，覆盖：安装启动、页面绘制、新建任务、
勾选自动分组、取消勾选回移、设置面板与 Markdown 开关、两段式清空已完成、
页面重载后的数据与设置持久化，并保存插件视图截图。

## 结构

```text
src/App.vue               主界面与 Vim 快捷键逻辑
src/components/           分组侧边栏、设置面板
src/todo/                 类型、存储（dbStorage）、Markdown 渲染
src-ztools/plugin.json    插件清单
src-ztools/preload/       最小 preload 桥接
src-ztools/dist/          Vite 页面构建结果
tests/e2e/plugin.spec.js  真实 Electron 端到端测试
```
