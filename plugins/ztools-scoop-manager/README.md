# Scoop 包管理器（ztools-scoop-manager）

[ZTools](https://github.com/ZToolsCenter/ZTools) 的 Scoop 图形化管理插件：
已装软件一览、一键更新/卸载、搜索安装、Bucket 管理与缓存清理。
全部走本机 `scoop` 命令，无需注册、无需 API Key，**专为国内网络环境优化——全程无需梯子**。

> 仅支持 Windows。

## 功能

### 五个页签

| 页签 | 能做什么 |
|------|---------|
| **已安装** | 应用列表（名称 / 版本 / 来源 bucket / 更新时间 / 状态标签）、本地筛选；单个应用支持更新、打开主页、打开安装目录、锁定/解锁（锁定后 `scoop update` 跳过）、卸载 |
| **可更新** | 一键检查所有可更新软件，逐个更新或全部更新；「异常包」（清单已移除 / 安装失败）单独分组提示处理 |
| **搜索安装** | 搜索本地已添加的 bucket，未安装的一键安装，实时滚动日志 |
| **Bucket** | 查看已添加 bucket（来源 / 清单数 / 更新时间）、快捷添加常用 bucket、手动添加（支持名称 / git 地址 / 「名称 地址」）、移除 |
| **缓存** | 按应用聚合统计下载缓存占用、清空缓存（`cache rm *`）、清理旧版本（`cleanup *`） |

### 状态标签

已安装列表自动标注：`全局`（Global install）、`已锁定`（Held package）、
`Install failed` / `Manifest removed`（红色异常，建议在「可更新」页处理）。

### 卸载的两档

卸载默认保留持久化数据。按钮点一次进入确认态（状态栏有操作提示）：

- 再点一次「确认?」→ 普通卸载（保留数据）
- **Alt + 点击「确认?」** → 彻底卸载（`scoop uninstall -p`，连数据一起删）

## 无梯子友好：四层国内镜像体系

插件面向所有用户设计，没有代理的机器可以走完全程：

1. **没有 scoop？启动自举**
   启动时自动检测，检测失败进入配置页。一键安装走官方安装脚本 +
   scoop.201704.xyz GitHub 反代（安装器内部所有 GitHub 下载地址自动打镜像前缀），
   强制 TLS 1.2（Windows PowerShell 5.1 默认不开，直连 GitHub 必挂的经典原因），
   管理员权限自动加 `-RunAsAdmin`，直连不通还会自动探测本机代理端口重试。
   也可以手动指定已有的 scoop 位置。
2. **加 bucket 不用梯子**
   快捷添加的 bucket 全部预置国内可直连源（`main` 走 Gitee 镜像，
   `extras` / `versions` / `apps` 走 GitHub 反代），均已实测可用。
3. **没有 git？自动补**
   Scoop 的 bucket 管理硬依赖 git，而新装的 scoop 不带 git。
   添加 bucket 前自动检测，缺就从 npmmirror 的 git-for-windows 国内 CDN
   下载最新稳定版静默安装。
4. **装软件不走 GitHub**
   安装/更新前把 bucket 清单里的 GitHub 下载地址（releases / raw / objects /
   codeload / api）**就地临时改写**为反代地址（原始清单自动备份、装完字节级还原），
   再正常执行安装。镜像代理的是原始文件，hash 校验不受影响；
   非 GitHub 地址（官网、FossHub 等）一律不动。

## 安装使用

1. 在 ZTools 插件市场搜索「Scoop 包管理器」安装；
   或用「ZTools 开发者工具」加载本仓库目录（支持热重载）。
2. `Alt+Z` 唤起 ZTools，输入 `scoop` / `包管理` / `软件管理` / `更新软件` / `卸载软件` 打开。
3. 没装过 scoop 也没关系，首次打开会引导你配置环境。

## 常见问题

**Q: 安装时提示执行策略错误？**
插件起的 PowerShell 自带 `-ExecutionPolicy Bypass`，该告警已被内部消化，不影响使用。

**Q: 安装报 "Hash Check Failed"？**
个别清单可能同步到了错误的文件，可临时用 `scoop install <app> -s` 跳过校验。

**Q: 日志里出现 "Scoop uses 'aria2c' for multi-connection downloads" 警告？**
只是提示。若 aria2 多线程下载出问题，可运行 `scoop config aria2-enabled false` 关闭。

**Q: 之前手动装 scoop 失败过，留下半截目录？**
一键安装会自动把残骸改名（`scoop.bak-时间戳`）让路，不会删除你的文件。

**Q: 卸载了 scoop，插件还能恢复吗？**
能。重新打开插件会进入配置页，点「一键安装」即可重装。

## 实现要点（维护者向）

- **解析不碰表格**：scoop 是 PowerShell 脚本，表格输出列宽随宿主控制台宽度漂移。
  查询命令一律套 `| ConvertTo-Json`（v0.6.0 全部支持），`extractJson` 负责剥掉
  前缀告警（git fatal / WARN 行）。已知坑都注释在代码现场：
  - `scoop --version` 的版本行走 Write-Host 宿主流，管道里反而是 bucket 摘要，
    版本号必须锚定 `v` 前缀、从「数据 + 告警」合并文本里捞；
  - PowerShell 5.1 对空数组管道 `ConvertTo-Json` 输出**空串**（status 全最新 /
    search 无结果 / cache 已清空 / 新装无 git 四种场景都会踩），需 `allowEmpty`；
  - `allowEmpty` 后还必须区分「跑了但空」与「命令不存在」（后者报错在 stderr），
    见 `classifyDetect`；
  - `scoop prefix` 输出裸路径，走纯文本通道。
- **防注入**：应用名 / bucket 名会拼进 `powershell -Command`，
  白名单 `[\w.@-]{1,100}`（覆盖 `7zip@16.04` 这类名），bucket 来源仅放行
  官方短名 / https(s) URL / 盘符路径。
- **清单就地改写**：安装/更新时临时改写 bucket 内清单并备份（`.ztools-bak`），
  finally 里字节级还原。不能把改好的清单放临时目录——清单的 post_install
  会引用 `$bucketsdir\$bucket\...` 相对资源，脱离 bucket 上下文必挂（7zip 实测）。
- **`window.exports` 的 mode 不要写 `'none'`**：宿主会按无界面插件处理导致打不开，
  固定 `'web'`。

## 目录结构

```
├── plugin.json        插件清单
├── preload.js         scoop 命令封装 / JSON 提取 / 输入消毒 / 镜像化安装
├── index.html         五页签界面骨架 + 配置页
├── style.css          主题变量（跟随宿主深浅色）
├── app.js             页面逻辑（页签 / 表格 / 日志抽屉 / 两步确认 / 启动分流）
├── scripts/make_logo.py   生成 logo.png
└── tests/
    ├── run_tests.js   纯函数 + 实机冒烟（node tests/run_tests.js [--live]）
    └── preview.html   浏览器假数据预览（?setup=1 模拟无 scoop 环境）
```

## 开发与测试

```
node tests/run_tests.js          # 纯函数测试（vm 沙箱加载 preload，不需要 scoop）
node tests/run_tests.js --live   # 追加真实 scoop 冒烟（检测/列表/状态/缓存/搜索/清单改写往返等）
```

浏览器看 UI：`python -m http.server 8123` →
`http://127.0.0.1:8123/tests/preview.html`（`?setup=1` 看配置页）。

## 已知限制

- 仅支持 Windows（scoop 本身的限制）。
- 搜索只覆盖本地已添加的 bucket；`scoop search` 的联网远端结果未接入。
- 批量更新（`update *`）不做镜像兜底，个别 GitHub 下载失败的会在日志里显示，
  可到「已安装」页逐个点更新走镜像清单。
- 一键安装的镜像源为社区服务（scoop.201704.xyz），若不可用会自动回退官方源与代理。
