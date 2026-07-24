# 目录树生成器

`file-tree` 是一个 ZTools 插件，用于扫描本地文件夹并生成可编辑的目录树文本。生成后可补充注释、统一注释对齐，并导出为 PNG 图片，适合用于项目文档、演示材料和仓库说明页。

## 功能特性

- 选择本地文件夹并生成树形目录结构
- 支持通过插件指令或右键文件能力直接触发
- 可限制显示层级，或显示完整目录
- 支持显示/隐藏隐藏文件
- 支持自定义忽略规则，如 `node_modules,dist,*.log`
- 支持为目录树内容手动补充注释
- 支持一键格式化注释对齐
- 支持 `#` 和 `//` 两种注释分隔符
- 支持浅色、深色、跟随系统三种界面主题
- 支持自定义导出主题和颜色，并导出 PNG 图片

## 插件信息

- 插件名称：`file-tree`
- 标题：`目录树生成器`
- 当前版本：`1.0.5`
- 作者：`aiyakuaile`
- 首页：[https://github.com/aiyakuaile/file-tree](https://github.com/aiyakuaile/file-tree)

## 使用方式

### 方式一：插件命令触发

可通过以下关键词触发：

- `tree`
- `目录树`
- `树形图`
- `file tree`

### 方式二：目录右键触发

插件声明了 `directory` 类型文件能力，可直接对单个文件夹执行“生成目录树”。

## 界面说明

### 顶部操作区

- `选择文件夹`：选择本地目录并开始扫描
- `格式化注释`：将已添加的注释按统一列对齐
- `导出图片`：打开导出面板并保存为 PNG

### 目录树设置

- `显示层级`：控制最多渲染多少层，支持 `显示全部`
- `注释分隔符`：可选 `#` 或 `//`
- `主题`：`跟随系统`、`浅色`、`深色`
- `显示隐藏文件`：勾选后包含以 `.` 开头的文件或目录
- `忽略规则`：输入逗号分隔的匹配项后点击刷新按钮，或按回车更新

## 忽略规则示例

支持简单通配符：

- `*`：匹配任意长度字符
- `?`：匹配单个字符

示例：

```text
node_modules,dist,build,*.log,.DS_Store
```

## 导出说明

导出图片时支持以下配置：

- 预设主题：`github-light`、`github-dark`、`monokai`、`dracula`、`nord`
- 自定义颜色：背景色、文字色、注释色
- 导出缩放：`1x`、`2x`、`3x`

导出文件默认命名格式：

```text
<文件夹名>@<倍率>x.png
```

例如：

```text
my-project@2x.png
```

## 示例输出

```text
project
├── src
│   ├── components  # 组件目录
│   ├── utils       # 工具函数
│   └── main.js     # 入口文件
└── docs            # 文档目录
    └── guide.md    # 使用指南
```

## 项目结构

```text
file-tree/
├── index.html
├── main.js
├── preload.js
├── styles.css
├── icons.css
├── plugin.json
├── logo.png
├── codemirror.min.css
├── codemirror.min.js
├── monokai.min.css
└── html2canvas.min.js
```

## 实现说明

- `index.html`：插件界面结构
- `main.js`：目录树渲染、主题切换、注释格式化、导出逻辑
- `preload.js`：本地文件系统扫描与文件保存能力
- `plugin.json`：ZTools 插件元数据与能力声明

## 开发说明

当前插件为前端静态资源形式，目录内未包含额外构建脚本。核心依赖以本地文件方式引入：

- `CodeMirror`
- `html2canvas`

如需在 ZTools 中使用，确保插件目录结构完整，并保留 `plugin.json`、页面资源文件与预加载脚本。
