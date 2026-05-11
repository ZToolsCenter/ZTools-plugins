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

## 📜 开源许可

本项目基于 [GNU Affero General Public License v3.0 (AGPL-3.0)](https://www.gnu.org/licenses/agpl-3.0.html) 许可进行开源

### ⚠️ 重要说明

- **本项目仅供个人学习研究使用，禁止用于商业及非法用途**
- 任何修改和分发都必须基于 AGPL-3.0 进行，源代码必须一并提供
- 派生作品必须同样采用 AGPL-3.0，并注明原始项目
- 禁止修改程序原版权信息（可添加二开作者信息）

### 📌 原项目

本项目基于 [SPlayer](https://github.com/imsyy/SPlayer) 进行移植和修改

- 原作者: [imsyy](https://github.com/imsyy)
- 原项目: https://github.com/imsyy/SPlayer
- 许可证: AGPL-3.0
