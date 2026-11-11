# 2026-11-10 基本与界面设置审计

本表覆盖基本、主题编辑、字体、搜索、列表、强迫症、其他、快捷键和更新。播放、歌词、下载、同步、网络、备份及关于页面的专门审计由其他报告记录。本报告没有启动 Electron，没有修改 `vendor/lx`，没有提交或推送。

## 证据口径

- **静态链路**：核对原控件、原 store、实际构建替换、插件桥接及消费位置，能确认调用有接收方；不能据此声称已经在真实 ZTools 窗口逐项点验。
- **组件行为实测**：执行原 Vue 组件的 script、真实 Vue watcher/ref；路由、网络建议和原生弹窗由测试替身提供。缓存错误提示还经过真实 Pug/Vue 模板编译，检查生成的 `role=alert` 节点。
- **IPC/SQLite 实测**：调用真实插件运行时、原业务事件及临时 SQLite 数据库；不接触用户数据库，不代表真实网络音源已可用。
- **本机能力实测**：本次调用插件内 `font-list.getFonts()`，Windows 返回 216 个字体，包含微软雅黑。字体选择后实际字形渲染仍须浏览器或宿主验收。
- **宿主待验**：全局物理快捷键、ZTools 设置跳转、宿主主题通知、真实字体渲染及主题背景选择等需要真实宿主条件的项目，本表不标为已实机通过。

`docs/ztools/settings-map.md` 的“有效”属于接线说明，不是逐项人工验收记录。尤其 `search.isFocusSearchBox` 的原中文标签是“启动时自动聚焦搜索框”（`vendor/lx/src/lang/zh-cn.json:562`），不是每次进入搜索页都聚焦。

所有原设置键共有的持久化链为：原控件 `updateSetting` → `vendor/lx/src/renderer/store/setting.ts:25` → 原 `utils/ipc.ts:13` → `src/ztools/rendererIpc.ts:16` → `runtime/index.cjs` 的 `set_app_setting` → `AppEvent.update_config` → `runtime/app-utils.cjs` → `runtime/settings.cjs` → SQLite；提交后的 `on_config_change` 再合并回 Vue store。以下表中的设置键均经此链，动作按钮另外列出其通道。

## 基本设置逐控件

原控件统一位于 `vendor/lx/src/renderer/views/Setting/components/SettingBasic.vue`。

