# Node Dashboard - ztools 插件

![Node Dashboard Logo](logo.png)

一个跨平台的 Node.js 环境管理插件，集成在 ztools 中，提供可视化界面与快速指令支持。现已适配 Windows 和 macOS。

## ✨ 主要功能

1.  **Node.js 版本管理**
    - 一键查看本地已安装的所有 Node 版本。
    - 快速切换当前使用的 Node 版本。
    - 浏览并安装远程 LTS 版本。
    - **跨平台支持：** 
        - **Windows**: 基于 `nvm-windows` 实现。
        - **macOS**: 基于 `nvm` 实现（也兼容 `n` 或 `fnm`，只要在 PATH 中）。

2.  **npm 镜像源管理**
    - 内置常用源：npm, yarn, taobao (npmmirror), tencent, cnpm。
    - 一键测试当前源状态并快速切换。

3.  **快速指令系统**
    - `node 18`：快速建议切换至 18.x 版本。
    - `换源 taobao`：无需打开界面，一秒完成 npm 换源。

## 🛠️ 安装要求

### Windows 用户
1.  **nvm-windows**: 必须安装 nvm-windows 才能使用版本管理功能。
2.  **管理员权限**: ztools 建议以管理员身份运行，以确保写入权限。

### macOS 用户
1.  **Node 管理器**: 推荐安装 `nvm`。
2.  **环境配置**: 请确保 `nvm` 指令在 Shell 中可被直接调用（建议在 `.bashrc` 或 `.zshrc` 中配置好环境）。

## 🚀 使用指南

- 输入 `node` 或 `npm` 即可唤起管理面板。
- 侧边栏支持“Node 版本”、“npm 源管理”与“项目管理”切换。
- 所有操作均会有 ztools 系统通知即时反馈。

---
Created with ❤️ for Node.js Developers.
