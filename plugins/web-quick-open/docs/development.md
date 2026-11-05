# 网页快开开发文档

本文合并原功能设计与批量图标设计文档，以当前实现为准。使用说明见 [README](../README.md)，版本记录见 [CHANGELOG](../CHANGELOG.md)

## 1. 项目结构

插件使用 Vue 3、TypeScript、Vite、ztools-ui，当前版本为 1.0.5

| 文件 | 职责 |
| --- | --- |
| `src/App.vue` | 入口管理、分组、详情编辑、浏览器管理与批量进度 |
| `src/components/DownSelect.vue` | 固定向下展开的选择器，按剩余空间限制菜单高度 |
| `src/style.css` | 页面布局、共享卡片与菜单样式、暗色适配 |
| `src/env.d.ts` | 数据模型与 preload API 类型 |
| `src/main.ts` | 组件库与宿主主题初始化 |
| `public/preload.js` | 存储、导入导出、动态指令、网络请求与程序启动 |
| `public/batch-icons.cjs` | 批量图标任务、并发、取消与增量写入 |
| `public/browser-icons.cjs` | 本地浏览器图标提取 |
| `public/browser-presets.json` | 各平台浏览器预设及图标 |
| `public/plugin.json` | 插件入口、版本与静态功能声明 |
| `tests/` | Node 内置测试运行器的回归测试 |

UI 通过 `window.webQuickOpen` 调用 preload，不直接访问数据库、启动进程或重复实现图标逻辑。新增接口时同步更新类型和调用方

## 2. 数据与存储

存储使用宿主 `dbStorage`，底层 API 为同步调用，不能承诺整个流程完全无阻塞

| 存储键 | 内容 |
| --- | --- |
| `web-quick-open-engines` | 网页及搜索入口 |
| `web-quick-open-groups` | 用户分组名称列表 |
| `web-quick-open-browser-profiles` | 可复用浏览器配置 |

### 入口

`id/name/url/icon/enabled/type` 为核心字段，`type` 为 `webpage` 或 `search`。附加字段包括 `keyword/group/browserId/iconSource`，旧数据可能携带 `browser`，读取时兼容迁移

- 搜索 URL 的 `{q}` 替换为编码后的搜索词
- `group` 为空时归入默认分组，删除分组时入口移回默认分组
- `browserId` 为空、为 `system` 或配置缺失时，使用系统默认浏览器
- `iconSource` 为 `auto` 或 `manual`；清空图标时清除来源
- 上传图片标记 `manual`，自动获取成功标记 `auto`，失败保留原图及来源
- JSON 导入本身不代表手动图标，应保留来源；旧版来源不明的已有图标默认受保护

### 浏览器配置

字段为 `id/name/icon/path/args/builtin/hidden/platform`，入口仅通过 `browserId` 引用。启动参数存为数组，支持重复的 `{url}` 占位符；未写占位符时自动追加 URL

预设按当前平台过滤，用户配置保留。各系统预设使用独立 ID，避免覆盖既有 Windows 配置。内置预设的删除操作实际为隐藏，恢复默认可重新显示；跨平台导入不改写用户路径

## 3. 页面与交互

- 主页面负责搜索、分组筛选、启停、预览与编辑；启用入口注册宿主动态指令，停用或删除时移除
- 详情页维护名称、URL、关键字、分组、打开方式和图标
- 分组和打开方式使用 `DownSelect` 包装 `ZSelect`，固定 `bottom-start`，关闭自动翻转，下方空间不足时缩短菜单并滚动
- 默认选项使用数字 `0` 作为界面值，提交时映射回 `null`，避免空字符串被组件当作未选择
- 已选浏览器即使不在可见列表中，也保留其名称；引用缺失时显示警告，启动仍回退系统默认
- 浏览器卡片复用网页卡片的外壳、图标、标题和操作区；路径与参数省略显示，悬浮查看完整内容
- 刷新主按钮重新读取数据，箭头展开批量图标菜单；菜单与新增菜单共享样式，支持外部点击和 Esc 关闭
- 颜色沿用宿主主题变量；新增控件同时检查亮色、暗色和窄窗口

## 4. 打开网页与程序安全

### 分组指令

非默认分组以 `quick-group-${encodeURIComponent(name)}` 注册动态指令，`cmds` 使用分组名字符串，与网页关键字采用相同的宿主匹配方式。分组与网页使用不同的指令前缀，避免冲突