| 编号 | 控件及全部选项 | 数据/消费位置 | 当前结论及验证方式 |
| --- | --- | --- | --- |
| B01 | 显示动画效果：开/关 | 第6行 `common.isShowAnimation`；`core/useApp/useEventListener.ts:87` 切换根节点 `disableAnimation`，原 App 样式关闭 transition/animation | 静态链路完整；浏览器检查根类和一次弹层过渡 |
| B02 | 弹出层随机动画：开/关 | 第8行 `common.randomAnimate`；`components/material/Modal.vue:206` 选择动画；B01关闭时此项禁用 | 静态链路完整；浏览器开关后重复开启弹层，关闭随机时确认固定动画 |
| B03 | 以全屏模式启动 | 第10行 `common.startInFullscreen`；原 useApp 初始化会读取；插件原控件原本被 host loader 禁用 | 用户已批准移除非歌词的独立窗口设置，主代理实施；不应删兼容备份键 |
| B04 | 关闭窗口时最小化到系统托盘 | 第12行 `tray.enable`；插件没有独立 LX 托盘 | 用户已批准移除，主代理实施；插件隐藏/终止由宿主生命周期管理 |
| B05 | 定时停止入口、分钟输入、开始/更新/停止、关闭 | 第14行 → `PlayTimeoutModal.vue` → `core/player/timeoutStop.ts`；分钟保存 `player.waitPlayEndStopTime` | 发现分钟数 number 被 string 默认类型拒绝，主代理修复；分钟 1/1440、超界、重开回显及停止需覆盖 |
| B06 | 定时停止：等待本曲结束开/关 | `PlayTimeoutModal.vue:11` → `player.waitPlayEndStop`；`timeoutStop.ts:29` 决定立即 pause 或只置 `isPlayedStop` | 静态链路完整；分别验证到时立刻暂停/到本曲结束暂停；歌词设置不因本次清理移除 |
| B07 | 主题色、更多主题、自动主题及右键配置 | 第20-35行 → `theme.id/lightId/darkId`；详见主题表 | 内置/自定义主题存储及自动主题绑定有离线测试；完整视觉效果另验 |
| B08 | 音源单选，每个导入脚本/状态行 | 第41-48行 `common.apiSource`；`useSettingSync.ts:26` → `setUserApi` → `runtime/source/manager.cjs` | 静态链路完整；脚本初始化/错误状态需用用户自备脚本真实验；无脚本不能认定已能播放 |
| B09 | 自定义音源管理按钮 | 第50行打开 `UserApiModal`；导入、移除、状态通过 runtime/index.cjs:101-114 → source service | 已有来源隔离/生命周期测试；不在本表重复报告脚本真实兼容性 |
| B10 | 窗口尺寸各单选项 | 第53-58行 `common.windowSizeId`；插件外层区域属于宿主，原来所有单选被禁用 | 用户已批准移除，主代理实施；保留导入字段兼容 |
| B11 | 基准字号：14、15、16、17、18、19 | 第61-67、316-324行 `common.fontSize`；`useSettingSync.ts:15` 设置根节点 style.fontSize | 六个值均有静态消费链；原 fullscreen 状态会禁用，浏览器逐值看 computed font-size，并刷新回显 |
| B12 | 主字体：默认/本机所有字体 | 第70-73、297-315行 `common.font`；get_system_fonts → `runtime/index.cjs:97` → font-list；消费于 `useSettingSync.ts:30` | 本机216字体枚举已实测；默认/中文字体/西文字体选择与持久化、computed font-family 待浏览器验 |
| B13 | 回退字体：默认/本机所有字体 | 主字体非空时显示第二个下拉；与主字体以逗号连接保存同一键 | 静态链路完整；主字体置默认、回退字体残留/重选、缺字回退需浏览器验，不声称字体加载已经通过 |
| B14 | 语言：原 langList 中每个语种 | 第77-81行 `common.langId`；`useSettingSync.ts:20` 更新 i18n 和 html.lang，启动 main.ts 也读取 | 静态链路完整；逐个语种切换并刷新，检查设置页/弹框及 lang 属性 |
| B15 | 来源名称：原名/别名 | 第84-88行 `common.sourceNameType`；`store/index.ts:86-104` 计算 `sourceNames`，歌单/榜单/搜索用这些标签 | 静态链路完整；列表来源标记 kw/tx 等不是此控件要改的平台名称标签；导航重建后验标签 |
| B16 | 桌面控制按钮位置：左/右 | 第90-94行 `common.controlBtnPosition`；主窗控制按钮被 shell.css 隐藏，原单选被禁用 | 用户已批准移除，主代理实施 |
| B17 | 播放栏进度：迷你/中部/全宽 | 第96-106行 `common.playBarProgressStyle`；`components/layout/PlayBar/index.vue:2-3` 切换 Full/Middle，否则迷你进度组件 | 三个值静态链路完整；逐项查看进度组件并验证拖动进度 |

## 主题及主题编辑逐控件

主题列表在 SettingBasic，浅/深自动主题在 `ThemeSelectorModal.vue`，编辑器在 `ThemeEditModal/index.vue`。`runtime/index.cjs:98-100` 注册读/保存/移除主题；`runtime/themes.cjs` 使用同一 SQLite 中独立 `themes` namespace。`runtime.test.cjs` 已实测保存、读回及移除自定义主题；`host-theme.test.cjs` 已实测自动主题跟随通知、手动主题保持。

