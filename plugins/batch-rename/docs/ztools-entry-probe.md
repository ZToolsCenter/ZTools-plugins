# ZTools 入口 Probe 记录

## 结论状态

Phase 0 的 A～D 入口验证已完成。ZTools 3.2.0 的文件上下文入口会传入选中文件；普通主面板搜索不会自动携带 Explorer 当前选择。

## 测试基线

- 测试日期：2026-09-25
- 操作系统：Windows
- ZTools：ZToolsCenter 3.2.0
- 运行时：Windows x64、Node.js 24.15.0、Electron 41.4.0
- 插件 ID：`batch-rename-probe`
- 分支：`chore/phase-0-entry-probe`
- Probe 原则：仅记录入口参数和内存会话变化，不读取或修改被选文件内容

## 已收到的实测报告

### 普通入口（Probe C）

- 报告时间：2026-09-25 02:32:09 UTC（北京时间 10:32:09）
- 安装模式：`isDev: false`，说明运行的是本地安装包
- `onPluginEnter`：已触发 1 次
- `code`：`batch-rename`（普通关键词入口）
- `type`、`payload`：报告中未出现
- 提取到的绝对路径：0 条
- 会话：当前文件列表为空，模拟 Undo 不存在
- 触发场景：用户确认未选中文件，经普通搜索进入插件

结论：Probe C 的普通启动通过，且本次没有自动带入文件；尚不能验证重入时是否保留已有任务与 Undo。

### 文件入口（Probe A）

- 报告时间：2026-09-25 02:36:58 UTC（北京时间 10:36:58）
- 入口：Explorer 选中 4 个文件后，经 ZTools 文件上下文进入
- `onPluginEnter`：再次触发，事件序号为 3
- `code`：`batch-rename-files`
- `type`：`files`
- `payload`：长度为 4 的数组；每项包含 `isFile: true`、`isDirectory: false`、`name`、`path`
- `path`：Windows 绝对文件路径；此处省略用户文件名，不在文档中保存原始路径
- 提取路径：4 条；`session.currentFiles` 同步变为这 4 条路径
- 执行的会话动作：替换当前文件列表，并把模拟 Undo 设为 `false`
- 在本次进入前记录到 `plugin-out` 且 `isKill: false`；再次进入时旧事件仍在，说明该次退出没有丢失 Probe 页面状态

结论：选中文件可通过 FilesCmd 一次传入 4 个文件；入口识别应以 `code: batch-rename-files` 为准，并从 `payload[].path` 读取文件路径。因为测试前模拟 Undo 已为 `false`，此报告不能证明清除 Undo 的实际效果。

### 选中文件后普通搜索（Probe B）

- `plugin-enter` 事件时间：2026-09-25 02:38:34 UTC（北京时间 10:38:34）
- 触发场景：Explorer 仍选中文件，经 `Alt+Z` 普通搜索“批量重命名”进入
- `code`：`batch-rename`
- `type`：`text`
- `payload`：空字符串
- 提取路径：0 条
- 会话：`currentFiles` 仍是 Probe A 已载入的 4 条路径，模拟 Undo 为 `false`

结论：当前 ZTools 3.2.0 中，经主面板普通搜索进入不会自动携带 Explorer 当前选择；普通入口保留已有文件列表。此结果不能证明已有模拟 Undo 会保留，因为进入前该值为 `false`。

### 新文件上下文任务（Probe D）

- `plugin-enter` 事件时间：2026-09-25 02:41:20 UTC（北京时间 10:41:20）
- 操作：按测试步骤先创建模拟 Undo，再从 Explorer 选取与 Probe A 不同的 4 个文件，通过文件上下文进入
- `code`：`batch-rename-files`
- `type`：`files`
- `payload`：4 个文件对象；文件名和完整路径不写入文档
- 会话：`currentFiles` 变为新选中的 4 条路径，不含 Probe A 的文件；`hasSimulatedUndo: false`
- 旧事件仍在；本次进入前记录到 `plugin-out` 且 `isKill: false`

结论：文件入口再次触发时，插件沿用原有页面状态并替换当前任务；按本次操作步骤，之前创建的模拟 Undo 被清除。导出报告只显示最终 Undo 状态，没有记录点击按钮后的中间状态；正式实现还需为 Undo 生命周期编写集成测试。

### 对 V1 实现的约束

1. 用 `code: batch-rename-files` 识别文件上下文任务；将 `payload` 作为文件对象数组处理，从每项的 `path` 读取绝对路径。
2. 普通搜索入口使用 `code: batch-rename`。即使 Explorer 当前选中了文件，ZTools 也可能给出 `type: text`、空 `payload`；此时保留当前任务，不自行读取 Explorer 选择。
3. 文件入口重入视为新任务：替换文件列表、重置默认 Tab 和排序、清除最近一次 Undo。
4. `onPluginOut(false)` 后页面状态在本次测试中保留；完全退出 ZTools 后 Undo 生命周期未在本 Probe 中实测，正式实现不可依赖持久化状态。