启动时恢复已有分组指令；创建、重命名、删除和导入后同步，清理旧指令时保留静态入口。空分组也注册指令，执行时提示没有可打开的网页

前端识别分组指令后调用 `openGroup(name)`，按顺序打开组内已启用的 `webpage` 入口，沿用各自的浏览器配置。默认分组、停用入口和需要搜索词的 `search` 入口不参与批量打开。单项失败不影响其余入口，返回打开和失败数量；全部失败不隐藏主窗口，部分失败提示数量。浏览器配置中的新窗口或隐私参数仍生效，不保证全部网页进入同一窗口

### 浏览器启动

默认浏览器通过宿主打开外部链接，自定义配置通过 `spawn(path, args, { shell: false })` 启动，URL 限定为 HTTP/HTTPS，拒绝脚本扩展名

不扫描用户本地浏览器，路径由用户选择或填写。Windows 支持固定的 App Paths 查询，macOS 应用包通过 `open -a ... --args` 启动，Linux 内置预设仅在 ENOENT 时尝试已知别名，不扫描目录

本地图标提取异步执行，整体最多 2 秒，超时终止子进程。macOS 转换临时文件后清理，Linux 仅检查约定图标路径。上传图标上限 1 MB，预设图标来自 browser-logos，商标归各浏览器厂商所有

## 5. 网页图标与网络

### 获取顺序

页面 HTML、站点 `/favicon.ico` 和远端服务并发请求，但不再采用首个返回结果。选择优先级为：

1. 页面声明的图标，按解析候选顺序选择可用结果
2. 站点根目录图标，页面重定向后也尝试最终站点
3. 远端 `https://fav.lee.cm/get.php?url=${encodeURIComponent(parsed.host)}`

总时限为 5 秒。到期优先返回已完成的根目录结果，其次返回已完成的远端结果；均不可用时报告超时。成功、失败或取消后中止剩余请求，失败不覆盖原图

远端可能返回默认地球图或旧图，不能仅以请求更快为由优先采用。BeJSON 是此问题的回归场景

### HTML 与图片

只读取 HTML head，最多 256 KB；候选最多 8 个，单张图标读取上限 1 MB。优先使用 DOMParser，缺失或未提取到链接时使用轻量属性解析，支持相对路径、查询参数和 base 地址

候选识别 `icon`、`apple-touch-icon`、`mask-icon`、`fluid-icon`，仅允许 HTTP/HTTPS。下载检查状态码、非空内容及图片或二进制 MIME，缺少类型时根据 URL 推断；保存前沿用现有 PNG 压缩流程

### 网络栈

浏览器运行时统一使用页面原生 `fetch`，走宿主插件 Session 的 Chromium 网络栈及代理设置。不发送 Cookie、Referer，不用缓存；流式读取支持大小限制、head 截断和 AbortController

仅在没有浏览器 fetch 的测试或非浏览器环境使用 Node transport。Chromium 请求失败不自动切换 Node 直连，以免绕过代理。Chromium 管理重定向，Node 回退最多跟随 5 次

## 6. 批量图标任务

### 范围与来源保护

任务覆盖全部网页和搜索入口，包括停用入口，不受当前搜索和分组筛选影响，不批量修改浏览器配置图标

| 图标状态 | 行为 |
| --- | --- |
| 无图标 | 获取 |
| 已有图标且来源为 `auto` | 重新获取 |
| 已有图标且来源为 `manual` | 跳过 |
| 已有图标但来源缺失或未知 | 跳过 |

开始前确认范围和受保护数量；没有候选时不创建任务。旧图标可在详情页单次自动获取，成功后进入自动更新范围

### 队列与写入

- 同时最多处理 3 个不同 URL，按替换 `{q}` 后的完整规范 URL 去重，不按域名合并
- 去重结果仅在当前任务内复用，失败也不重复请求，进度仍按入口统计
- 每累计 10 个结果或等待 500 毫秒增量写入，完成和取消时写入剩余结果，批次间让出事件循环
- 写入前重读最新数据，只合并图标与来源；入口已删除、URL 或图标及来源已变化时跳过，避免覆盖并发编辑
- 修改名称、分组和启用状态不妨碍图标写入；成功后同步动态指令图标
- 存储失败停止任务，未写入结果不计为成功；指令同步失败不撤销已保存图标

