# 剪贴板图片涂改

把剪贴板里的图片以**无边框、置顶的悬浮窗**显示，并用画笔、形状、马赛克、文字进行**就地标注**，可一键**保存为 PNG** 或**回写到剪贴板**。本插件不含任何人工，不保证后续更新与bug修复，请注意。

## ✨ 功能

- 🖼️ **多种触发方式**
  - **打开 ZTools、剪贴板里有图片** → 主搜索结果里直接出现两个选项
    - 📝 涂改剪贴板里的图片
    - 💾 保存剪贴板里的图片到本地
  - **粘贴图片到 ZTools 搜索框** → 同时出现「涂改」和「保存」两个选项
  - **粘贴图片文件**（png/jpg/jpeg/gif/bmp/webp）→ 同时出现「涂改」和「另存为」两个选项
  - **文本指令**
    - `图片涂改` / `悬浮涂改` / `image-paint` → 涂改剪贴板里的图片
    - `保存剪贴板图片` / `保存图片` / `save-image` → 直接保存剪贴板图片
- 🎨 **丰富的标注工具**：画笔、荧光笔、矩形、椭圆、箭头、文字、马赛克、橡皮擦
- 🌈 10 种预设颜色 + 5 档画笔粗细
- ↩️ 撤销 / 重做 / 一键清除全部标注
- 💾 **保存为 PNG**（系统对话框选择路径）
- 📋 **复制到剪贴板**（直接粘贴到聊天工具）
- 🪟 **无边框、置顶、可拖拽**，右下角拖拽改变窗口大小
- ⌨️ 全键盘快捷键

## ⌨️ 快捷键


| 操作                                      | Windows / Linux                 | macOS                     |
| --------------------------------------- | ------------------------------- | ------------------------- |
| 撤销                                      | `Ctrl + Z`                      | `⌘ + Z`                   |
| 重做                                      | `Ctrl + Y` / `Ctrl + Shift + Z` | `⌘ + Y` / `⌘ + Shift + Z` |
| 保存                                      | `Ctrl + S`                      | `⌘ + S`                   |
| 复制                                      | `Ctrl + C`                      | `⌘ + C`                   |
| 关闭                                      | `Esc`                           | `Esc`                     |
| 画笔 / 荧光笔 / 矩形 / 椭圆 / 箭头 / 文字 / 马赛克 / 橡皮 | `B / H / R / O / A / T / M / E` | 同上                        |
| 改变画笔粗细                                  | 滚轮                              | 滚轮                        |
| 改变窗口透明度                                 | `Ctrl + 滚轮`                     | `⌘ + 滚轮`                  |


## 📦 安装

### 方式一：开发者直接加载（推荐）

1. 准备好本目录所有文件（确保 `logo.png` 已经放进来——见下方"准备 logo"）：
  ```text
   clipboard-image-paintbrush/
   ├── plugin.json
   ├── preload.js
   ├── floater-preload.js
   ├── floater.html
   ├── floater.css
   ├── floater.js
   ├── logo.png
   └── README.md
  ```
2. 打开 ZTools → 设置 → 开发者 → 「加载本地插件」→ 选择本目录。
3. 在 ZTools 主面板输入 `图片涂改` 或粘贴图片即可看到本插件。

### 方式二：打包提交到插件市场

```bash
# 全局安装 CLI
npm i -g @ztools-center/plugin-cli

# 在本目录初始化 git
git init && git add . && git commit -m "init"

# 发布到 ZTools-plugins 仓库（首次会自动 fork + OAuth）
ztools publish
```

## 🖼️ 准备 logo

本仓库已经自带一张默认 logo（如果你拿到的工程里没有 `logo.png`，可参考下面任一方式补一个）：

- 自己提供一张 256×256 或更大的 PNG，命名为 `logo.png` 放到工程根目录即可。
- 也可以临时用任意正方形 PNG 替代，ZTools 不强校验内容。

## 🛠️ 工作机制

```text
┌──────────────────────────┐         ┌─────────────────────────────┐
│   ZTools 主面板搜索结果     │         │   悬浮涂改窗口（浮窗）         │
│   触发后调用 enter()      │ create  │   - 无边框、置顶、透明        │
│   读取剪贴板/payload       │  ───►   │   - 双 Canvas 分层渲染        │
│   创建子 BrowserWindow    │         │   - 工具栏 + 画布 + 文字层    │
└──────────────┬───────────┘         └────────────┬────────────────┘
               │                                  │
               │  ipcRenderer.sendTo / on         │  ztools.sendToParent
               │ (move / resize / opacity)        │
               ▼                                  ▼
        通过 electron.ipc 父子互通       通过 ztools API 完成保存/复制
```

- **数据传递**：父窗口把图片 base64 写入 `localStorage`，子窗口读取后即清除，避免 URL 长度限制。
- **保存**：子窗口里通过 `floater-preload.js` 提供的 `ztools.showSaveDialog` + Node `fs.writeFileSync` 写入 PNG。
- **复制**：调用 `ztools.copyImage(dataUrl)`。
- **窗口控制**：子窗口想要改变自己的尺寸 / 位置 / 透明度时，通过 `ztools.sendToParent` 发回主 preload，由主 preload 调用 `BrowserWindow` 的实例方法实现。

## 🤓 文件说明


| 文件                   | 作用                                                      |
| -------------------- | ------------------------------------------------------- |
| `plugin.json`        | 插件元数据 & 7 个 feature（text / img / files / over+mainPush） |
| `preload.js`         | 主 preload：读剪贴板、保存文件、创建悬浮子窗、注册 onMainPush                |
| `floater-preload.js` | 子窗口 preload：暴露保存/复制/父子通信 API                            |
| `floater.html`       | 悬浮窗 UI 结构                                               |
| `floater.css`        | 悬浮窗样式                                                   |
| `floater.js`         | 涂改主逻辑（双 Canvas、形状、文字、撤销栈、快捷键）                           |
| `logo.png`           | 插件图标                                                    |


## 🧭 7 个 feature 一览


| code                 | 触发方式                                      | 作用                      |
| -------------------- | ----------------------------------------- | ----------------------- |
| `annotate-clipboard` | 文本：`图片涂改` / `悬浮涂改` / `image-paint`        | 涂改剪贴板里的图片               |
| `save-clipboard`     | 文本：`保存剪贴板图片` / `保存图片` / `save-image`      | 直接保存剪贴板图片               |
| `annotate-img`       | `cmds.type: "img"` —— 粘贴图片到搜索框            | 显示「📝 涂改这张图片」           |
| `save-img`           | `cmds.type: "img"` —— 粘贴图片到搜索框            | 显示「💾 保存图片到本地」          |
| `annotate-files`     | `cmds.type: "files"` —— 粘贴图片文件            | 显示「📝 涂改图片文件」           |
| `save-files`         | `cmds.type: "files"` —— 粘贴图片文件            | 显示「💾 另存为...」           |
| `clipboard-detect`   | `cmds.type: "over"` + `mainPush` —— 搜索框输入 | 剪贴板有图就主动推送「涂改 + 保存」两条结果 |


> `clipboard-detect` 使用 `onMainPush`，所以**用户只要在搜索框输入任意短字符**（或空），插件就会主动检测剪贴板，并在结果列表里推送两条快捷操作；不需要进入插件 UI，直接选中即可保存或开始涂改。

## 📝 License

MIT