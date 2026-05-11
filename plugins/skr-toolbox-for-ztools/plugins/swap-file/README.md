# SwapFile 文件分享

局域网文件分享 ZTools 插件。在本机启动 HTTP 服务器，同一局域网内的设备通过浏览器即可浏览、下载和上传文件。

## 功能

- 选择文件或文件夹分享到局域网
- 文件树浏览，支持搜索、展开/折叠
- 其他设备通过浏览器访问 Web 页面浏览和下载文件
- 移动端适配：文件多选批量下载、Action Sheet 上传
- PC 端拖拽上传，移动端相册/文件选择上传
- 访问地址二维码，方便手机扫码
- 多网卡 IP 选择，优先 192.168.x.y，支持记住选择
- 上传目录可自定义，默认 `os.tmpdir()/SwapFile`
- 实时 WebSocket 通知（文件上传提醒等）
- 仅允许局域网 IP 访问，拒绝外网请求

## 开发

```bash
npm install
npm run dev     # 启动 Vite 开发服务器 http://localhost:5173
npm run build   # 类型检查 + 构建 → dist/
```

## 架构

```
渲染进程 (Vue 3)                    Preload (Node.js)
┌──────────────────┐               ┌──────────────────────┐
│  src/            │               │  public/preload/     │
│  ├─ FileShare/   │  window       │  └─ services.js      │
│  ├─ components/  │◄─services──►  │     ├─ Fastify HTTP  │
│  ├─ store/       │               │     ├─ WebSocket     │
│  └─ composables/ │               │     └─ 文件系统操作  │
└──────────────────┘               └──────────────────────┘
                                          │
                                   ┌──────┴──────────┐
                                   │ public/web/     │
                                   │ index.html      │
                                   │ (浏览器客户端)  │
                                   └─────────────────┘
```

- **渲染进程** — Vue 3 + Pinia + TypeScript + SCSS，运行在 ZTools webview 中
- **Preload** — CommonJS，拥有完整 Node.js 权限，通过 `window.services` 暴露能力
- **Web 客户端** — 独立原生 HTML/JS 页面，由 Fastify 提供给局域网设备

## 技术栈

| 层级 | 技术 |
|------|------|
| UI 框架 | Vue 3 Composition API |
| 状态管理 | Pinia |
| HTTP 服务 | Fastify + @fastify/cors + @fastify/static + @fastify/multipart |
| WebSocket | ws |
| 构建工具 | Vite |
| 样式 | SCSS (sass-embedded) |
| 图标 | lucide-vue-next |
| 二维码 | qrcode |

## 默认端口

- HTTP: `32123`
- WebSocket: `32124` (HTTP 端口 + 1)

## 协议

MIT