### 生命周期与接口

同一时间只有一个任务。运行时禁止刷新、重复启动和导入，保留入口管理操作。取消停止排队并中止在途请求，保留已保存结果，失败或取消不清空旧图标

`startBatchIcons/getBatchIconsStatus/cancelBatchIcons` 分别负责启动、查询与按任务 ID 取消。状态包含 `id/status/total/processed/updated/failed/skipped/error/revision`，UI 据此显示进度和刷新已写入内容。关闭插件时取消任务，再次进入读取当前状态

## 7. 导入导出

导出格式为 `ztools.web-quick-open`、版本 2，包含 `groups/engines/browserProfiles`。导入合并数据，ID 冲突时重新分配并重映射引用；与预设冲突但内容不同的配置作为自定义配置保存，无效引用回退默认。兼容旧数组格式及入口内旧 browser 字段

JSON 上限 20 MB。优先使用临时 Web Worker，其次 Node Worker；不可用时让出事件循环后本地解析。使用完毕终止 Worker 并释放 Blob URL，不以超时竞速重复解析

校验、图标处理和动态指令同步分批让出事件循环，Worker 不调用宿主 API。数据库同步写入仍可能短暂阻塞；不要将异步解析等同于数据库异步

## 8. 日志与排查

Debug 通过宿主 electron-log 5 的 `__ELECTRON_LOG__` IPC 接入日志收集，不可用时回退 console。使用宿主 DEBUG 等级筛选 `WebQuickOpen`，不增加独立日志开关

记录操作 ID、关联 trace、耗时、请求来源、状态码、进度和脱敏错误，不输出 URL、完整参数、图标数据或令牌，日志失败不影响业务

| 现象 | 排查方向 |
| --- | --- |
| 浏览器有图标，插件获取失败 | 检查 head 候选数量、DOMParser 回退、MIME、5 秒超时和插件代理 |
| 获取到地球或旧图 | 比较站点与服务图，确认优先选择站点而非服务速度 |
| Chrome 可访问但插件不可访问 | 检查宿主 Session 代理，不假定两个应用网络配置相同 |
| 批量任务跳过已有图标 | 检查来源，manual 和旧版未知来源均受保护 |
| 选择框显示占位文字 | 检查默认界面值与实际选项是否匹配，默认不可用空字符串 |
| 浏览器菜单向上展开 | 检查是否绕过 DownSelect 或重新开启自动翻转 |

## 9. 开发、测试与打包

在 `ZTools-Plugins/plugins/web-quick-open` 执行：

```powershell
npm install
npm run dev
npm test
npm run build
```

开发服务为 127.0.0.1:5178，宿主开发入口见 plugin.json。`npm run build` 先执行 vue-tsc，再由 Vite 生成 dist；public 文件复制进产物，README、CHANGELOG 和本开发文档由构建插件复制。单独构建 dist 不会更新 ZIP

仅打包此插件时，在 `ZTools-Plugins` 执行：

```powershell
$env:BUILD_PLUGINS = 'web-quick-open'
npm run detect
if ($LASTEXITCODE -eq 0) { npm run build }
```

安装包位于 `release/web-quick-open-1.0.5.zip`，版本来自插件声明。更新版本时同步 package.json、锁文件及 public/plugin.json，勿手改 dist 或 ZIP

### 验证清单

- 分组指令：注册、重命名、删除、导入与启动恢复，跳过停用和搜索入口，浏览器配置、部分失败和空分组提示；宿主内检查分组名搜索及点击打开
- `npm test`：入口迁移、分组、浏览器启动与图标、导入导出、网络、批量队列及取消
- 选择器定位测试：固定向下、空间不足滚动、滚动和缩放后重算、关闭后释放监听
- `npm run build`：类型检查和生产构建
- 宿主人工验证：亮暗主题、窄窗口、详情页滚动后的下拉位置、真实选项名称和键盘操作
- 批量人工验证：手动图保护、取消不清空旧图、并发编辑不被覆盖、动态指令图标同步
- 网络人工验证：BeJSON、OneCompiler、YAML Tools，以及代理失败和总超时路径

单元测试和构建不能替代宿主视觉验收。格式化遵循插件 `.prettierrc.json`：单引号、无分号、100 列、无尾随逗号、LF。仅格式化修改文件，保留无关工作区变更；不在验证过程中推送、发布或修改授权
