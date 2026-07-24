# 正则可视编辑器

ZTools 插件：正则表达式可视化编辑、实时匹配测试与 AI 中文说明。

## 功能

- **visual-regex 铁路图**：直观展示正则结构
- **实时匹配**：测试文本高亮匹配结果，支持捕获组
- **中文说明**：本地规则解释 + ZTools 内置 AI 大白话说明
- **AI 生成**：用自然语言描述需求，自动生成正则
- **常用范例**：邮箱、手机号、URL、IPv4 等 20+ 预设

## 触发指令

- `正则` / `正则编辑器` / `regex`
- 选中文本 → `正则测试`

## 开发

```bash
pnpm install
pnpm dev      # http://127.0.0.1:5173
pnpm build    # 输出到 dist/
```

打包插件时选择 **`dist`** 目录。

## 发布到 ZTools 插件市场

```bash
pnpm add -g @ztools-center/plugin-cli
ztools publish
```

需 GitHub 账号授权，自动向 [ZTools-plugins](https://github.com/ZToolsCenter/ZTools-plugins) 提交 PR。

## 技术栈

Vue 3 + Vite + TypeScript + visual-regex

## License

MIT
