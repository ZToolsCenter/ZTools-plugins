# ZTools 时间戳转换插件

一个简洁高效的时间戳转换工具，支持多种时间格式互转，提供全球时区查询。

## ✨ 功能特性

### 🕐 多格式时间转换

支持以下格式的输入和互转：

- **时间戳（秒）** - 如 `1704067200`
- **时间戳（毫秒）** - 如 `1704067200000`
- **日期字符串** - 如 `2024-01-01 12:00:00` 或 `2024-01-01T12:00:00`

### 🌍 时区支持

- **本地时间** - 自动识别系统时区
- **UTC 标准时间** - 世界协调时间
- **全球 50+ 时区** - 从 UTC-12:00 到 UTC+14:00，覆盖全球主要时区

### ⌨️ 快捷键操作

使用快捷键快速复制结果：

| 快捷键 | 功能 |
|--------|------|
| `⌘/Ctrl + 1` | 复制本地时间（完整） |
| `⌘/Ctrl + 2` | 复制本地时间（日期） |
| `⌘/Ctrl + 3` | 复制时间戳（秒） |
| `⌘/Ctrl + 4` | 复制时间戳（毫秒） |
| `⌘/Ctrl + 5` | 复制 UTC 时间 |

### 🚀 智能识别

支持自动识别输入内容：

- 输入 `时间戳转换` 或 `timestamp` 打开工具
- 直接输入时间戳（如 `1704067200`）自动触发转换
- 输入日期字符串（如 `2024-01-01 12:00:00`）自动转换

### 💡 人性化设计

- 复制成功后自动退出插件，无需手动关闭
- 实时转换，输入即刻显示结果
- 清晰的界面布局，一键展开多时区视图

## 📦 安装与构建

### 安装依赖

```bash
pnpm install
```

### 开发模式

```bash
pnpm run dev
```

开发服务器将在 `http://localhost:5173` 启动。

### 构建生产版本

```bash
pnpm run build
```

构建产物输出到 `dist/` 目录。

## 🎯 使用场景

- 快速查看时间戳对应的实际时间
- 将日期转换为时间戳用于开发调试
- 查询不同时区的当前时间
- API 接口时间参数的转换与验证
- 跨时区协作时的时间对照

## 🛠️ 技术栈

- **Vue 3** - Composition API + `<script setup>`
- **Vite 6** - 快速构建工具
- **TypeScript 5** - 类型安全
- **Tailwind CSS v4** - 现代化样式

## 📁 项目结构

```
.
├── public/
│   ├── logo.png              # 插件图标
│   ├── plugin.json           # 插件配置
│   └── preload/              # Node.js 扩展（可选）
├── src/
│   ├── main.ts               # 入口文件
│   ├── main.css              # 全局样式
│   ├── App.vue               # 路由控制
│   └── components/
│       └── timestamp/
│           └── timestamp.vue # 时间戳转换组件
├── index.html
├── vite.config.js
├── tsconfig.json
└── package.json
```

## 📖 开发说明

### 时区处理逻辑

- **时间戳输入** - 直接解析为 Date 对象
- **日期字符串输入** - 使用本地时区解析（而非 UTC+0）
- **多时区显示** - 基于 UTC 时间计算各时区偏移

### 添加新时区

在 `src/components/timestamp/timestamp.vue` 的模板部分添加新的时区项：

```vue
<div class="flex items-center justify-between p-4 hover:bg-gray-50 border-b">
  <div class="flex-1">
    <span class="text-gray-600 text-sm">时区名称(缩写)</span>
    <div class="text-lg font-mono text-gray-900">{{ getTimezoneTime(偏移分钟数) }}</div>
  </div>
</div>
```

## 🔗 相关链接

- [项目地址](https://github.com/loocao/ztools-timestamp)
- [ZTools 官方仓库](https://github.com/ztool-center/ztools)
- [ZTools API 文档](https://github.com/ztool-center/ztools-api-types)

## 📄 开源协议

MIT License

---

**简化时间转换，提升开发效率** 🚀