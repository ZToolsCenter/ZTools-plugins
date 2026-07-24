# PicList 图片上传插件

> 一个基于 ZTools 的 PicList 图片上传工具插件

这是一个使用 **Vue 3 + Vite + TypeScript + Element Plus** 构建的 ZTools 插件，用于便捷地上传图片到 PicList 图床服务。

## ✨ 功能特性

### 🚀 图片上传

- **文件选择上传**：支持点击选择本地图片文件，支持多图同时上传
- **拖拽上传**：支持拖拽图片到上传区域进行上传
- **剪贴板上传**：支持粘贴剪贴板中的图片直接上传
- **URL上传**：支持粘贴图片URL进行上传
- **文件路径上传**：支持通过文件路径上传图片

### ⚙️ 设置管理

- **服务配置**：配置 PicList 服务地址、端口、协议（HTTP/HTTPS）
- **鉴权配置**：支持 API Key 鉴权
- **复制格式配置**：支持多种复制格式（Markdown、HTML、URL、UBB、自定义）
- **历史记录配置**：设置历史记录最大保存条数
- **数据持久化**：所有配置自动保存到本地数据库

### 📋 上传历史

- **历史记录查看**：查看所有已上传的图片记录
- **图片预览**：点击预览链接查看上传的图片
- **链接复制**：一键复制图片链接（支持多种格式）
- **记录管理**：支持删除单条记录或清空全部历史

### 💾 数据持久化

- 服务配置自动保存到本地数据库
- 上传历史自动保存，下次打开自动恢复
- 支持配置历史记录最大保存条数（默认50条）

## 📁 项目结构

```
.
├── public/
│   ├── logo.png              # 插件图标
│   ├── plugin.json           # 插件配置文件
│   └── preload/              # Preload 脚本目录
│       ├── package.json      # Preload 依赖配置
│       └── services.js       # Node.js 能力扩展
├── src/
│   ├── main.ts               # 入口文件
│   ├── main.css              # 全局样式
│   ├── App.vue               # 根组件
│   ├── env.d.ts              # 类型声明
│   ├── Home/                 # 首页组件（图片上传功能）
│   │   └── index.vue
│   ├── Settings/             # 设置页组件（服务配置）
│   │   └── index.vue
│   ├── History/              # 历史记录页组件
│   │   └── index.vue
│   ├── About/                # 关于页组件
│   │   └── index.vue
│   └── components/           # 公共组件
│       └── Header/           # 顶部导航组件
│           └── index.vue
├── index.html                # HTML 模板
├── vite.config.js            # Vite 配置
├── tsconfig.json             # TypeScript 配置
├── package.json              # 项目依赖
└── README.md                 # 项目文档
```

## 🚀 快速开始

### 安装依赖

```bash
npm install
```

### 开发模式

```bash
npm run dev
```

开发服务器将在 `http://localhost:5173` 启动。ZTools 会自动加载开发版本。

### 构建生产版本

```bash
npm run build
```

构建产物将输出到 `dist/` 目录。

## 📖 使用指南

### 插件入口

插件支持以下入口命令：

| 命令 | 功能 |
|------|------|
| `piclistImg` | 打开插件并触发图片上传功能 |

### 首页功能

1. **选择图片**：点击上传区域或拖拽图片到上传区域
2. **开始上传**：点击"开始上传"按钮上传选中的图片
3. **查看结果**：上传完成后显示上传结果，支持预览和复制链接
4. **快捷操作**：点击"配置"按钮快速跳转到设置页面

### 设置页功能

1. **服务配置**：设置 PicList 服务地址、端口、协议和 API Key
2. **测试连接**：测试与 PicList 服务的连接状态
3. **历史配置**：设置历史记录最大保存条数（1-500）
4. **复制格式**：选择复制图片链接时使用的格式

### 历史记录页功能

1. **查看记录**：浏览所有已上传的图片记录
2. **预览图片**：点击预览按钮在新窗口打开图片
3. **复制链接**：一键复制图片链接（按配置的格式）
4. **删除记录**：删除单条记录或清空全部历史

## 🔧 开发指南

### 修改插件配置

编辑 `public/plugin.json` 文件：

```json
{
  "name": "piclist-plugin",
  "description": "PicList 图片上传工具",
  "author": "Your Name",
  "version": "1.0.0",
  "features": [
    {
      "code": "piclistImg",
      "explain": "使用 PicList 上传图片",
      "cmds": [
        {
          "type": "img",
          "label": "图片上传"
        }
      ]
    }
  ]
}
```

### 使用 ZTools API

```vue
<script setup lang="ts">
// 显示通知
window.ztools.showNotification('操作成功')

// 数据库操作
await window.ztools.db.put({ _id: 'key', data: 'value' })
const result = await window.ztools.db.get('key')

// 获取存储数据
const storage = await window.ztools.getStorage('key')
</script>
```

### PicList API 调用

插件调用 PicList 内置 HTTP 服务进行图片上传：

```bash
# 上传剪贴板图片
curl -X POST \
  -H "Content-Type: application/json" \
  -d '{}' \
  http://127.0.0.1:36677/upload

# 上传指定路径图片
curl -X POST \
  -H "Content-Type: application/json" \
  -d '{"list": ["/path/to/image.jpg"]}' \
  http://127.0.0.1:36677/upload
```

## 📦 构建与发布

### 1. 构建插件

```bash
npm run build
```

### 2. 测试构建产物

将 `dist/` 目录中的所有文件复制到 ZTools 插件目录进行测试。

### 3. 发布到插件市场

1. 确保 `plugin.json` 中的信息完整准确
2. 准备好插件截图和详细说明
3. 访问 ZTools 插件市场提交插件

## 📚 相关资源

- [ZTools 官方文档](https://ztoolscenter.github.io/ZTools-doc/)
- [ZTools API 文档](https://ztoolscenter.github.io/ZTools-doc/plugin-api.html)
- [PicList 官方网站](https://piclist.cn/)
- [Vue 3 文档](https://vuejs.org/)
- [Vite 文档](https://vitejs.dev/)
- [Element Plus 文档](https://element-plus.org/)

## ❓ 常见问题

### Q: 如何调试插件？

A: 使用 `npm run dev` 启动开发服务器，在插件界面中点击插件头像图标，在弹出的菜单中选择"打开开发者工具"进行调试。

### Q: 上传失败怎么办？

A: 请确保：
1. PicList 已安装并启动
2. PicList 已开启内置 HTTP 服务（设置 -> 服务设置 -> 开启服务）
3. 插件配置中的地址和端口与 PicList 设置一致
4. 若启用了 API 鉴权，请正确配置 API Key

### Q: 如何修改复制格式？

A: 在设置页面的"复制 URL 格式"下拉框中选择所需格式，支持 Markdown、HTML、URL、UBB 和自定义格式。

### Q: 历史记录不显示？

A: 历史记录存储在本地数据库中，若插件重新安装或数据被清除，历史记录可能丢失。

## 📄 开源协议

MIT License

---

**祝你使用愉快！** 🎉
