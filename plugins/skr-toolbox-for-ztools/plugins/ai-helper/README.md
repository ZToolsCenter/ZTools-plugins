# AI 助手

轻量级 AI 聊天助手插件，基于 ZTools AI 接口实现流式对话。

## 功能特性

- 流式 AI 对话，实时显示回复内容
- 多会话管理，支持新建、切换、删除对话
- 会话历史持久化，重启后自动恢复
- 侧边栏会话列表，支持搜索过滤
- 多模型切换，自动记忆上次选择
- Markdown 渲染（代码高亮、列表、表格等）
- 深色 / 浅色主题自适应
- 支持 over 模式，从搜索框直接发起对话
- 输入框自动撑高，多行时发送按钮移至底部

## 使用方式

| 触发方式 | 说明 |
|---------|------|
| 搜索 `AI助手` / `AI` / `chat` | 打开插件进入对话界面 |
| 输入文本 → 选择「AI对话」 | 自动创建新对话并发送输入内容 |

## 快捷键

| 快捷键 | 操作 |
|--------|------|
| `Enter` | 发送消息 |
| `Shift + Enter` | 换行 |

## 技术栈

- Vue 3 + TypeScript + Vite
- marked（Markdown 渲染）
- ZTools API（AI 调用、数据存储）

## 开发

```bash
npm install
npm run dev    # 启动开发服务器 localhost:5173
npm run build  # 构建到 dist/
```

## 项目结构

```
ai-helper/
├── public/
│   ├── plugin.json          # 插件配置
│   ├── logo.svg / logo.png  # 插件图标
│   └── preload/
│       └── services.js      # Node.js 桥接
├── src/
│   ├── main.ts              # 入口
│   ├── main.css             # 全局样式与主题变量
│   ├── App.vue              # 根组件（布局 + over 入口）
│   ├── useChat.ts           # 聊天状态管理
│   └── components/
│       ├── Sidebar.vue      # 侧边栏（会话列表）
│       └── ChatArea.vue     # 聊天区域（消息 + 输入）
└── package.json
```

## 协议

MIT
