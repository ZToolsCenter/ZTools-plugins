# 权限与数据说明

## 授权方式

首次手动备份、读取版本或恢复时，通过宿主官方弹窗一次申请以下 33 项高级 API。即使第一次仅备份，也会包含恢复需要的写入权限；这是为了避免后续重复申请。完整批准后需重试操作，批准不会自动恢复；不完整批准或权限不可用时停止任务。后台不弹出申请。

不申请完全授权、不申请管理其他插件授权的 API，也不自行修改宿主授权名单。插件卸载不自动删除用户 WebDAV 备份。

**权限粒度与代码行为不同**：例如 db-get/db-put 是访问宿主数据库的较宽能力，并非宿主强制的字段级隔离。本插件代码使用下述固定文档和字段白名单，页面不暴露任意 IPC 或任意路径读写。用户仍须信任所安装代码；此声明不是宿主级沙箱保证。

| 申请的 API 通道 | 本插件用途 |
| --- | --- |
| `internal:db-get` | 读取本机通用设置、已安装插件清单、插件行为及快捷键文档 |
| `internal:get-disabled-plugins` | 读取插件禁用状态 |
| `internal:get-current-shortcut` | 读取主唤起快捷键 |
| `internal:db-put` | 仅写入用户选择的设置、插件行为和快捷键；维护本插件后台启动名单 |
| `internal:fetch-plugin-market` | 查询可安装插件及当前市场版本 |
| `internal:get-commands` | 核对恢复快捷键的目标指令 |
| `internal:install-plugin-from-market` | 安装用户选择的缺失市场插件 |
| `internal:set-plugin-disabled` | 恢复所选插件禁用状态 |
| `internal:update-shortcut` | 注册恢复的主唤起快捷键 |
| `internal:update-primary-color` | 立即应用主题色 |
| `internal:register-global-shortcut` | 注册所选全局插件指令快捷键 |
| `internal:unregister-global-shortcut` | 移除被替换的全局快捷键及失败补偿 |
| `internal:register-app-shortcut` | 注册所选应用内插件指令快捷键 |
| `internal:unregister-app-shortcut` | 移除被替换的应用内快捷键及失败补偿 |
| `internal:set-theme` | 立即应用主题 |
| `internal:set-window-opacity` | 立即应用窗口透明度 |
| `internal:set-compact-main-window-header` | 立即应用紧凑顶部栏 |
| `internal:set-window-default-height` | 立即应用默认窗口高度 |
| `internal:update-placeholder` | 立即应用搜索框提示 |
| `internal:update-auto-paste` | 立即应用自动粘贴 |
| `internal:update-auto-clear` | 立即应用自动清空输入 |
| `internal:update-auto-back-to-search` | 立即应用自动返回搜索 |
| `internal:update-hide-main-window-on-plugin-esc` | 立即应用插件内 ESC 隐藏窗口 |
| `internal:update-window-position-strategy` | 立即应用窗口呼出位置 |
| `internal:update-show-recent-in-search` | 立即应用显示最近使用 |
| `internal:update-match-recommendation` | 立即应用显示匹配推荐 |
| `internal:update-recent-rows` | 立即应用最近使用行数 |
| `internal:update-pinned-rows` | 立即应用固定区行数 |
| `internal:update-search-mode` | 立即应用搜索模式 |
| `internal:update-tab-key-function` | 立即应用Tab 按键行为 |
| `internal:update-local-app-search` | 立即应用搜索本机应用 |
| `internal:set-tray-icon-visible` | 立即应用显示托盘图标 |
| `internal:set-window-material` | 立即应用窗口材质（同系统） |

## 读取与写入的数据

- 读取宿主 `settings-general` 整份文档；仅以下字段允许进入备份或按选择恢复：

