# local-search-neo

借助 Everything 进行本地文件搜索、分类浏览和快速预览的 ZTools 插件。

> 项目地址：[https://github.com/guopenghui/local-search-neo](https://github.com/guopenghui/local-search-neo)  
> 如有任何 Bug 或功能请求，欢迎提 [Issue](https://github.com/guopenghui/local-search-neo/issues)。

> [!TIP]
> 推荐使用本地安装版 everything
>
> 插件会自带内置的 everything，但是这会使得每次插件第一次启动时，需要重新启动 everything，读取和初始化数据库。
>
> 使用本地安装 everything，并设置开机自启，进程会长期存在。每次打开插件时可以直接读取数据库。

## 界面

![界面](https://raw.githubusercontent.com/guopenghui/local-search-neo/refs/heads/master/public/demo.png)

## 功能

### 文件搜索

- 使用 Everything 搜索本地文件和文件夹。
- 支持 Everything 查询语法，可直接输入关键词或规则。
- 支持按分类快速过滤：全部、文件夹、Office 文档、PDF、图片、视频、音频、压缩文件等。
- 支持自定义分类规则。
- 支持按名称、路径、大小、修改时间排序。

### 结果操作

- 打开文件或文件夹。
- 打开所在目录。
- 复制完整路径。
- 复制所在目录路径。
- 复制文件到系统剪贴板。
- 删除文件到回收站。
- 支持拖动文件到外部和其他软件
- 支持多选，批量打开和删除

### 文件预览

- 文本预览：支持常见文本、日志、配置文件。
- 代码预览：支持渲染常见语言的代码。
- Markdown预览：支持渲染。
- PDF 预览。
- 图片预览：支持常见图片格式，右键可复制图片。
- 视频预览。
- 音频预览：选中时直接播放。
- 文件夹预览：以 tree 格式速览文件夹内部结构。
- 压缩包预览：以 tree 格式速览 `.zip` 和 tar 系压缩包（`.tar`、`.tar.gz`、`.tgz`）内部结构；。

### ZTools 集成

- 支持主搜索面板 `mainPush` 快速返回搜索结果。
- 注册 MCP Tool，可供外部 agent 调用 everything search 功能

### 设置项

- 开启路径匹配功能，同时匹配路径和文件名（文件名和路径片段用空格分隔）
- 添加自定义分组规则

## 运行要求

- Windows
- 已安装并运行 Everything 1.4+ (建议）

## 开发

### 前提条件

- Node 已安装
- Rust 工具链已安装
- Window 平台

### 安装依赖

```bash
npm install
```

### 启动开发模式

```bash
npm run dev
```

`dev` 前会自动编译 release addon，并复制到 `public/addon.node`。

addon 始终使用 release 构建，以保证性能测试和实际运行一致。

### 构建

```bash
npm run build
```

`build` 前会自动编译 release addon，并复制到 `public/addon.node`。
Vite 最后会把它复制到 `dist/addon.node`。

### 常用检查

```bash
npm run lint
npm run format:check
npm test
npx vue-tsc --noEmit
npm --prefix addon test
```

### addon 调试

```bash
npm run build:addon
npm run test:everything-addon -- --query "*.exe" --max-results 3
node scripts/benchmark-everything-addon.cjs
```

`test:everything-addon` 会直接 require `addon/index.node`，验证 addon 导出、Everything 状态、版本信息和查询结果。

### 项目结构

```text
.
├── addon/                  # Neon / Rust addon
│   ├── src/                # Everything、文本预览、目录/压缩包树等原生能力
│   └── index.d.ts          # addon 导出类型
├── public/
│   ├── everything/         # 内置的 Everything.exe 二进制及配置文件 Everything.ini
│   ├── plugin.json         # ZTools 插件配置
│   └── preload/services.js # 预加载脚本，挂载 window.services，提供系统原生能力
├── scripts/                # addon 复制、验证和性能测试脚本
├── src/
│   ├── App.vue             # 插件入口和 mainPush 处理
│   ├── Finder/             # 搜索界面、结果列表、预览、设置等主要功能
│   ├── assets/             # 静态资源目录
│   ├── components/         # 通用组件
│   ├── env.d.ts            # window.services 等类型声明
│   ├── main.css            # 主样式文件
│   └── main.ts
├── AGENTS.md               # Agent 开发提示
├── package.json
└── vite.config.js
```
