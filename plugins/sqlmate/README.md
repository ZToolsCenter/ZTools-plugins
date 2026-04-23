# SQLMate Plugin for ZTools

> 本地优先的 SQL 数据处理工具集，12 项功能覆盖 DBA / 开发者日常数据处理全场景。
> 数据不离本机，完全离线运行。

---

## 功能一览

### 基础处理

| 功能 | 触发词 | 说明 |
|------|--------|------|
| **合并** | `SQL合并` / `合并INSERT` | 多条单行 INSERT → 批量插入，可配置每批条数 |
| **拆分** | `SQL拆分` / `拆分INSERT` | 批量 INSERT → 逐行单条，与合并互为逆操作 |
| **分割** | `SQL分割` / `切割SQL` | 大文件按行数或 MB 切成多个小文件 |
| **抽取** | `SQL抽取` / `按表抽取` | 扫描 dump 文件所有表名，勾选抽取指定表数据 |
| **统计** | `SQL统计` / `表统计` | 扫描各表行数和估算大小，可导出 Markdown / CSV |

### 数据治理

| 功能 | 触发词 | 说明 |
|------|--------|------|
| **去重** | `SQL去重` / `INSERT去重` | 按列名或列序号去重，保留第一条或最后一条 |
| **脱敏** | `SQL脱敏` / `数据脱敏` | 手机号、身份证、邮箱、姓名等 6 种脱敏类型，支持自定义和正则 |
| **替换** | `表名替换` / `列名替换` | 批量替换表名（精确/前缀）和列名 |
| **ID偏移** | `ID偏移` / `主键偏移` | 数值列批量加偏移量，合库时避免主键冲突 |
| **改写** | `语句改写` / `INSERT转UPDATE` | INSERT → UPDATE / MySQL UPSERT / PG UPSERT / INSERT IGNORE |

### 对比分析

| 功能 | 触发词 | 说明 |
|------|--------|------|
| **数据Diff** | `SQL对比` / `数据Diff` | 按主键逐行对比两份 SQL，输出新增/删除/修改/未变明细 |
| **DDL对比** | `DDL对比` / `表结构对比` | 对比两张表 CREATE TABLE，自动生成 ALTER TABLE（MySQL / PostgreSQL / Oracle） |

---

## 大文件支持

所有功能均自动判断文件大小：

- **≤ 10 MB**：内存处理，结果直接展示在界面，可复制或保存
- **> 10 MB**：流式处理（Node.js `readline` 逐行读取），内存占用恒定，支持 GB 级文件

拖拽 `.sql` 文件到 ZTools 搜索框可直接触发对应功能并自动填入。

---

## 使用方式

1. 在 ZTools 搜索框输入触发词（如 `SQL合并`）打开对应功能
2. 或直接搜索 `sqlmate` 打开主界面，通过左侧导航切换功能
3. 粘贴 SQL 文本，或点击「选择文件」/ 拖拽 `.sql` 文件到输入区
4. 配置参数后点击执行，结果可复制或保存到本地文件

---

## 开发

```bash
# 安装依赖
npm install

# 开发模式（热重载）
npm run dev

# 构建生产版本（产物含 README.md）
npm run build
```

### 项目结构

```
sqlmate-plugin/
├── public/
│   ├── plugin.json          # ZTools 插件配置
│   ├── logo.png             # 插件图标
│   └── preload/             # Node.js 服务层（明文，不可混淆）
│       ├── services.js      # 统一 API 入口，自动路由大/小文件
│       └── lib/             # 纯函数核心库（12 个功能模块）
│           └── stream/      # 流式处理库（大文件 readline）
├── src/
│   ├── App.tsx              # 根组件 + 侧边导航
│   ├── pages/               # 12 个功能页面
│   ├── components/          # 公共组件（FileInput、ResultPanel 等）
│   └── hooks/               # React Hooks
├── dist/                    # 构建产物（发布插件时使用此目录）
└── README.md
```

### 技术栈

| 层 | 技术 |
|---|---|
| 前端框架 | React 19 + TypeScript |
| 构建工具 | Vite 6 |
| 样式 | 纯 CSS（CSS 变量，支持亮/暗色模式） |
| Node.js 层 | CommonJS（ZTools preload 规范，明文不压缩） |
| 流式处理 | Node.js `readline`，O(1) 内存占用 |

---

## License

MIT
