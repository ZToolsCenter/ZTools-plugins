# ASCII Tree

`ascii-tree` 是一个基于 ZTools 的文本转换插件，用来把以 `=` 表示层级的文本实时转换成 ASCII Tree。

## 功能

- 输入分级文本，实时生成 ASCII Tree
- 支持在右侧树结构中反向编辑，同步回左侧原始文本
- 支持复制结果
- 支持保存最近一次输入，下次打开自动恢复

## 构建

执行：

```bash
pnpm install
pnpm run build
```

该命令会把发布所需文件复制到 `dist/`：

- `index.html`
- `index.css`
- `index.js`
- `plugin.json`
- `preload.js`
- `logo.jpg`

清理构建产物：

```bash
pnpm run clean
```

## 输入示例

左侧输入：

```text
workspace
=apps
==desktop
==web
=packages
==core
==ui
=docs
==README.md
```

右侧输出：

```text
workspace
├── apps
│   ├── desktop
│   └── web
├── packages
│   ├── core
│   └── ui
└── docs
    └── README.md
```
