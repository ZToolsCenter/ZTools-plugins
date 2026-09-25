# 文件智能重命名

面向 Windows / ZTools 的文件批量重命名插件。支持规则化重命名，也可以使用 ZTools 中已配置的 AI 模型生成候选名称；所有候选都可先预览，再执行。

## 功能

- **查找替换**：普通替换、位置替换、多规则串联，并可选择是否处理扩展名。
- **自动编号**：支持数字、中文数字和英文字母序号，可设置前后缀、起始值和位数。
- **插入内容**：插入文本、序号、文件时间、大小、图片尺寸和拍摄时间。
- **智能重命名**：根据自然语言要求生成候选名称；需要先在 ZTools 配置可用模型。
- **手动编辑**：逐项编辑，或粘贴电子表格中的多行文件名。
- 支持从资源管理器文件上下文导入、递归扫描文件夹、排序、实时预览、冲突预检和最近一次操作撤销。

## 界面截图

| 查找替换 | 智能重命名 |
| --- | --- |
| ![查找替换](docs/ui-evidence/v1.0.0-find-replace.png) | ![智能重命名](docs/ui-evidence/v1.0.0-smart-rename.png) |

其他界面：[自动编号](docs/ui-evidence/v1.0.0-numbering.png) · [插入内容](docs/ui-evidence/v1.0.0-insert.png) · [手动编辑](docs/ui-evidence/v1.0.0-manual-edit.png)

## 安装

- **插件中心**：在 ZTools 插件市场搜索“文件智能重命名”。市场审核通过后即可安装。
- **本地安装**：从 [GitHub Releases](https://github.com/yyxxd/ztools-batch-rename/releases) 下载 ZIP，在 ZTools 插件管理中选择“本地安装”。

## 本地开发与打包

需要 Node.js 和 pnpm。克隆仓库后运行：

```powershell
pnpm install
pnpm dev
pnpm build
pnpm test
.\scripts\package-probe.ps1
```

打包脚本会在 `outputs/` 生成可在 ZTools 中本地安装的 ZIP。也可在 ZTools 插件管理中加载本地开发版本。

## 支持范围

- 目标平台：Windows（`win32`）与 ZTools。
- 智能重命名依赖 ZTools 已配置的模型；每次最多处理 500 个文件。
- 其他操作系统及未经实测的宿主版本暂不声明支持。

## 许可

[MIT License](LICENSE)
