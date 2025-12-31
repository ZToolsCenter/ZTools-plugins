# API 服务器架构

## 架构

```
前端 (localhost:5173)
  ↓ /api/netease/*
Vite Proxy
  ↓
Fastify (127.0.0.1:36524)
  ↓ 366 个路由
网易云音乐 API
```

## 配置

- **端口**: 36524
- **实现**: `packages/ztools-plugin/vite.config.ts`
- **启动**: `pnpm dev:plugin`

## Cookie 处理

**前端** (request.ts):
```typescript
request.params.cookie = encodeURIComponent(cookie);
```

**后端** (vite.config.ts):
```typescript
params.cookie = decodeURIComponent(params.cookie);
```

## 健康检查

```bash
curl http://127.0.0.1:36524/health
```

## 故障排查

### 端口占用
```bash
netstat -ano | findstr :36524
taskkill /PID <PID> /F
```

### 服务器未启动
检查控制台:
```
✅ Fastify API server started
✅ Registered 366 API routes
```
