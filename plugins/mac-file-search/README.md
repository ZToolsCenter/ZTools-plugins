# ztools-mac-file-search

一个面向 macOS 的 ZTools 本地文件搜索插件项目。

## 功能

- `find / 文件搜索 / 搜索文件` 触发插件
- 使用 `mdfind` 搜索本地文件和文件夹
- 支持搜索语法：
  - `"精确词"` 精确匹配
  - `*通配*` 自定义通配
  - `-排除词` 排除匹配
- 支持“选择目录”后仅在该目录内搜索
- 支持主搜索 `mainPush` 快速返回文件结果
- 支持打开文件、在 Finder 中定位、复制路径

## 项目结构

- `plugin.json` 插件配置
- `preload.js` 搜索核心逻辑（Node.js + ZTools API）
- `index.html` / `app.js` / `styles.css` UI
- `logo.png` 插件图标

## 使用

1. 安装依赖（仅用于类型提示）

```bash
npm install
```

2. 构建可打包目录

```bash
npm run build
```

3. 将 `dist/` 目录作为插件目录导入 ZTools。

## 参考

- ZTools 开发文档：
  - https://ztoolscenter.github.io/ZTools-doc/first-plugin.html
  - 以及侧边栏的 `快速开始 / 插件目录结构 / plugin.json / preload.js / Node.js / 插件 API`
- 参考实现：`mverything-plus`（uTools）

