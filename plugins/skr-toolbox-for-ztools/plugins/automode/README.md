# AutoMode

AutoMode 是一个面向 Windows 的 ZTools 插件仓库，用于按预设时间自动切换系统深色/浅色主题。

## 仓库作用

这个仓库保存的是 AutoMode 插件的源码、测试和打包产物，当前功能范围聚焦在：

- 定时切换 Windows 系统深色/浅色主题
- 手动一键切换当前主题
- 生成并管理本地计划任务

## 与 ZTools 的关系

AutoMode 运行在 ZTools 插件体系中。

- ZTools 项目地址：https://github.com/ZToolsCenter/ZTools
- ZTools 是一个高性能、可扩展的应用启动器和插件平台，支持 macOS 和 Windows

这个仓库只负责 AutoMode 插件本身，不包含 ZTools 主程序源码。

## 主要文件

- `plugin.json`: 插件清单
- `index.html`: 插件界面
- `preload.js`: 插件预加载脚本，负责计划任务、主题切换和状态读取
- `lib/`: 可测试的纯逻辑模块
- `test/`: Node 内置测试
- `AutoMode.zpx`: 已打包的插件产物

## 开发与打包

本仓库没有 `package.json`，直接在仓库根目录执行命令即可：

```powershell
node --test test\core-shape.test.js test\schedule-ui.test.js test\utils.test.js
node pack.js
```

`node pack.js` 会生成或刷新 `AutoMode.zpx`。
