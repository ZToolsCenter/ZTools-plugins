# 图标检索（ZTools 插件）

一个面向 ZTools 的开源图标搜索与导出插件。数据来自 [Iconify 公共 API](https://iconify.design/docs/api/)，可搜索 300,000+ 个开源图标，并按图标集展示名称和许可证。

## 功能

- 关键词搜索，内置常用中文图标词映射
- 48 个图标一页，按需加载后续结果
- 紧凑编号网格，可按住 `Alt` 输入本页序号快速选取
- SVG / PNG 格式切换
- 单色图标换色，PNG 支持 24-512 px 尺寸
- 选中后通过快捷弹窗复制到剪贴板或保存到本地
- Iconify 主站不可用时自动切换到两个官方备用主机

## 快捷键

| 快捷键 | 操作 |
| --- | --- |
| `方向键` | 在结果网格中移动选择 |
| `Home` / `End` | 选择本页第一项 / 最后一项 |
| `Alt + 本页序号` | 选取对应图标并打开操作弹窗；多位序号需按住 `Alt` 连续输入 |
| `Enter` | 打开当前选中图标的操作弹窗 |
| 弹窗内 `Alt + 1` | 复制 SVG |
| 弹窗内 `Alt + 2` | 复制 PNG |
| 弹窗内 `Alt + 3` | 保存 SVG |
| 弹窗内 `Alt + 4` | 保存 PNG |
| `Ctrl/Cmd + C` | 复制当前格式的选中图标 |
| `Ctrl/Cmd + S` | 保存当前格式的选中图标 |
| `PageUp` / `PageDown` | 上一页 / 下一页 |
| `/` | 聚焦并选中搜索框 |

## 开发

```bash
pnpm install
pnpm dev
```

在 ZTools 中打开“设置 -> 已安装插件 -> 添加开发中插件”，选择 `public/plugin.json`。开发入口会连接 `http://localhost:5173`。

## 测试与构建

```bash
pnpm test
pnpm build
```

构建结果位于 `dist/`，选择 `dist/plugin.json` 即可验证生产构建。发布时按 ZTools CLI 要求提交源码，并使用 `ztools publish`。

## 数据与许可证

搜索和 SVG 内容由 Iconify 公共 API 提供。每个图标集可能使用不同许可证，插件会在操作弹窗中显示当前图标集的 SPDX 标识或许可证名称；将图标用于项目之前，请按对应许可证履行署名或其他义务。
