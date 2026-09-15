# ztools-plugin-icon-creator

<p align="center">
  <img src="public/logo.png" alt="Icon Creator Logo" width="120" />
</p>

**一个 ZTools 图标创建插件，把可视化画布编辑与 AI 驱动的图标生产封装为开箱即用的「图标设计工具」**

_钢笔与路径编辑 · 布尔运算 · 组件符号 · 渐变/图案填充 · 多尺寸导出 · MCP / AI 驱动_

![ZTools](https://img.shields.io/badge/ZTools-%E6%8F%92%E4%BB%B6-blue) ![Vue](https://img.shields.io/badge/Vue-3.x-4FC08D?logo=vuedotjs&logoColor=white) ![Fabric.js](https://img.shields.io/badge/Fabric.js-7.x-purple) ![Version](https://img.shields.io/badge/version-1.0.0-orange)

---

## ✨ 特性

- 🎨 **可视化画布编辑** — 基于 Fabric.js 的所见即所得画布，支持基础图形、文字、图片导入、SVG 1:1 导入、Iconify 图标库与内置图标模板
- ✏️ **矢量路径编辑** — 钢笔工具（角点/曲线点/对称控制柄）、锚点增删、线段直线/曲线切换、文字一键转曲
- 🔀 **布尔运算与蒙版** — 并集/交集/差集/异或，支持蒙版裁切，直线以描边轮廓参与运算
- 🌈 **丰富样式系统** — 纯色/线性径向渐变/图案平铺填充、描边与虚线、投影/内阴影、7 种位图滤镜、13 种混合模式、位图裁剪、全局颜色替换
- 🧩 **组件符号系统** — 把常用组合保存为可复用定义，联动实例一键同步，解除关联自由拆分
- 🎛️ **样式预设与色板** — 命名色板引用、文档级样式预设（含内置预设），一键套用填充/描边/阴影组合
- 📐 **精确排版** — 标尺 + 拖出式对齐参考线、对象吸附、对齐/分布、像素网格与 Keyline 安全区模板
- 🖥️ **多画板 & 多标签** — 每个标签独立画布与撤销历史，编辑过程自动保存草稿，重启可恢复
- ↩️ **完整历史管理** — 多步撤销/重做、历史跳转、跨撤销栈的命名快照（恢复前自动备份）
- 📦 **全能导出** — PNG/SVG/WebP（文本/dataURL/文件）、favicon/pwa/android/ios/electron 多尺寸套件、ICO/ICNS 容器、按画板导出、一键复制到剪贴板
- 🤖 **AI / MCP 集成** — 通过 `command_dispatcher` 暴露 80+ 编辑器操作，AI 可在对话中完成「查询 → 绘制 → 调整 → 导出」全流程闭环
- ⌨️ **可自定义快捷键** — 全键位可搜索、录制、删除与恢复默认，配置自动保存

## 📸 界面预览

![界面预览](https://raw.githubusercontent.com/Particaly/ztools-plugin-icon-creator/main/.github/assets/preview.png)

## 🤖 作为 MCP 工具接入

插件通过 `command_dispatcher` 工具向 MCP 客户端（如 ZCode）暴露编辑器能力，所有操作直接作用于当前打开的编辑器窗口，AI 即可在对话中驱动界面完成图标设计。

```json
{
  "operation": "add_shape",
  "args": { "shape": "circle", "x": 256, "y": 256, "fill": "#6366f1" }
}
```

### 能力总览

- **查询** — 画布概览、对象列表、条件查找、选区、画板、历史、色板、快照、对齐参考线
- **创建** — 基础图形、文本、SVG、Iconify 图标、模板、批量创建并编组（可携带初始样式一步到位）
- **编辑** — 属性/批量属性、图层管理、语义命名、对齐分布、布尔运算、蒙版、文字转曲、文本排版、位图滤镜/裁剪/图案填充
- **组织** — 组件符号（定义/实例/联动更新/解除关联）、全局颜色替换、样式预设
- **历史** — 撤销/重做/历史跳转/命名快照
- **导出** — SVG/PNG/WebP 文本与文件、多尺寸套件、ICO/ICNS 容器、按画板导出
- **自检** — `get_canvas_thumbnail` 低成本缩略图，支持「画完 → 看图 → 修正」闭环

### 典型工作流

```text
1. new_document / apply_icon_template      建立画布
2. add_shape + set_object_props            绘制并调样式（或 create_objects 一步成组）
3. get_canvas_thumbnail                    视觉自检
4. align_objects / boolean_ops             精修
5. export_size_set / export_icon_container 交付全套尺寸
```

> 完整操作名列表与坐标语义见 [USER_GUIDE.md](USER_GUIDE.md) 的「AI / MCP 集成」章节。

## 🧩 功能详解

| 模块 | 能力 |
| --- | --- |
| 对象与绘制 | 基础图形（按目标尺寸生成）、文字预设、图片导入（PNG/JPG/SVG）、Iconify 图标库、内置图标模板、批量创建并编组 |
| 矢量路径 | 钢笔工具（拖拽出曲线、`Alt` 断开对称）、点位/线段模式（`Alt+2`/`Alt+3`）、锚点插删、文字转曲 |
| 样式系统 | 纯色/渐变（线性·径向）/图案平铺填充、描边虚线、投影/内阴影、位图滤镜叠加、13 种混合模式、位图连续裁剪、文档级全局颜色替换 |
| 组织管理 | 图层搜索与四档锁定、编组/解组、对齐/分布、标尺参考线与吸附、组件符号定义与联动实例 |
| 画布工程 | 多画板管理、多标签工作区、像素网格、Keyline 安全区、自动草稿恢复、`.json` 工程文件读写、命名快照 |
| 导出交付 | PNG/SVG/WebP、favicon/pwa/android/ios/electron 多尺寸套件、ICO/ICNS 容器、按画板导出、复制 PNG/SVG 到剪贴板 |

## 🛠️ 技术栈

| 技术 | 用途 |
| --- | --- |
| [Vue 3](https://vuejs.org/) + TypeScript | 界面与编辑器运行时 |
| [Fabric.js 7](https://fabricjs.com/) | 画布对象模型与渲染 |
| [PathKit (Skia) WASM](https://www.npmjs.com/package/pathkit-wasm) | 矢量几何：布尔运算、可编辑路径 |
| [UnoCSS](https://unocss.dev/) | 原子化样式 |
| [ztools-ui](https://www.npmjs.com/package/ztools-ui) | ZTools 插件 UI 组件 |
| [Iconify](https://iconify.design/) | 海量图标库接入 |
| [JSZip](https://stuk.github.io/jszip/) / [js-beautify](https://github.com/beautify-web/js-beautify) | ICO/ICNS 容器打包与代码美化 |
| [Vite](https://vitejs.dev/) + [Vitest](https://vitest.dev/) | 构建与单元测试 |

## 📁 项目结构

```text
icon-creator/
├── public/
│   ├── plugin.json          # 插件清单：功能声明与 MCP 工具 Schema
│   ├── logo.png
│   └── preload/             # ZTools 预加载服务（文件读写等系统能力）
├── src/
│   ├── main.ts              # 应用入口
│   ├── App.vue
│   ├── router/              # 路由
│   └── views/home/          # 编辑器主界面
│       ├── index.vue        # 编辑器页面
│       ├── components/      # 工具栏 / 图层面板 / 属性面板 / 弹窗
│       ├── composables/     # 组合式逻辑（文档 / 画板）
│       ├── editor/          # 编辑器运行时模块与状态
│       ├── fabric/          # Fabric.js 扩展（形状工厂 / 滤镜 / 裁剪 / 图案填充）
│       ├── geometry/        # PathKit 几何（布尔运算 / 可编辑路径 / 网格绘制）
│       ├── mcp/             # MCP 网关与 80+ 操作实现
│       └── __tests__/       # 单元测试
├── USER_GUIDE.md            # 编辑器使用指南（含 MCP 完整操作文档）
└── vite.config.js
```

## 📋 使用须知与限制

- 布尔运算仅支持闭合图形与可编辑路径，文字和图片对象不支持，成组对象需先解组
- 文字直接使用系统字体名渲染，跨设备可能回退；发布图标建议先「文字转曲」固化字形
- 图案填充来源为本地上传图片，切回纯色/渐变后图案不再生效
- 撤销、重做或重新打开工程后，符号实例保持保存当时的外观，内容联动只在显式「更新定义」时发生

## 🐛 问题反馈

遇到问题或有功能建议，欢迎提交 [Issue](https://github.com/Particaly/ztools-plugin-icon-creator/issues) 或 Pull Request：

1. 提交前请先搜索是否已有同类 Issue
2. 反馈编辑器问题时请附上操作步骤与预期/实际行为
3. 反馈 AI/MCP 问题时请附上 `operation` 与 `args` 及返回结果

## 💝 致谢

- [Fabric.js](https://fabricjs.com/) — 强大的 Canvas 对象模型
- [Skia PathKit](https://skia.org/docs/user/modules/pathkit/) — 浏览器端矢量布尔运算
- [Iconify](https://iconify.design/) — 开放统一的图标生态
- [ZTools](https://github.com/ZToolsCenter/ZTools) — 插件化效率工具平台

## 📄 许可证

本项目暂未附加开源许可证，默认保留所有权利；如需二次开发或分发，请联系作者。

---

如果这个项目对你有帮助，欢迎点个 Star ⭐ 支持一下！
