# hooost

> ZTools 插件，用于管理本地 hosts 多环境配置。

`hooost` 用来把开发、测试、生产等不同场景的 hosts 片段拆成独立配置，在 ZTools 中集中管理，并按需启用、停用、排序，最后再安全地合并回系统 hosts。

## 适用场景

- 需要频繁切换不同 API、域名或联调环境
- 希望把常用 hosts 配置沉淀成多套环境
- 想保留自己手写的 hosts 内容，不被工具整体覆盖

## 功能概览

- 只读查看当前系统 hosts（`实际配置`）
- 首次初始化自动生成「开发配置 / 测试配置 / 生产配置」
- 支持新增、重命名、编辑、删除自定义配置
- 支持双击或右键快速启用 / 停用配置
- 支持拖拽调整配置顺序
- 仅将已启用配置合并写回系统 hosts
- 每次应用前自动备份当前 hosts
- 写入成功后自动尝试刷新 DNS 缓存
- 保留 Docker Desktop、Tailscale 等外部区段

## 安装与进入插件

`hooost` 是一个 **ZTools 插件**，不是独立桌面应用。

1. 在 ZTools 中导入或加载本项目作为插件
2. 通过以下任一命令词进入插件：
   - `hosts`
   - `切换hosts`
   - `管理hosts`

插件元数据位于 `public/plugin.json`，当前标题与命令入口如下：

- 插件名：`hooost`
- 描述：`本地 hosts 配置管理，支持预设切换、备份与回滚`
- 命令词：`hosts` / `切换hosts` / `管理hosts`

## 快速上手

1. 打开插件后，左侧会看到两个区域：
   - `实际配置`：只读查看当前系统 hosts
   - `配置列表`：用于管理你的环境配置
2. 点击 `新增` 创建一套新配置
3. 在右侧源码编辑器中输入 hosts 条目，编辑完成后点击 `确认`
4. 双击某个配置，或右键选择 `启用此配置` / `停用此配置`
5. 启用后，hooost 会把所有已启用配置按顺序合并写入系统 hosts
6. 删除已启用配置时，系统会先将其停用，再从配置列表中移除

### 源码编辑示例

```text
127.0.0.1 api.local.test
127.0.0.1 admin.local.test
# 127.0.0.1 old-api.local.test
```

说明：

- 以 `#` 开头的 hosts 行会被识别为**已禁用条目**
- 应用到系统 hosts 时，只会写入**已启用条目**
- 注释和空行会保留在编辑器里，但合并写入时只输出有效 hosts 条目

## 工作原理

hooost 不会简单覆盖整个 hosts 文件。

每次启用或停用配置时，它会按下面的方式处理：

1. 读取当前系统 hosts
2. 将不属于受管环境块的内容视为基础内容保留
3. 把所有已启用配置渲染成分组块
4. 将这些分组块追加到基础内容后面
5. 写回系统 hosts

当前实现使用的分组头尾格式如下：

```text
#-------- 开发配置 --------
127.0.0.1 api.local.test
127.0.0.1 admin.local.test
#-------- 开发配置 结束 --------
```

这意味着：

- 你的原始 hosts 内容不会被整段替换
- 已知外部区段（如 Docker Desktop、Tailscale）会被保留
- 如果历史 hosts 中存在缺失结束标记的环境块，插件会尝试自动补全并规范化

## 权限、备份与 DNS

修改系统 hosts 需要管理员权限。

- **Windows**：优先直接写入；失败时通过 PowerShell 提权复制
- **macOS**：优先直接写入；不可写时先申请授权调整 `/etc/hosts` 权限，再由插件自身写入

每次应用配置前，hooost 都会先自动备份当前 hosts 文件。

备份目录：

- **Windows**：`%APPDATA%/hooost/backups`
- **macOS**：`~/Library/Application Support/hooost/backups`

写入或恢复后，插件会尝试刷新系统 DNS 缓存，减少切换后仍命中旧解析结果的情况。

> 当前主界面重点是环境管理流程；自动备份文件会保存在本地数据目录中。

## 数据存储

环境数据通过 `window.ztools.dbStorage` 持久化，当前存储 key 为：

```text
hooost:environment:store
```

存储内容包括：

- 配置列表及顺序
- 当前启用状态
- 每个配置的源码内容

首次初始化时会自动生成：

- `实际配置`（只读系统 hosts 视图）
- `开发配置`
- `测试配置`
- `生产配置`

加载旧数据时，插件会自动做归一化和兼容处理。

## 开发

```bash
npm install
npm run dev
npm run build
```

说明：

- 开发服务器地址：`http://localhost:5179`
- `public/plugin.json` 中的 `development.main` 已指向该地址
- `npm run build` 会执行 `vue-tsc && vite build`

## 关键文件

```text
public/
├── plugin.json              # 插件元数据与命令入口
└── preload/
    └── services.js          # hosts 读写、备份、恢复、提权、DNS 刷新
src/
├── App.vue                  # 主界面与主流程
├── lib/hosts.ts             # hosts 解析、规范化、合并逻辑
├── composables/useEnvironmentStorage.ts
│                           # 环境数据持久化与初始化
└── components/
    ├── EnvironmentList.vue  # 左侧环境列表
    └── EnvironmentEditor.vue# 右侧源码编辑器
```

## 常见问题

### 1. 无法写入 hosts

通常是权限不足。请确认当前环境允许以管理员身份修改系统 hosts。

### 2. 为什么开发地址是 5179，不是 5173？

当前项目在 `vite.config.js` 中固定使用 `5179`，用于避免与主程序默认端口冲突。

### 3. 启用后为什么解析结果没有立刻变化？

插件会尝试刷新 DNS，但不同系统和应用仍可能存在短暂缓存。可以重开终端、浏览器，或稍等片刻再验证。

### 4. 为什么编辑器里的注释没有写进系统 hosts？

当前合并逻辑只会把**已启用的 hosts 条目**写回系统 hosts；注释、空行和已禁用条目不会进入最终环境块。

## 开源协议

MIT License
