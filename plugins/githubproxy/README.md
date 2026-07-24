# Github Proxy

> A ZTools plugin for GitHub file proxy acceleration

这是一个使用 **Vue 3 + Vite + TypeScript + Element Plus** 构建的 ZTools 插件，用于加速访问 GitHub 文件资源。

## ✨ 功能特性

### 🚀 GitHub 文件代理加速

- **代理服务器选择**：支持多个代理服务器，可显示每个服务器的状态和响应时间
- **多种下载方式**：
  - Git Clone 命令复制
  - Wget 命令复制
  - Curl 命令复制
  - Direct Download 直链获取
  - 直接下载文件到本地
- **命令自动生成**：根据选择的代理服务器和输入的 GitHub URL 自动生成对应命令

### ⚙️ 设置管理

- **代理服务器管理**：添加、编辑、删除代理服务器
- **一键测速**：测试所有或单个代理服务器的响应时间
- **清理失效代理**：快速清理无法连接的代理服务器
- **数据持久化**：代理列表和选择偏好自动保存

### 💾 数据持久化

- 代理服务器列表自动保存到本地数据库
- 下次打开自动恢复上次选择的代理服务器
- 测速结果自动保存

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
│   ├── Home/                 # 首页组件（GitHub Proxy 功能）
│   │   └── index.vue
│   ├── Settings/             # 设置页组件（代理服务器管理）
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

| 命令             | 功能                   |
| -------------- | -------------------- |
| `download`      | 打开插件并将输入的 URL 直接下载   |
| `copygitclone` | 打开插件并复制 Git Clone 命令 |

### 首页功能

1. **选择代理服务器**：从下拉框中选择可用的代理服务器
2. **输入 GitHub URL**：粘贴 GitHub 文件或仓库的 URL
3. **获取命令**：在下方选项卡中查看对应的命令
4. **复制命令**：点击复制按钮将命令复制到剪贴板
5. **直接下载**：点击下载按钮直接下载文件

### 设置页功能

1. **全部测速**：测试所有代理服务器的响应时间
2. **添加服务器**：添加新的代理服务器地址
3. **清理失效代理**：一键删除无法连接的代理服务器

## 🔧 开发指南

### 修改插件配置

编辑 `public/plugin.json` 文件：

```json
{
  "name": "githubproxy",
  "description": "GitHub 文件代理加速工具",
  "author": "Your Name",
  "version": "1.0.0",
  "features": [
    {
      "code": "download",
      "explain": "GitHub文件代理加速，下载文件"
    },
    {
      "code": "copygitclone",
      "explain": "GitHub文件代理加速，复制Git Clone地址"
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

// 调用下载服务
const savePath = await window.services.downloadFile(url, {
  onProgress: (progress) => {
    console.log(`下载进度: ${progress}%`)
  }
})
</script>
```

### 调用 Preload 服务

```vue
<script setup lang="ts">
// 下载文件
const savePath = await window.services.downloadFile(proxyUrl, {
  onProgress: (progress) => {
    setDownloadProgress(progress)
  }
})
</script>
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

- [ZTools 官方文档](https://github.com/ztool-center/ztools)
- [ZTools API 文档](https://github.com/ztool-center/ztools-api-types)
- [Vue 3 文档](https://vuejs.org/)
- [Vite 文档](https://vitejs.dev/)
- [Element Plus 文档](https://element-plus.org/)

## ❓ 常见问题

### Q: 如何调试插件？

A: 使用 `npm run dev` 启动开发服务器，在插件界面中点击插件头像图标，在弹出的菜单中选择"打开开发者工具"进行调试。

### Q: 如何添加新的代理服务器？

A: 在插件设置页面点击"添加服务器"按钮，输入代理服务器地址即可。

### Q: 测速显示"连接超时"怎么办？

A: 说明该代理服务器可能已失效或无法访问，可以在设置页使用"清理失效代理"功能将其删除。

### Q: 下载功能无法使用？

A: 确保 ZTools 版本支持 `downloadFile` 服务，且插件已正确安装。

## 📄 开源协议

MIT License

***

**祝你使用愉快！** 🎉
