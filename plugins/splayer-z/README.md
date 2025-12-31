# SPlayerZ

SPlayer 的 ZTools 插件版本,支持在 ZTools 中播放网易云音乐。

## 快速开始

```bash
# 安装依赖
pnpm install

# 启动开发服务器
pnpm dev:plugin
```

访问: http://localhost:5173

## 功能

- ✅ 搜索和播放音乐
- ✅ 歌词显示
- ✅ 用户登录
- ✅ 播放列表管理
- ✅ 主题切换

## 技术栈

- Vue 3 + Naive UI + Pinia
- Fastify API Server (366 个路由)
- Vite + TypeScript

## 常见问题

### 端口被占用
```bash
# Windows
netstat -ano | findstr :36524
taskkill /PID <PID> /F
```

### API 服务器未启动
检查控制台是否显示:
```
✅ Fastify API server started on http://127.0.0.1:36524
```

## Git 初始化

```bash
# Windows
git-init.bat

# Linux/Mac
chmod +x git-init.sh && ./git-init.sh
```

## 许可证

MIT