| 编号 | 控件及全部选项 | 实际行为链 | 结论/待验 |
| --- | --- | --- | --- |
| T01 | 内置主题各色块 | SettingBasic:225-230 → themeId、applyTheme、theme.id | 静态链路完整；每个主题的 CSS 颜色、背景及重启持久化待视觉验 |
| T02 | 更多主题 | 第34行 showAllTheme=true，展示完整列表、自动和新增入口 | 纯界面开关，静态完整 |
| T03 | 自动主题 | 第236-245行选择 auto；`src/ztools/host-theme.cjs:2-12` 从宿主读取深色并监听通知 | 通知逻辑离线实测；真实宿主通知未实测 |
| T04 | 自动主题的浅色选项每一项 | ThemeSelectorModal:106-110 → theme.lightId，auto 时立即 applyTheme | 静态链路完整；宿主浅色时选每项，刷新后验 |
| T05 | 自动主题的深色选项每一项 | ThemeSelectorModal:111-115 → theme.darkId，auto 时立即 applyTheme | 静态链路完整；宿主深色时选每项，刷新后验 |
| T06 | 新增主题 | SettingBasic:29、208-219 → ThemeEditModal，最多10个自定义主题 | 静态链路完整；上限与取消路径待浏览器验 |
| T07 | 右键编辑自定义主题 | SettingBasic:20、208-219；内置项 isDefault 被拒绝编辑 | 静态完整；只应编辑自己的主题，不覆盖内置 |
| T08 | 主题名称输入 | ThemeEditModal:105、433、492；保存取前20字符，空名不保存 | 静态完整；空/20/21字符待组件点击验 |
| T09 | 主题色选择器 | 第9行 → useMainColor.ts → theme.config.themeColors，preview 时 apply | 静态完整，选色后需看真实主题色 |
| T10 | 字体颜色选择器 | 第13行 → useFontColor.ts → extInfo 字体色 | 静态完整，待视觉验 |
| T11 | 应用背景颜色选择器 | 第17行 → useAppBgColor.ts → extInfo | 静态完整，待视觉验 |
| T12 | 侧栏按钮颜色选择器 | 第21行 → useAsideFontColor.ts | 静态完整，待视觉验 |
| T13 | 内容区域背景颜色选择器 | 第25行 → useMainBgColor.ts | 静态完整，待视觉验 |
| T14 | 标签主颜色选择器 | 第52行 → useBadgePrimaryColor.ts | 静态完整；看无损标签 |
| T15 | 标签次颜色选择器 | 第56行 → useBadgeSecondaryColor.ts | 静态完整；看高音质标签 |
| T16 | 标签第三颜色选择器 | 第60行 → useBadgeTertiaryColor.ts | 静态完整；看来源标签 |
| T17 | 关闭按钮颜色选择器 | 第88行 → useCloseBtnColor.ts；对应主窗按钮被 src/ztools/shell.css:29-31 隐藏 | 插件中没有可见消费结果，用户已批准移除此控件，主代理实施 |
| T18 | 最小化按钮颜色选择器 | 第92行 → useMinBtnColor.ts；同上 | 用户已批准移除此控件，主代理实施 |
| T19 | 隐藏播放详情页按钮颜色 | 第96行 → useHideBtnColor.ts，原播放详情仍有隐藏动作 | 保留；不能因T17/T18无效删除整个配色组；待详情页视觉验 |
| T20 | 选择/更换背景图片 | 第370-395行 → show_select_dialog → runtime/host.cjs:14-18 授权；copyFile → files:call → 授权文件复制到插件 temp → file URL预览 | 授权、复制及持久化链完整；真实系统对话框/图片渲染未实测；带中文/空格/#路径需验 |
| T21 | 移除背景图片 | 第397-405行 → 删除临时副本、--background-image=none、createPreview | 静态完整；保存/取消后旧背景是否存在需验 |
| T22 | 暗色主题开/关 | 第107、407-410行 → theme.isDark、applyPrimaryColor；保存到主题数据 | 静态完整；主题自动选择器的浅深分组需同时验 |
| T23 | 深色字体开/关 | 第109、411行以后 → theme.isDarkFont、applyPrimaryColor | 静态完整；配色反转效果待视觉验 |
| T24 | 预览开/关 | 第110、420行以后 → window.setTheme；关预览恢复已保存主题 | 静态完整；预览退出恢复待验 |
| T25 | 保存 | 第118、431-453行；临时图片move到持久目录，save_theme → SQLite，刷新主题列表 | 主题元数据真实IPC保存/读回通过；图片移动、实际CSS恢复待浏览器验 |
| T26 | 另存 | 第116、489-510行；新ID；已有背景copy/新临时背景move；save_theme | 静态完整；原主题/原背景不能受损，须验 |
| T27 | 删除主题 | 第115、454-488行；确认；当前/浅/深引用分别回退green/black；删除旧背景和主题 | SQLite删除实测通过；对话框取消、引用回退和背景删除待组件验 |
| T28 | 关闭编辑器/取消 | 第2、425-429、361-365行；恢复已选主题、删除临时背景 | 静态完整；关闭后不残留预览主题待验 |
| T29 | 各选色器中的重置、上次颜色、确认/取消 | 各 use*Color.ts → 原 Pickr 选择器回调 | 使用原控件库，未变更；不能只因按钮存在便视为每个回调已人工验收 |

