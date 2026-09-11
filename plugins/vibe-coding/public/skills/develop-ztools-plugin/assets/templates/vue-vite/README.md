# {{PLUGIN_TITLE}}

{{DESCRIPTION}}

## 开发

```bash
npm install
npm run dev
```

开发页面默认运行在 `http://localhost:5173`，ZTools 从
`src-ztools/plugin.json` 的 `development.main` 加载该页面。

## 构建

```bash
npm run build
```

构建脚本会完成类型检查和 Vite 页面构建。插件目录是 `src-ztools/`，打包或
压缩插件时应选择该目录，其中包含：

- `plugin.json`
- `logo.png`
- `preload/` 及其 CommonJS 声明
- `dist/` 中的 `index.html` 和前端资源

`src-ztools/plugin.json` 保持 `main: dist/index.html`，因此 `dist/` 只负责承载
页面构建结果，不重复存放清单、Logo 或 preload。

## 真实 ZTools 测试

```bash
npm run test:e2e
```

测试会使用安装版 ZTools 和隔离数据目录加载 `src-ztools/`，验证插件可安装、
页面已真实绘制并保存 WebContentsView 截图。按插件需求继续在
`tests/e2e/plugin.spec.js` 中增加业务断言。

## 结构

```text
src/                       Vue 页面源码
src-ztools/plugin.json     插件清单
src-ztools/preload/        最小 preload 桥接
src-ztools/dist/           Vite 页面构建结果
```

默认生成精简项目。需要保留 Hello、读文件和写文件示例时，在创建项目时传入
`--examples`。