## 安装与运行

### 本地安装（ZIP）

1. 执行 `pnpm install`。
2. 执行 `pnpm build`。
3. 执行 `./scripts/package-probe.ps1 -OutputPath <目标 ZIP 绝对路径>`。ZIP 根目录必须直接包含 `plugin.json`、`index.html`、`logo.png` 和 `preload/services.js`，不能多一层 `dist/`。
4. 在 ZTools 插件管理页面选择“本地安装”，选中生成的 `.zip` 文件。

当前可安装包：`D:\Ai_Project\quick-batch-rename\outputs\batch-rename-probe-0.0.1.zip`。

### 开发项目入口（与本地安装不同）

1. 执行 `pnpm dev`。
2. 在 ZTools 的“导入开发插件”入口选择项目根目录的 `plugin.json`；此入口的文件选择器接受 JSON。
3. ZTools 将读取 `development.main` 并连接本地 Vite 服务。

ZTools 3.2.0 的“本地安装”文件选择器只接受 `.zpx` / `.zip`。官方开发文档把 `dist` 描述为构建后的插件内容目录，但实际安装需要把它封装为上述文件格式。

依据：

- [ZTools AI 插件开发指南](https://ztoolscenter.github.io/ZTools-doc/ai-plugin-guide.html)：`dist` 是构建后的插件应用目录。
- [ZTools 插件安装实现](https://github.com/ZToolsCenter/ZTools/blob/main/src/main/api/renderer/pluginInstaller.ts)：本地安装文件选择器只接受 `.zpx` / `.zip`，ZIP 根目录读取 `plugin.json`。
- [ZTools 开发项目导入实现](https://github.com/ZToolsCenter/ZTools/blob/main/src/main/api/renderer/pluginDevProjects.ts)：开发项目入口选择 `plugin.json`。

## Probe A：Explorer 文件上下文

步骤：Explorer 选中 4 个测试文件，通过 ZTools 文件上下文进入“批量重命名”。

- 状态：通过
- `code`：`batch-rename-files`
- `type`：`files`
- `payload`：4 个文件对象组成的数组
- 路径结构：`payload[].path` 为 Windows 绝对路径
- 是否一次收到全部 4 个文件：是

## Probe B：Explorer 选中文件后普通搜索

步骤：Explorer 选中 4 个测试文件，按 `Alt+Z`，搜索“批量重命名”并回车。

- 状态：通过
- 是否进入 files 指令：否，进入普通关键词指令
- 是否携带当前选中的 4 个文件：否；已有文件列表继续显示
- `code`：`batch-rename`
- `type`：`text`
- `payload`：空字符串

## Probe C：无文件选择时普通搜索

步骤：取消文件选择，按 `Alt+Z`，搜索“批量重命名”并回车。

- 状态：普通启动通过；已有 Undo 保留行为未单独实测
- 是否正常启动：是；`onPluginEnter` 收到 `code: batch-rename`
- 是否保留当前任务：Probe B 已验证普通入口保留已有文件列表
- `code`：`batch-rename`
- `type` / `payload`：导出报告中未出现
- 提取路径：0 条

## Probe D：新文件上下文替换当前任务

步骤：先进入插件并点击“创建模拟 Undo”，再从 Explorer 选择另一批文件，通过文件上下文进入插件。

- 状态：通过
- 是否保留原有页面状态：是，旧事件仍在
- 是否触发新的 `onPluginEnter`：是，`code: batch-rename-files`
- 当前文件是否替换：是，旧 4 个文件换成新 4 个文件
- 模拟 Undo 是否清除：是，按用户操作步骤，进入前设为“存在”，进入后报告为 `false`

## 补充生命周期检查

- 普通隐藏后再次打开是否保留页面内存：是，旧事件在后续报告中仍可见
- `onPluginOut(false)` 是否触发：是，在 Probe C 退出后记录到事件序号 2
- 完全结束插件时是否收到 `onPluginOut(true)`：待记录
- 仅修改文件名大小写时，Windows 文件系统行为：待后续执行引擎 Probe

## Phase 0 完成门槛

- [x] 确认目标客户端和版本
- [x] 建立 Git 仓库与独立开发分支
- [x] 创建最小 UI Probe 插件
- [x] 分离普通指令与 FilesCmd 的 feature code
- [x] 展示原始 `code`、`type`、`payload`
- [x] 展示可提取的绝对路径
- [x] 实现当前任务与单级 Undo 的模拟状态及展示
- [x] 通过宿主重入验证模拟 Undo 的清理行为
- [x] Probe C：无文件选择时，普通搜索可启动插件
- [x] Probe A：Explorer 选中的 4 个文件通过 FilesCmd 一次传入
- [x] Probe B：Explorer 选中文件后普通搜索不自动携带选择，已有文件列表保留
- [x] Probe D：新文件上下文任务替换旧列表并清除模拟 Undo
- [x] 完成 Probe A～D 宿主实测
- [x] 把实测结论写回本文档
