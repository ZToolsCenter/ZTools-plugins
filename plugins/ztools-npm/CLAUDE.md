# Npm Lite (ztools-npm)

一款面向前端与 Node.js 开发者的 ZTools 插件，集成 npm 包检索、安装指令复制、以及本地全局包管理 / Node 版本管理。

## 命令

```bash
npm install          # 安装依赖
npm run dev          # 开发模式（ZTools 自动加载 http://localhost:5173）
npm run build        # vue-tsc 类型检查 + vite build + zip 打包 → dist/dist.zip
npm test             # 单元 + 组件测试
```

## 构建产物

`npm run build` 产出 `dist/` 目录与 `dist.zip`。安装到 ZTools：

```bash
unzip dist.zip -d <ZTools 插件目录>/ztools-npm/
```

## 架构

```
index.html              入口
preload.js              主进程 preload 服务（CommonJS，非打包）
plugin.json             插件清单（version 在此声明）
public/plugin.json      Vite 输入，与根 plugin.json 保持一致
src/
  App.vue               路由（NpmUi / NpmQuick）
  NpmUi/index.vue       主面板：创建/管理 双模式
  NpmSettings/          设置弹窗
  lib/                  纯函数（搜索解析/版本标签/命令构建/markdown/主题/缓存）
  env.d.ts              window.services 及 ztools API 类型声明
tests/                  单元 / 组件测试
```

## 关键约定

- **版本号三处同步**：`plugin.json`、`package.json`、以及 `src/NpmUi/index.vue` 里的 `PLUGIN_VERSION` 常量（顶部「开源 vX」链接用）。
- **preload.js 用 CommonJS**，通过 `execFile` 跑 npm / nvm 子进程；所有 npm 调用都带 `SHELL_ENV`（增强 PATH + HOME/NVM_DIR 兜底）。
- **npm 子进程必须带 `--prefix`**：nvm 的 shim 在 Electron 渲染进程里会解析错误 prefix，返回 `{"name":"lib"}` 退化输出。见 `npmPathsForVersion`。
- **当前全局 Node 检测**按优先级：`~/.nvm/current` 符号链接 → `~/.nvm/alias/default`（支持大版本别名如 `22`、`lts/iron`）→ `shell -lc 'source nvm.sh && node -p version'` → `which node` 兜底。
- 全局包列表默认隐藏包管理工具（npm/npx/yarn/pnpm/corepack），可点击「含 N 工具」展开。
- 管理模式：左 Node 版本（点击切换）、右该版本的全局包（更新/卸载/跨版本复制到另一版本，支持淘宝镜像）。

## 快捷键（创建模式）

| 键 | 作用 |
|---|---|
| `↑/↓` | 列表内移动 |
| `←/→` | 切换数据源 Tab |
| `Enter`/`c` | 进入版本列表 / 打开复制菜单 |
| `n`/`p`/`y` | 复制 npm/pnpm/yarn install |
| `Shift+N/P/Y` | 全局安装（需二次确认） |
| `r` | 切到右侧使用指南 |
| `Esc` | 返回 / 退出 |
| `Cmd/Ctrl+K` | 帮助 |

## 开源

- MIT License
- 仓库：https://github.com/kshq1996/ztools-npm