- `theme`：主题
- `primaryColor`：主题色
- `customColor`：自定义颜色
- `opacity`：窗口透明度
- `compactMainWindowHeader`：紧凑顶部栏
- `windowDefaultHeight`：默认窗口高度
- `placeholder`：搜索框提示
- `autoPaste`：自动粘贴
- `autoClear`：自动清空输入
- `autoBackToSearch`：自动返回搜索
- `hideMainWindowOnPluginEsc`：插件内 ESC 隐藏窗口
- `windowPositionStrategy`：窗口呼出位置
- `showRecentInSearch`：显示最近使用
- `showMatchRecommendation`：显示匹配推荐
- `localAppSearch`：搜索本机应用
- `recentRows`：最近使用行数
- `pinnedRows`：固定区行数
- `searchMode`：搜索模式
- `tabKeyFunction`：Tab 按键行为
- `showTrayIcon`：显示托盘图标
- `clipboardRetentionDays`：剪贴板保留天数
- `floatingBallEnabled`：启用悬浮球
- `superPanelEnabled`：启用超级面板
- `superPanelMouseButton`：超级面板鼠标按钮
- `superPanelLongPressMs`：超级面板长按时间
- `superPanelTranslateEnabled`：超级面板翻译
- `ignoreHotkeysOnFullscreen`：全屏时忽略快捷键
- `autoCheckUpdate`：自动检查更新
- `windowMaterial`：窗口材质（同系统）
- `acrylicLightOpacity`：浅色材质透明度（同系统）
- `acrylicDarkOpacity`：深色材质透明度（同系统）

- 读取宿主 `plugins` 插件注册表，可能在内存中接触路径等原始元数据；导出仅含名称、标题、版本、支持系统，不导出二进制或安装路径。
- 插件行为文档：`plugin-order`（插件排序）、`auto-start-plugin`（自动启动插件）、`auto-detach-plugin`（自动分离插件）、`out-kill-plugin`（退出时结束的插件）、`enabled-main-push-plugin`（启用主搜索推送的插件）。定时计划获批后可维护本插件在自动启动列表中的条目。
- 读取禁用插件状态、当前主唤起键、`global-shortcuts` / `app-shortcuts` 文档及通用设置中的内置快捷键开关。仅按用户选择恢复；具体文档名及校验见 `shortcuts.cjs`。
- 读取市场插件及宿主指令列表，用来预览可用性、安装所选缺失插件与校验快捷键目标。插件安装会由宿主下载对应市场版本，不是历史二进制还原。
- WebDAV 配置、本机映射偏好、上传状态、恢复前 ZIP 写在本插件专属 `pluginData` 目录。备份文件只写入用户配置 WebDAV 下的 `ztools-environment-v1/`。

## 网络与隐私

网络请求包括用户自行配置的 WebDAV 和宿主的插件市场/下载服务。本插件不配置开发者收集服务器或遥测；宿主服务本身的数据政策由其维护者负责。WebDAV 地址、账号及密码会发给用户配置的服务器，建议 HTTPS 与独立应用密码；连接不跟随重定向，不绕过证书验证。

备份不包含账号令牌、AI 密钥、代理、终端命令、文件路径、壁纸文件、高级 API 授权、插件内部数据或剪贴板历史。读取整份宿主文档时可能在内存中接触未导出字段；排除出备份不等于从未读到。WebDAV 密码默认仅内存保存；勾选记住后明文存于本机 `webdav-local.json`（macOS 0600，Windows 继承目录权限）。密码与本插件本机偏好不写入 ZIP 或官方云同步。ZIP 压缩但不加密；SHA-256 只用于一致性校验，不提供加密、签名或来源认证。请仅恢复自己信任的备份。

## 兼容性与失败处理

需要 ZTools 3.3.0-beta.2 或更新版本；使用高级 API 及内部设置结构，后续宿主升级可能导致接口或字段不兼容。本插件只迁移白名单配置，不声称覆盖全部设置。窗口材质限制同系统，快捷键跨系统使用用户配置的三键映射。

恢复前保存本机 ZIP，逐项汇报成功、跳过或失败；部分操作失败会尝试补偿，但没有跨设置、快捷键和插件安装的统一事务。恢复前备份不会自动卸载本次新装插件，也不会删除快照中不存在的新绑定。

## 开发披露

整个插件通过 Codex Vibe Coding 完成，没有人工编写代码或代码审核；人工参与仅包括功能测试与功能细节调整。自动化检查不能替代独立人工安全审计。安装与使用由用户自愿决定。
