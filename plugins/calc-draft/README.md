# Calc-Draft

<p align="center"><img src="src-ztools/logo.png" width="120" alt="Calc-Draft Logo" /></p>

> 计算草稿纸，记录多步计算，友好且现代的交互界面

- 当前项目是ZTools插件，目的是为了作为`计算稿纸`插件的"现代化平替"并且提供`公式行引用`和`跨草稿引用`等特性
- 在`Vibe Coding`时代，现代化的界面和交互体验是必须的，因此本项目提供了现代化界面和优雅的交互体验，符合`Coder`的使用习惯
- 精雕细琢每个快捷键设计，欢迎体验和反馈


## 应用速览

<table>
<tr>
<td width="50%" align="center" valign="top"><sub>基本用法</sub><br><img src="docs/basic-usage.gif" width="100%" alt="basic-usage" />
<td width="50%" align="center" valign="top"><sub>跨草稿公式引用</sub><br><img src="docs/more-usage.gif" width="100%" alt="more-usage" />
</tr>
<tr>
<td width="50%" align="center" valign="top"><sub>科学计算</sub><br><img src="docs/more-usage-2.gif" width="100%" alt="more-usage-2" />
<td width="50%" align="center" valign="top"><sub>明亮模式</sub><br><img src="docs/snapshot-1.png" width="100%" alt="snapshot-1" />
</tr>
</table>

## ✨ 功能特性

- **多步计算**：每行写一个表达式，自动出结果。支持四则运算、幂、取模、常用函数（sqrt/sin/cos/log/abs/round 等）和常量（pi/e）
- **行引用**：用 `#N` 引用任意行的计算结果，像草稿纸上的"由第 N 步可知"——但更可靠：增删行后引用自动跟随，不会错位
- **跨草稿引用**：`@页序号#行序号` 引用其他草稿的行（如 `@2#6` = 第 2 个草稿第 6 行），页签重引用不变；输入 `@` 自动补全草稿和行，零记忆负担
- **点击即用**：单击行内任意数字复制结果；Alt+点击数字可把数值插入当前编辑光标处，续写下一行零停顿
- **直观反馈**：每行固定颜色，引用处着色联动、上游行描边高亮，关系一目了然；循环引用、未找到、除零等错误以红字短句行内提示，不打断其他计算
- **草稿管理**：多页草稿切换、双击重命名、一键删除，自动保存到本地，刷新不丢
- **快捷键至上**：从选中、编辑、复制、移行到翻页全键盘可完成，具体可点击右上角键盘图标查看完整快捷键清单

# 开发指引
## 📁 项目结构

```
.
├── src-ztools/                 # ZTools 插件目录
│   ├── logo.png                # 插件图标
│   ├── plugin.json             # 插件配置（code: calc）
│   ├── preload/services.js     # Preload 扩展点（当前为空）
├── src/
│   ├── main.tsx / main.css     # 入口与全局样式
│   ├── App.tsx                 # 路由：calc → CalcDraft
│   └── CalcDraft/
│       ├── index.tsx           # 页面骨架：顶栏 + 行列表 + 底栏
│       ├── index.css           # macOS 风格样式
│       ├── state.ts            # reducer、DraftDoc、localStorage 持久化
│       ├── palette.ts          # seq → 颜色映射
│       ├── engine/             # jsep 解析 + 自研拓扑求值器（含单测）
│       └── components/         # CalcRow / NumberCell / PageTabs / Toast
├── docs/superpowers/           # 设计 spec 与实现计划
├── vitest.config.ts
└── package.json
```

## 🚀 快速开始

```bash
npm install        # 安装依赖
npm run dev        # 开发模式（http://localhost:5173）
npm test           # 运行单测（Vitest）
```

将 `src-ztools/` 目录作为完整插件目录复制到 ZTools 插件目录即可测试；ZTools 会通过触发词 `计算` / `草稿` / `calc` 打开插件。

## 📖 开发说明

- **表达式管线**：`expr → jsep() → AST → evaluator → number | error`（`src/CalcDraft/engine/`）
- **状态**：顶层 `useReducer` 管理 `DraftDoc { pages, activePageId }`，每次变更 debounce 500ms 写入 `localStorage` 键 `calc-draft:doc`
- **测试**：引擎与状态层 Vitest 单测覆盖引用稳定性、环检测、拓扑重算、损坏存储回退、浮点格式化


## 📄 开源协议

MIT License
