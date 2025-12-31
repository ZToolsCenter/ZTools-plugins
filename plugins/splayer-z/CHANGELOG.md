# 修改记录

## 核心修改

### 1. API 服务器 (vite.config.ts)
- Fastify 服务器集成,端口 36524
- 自动注册 366 个 API 路由
- Cookie 解码: `decodeURIComponent(params.cookie)`
- 优雅重启机制

### 2. 请求拦截器 (request.ts)
- 移除 Pinia store,改用 `localStorage`
- 修复 `inject()` 错误
- 添加 `proxyProtocol` 空值检查

### 3. 用户认证 (auth.ts)
- 添加重试机制 (最多 3 次)
- 改善错误处理

### 4. UI 优化
- 侧边栏默认折叠 (status.ts)
- 设置页面滚动 (MainSetting.vue)
- 设置页面高度 90vh

## 修复的问题

- ✅ Cookie 编码/解码
- ✅ Vue inject() 错误
- ✅ 端口占用
- ✅ toLowerCase 空值错误

## 技术架构

```
前端 (localhost:5173)
  ↓
Vite Proxy
  ↓
Fastify (127.0.0.1:36524)
  ↓
网易云音乐 API
```
