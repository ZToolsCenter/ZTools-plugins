# 网页快开

网页快开是一个 ZTools 插件，用于管理网页直开入口和搜索引擎快捷入口。

## 功能

- 添加网页入口：输入匹配关键字后，可以在 ZTools 中直接打开固定网页。
- 添加搜索入口：使用 `{q}` 作为搜索词占位符，可以从 ZTools 输入内容后快速搜索。
- 快捷添加搜索渠道：内置百度、必应、Google、哔哩哔哩。
- 图标管理：本地站点与远端图标服务并发获取图标，整体限时 5 秒，也支持上传本地图片。
- 分组管理：支持新增、重命名和删除分组。
- 浏览器配置：支持默认浏览器或指定浏览器，配置可复用，提供三平台预设和图标管理。
- 导入导出：支持 JSON 配置文件，包含入口、分组和浏览器配置，兼容旧版数据。
- 动态启停：入口启用后会注册为 ZTools 功能，关闭后会移除对应功能。

## 搜索 URL 示例

```text
https://www.baidu.com/s?wd={q}
https://www.bing.com/search?q={q}
https://www.google.com/search?q={q}
https://search.bilibili.com/all?keyword={q}
```

## 使用说明

- 网络请求跟随 ZTools 的系统或自定义代理，浏览器预设不代表本机已安装对应程序。
- 自动获取网页图标会向 `fav.lee.cm` 发送站点域名与端口；不希望使用第三方服务时可上传图片。
- 在 ZTools 调试控制台启用收集，选择 DEBUG 并搜索 `WebQuickOpen`，可查看插件日志。

## 开发

```bash
npm install
npm run dev
npm run build
```

构建产物会输出到 `dist`，其中包含插件运行所需的 `plugin.json`、`preload.js`、`logo.png` 和本文档。

浏览器图标来自 [alrra/browser-logos](https://github.com/alrra/browser-logos)，商标归各浏览器厂商所有
