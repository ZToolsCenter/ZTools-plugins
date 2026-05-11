# Node Dashboard - ztools 插件

![Node Dashboard Logo](logo.png)

一个专为 Windows 开发者设计的 Node.js 环境管理插件，集成在 ztools 中，提供可视化界面与快速指令支持。

## ✨ 主要功能

1.  **Node.js 版本管理**
    - 一键查看本地已安装的所有 Node 版本。
    - 快速切换当前使用的 Node 版本。
    - 浏览并安装远程 LTS 版本。
    - **依赖：** 该功能基于 `nvm-windows` 实现。

2.  **npm 镜像源管理**
    - 内置常用源：npm, yarn, taobao (npmmirror), tencent, cnpm。
    - 一键测试当前源状态并快速切换。

3.  **快速指令系统**
    - `node 18`：直接跳转并建议切换至 18.x 版本。
    - `换源 taobao`：无需打开界面，一秒完成 npm 换源。

## 🛠️ 安装要求

1.  **nvm-windows**: 必须在系统中安装 nvm 才能使用版本管理功能。
2.  **管理员权限**: ztools 需要以管理员身份运行，否则 `nvm use` 指令可能因权限不足而失效。

## 🚀 使用指南

- 输入 `node` 或 `npm` 即可唤起管理面板。
- 侧边栏支持“Node 版本”与“npm 源管理”平滑切换。
- 所有操作均会有 ztools 系统通知即时反馈。

---
Created with ❤️ for Node.js Developers.
