# Kuke AI Agent

**本地全能 AI Agent 插件** —— 在你的机器上帮你完成各种任务的智能助手。

> 这是一个 ZTools 平台插件，让 AI 能够读写文件、执行命令、联网搜索、管理任务，让 AI 真正成为你的编程利器。

## 📸 插件截图

![插件主界面](https://img.cdn1.vip/i/69ea2aae53b48_1776954030.webp)

![插件配置](https://img.cdn1.vip/i/69ea2ab5c406e_1776954037.webp)

![插件功能展示](https://img.cdn1.vip/i/69ea2b18522a1_1776954136.webp)

---

## ✨ 核心能力

### 🤖 多模型支持
- **OpenAI**: 支持任何 OpenAI-compatible API
- **Anthropic**: 支持任何 Anthropic-compatible API

### 📁 文件操作
| 工具 | 功能 |
|------|------|
| `FileReadTool` | 读取文件（支持分页、大文件优化） |
| `FileEditTool` | 精确替换（查找替换/批量补丁） |
| `FileWriteTool` | 整文件写入 |
| `FileDeleteTool` | 删除文件（带快照回滚） |
| `NotebookEditTool` | Jupyter Notebook 单元格编辑 |

### 🔍 检索搜索
| 工具 | 功能 |
|------|------|
| `GlobTool` | 按路径模式查找文件 |
| `GrepTool` | 代码内容搜索（正则/上下文/类型过滤） |

### 💻 终端执行
| 工具 | 功能 |
|------|------|
| `BashTool` | 执行 Shell 命令 |
| `BashOutputTool` | 读取后台进程输出 |
| `KillShellTool` | 终止后台进程 |

### 🌐 联网能力
| 工具 | 功能 |
|------|------|
| `WebFetchTool` | 抓取网页（可选 LLM 摘要） |
| `WebSearchTool` | 联网搜索（Tavily） |

### 📋 任务规划
| 工具 | 功能 |
|------|------|
| `TodoWriteTool` | 拆解任务、实时跟踪进度 |

### 🧠 记忆系统
| 工具 | 功能 |
|------|------|
| `listMemoryBlocks` | 列出所有记忆块 |
| `getMemoryBlock` | 读取记忆块 |
| `setMemoryBlock` | 创建/更新记忆 |
| `replaceMemoryBlockText` | 局部修改记忆 |
| `deleteMemoryBlock` | 删除记忆 |

### 🔌 MCP 扩展
支持连接 Model Context Protocol 服务器，扩展更多工具能力。

---

## 🛡️ 安全机制

### 四种安全模式
| 模式 | 说明 |
|------|------|
| **严格模式** | 所有修改操作都需要确认 |
| **宽松模式**（默认） | 中/高风险操作需要确认 |
| **无视风险** | 所有操作直接执行 |
| **黑白名单** | 自定义命令白名单/黑名单 |

### 风险等级
- **低风险** (`low`): 只读查询
- **中风险** (`medium`): 修改项目文件
- **高风险** (`high`): 删除、系统配置、不可逆操作

### 文件保护
- **快照机制**: 危险操作前自动快照
- **一键回滚**: 可恢复到任意时间点
- **撤回功能**: 将消息撤回重新编辑

---

## 📖 使用指南

### 基础对话
1. 输入你的问题或任务描述
2. AI 会自动调用合适的工具来回答
3. 观看工具执行过程，查看结果

### 附加文件
- **拖拽**: 直接拖拽文件到输入框
- **粘贴**: 截图后 Ctrl+V 粘贴图片
- **附件按钮**: 点击 + 按钮选择文件/文件夹

### 使用示例

**代码理解**
```
帮我理解 src/main.ts 的主要逻辑
```

**代码修改**
```
把 config.json 中的 port 改为 3000
```

**运行测试**
```
在当前目录运行 npm test
```

**联网查询**
```
搜索最新的 Vue 3 教程
```

**复杂任务**
```
帮我重构这个项目，拆分成多个模块
```
→ AI 会自动创建 Todo 计划，逐步完成任务

---

## ⚙️ 配置说明

### 模型配置
1. 点击顶部模型选择器
2. 添加/编辑 Provider（API 地址、Key）
3. 选择或手动输入模型名称
4. 点击「同步模型」获取可用模型列表

### 系统提示词
预设三种场景：
- **通用 Agent**: 默认全能助手
- **代码协作**: 专注编程任务
- **系统执行**: 自动化脚本执行

支持 `{{currentTime}}`、`{{cwd}}`、`{{osType}}` 等变量占位。

### Tavily 搜索
在设置中填入 Tavily API Key 即可启用联网搜索。

---

## 🎯 工作原则

1. **确认工作目录**: 开工前先确认当前目录，避免误操作
2. **复杂任务先规划**: 使用 TodoWriteTool 拆解步骤
3. **先搜索再行动**: 用 GlobTool/GrepTool 定位文件
4. **大文件分页读**: 用 offset/limit 避免超长输出
5. **用专用工具**: FileDeleteTool 等有快照保护，不要用 rm/del 命令
6. **后台任务管理**: dev server 用 runInBackground=true

---

## 🔧 技术栈

| 层级 | 技术 |
|------|------|
| 前端框架 | Vue 3 + TypeScript |
| 样式 | Tailwind CSS |
| 构建工具 | Vite |
| AI SDK | OpenAI SDK, Anthropic SDK |
| 联网搜索 | Tavily |
| 协议 | MCP (Model Context Protocol) |

---

## 📂 数据存储

| 数据 | 存储位置 |
|------|----------|
| 对话历史 | localStorage |
| Provider 配置 | localStorage |
| 用户记忆 | localStorage |
| Skill 技能 | `~/.kukeagent/skills/` |
| 工作空间 | `~/.kukeagent/workspaces/` |
| 文件快照 | 系统临时目录 |

---

## 🚀 开发命令

```bash
npm install      # 安装依赖
npm run dev      # 开发模式 (http://localhost:5173)
npm run build    # 构建生产版本
npm run pack     # 打包 ZTools 插件
```

---

## 📄 许可证

MIT License

---

**版本**: 1.1.0  
**作者**: kukemc  
**主页**: https://github.com/kukemc