## 搜索、列表、强迫症逐控件

| 编号 | 控件及选项 | 数据/行为消费 | 结论 |
| --- | --- | --- | --- |
| S01 | 显示热搜：开/关 | SettingSearch:5 → search.isShowHotSearch；Search/components/BlankView.vue:4-8/44-61 → store/hotSearch.ts → 原平台热搜请求 | 设置和显示有静态消费；热搜属于外部请求，真实接口成败未验；无数据不等于开关没保存 |
| S02 | 显示搜索历史：开/关 | SettingSearch:7 → search.isShowHistorySearch；BlankView:9-21/63-65、store/search/action.ts:27 还控制是否记录历史 | 开关同时影响展示及后续记录，非仅隐藏；通用 get_data/save_data 落插件SQLite；真实UI待验 |
| S03 | 启动时自动聚焦搜索框：开/关 | SettingSearch:9 → search.isFocusSearchBox；material/SearchInput.vue:112-115 mounted检查 | 按原标签仅启动生效，静态完整；重启后 document.activeElement 待浏览器/宿主验 |
| L01 | 显示列表操作按钮：开/关 | SettingList:5 → list.actionButtonsVisible；List/MusicList/index.vue:139 和 material/OnlineList/index.vue:148 在setup读取，模板据此创建按钮列 | 经过设置页返回列表会重新挂载，正常设置流程有消费；不是未反应的store。我的列表/搜索/歌单/榜单均需覆盖 |
| L02 | 显示歌曲来源：开/关 | SettingList:7 → list.isShowSource；List/MusicList/useListInfo.js:36 computed；index.vue:46/78 控制来源标签 | 原语义是“我的列表”的来源标签，静态完整；在线聚合结果独立 sourceTag 不受此项控制 |
| L03 | 记住列表滚动位置：开/关 | SettingList:9 → list.isSaveScrollLocation；List/MusicList/useListScroll.js:23 控制恢复；位置信息经utils/data落本地 | 关闭时仍可能保存位置，但不恢复，符合可见行为；待长列表离开/返回验证 |
| L04 | 双击歌曲切换整个列表播放：开/关 | SettingList:11 → list.isClickPlayList；material/OnlineList/usePlay.ts:54；原标签限定歌单和排行榜 | 静态完整；不能用“我的列表”双击结果判定无效；歌单/榜单需分别验 |
| L05 | 添加歌曲位置：顶部/底部 | SettingList:17-22 → list.addMusicLocationType；store/list/action.ts:38-51、listManage/action.ts:224-245 消费，下载任务创建也读取 | 静态完整；单曲/批量添加和移动需同时验，检查实际顺序而非只验保存值 |
| O01 | 离开搜索界面时清空搜索框：开/关 | SettingOdc:5 → odc.isAutoClearSearchInput；Toolbar/SearchInput.vue:33 | 组件行为四种组合实测通过；进入SongListDetail例外仍保留 |
| O02 | 离开搜索界面时清空搜索列表：开/关 | SettingOdc:7 → odc.isAutoClearSearchList；Toolbar/SearchInput.vue:34 | 已修复清列表反向误清输入框；未提交草稿与下一轮搜索同步均实测通过 |

