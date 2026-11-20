# 进程管家（process-killer）

ZTools 插件（ID `process-killer`）：搜索进程名或端口，查看 CPU、内存与端口占用，关闭、强制结束或重启进程。支持 macOS 与 Windows。

在 ZTools 里输入 `kill`、`关闭进程`、`进程管理`、`进程管家`、`netstat`、`端口占用` 即可打开。

## 功能

- 列出进程及其 CPU、内存、监听端口，按内存 / CPU / 名称 / 端口排序
- 搜索进程名、路径、PID 或端口号
- 关闭（先温和退出，3 秒未退提示可强制结束）、强制结束、重启 .app / .exe、复制路径、文件夹中显示、查看完整启动命令
- 关闭前弹确认框，确认后才真正结束进程
- 自动 / 手动刷新开关
- 主搜索框直接推结果：输入 `kill chrome` 或 `netstat 8080` 即列出，回车关闭

## 目录结构

本仓库按 [ZToolsCenter/ZTools-plugins](https://github.com/ZToolsCenter/ZTools-plugins) 的目录约定组织，插件 ID 为 `process-killer`：

```text
src-ztools/
├── build-plugin.sh    官方 CI 的构建钩子：跑 npm run build
└── ztools/            插件目录（提交在仓库里，清单所在目录 = 安装包内容）
    ├── plugin.json    清单（name / title / version / main / preload / platform …）
    ├── logo.png       图标
    ├── index.html     界面入口
    ├── main.js / style.css
    └── preload/       Node 侧采集与操作
```

发布 CLI 会把整个工程目录复制成仓库里的 `plugins/process-killer/`，但它复制时会**跳过所有名为 `dist` 的目录**，所以运行时代码放在 `src-ztools/ztools/`；本地构建输出的 `dist/` 是安装包内容，不提交（已在 `.gitignore` 里）。

官方 CI 没有 `build-plugin.sh` 时，会把 `src-ztools/` 整份打成安装包；有钩子则先执行构建。两条路径都能拿到正确的安装包结构，

## 本地开发

Node.js >= 20（本机用 nvm 的 v20.19.5）。

```sh
npm run build     # 把 src-ztools/ztools 整理成 dist/（安装包内容），并核对清单声明的文件
npm run package   # 另外输出 releases/process-killer-<版本>.zip
npm test          # 单元测试
npm run test:ui   # Chrome 里跑一遍界面，需要 playwright 与本机 Chrome
```

ZTools 开发者工具里的开发模式添加 `src-ztools/ztools/plugin.json` 即可加载本工程。

## 发布

```sh
ztools publish
```

本机已安装 `@ztools-center/plugin-cli`（`~/.nvm/versions/node/v14.21.3/bin/ztools`），token 存在 `~/.config/ztools/cli-config.json`。发布前需要：`plugin.json` 的 version 已升、`CHANGELOG.md` 有对应 `## 版本 - 日期` 段落、工作区干净。

## 注意

- CPU 取自 `ps` / CIM 的累计百分比，不是瞬时值，与活动监视器口径不同。
- `lsof`（macOS）/ `netstat`（Windows）看不到无权限用户进程的端口，界面会提示。
- 只能重启应用包（.app / .exe）；命令行程序直接启动会丢环境变量，故明确报错。
- 关闭系统进程需要更高权限，插件不做提权。
