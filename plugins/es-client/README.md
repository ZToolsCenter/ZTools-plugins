# ESClient

> ZTools 插件：轻量 Elasticsearch 客户端（连接管理 / 集群 / 索引 / DSL 搜索 / 文档 CRUD / REST 控制台）

技术栈：**Vue 3 + Vite + TypeScript**，目录对齐官方 [vue-vite 模板](https://github.com/ZToolsCenter/ztools-plugin-cli/tree/main/templates/vue-vite)。

## 功能

- **连接**：HTTP(S) + Basic Auth / API Key；创建时可直接测试连通
- **集群**：health、`GET /`、nodes
- **索引**：列表、mapping/settings、新建/修改/删除、别名、克隆（含文档）
- **搜索**：可视化条件（含嵌套 AND/OR）、match_all、文档 CRUD、查看/应用查询 JSON
- **REST**：Monaco Dev Tools 脚本、多请求 ▶、索引/字段补全、GET 带 Body
- **其它**：主题、状态持久化（ztools.db）、JSON Ctrl+F 查找
- **兼容**：Elasticsearch 7.x / 8.x
- **体验**：请求等待有 Loading 遮罩

### 触发指令

| Feature | 指令 |
|---------|------|
| `manage` | `ESClient`、`es`、`Elasticsearch` |

## 项目结构

```
.
├── src-ztools/                 # ★ 完整可安装插件目录（本地安装选这个）
│   ├── logo.png
│   ├── plugin.json             # 插件入口配置
│   ├── preload/
│   │   ├── package.json        # {"type":"commonjs"}
│   │   └── services.js         # build 生成，注入 window.services
│   └── dist/                   # UI 构建产物（base: './'）
├── src/                        # Vue 源码 + preload TypeScript
├── plugin.json                 # 与 src-ztools/plugin.json 同步
├── docs/superpowers/
└── tests/
```

依据 [插件应用目录结构](https://ztoolscenter.github.io/ZTools-doc/file-structure.html)：请将 **编译后的插件目录**（`src-ztools/`）安装到 ZTools，不要把源码根目录当作插件安装。

## 开发

```bash
npm i
npm run dev      # Vite，配合 development.main
npm test
npm run build    # UI → src-ztools/dist，preload → src-ztools/preload/services.js
npm run pack     # 构建并打包 es-client-plugin.zip
```

### 本地安装（ZTools）

1. `npm run build`（或 `npm run pack`）
2. ZTools → 插件管理 → **本地安装**
3. 选择 **`src-ztools`** 文件夹，或安装 `es-client-plugin.zip`
4. 搜索 `ESClient` / `es` 打开

开发模式：本地安装 `src-ztools/` 后，`plugin.json` 的 `development.main` 会指向 `http://localhost:5173`。

## 安全说明

- 密码 / API Key 仅存本地 `ztools.db`，不会写入日志或 toast
- 危险操作（删文档、REST DELETE、删索引）需确认

## 发布到插件中心

按 [第一个插件 · 发布](https://ztoolscenter.github.io/ZTools-doc/first-plugin.html)：

```bash
npm install -g @ztools-center/plugin-cli
# 工作区干净、已 commit
ztools publish
```

发布后请在 PR 中：上传截图/GIF、勾选自检清单、Mark as ready for review。

## License

MIT
