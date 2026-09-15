# ztools-plugin-zdic-search

接入[汉典](https://zdic.net)在线查询汉字、词语释义的 ZTools 插件。

基于 Vue 3 + Vite + TypeScript 构建，使用 Electron `<webview>` 嵌入汉典网页。

## 功能

- **汉典首页** - 触发指令：`汉典` / `hd`，打开汉典首页
- **汉典查询** - 任意文本 → `汉典查询`（over 全局匹配），直接进入词条页

## 交互说明

- 插件子输入框中输入汉字或词语，防抖 800ms 后自动查询
- 词条直达（`/hans/<词>`）失败时自动降级到搜索页（`/search/?q=<词>`），同一查询词会记住降级结果
- 网络失败时显示错误面板，可一键重试

## 开发

```bash
pnpm install
pnpm run dev    # 开发服务器 localhost:5173
pnpm run build  # 构建产物输出到 dist/（dev 环境产物，供 ZTools 加载调试）
```

## 版本历史

- **0.3.0** - 适配官方 ZTools v3.x：移除对个人魔改版 API（`onPluginKeyDown`）及 webview 内键盘注入、标题信号等魔法操作的依赖，仅保留官方原生 API（子输入框交互 + webview 导航）
- **0.2.1** - 魔改版热键支持（已随 0.3.0 移除）
- **0.2.0** - webview 内热键注入、自定义滚动条、hans 重定向、防抖
- **0.1.0** - 初始版本

## 目录结构

```
.
├── public/
│   ├── logo.png           # 插件图标
│   ├── plugin.json        # 插件配置
│   └── preload/           # Preload 脚本（当前为空实现）
├── src/
│   ├── main.ts            # 入口
│   ├── main.css           # 全局样式
│   ├── App.vue            # 根组件（webview + 子输入框逻辑）
│   └── env.d.ts           # 类型声明
├── index.html
├── vite.config.js
└── package.json
```

## 相关资源

- [ZTools 官方文档](https://ztoolscenter.github.io/ZTools-doc/)
- [ZTools API 文档](https://ztoolscenter.github.io/ZTools-doc/plugin-api.html)

## 开源协议

MIT License
