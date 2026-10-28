# 第三方组件与许可

本项目自身以 MIT 许可发布（见 `LICENSE`）。下面列出随产物分发或参与构建的第三方组件，
以及它们各自的许可。完整依赖树见 `package-lock.json`。

## 随产物分发的运行时依赖

| 组件 | 许可 | 用途 |
|---|---|---|
| React / React DOM | MIT | UI 框架 |
| Plate（@platejs/*） | MIT | 富文本编辑器内核 |
| Zustand | MIT | 状态管理 |
| Mermaid | MIT | 流程图 / 时序图渲染 |
| ECharts | Apache-2.0 | 统计图表渲染 |
| elkjs | **EPL-2.0** | Mermaid 的图形布局引擎（见下方说明） |
| KaTeX | MIT | 数学公式渲染（含 `public/fonts/` 下的字形文件） |
| lowlight / highlight.js | MIT | 代码块语法高亮 |
| lucide-react | ISC | 图标 |

### elkjs（EPL-2.0）

`elkjs` 通过 Mermaid 间接引入，采用 Eclipse Public License 2.0。
EPL-2.0 是**文件级**弱传染许可：只要不修改 elkjs 自身的源文件，把它作为依赖分发
不要求本项目整体改用 EPL。本项目未修改 elkjs 源码。若后续需要修改它，请遵守 EPL-2.0
关于修改文件的规定。

## 仅参与构建，不进入产物

| 组件 | 许可 | 用途 |
|---|---|---|
| Vite | MIT | 构建工具 |
| TypeScript | Apache-2.0 | 类型检查 |
| caniuse-lite | CC-BY-4.0 | 浏览器兼容数据（构建期查询） |

## 资源文件

| 文件 | 来源与许可 |
|---|---|
| `public/export-file/github-markdown.css` | GitHub 官方 Markdown 样式（sindresorhus/github-markdown-css，MIT） |
| `public/katex.min.css`、`public/fonts/*` | KaTeX 发行包（MIT） |

## 关于 `public/export-file/index.html`

该文件是导出 PDF / 长图时使用的隐藏渲染窗口模板，全部内容为标准 HTML 骨架加几条
基础样式，不含任何第三方专有代码。若你在分发时希望更彻底，可直接替换为自己的模板，
接口只需保留 `<article class="markdown-body">` 与 `window.waitAllImageLoaded()` 两个约定。