O01/O02 缺陷根因是 `Toolbar/SearchInput.vue:40-42` 对结果查询的 watch 无条件把空串同步到输入，导致只启用 O02 时也清输入。修复在 `build-config/ztools/search-input-loader.cjs`，只在本次“清结果”提交的watch刷新期间跳过空串反向同步；原厂源码保留。`search-input-settings.test.cjs` 先出现2个预期失败，再6/6通过。Webpack已由主代理统一接入此loader。

## 其他逐控件

原页面为 `SettingOther.vue`，正常成功路径不是noop。四种缓存独立走 `utils/ipc.ts` → 原 `upstream/main/modules/winMain/rendererEvent/music.cjs:15-75` → 原 dbService → SQLite。

| 编号 | 控件 | 实际行为及本次证据 | 当前结论 |
| --- | --- | --- | --- |
| C01 | 主窗口内置圆角及阴影 | common.transparentWindow；插件shell强制铺满宿主，原控件被禁用 | 用户已批准移除，主代理实施 |
| C02 | 托盘图标主题：原生/黑色/原色/自动 | tray.themeId；插件没有独立LX托盘，原控件被禁用 | 用户已批准移除，主代理实施 |
| C03 | 浏览器资源缓存显示及清理 | get_cache_size/clear_cache 无插件实现；loader原来显示“由ZTools管理”且禁用清理 | 用户已批准移除整段，主代理实施；不移除歌曲/歌词缓存 |
| C04 | 换源歌曲缓存数量/清理 | get_other_source_count/clear_other_source；真实临时SQLite从1变0，其他3种缓存保持 | IPC/SQLite实测通过；失败后恢复按钮并显示错误，成功后允许重试 |
| C05 | 歌曲URL缓存数量/清理 | get_music_url_count/clear_music_url；同上独立表 | IPC/SQLite实测通过；同步throw/异步拒绝恢复行为均通过 |
| C06 | 原始歌词缓存数量/清理 | get_lyric_raw_count/clear_lyric_raw；同上 | 用户要求歌词相关保留；IPC/SQLite与错误恢复实测通过 |
| C07 | 调整过时间歌词数量/清理、确认/取消 | get_lyric_edited_count/clear_lyric_edited；确认后原edited表清理；取消不变 | 用户要求保留；真实SQLite清理、组件取消/错误恢复通过 |
| C08 | 不喜欢列表数量、查看/编辑入口 | dislikeRuleCount → DislikeListModal；规则表get_dislike_music_infos | 实际数据读取链完整；真实IPC加载规则后可识别歌名、歌手和组合3种规则 |
| C09 | 不喜欢列表编辑文本/保存/关闭 | core/dislikeList.ts:20 → overwrite_dislike_music_infos → DislikeEvent → SQLite；成功通知同步回renderer解析和计数 | 真实IPC保存3种规则、发布通知、空内容保存清空规则均通过；不实际修改用户规则 |
| C10 | 清空“我的列表”、确认/取消 | SettingOther:201-212 → overwriteListFull → list_data_overwire → ListEvent → SQLite | 真实IPC实测删除自建列表，默认/收藏/临时列表歌曲均清空；原二次确认仍保留；浏览器取消点击待验 |

四个清缓存按钮原本在 `SettingOther.vue:135-140/152-157/170-175/187-197` 只在成功then里恢复可用，拒绝时永久禁用到离开页面，且没有可见错误。本次在 `host-settings-loader.cjs` 的 Other 分支加入 `runCacheAction`，await清理和计数刷新，catch展示真实错误，finally恢复按钮；初始化计数拒绝也展示错误。没有新增静默吞错。

`other-cache-settings.test.cjs` 首先4个同步失败行为全红；修复后10/10通过：4种缓存各覆盖同步throw及异步拒绝、模板可见错误、再次成功重试；另外覆盖计数刷新失败和取消编辑歌词清理。

## 快捷键和更新

