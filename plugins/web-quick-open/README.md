# 网页快开

网页快开是一个 ZTools 插件，用于管理网页直开入口和搜索引擎快捷入口。

## 功能

- 添加网页入口：输入匹配关键字后，可以在 ZTools 中直接打开固定网页。
- 添加搜索入口：使用 `{q}` 作为搜索词占位符，可以从 ZTools 输入内容后快速搜索。
- 快捷添加搜索渠道：内置百度、必应、Google、哔哩哔哩。
- 图标管理：支持通过图标服务自动获取站点图标，也支持上传本地图片。
- 动态启停：入口启用后会注册为 ZTools 功能，关闭后会移除对应功能。

## 搜索 URL 示例

```text
https://www.baidu.com/s?wd={q}
https://www.bing.com/search?q={q}
https://www.google.com/search?q={q}
https://search.bilibili.com/all?keyword={q}
```

## 开发

```bash
npm install
npm run dev
npm run build
```

构建产物会输出到 `dist`，其中包含插件运行所需的 `plugin.json`、`preload.js`、`logo.png` 和本文档。

