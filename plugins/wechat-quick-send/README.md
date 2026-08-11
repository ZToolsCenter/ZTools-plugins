<div align="center">

![Logo](public/logo.png)

# 微信速发

适配 [ZTools](https://github.com/ZToolsCenter/ZTools) 的微信快捷发送插件

</div>

---

[更新日志](./CHANGELOG.md)

---

## 功能一览

在 ZTools 搜索框中输入任意文本或拖入文件，一键唤起微信并粘贴到输入框，省去手动切换窗口的繁琐操作。

### 文本速发
- 在 ZTools 搜索框输入任意文本
- 选中下方出现的「发送到微信」
- 自动打开微信窗口并将文本粘贴到输入框

### 文件速发
- 将文件拖入 ZTools 搜索框
- 选中「发送文件到微信」
- 自动打开微信窗口，文件进入传输状态

## 快速开始

### 安装

- ZTools 插件市场搜索 **微信速发**，点击安装
- 或下载 Release 文件，在 ZTools 搜索框完成导入

### 开发

```bash
npm install
npm run dev      # 启动开发服务器
npm run build    # 构建生产版本
```

### 触发方式

在 ZTools 中输入任意文本或拖入文件，即可看到发送选项：

`任意文本` · `拖拽文件`

## 指令说明

| 指令 | 类型 | 说明 |
|------|------|------|
| 任意文本 | over | 输入任意文字后选择「发送到微信」 |
| 拖拽文件 | files | 拖入文件后选择「发送文件到微信」 |

## 技术细节

<details>
<summary><b>工作原理</b></summary>

插件通过 ZTools 的 preload 机制调用系统级键盘模拟：

1. 用户触发插件（输入文本 / 拖入文件）
2. Preload 脚本将内容或文件写入系统剪贴板
3. 通过 PowerShell `SendKeys` 模拟 `Ctrl+Alt+W` 唤起微信
4. 等待微信窗口就绪后模拟 `Ctrl+V` 粘贴内容

全程无界面（`mainHide` 模式），执行完毕自动退出。

</details>

<details>
<summary><b>跨平台适配</b></summary>

| 平台 | 键盘模拟 | 文件剪贴板 |
|------|----------|------------|
| Windows | `cscript` + VBScript（SendKeys） | `ztools.copyFile` / PowerShell |
| macOS | `osascript` + AppleScript（直接 activate 微信） | `osascript` Finder clipboard |
| Linux | `xdotool`（需安装） | `xclip`（需安装） |

macOS 下不依赖快捷键，直接通过 AppleScript 激活微信应用，更稳定可靠。

</details>

## 项目结构

```
├── public/
│   ├── plugin.json               # ZTools 插件配置
│   ├── logo.png                  # 插件图标
│   └── preload/
│       ├── package.json
│       └── services.js           # 核心逻辑：键盘模拟 + 剪贴板
├── src/
│   ├── App.vue                   # 根组件（无界面入口）
│   ├── main.ts                   # 应用入口
│   ├── main.css                  # 全局样式
│   └── env.d.ts                  # 类型定义
├── index.html
├── vite.config.js
├── tsconfig.json
├── package.json
├── CHANGELOG.md
└── README.md
```

## 开源协议

[GPLv3](./LICENSE)

---