| 编号 | 控件/说明 | 实际链路 | 证据边界 |
| --- | --- | --- | --- |
| K01 | LX 播放/暂停快捷键设置 | src/ztools/SettingHotKey.vue:15 → host:hotkeySetting → runtime/commands.cjs:7-10 → ztools.redirectHotKeySetting('LX 播放/暂停') | 原函数调用与label校验离线测试通过；真实宿主跳转及物理按键未验 |
| K02 | LX 上一首快捷键设置 | 同上，label/feature.code=prev | label与plugin.json声明一致；需真实宿主配置后按键验 |
| K03 | LX 下一首快捷键设置 | 同上，label/feature.code=next | 同上 |
| K04 | LX 搜索快捷键设置 | 同上，label/feature.code=search；src/ztools/commands.js 路由到/search | 冷启动队列处理有离线测试；物理按键/输入查询待宿主验 |
| K05 | LX 桌面歌词快捷键设置 | 同上，label/feature.code=lyrics；commands.js 读窗口状态后开关歌词窗口 | 用户要求歌词相关保留；设置入口保留；物理快捷键未实机验 |
| K06 | 设置入口失败提示 | configure捕获异常及false返回后，页面role=alert展示error | 静态链完整；宿主API无能力/返回false待浏览器断言 |
| U01 | 插件更新说明页 | webpack把原SettingUpdate替换为src/ztools/SettingUpdate.vue；本页是说明文本，没有检查/下载/重启控件 | 更新来自ZTools市场/本地插件包，不能把本页视为“原LX自动更新验证通过” |
| U02 | 兼容保留的common.tryAutoUpdate/common.showChangeLog键 | 新更新页没有这些控件；原useUpdate仍在vendor，但当前webpack为development，生产包没有启用原LX自动更新器 | 不新增插件内部更新器；升级及市场安装由主代理/发布流程验证 |

## 用户批准的移除范围与保留范围

用户收到汇总清单后答复“歌词相关先保留”。据此，主代理负责移除本表 B03/B04/B10/B16/C01/C02/C03/T17/T18 对应非歌词控件；原设置键保留用于备份兼容。其他审计中的独立电源锁和Windows任务栏进度也属批准移除的非歌词项。

所有歌词项继续保留，包括桌面歌词的“其他应用全屏时隐藏”和状态栏歌词选项、歌词字体/显示样式、桌面歌词快捷键、原始/调整后歌词缓存及主题编辑的“隐藏播放详情页按钮颜色”。尚无宿主接口的歌词项需要继续明确限制，不能仅因用户要保留便宣称有效。

## 本次执行记录

| 验证 | 结果 | 能证明什么 |
| --- | --- | --- |
| 搜索设置组件行为，修复前 | 6项，4通过/2预期失败 | 证明能复现只清结果误清输入及草稿丢失 |
| `node --test tests/ztools/search-input-settings.test.cjs`，修复后 | 6/6通过 | 四个开关组合、歌单详情例外、草稿、后续查询同步 |
| 缓存组件同步throw，修复前 | 4/4预期失败 | 证明按钮被永久禁用 |
| `node --test tests/ztools/other-cache-settings.test.cjs`，修复后 | 10/10通过 | 真实组件script/watch和编译模板中的可见错误/重试/恢复 |
| `node --test tests/ztools/settings-data-actions.test.cjs` | 3/3通过 | 4种缓存SQLite隔离清理、不喜欢3类规则保存清空、所有列表清空 |
| 插件font-list真实本机调用 | 216字体，含微软雅黑 | 本机字体枚举可用，不含真实字体渲染证明 |
| `npm run test:ztools`，2026-11-10本分支中途快照 | 195项，194通过/0失败/1跳过 | 包含本次搜索和缓存组件测试；当时尚未加入后来的3个数据动作测试。唯一跳过为需LX_SYNC_ROLE的官方LX互通测试；以主代理最终汇总为准 |
| `git diff -- vendor/lx` | 空 | 原LX源码未修改 |

真实ZTools窗口逐控件点击、视觉比对、物理快捷键、真实网络热搜及用户脚本播放未在本子任务执行。主代理可以把后续浏览器/宿主结果追加到对应行；本表没有把静态接线冒充人工实机验收。
