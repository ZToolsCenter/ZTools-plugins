# 网盘链接速开（ZTools 插件）

在 ZTools 主窗口**粘贴网盘等链接**，推荐区直接出现「**打开 XX App**」。命中**百度网盘/夸克**时：直接 `spawn` 启动你电脑里已安装的本地客户端。未安装本地 App 的规则自动回退浏览器打开。

> v1.5.0：百度/夸克图标已 base64 预置进插件，mainPush 响应**毫秒级**（不再调用 PowerShell 抽图标）。

## 支持

| App | 识别域名 |
|-----|---------|
| 📦 百度网盘 | `pan.baidu.com` |
| 🌀 夸克网盘 | `pan.quark.cn` |
| 🌌 阿里云盘 | `alipan.com` / `aliyundrive.com` |
| 🔵 UC 网盘 | `drive.uc.cn` |
| ☁️ 天翼云盘 | `cloud.189.cn` |
| 🔶 115 网盘 | `115.com` / `115cdn.com` |
| ⚡ 迅雷云盘 | `pan.xunlei.com` |
| 🟩 123 云盘 | `123pan.com` |
| 📺 哔哩哔哩 | `bilibili.com` / `b23.tv` |

## 用法

- **主窗口（推荐）**：ZTools 搜索框直接粘贴链接（如 `https://pan.baidu.com/s/xxx`）→ 推荐区出现「打开 百度网盘」→ 回车/点击
- **选中文字**：网页里选中链接 → 长按悬浮球 → 超级面板 → 「网盘链接速开」
- **搜索框命令**：输入 `打开链接` 后粘贴链接

## 原理

利用 ZTools 的 `mainPush` 机制监听主窗口输入，解析 URL 域名并匹配 `RULES`。命中后返回「打开 XX App」候选项，候选项的 icon 是**本地 app 的真实图标**（base64 预置，零 IO）。

打开动作：
1. 按 `RULES` 里的 `exe` 路径候选探测存在性（结果内存缓存，不重复 IO）
2. 命中即 `spawn` 拉起本地客户端（百度/夸克客户端启动/聚焦后自动检测剪贴板/URL 关联）
3. 兜底：未找到本地 App 时用 `shellOpenExternal` 回退浏览器

## 添加/配置本地 App

编辑 `preload.js` 顶部 `RULES`。`exe` 数组是本地安装路径候选（自动探测，第一个存在的被使用）；想用真实图标可以抽一次 exe 图标后把 base64 加进 `ICON_DATA` 并配 `iconKey`：

```js
{ name: 'XX网盘', emoji: '🧩', hosts: ['pan.xx.com'], exe: ['C:\\Program Files\\XX\\xx.exe'] },
```

## 安装

1. ZTools → 设置 → 插件 → 右上角「更多」→ **导入本地插件**
2. 选择 `url-to-app-1.5.0.zip`
3. 预览页点 **安装插件** → 安全警告点 **已知风险，继续安装**

## 文件说明

| 文件 | 作用 |
|------|------|
| `plugin.json` | 插件清单：open（list 模式 + mainPush） |
| `preload.js` | 识别规则 + 预置图标 + 主窗口联想 + 打开动作 |
| `index.html` | 占位页 |
| `logo.png` | 插件图标 |

## 已知限制

- 百度/夸克客户端是否自动弹「打开分享」取决于客户端本身的 URL/剪贴板检测；若未弹，App 打开后手动粘贴链接即可
- 仅百度网盘/夸克网盘配置了本地 App 启动；其余网盘规则未装本地客户端时回退浏览器
- 仅识别 `http(s)://` 链接；短链（如 `b23.tv`）按规则表直接匹配对应 App

作者：一个成熟的剪辑猿
