# ztools-rss

> 在 ZTools 内阅读 RSS 文章，支持 FreshRSS / Google Reader API 兼容服务端。

## 功能

- **双栏布局**：左栏为订阅源树 + 文章列表（按时间逆序），右栏为文章正文。
- **Google Reader API**：兼容 FreshRSS（默认）、Miniflux、Inoreader、The Old Reader 等服务端。
- **订阅源树**：按分类（文件夹）分组，显示未读计数，支持折叠。
- **文章阅读**：HTML 正文渲染（经 DOMPurify 清洗）、加星、标记已读、原文跳转。
- **明暗主题**自适应。

## 使用方式

1. 在 ZTools 主输入框输入 `rss` / `RSS` / `订阅` 进入插件。
2. 首次使用点击右上角 ⚙，填写账号配置：
   - **API 地址**：FreshRSS 的 `greader.php` 地址，例如 `https://your-host/api/greader.php`（不带尾斜杠）。
   - **用户名**：FreshRSS 用户名。
   - **API 密码**：在 FreshRSS「账户管理」中设置的**专用 API 密码**（非登录密码）。
3. 连接成功后，左侧选择订阅源即可阅读。

## 开发

```bash
npm install
npm run dev      # 开发服务器 http://localhost:5173
npm run build    # 类型检查 + 生产构建，输出到 dist/
```

## 项目结构

```
.
├── public/
│   ├── logo.png              # 插件图标
│   ├── plugin.json           # 插件配置
│   └── preload/
│       ├── package.json
│       └── services.js       # Node.js 层：rssFetch（规避渲染进程 CORS）
└── src/
    ├── main.ts               # 入口
    ├── main.css              # 全局样式 / 主题变量
    ├── App.vue               # 路由
    ├── env.d.ts              # 类型声明
    └── Reader/
        ├── index.vue         # 双栏布局容器
        ├── types.ts          # Google Reader API 类型
        ├── api.ts            # API 客户端（登录/订阅/文章/标记）
        ├── store.ts          # 响应式状态管理
        ├── utils.ts          # 日期等工具函数
        ├── FeedTree.vue      # 订阅源树
        ├── ArticleList.vue   # 文章列表
        ├── ArticleView.vue   # 文章正文
        └── Settings.vue      # 账号配置弹窗
```

## Google Reader API 端点

基于 [FreshRSS GReader API](https://freshrss.github.io/FreshRSS/en/developers/06_GoogleReader_API.html)：

| 功能 | 方法 & 路径 |
| --- | --- |
| 登录 | `POST /accounts/ClientLogin` |
| 订阅列表 | `GET /reader/api/0/subscription/list` |
| 未读计数 | `GET /reader/api/0/unread-count` |
| 文章流 | `GET /reader/api/0/stream/contents/<streamId>` |
| 修改令牌 | `GET /reader/api/0/token` |
| 标记已读/加星 | `POST /reader/api/0/edit-tag` |
| 整源已读 | `POST /reader/api/0/mark-all-as-read` |

所有网络请求经 preload 层（Node.js `http`/`https`）发起，以规避渲染进程 CORS 限制。

## 开源协议

MIT License
