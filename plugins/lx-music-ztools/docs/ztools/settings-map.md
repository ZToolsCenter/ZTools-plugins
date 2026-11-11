# 原 LX 默认设置逐项映射

基线：`vendor/lx/src/common/defaultSetting.ts`（LX 2.12.6 / `323e4bac`）。下表逐项保留全部135个**有效声明键**供存储和备份兼容，不把源码中的注释键算成设置，也不把保留键等同于设置页仍展示对应控件。默认值列采用上游表达式；`isMac`/`isWin`在本次Windows首验分别为false/true，`path.join(os.homedir(), 'Desktop')`是本机桌面路径。上游1/2月会把当前主题和歌词已播放色改为新年默认值。

状态「有效」指代码已接入原业务/界面或服务，**不表示逐个选项都做过实际人工验收**；单项/宿主证据另见[设置验证报告](settings-validation-report.md)和[验证矩阵](compatibility.md)。「界面已移除」表示按用户确认移除插件场景不适用的控件，原键继续保留；「宿主管理」表示插件更新等行为由ZTools负责，旧键不控制原独立桌面能力；「不支持」明确不能据此承诺行为；「条件有效」必须满足列明的宿主能力，并以实际执行结果为准。

适配依据：`build-config/ztools/host-settings-loader.cjs`、`prune-settings.cjs`，`src/ztools/SettingHotKey.vue`、`SettingUpdate.vue`，以及`preload/runtime/{settings,host,windows,commands}.cjs`。设置与列表使用同一SQLite，只接受原默认键及其校验后的值。用户确认“歌词相关先保留”后，非歌词的原窗口、尺寸、按钮位置、托盘、透明样式、任务栏进度、电源锁和浏览器资源缓存控件已从插件设置页移除；歌词相关控件继续保留，缺失能力的项目仍禁用并说明限制。导入旧值不会自动获得缺失的系统能力。各域逐项证据见[界面设置审计](audits/2026-11-10-ui-settings.md)、[播放与歌词设置审计](audits/2026-11-10-player-settings.md)、[服务设置审计](audits/2026-11-10-service-settings.md)。

## 结构版本
| 原键 | 上游默认值 | 状态 | 插件行为与限制 |
| --- | --- | --- | --- |
| `version` | `'2.1.0'` | 内部有效 | 原设置结构版本，用于备份迁移；不是插件发行版本。 |
## 基本
| 原键 | 上游默认值 | 状态 | 插件行为与限制 |
| --- | --- | --- | --- |
| `common.windowSizeId` | `3` | 界面已移除 | 原独立窗口尺寸选择已移除；插件区域由宿主管理，兼容保留的值不控制外层窗口。 |
| `common.fontSize` | `16` | 有效 | 0.1.2恢复原px→rem构建步骤，六档设置同时影响实际文字和配套尺寸；已验证计算字号、可见字宽、切页及终止后重开。0.1.1只验证根字号/保存不足，详见[渲染复验](font-size-fix.md)。 |
| `common.startInFullscreen` | `false` | 界面已移除 | 原独立应用启动全屏控件已移除；兼容保留旧值，插件外层全屏由宿主管理。 |
| `common.langId` | `null` | 有效 | 原界面语言选择。 |
| `common.apiSource` | `'temp'` | 有效 | 当前用户自备音源ID；需要导入并成功初始化，旧ID不保证新设备可用。 |
| `common.sourceNameType` | `'alias'` | 有效 | 原平台名称/别名显示。 |
| `common.font` | `''` | 有效 | 原界面字体；字体须在本机可用。 |
| `common.isShowAnimation` | `true` | 有效 | 原界面动画开关。 |
| `common.randomAnimate` | `true` | 有效 | 原随机动画配置。 |
| `common.isAgreePact` | `false` | 有效 | 原使用协议接受状态；导入备份时重置为false。 |
| `common.controlBtnPosition` | `isMac ? 'left' : 'right'` | 界面已移除 | 原桌面控制按钮位置控件已移除；插件主页面桌面按钮隐藏，原值仅为兼容保留。 |
| `common.playBarProgressStyle` | `'mini'` | 有效 | 原播放栏进度显示样式。 |
| `common.transparentWindow` | `!isMac` | 界面已移除 | 原主窗口内置圆角、阴影及透明样式控件已移除；插件外层窗口由宿主管理，兼容保留旧值。 |
| `common.tryAutoUpdate` | `true` | 宿主管理 | 原LX桌面自动更新页已替换；更新由ZTools市场/本地包安装管理，此键不驱动插件升级。 |
| `common.showChangeLog` | `true` | 宿主管理 | 原桌面更新日志设置不作为插件更新入口；当前版本变更见CHANGELOG和宿主信息。 |
## 播放与音效
| 原键 | 上游默认值 | 状态 | 插件行为与限制 |
| --- | --- | --- | --- |
| `player.startupAutoPlay` | `false` | 有效 | 原启动自动播放；取决于可恢复列表/资源和宿主音频能力。 |
| `player.togglePlayMethod` | `'listLoop'` | 有效 | 原列表循环/单曲/随机等播放方式。 |
| `player.playQuality` | `'128k'` | 有效 | 原播放音质选择；音源和歌曲须实际支持该音质。 |
| `player.isShowTaskProgess` | `true` | 界面已移除 | Windows任务栏进度没有可用的插件实现，对应非歌词控件已移除；原键仅为兼容保留。 |
| `player.isShowStatusBarLyric` | `false` | 不支持 | 按“歌词相关先保留”继续展示原选项并禁用、说明限制；无系统状态栏歌词渲染，保留控件和原键不构成系统显示能力。 |
| `player.volume` | `1` | 有效 | 原播放器音量。 |
| `player.powerSaveBlocker` | `true` | 界面已移除 | 无独立系统电源锁公开接口，对应非歌词控件已移除；原键仅为兼容保留。 |
| `player.isMute` | `false` | 有效 | 原静音。 |
| `player.playbackRate` | `1` | 有效 | 原播放速度。 |
| `player.preservesPitch` | `true` | 有效 | 原变速保留音高；依赖音频引擎实现。 |
| `player.isMaxOutputChannelCount` | `false` | 条件有效 | 原AudioContext输出通道策略；实际通道数受设备/浏览器限制。自选输出需元素和AudioContext双路由能力，不能从回归通过推断所有物理设备可用。 |
| `player.mediaDeviceId` | `'default'` | 条件有效 | 自选输出须同时具备mediaDevices枚举、HTMLMediaElement.setSinkId和AudioContext.setSinkId。按实际输出持有者切换：DSP接管前切元素，接管后切context。真实宿主已通过非默认设备切换及回系统默认；旧宿主缺能力时只提供默认。此前元素AbortError已定位并修复，不能作为当前硬件限制；不扩大为所有设备/人工听音通过。 |
| `player.isMediaDeviceRemovedStopPlay` | `false` | 条件有效 | 需先具备上述路由/枚举能力及devicechange监听。设备ID、groupId、label共同辨别变化，避免同名设备漏判；真实Vue回归验证移除时暂停。物理拔插尚未由人工验收。 |
| `player.isShowLyricTranslation` | `false` | 有效 | 原翻译歌词显示，取决于资源。 |
| `player.isShowLyricRoma` | `false` | 有效 | 原罗马音歌词显示，取决于资源。 |
| `player.isSwapLyricTranslationAndRoma` | `false` | 有效 | 原翻译/罗马音显示顺序。 |
| `player.isS2t` | `false` | 有效 | 原歌词简繁转换。 |
| `player.isPlayLxlrc` | `!isMac` | 有效 | 原LX增强歌词解析/播放。 |
| `player.isSavePlayTime` | `false` | 有效 | 原播放位置保存。 |
| `player.audioVisualization` | `false` | 有效 | 原音频可视化；受AudioContext/音频资源限制。 |
| `player.waitPlayEndStop` | `true` | 有效 | 原等待本首结束后停止策略。 |
| `player.waitPlayEndStopTime` | `''` | 有效 | 原定时停止时间设置；沿用原界面/解析。 |
| `player.autoSkipOnError` | `true` | 有效 | 原失败自动跳过。 |
| `player.isAutoCleanPlayedList` | `false` | 有效 | 原已播放列表自动清理。 |
| `player.soundEffect.convolution.fileName` | `''` | 有效 | 原卷积预设对应的打包filters资源名；不是任意本地卷积文件。真实宿主已验证内置telephone资源解码及增益节点生效。 |
| `player.soundEffect.convolution.mainGain` | `10` | 有效 | 原卷积主增益。 |
| `player.soundEffect.convolution.sendGain` | `0` | 有效 | 原卷积发送增益。 |
| `player.soundEffect.biquadFilter.hz31` | `0` | 有效 | 原均衡器31Hz频段增益；原Web Audio链路保留。 |
| `player.soundEffect.biquadFilter.hz62` | `0` | 有效 | 原均衡器62Hz频段增益；原Web Audio链路保留。 |
| `player.soundEffect.biquadFilter.hz125` | `0` | 有效 | 原均衡器125Hz频段增益；原Web Audio链路保留。 |
| `player.soundEffect.biquadFilter.hz250` | `0` | 有效 | 原均衡器250Hz频段增益；原Web Audio链路保留。 |
| `player.soundEffect.biquadFilter.hz500` | `0` | 有效 | 原均衡器500Hz频段增益；原Web Audio链路保留。 |
| `player.soundEffect.biquadFilter.hz1000` | `0` | 有效 | 原均衡器1000Hz频段增益；原Web Audio链路保留。 |
| `player.soundEffect.biquadFilter.hz2000` | `0` | 有效 | 原均衡器2000Hz频段增益；原Web Audio链路保留。 |
| `player.soundEffect.biquadFilter.hz4000` | `0` | 有效 | 原均衡器4000Hz频段增益；原Web Audio链路保留。 |
| `player.soundEffect.biquadFilter.hz8000` | `0` | 有效 | 原均衡器8000Hz频段增益；原Web Audio链路保留。 |
| `player.soundEffect.biquadFilter.hz16000` | `0` | 有效 | 原均衡器16000Hz频段增益；原Web Audio链路保留。 |
| `player.soundEffect.panner.enable` | `false` | 有效 | 原声像效果开关。 |
| `player.soundEffect.panner.soundR` | `5` | 有效 | 原声像半径。 |
| `player.soundEffect.panner.speed` | `25` | 有效 | 原声像速度。 |
| `player.soundEffect.pitchShifter.playbackRate` | `1` | 有效 | 原phase-vocoder AudioWorklet变调参数；受宿主Web Audio能力限制。 |
## 播放详情
| 原键 | 上游默认值 | 状态 | 插件行为与限制 |
| --- | --- | --- | --- |
| `playDetail.isZoomActiveLrc` | `false` | 有效 | 原播放详情活动歌词缩放。 |
| `playDetail.isShowLyricProgressSetting` | `false` | 有效 | 原详情歌词进度设置显示。 |
| `playDetail.style.fontSize` | `140` | 有效 | 原详情歌词字号。 |
| `playDetail.style.align` | `'center'` | 有效 | 原详情歌词对齐。 |
| `playDetail.isDelayScroll` | `true` | 有效 | 原详情歌词延迟滚动。 |
## 桌面歌词
| 原键 | 上游默认值 | 状态 | 插件行为与限制 |
| --- | --- | --- | --- |
| `desktopLyric.enable` | `false` | 有效 | 公开createBrowserWindow打开/关闭原桌面歌词页面；同一原播放器数据。 |
| `desktopLyric.isLock` | `false` | 有效 | 公开setIgnoreMouseEvents锁定/穿透；实际宿主锁定/解锁已验。 |
| `desktopLyric.isAlwaysOnTop` | `false` | 有效 | 公开setAlwaysOnTop置顶；实际宿主已验。 |
| `desktopLyric.isAlwaysOnTopLoop` | `false` | 有效 | 置顶时每500ms通过公开moveTop维持；不绕过系统窗口策略。 |
| `desktopLyric.isShowTaskbar` | `false` | 有效 | 公开setSkipTaskbar控制歌词独立窗口任务栏可见性；不是主播放器缩略按钮。 |
| `desktopLyric.audioVisualization` | `false` | 有效 | 原歌词页音频可视化，从同一播放器取分析数据，不另建audio。 |
| `desktopLyric.fullscreenHide` | `true` | 不支持 | 按“歌词相关先保留”继续展示原选项并禁用、说明限制；未接系统全屏检测，不能在其他应用全屏时保证自动隐藏。 |
| `desktopLyric.pauseHide` | `true` | 有效 | 原歌词renderer暂停淡出逻辑；不是关闭窗口或停止服务。 |
| `desktopLyric.width` | `450` | 有效 | 公开窗口bounds宽度，最小38；可结合屏幕限制。 |
| `desktopLyric.height` | `300` | 有效 | 公开窗口bounds高度，最小38；可结合屏幕限制。 |
| `desktopLyric.x` | `null` | 有效 | 歌词窗口X坐标；null按主显示器工作区初始化。 |
| `desktopLyric.y` | `null` | 有效 | 歌词窗口Y坐标；null按主显示器工作区初始化。 |
| `desktopLyric.isLockScreen` | `isWin` | 有效 | 将歌词bounds限制在目标显示器workArea；指窗口不越屏，不是系统锁屏或电源锁。 |
| `desktopLyric.isDelayScroll` | `true` | 有效 | 原桌面歌词延迟滚动。 |
| `desktopLyric.scrollAlign` | `'center'` | 有效 | 原歌词滚动对齐。 |
| `desktopLyric.isHoverHide` | `false` | 条件有效 | 原歌词hover淡出；依赖窗口鼠标事件，锁定穿透时行为受宿主事件支持限制。 |
| `desktopLyric.direction` | `'horizontal'` | 有效 | 原桌面歌词横排/竖排。 |
| `desktopLyric.style.align` | `'center'` | 有效 | 原桌面歌词文本对齐。 |
| `desktopLyric.style.font` | `''` | 有效 | 原桌面歌词字体；字体须在本机可用。 |
| `desktopLyric.style.fontSize` | `20` | 有效 | 原桌面歌词字号。 |
| `desktopLyric.style.lineGap` | `15` | 有效 | 原桌面歌词行距。 |
| `desktopLyric.style.lyricUnplayColor` | `'rgba(255, 255, 255, 1)'` | 有效 | 原未播放歌词色。 |
| `desktopLyric.style.lyricPlayedColor` | `'rgba(7, 197, 86, 1)'` | 有效 | 原已播放歌词色；上游1/2月有新年默认值覆盖。 |
| `desktopLyric.style.lyricShadowColor` | `'rgba(0, 0, 0, 0.18)'` | 有效 | 原歌词阴影色。 |
| `desktopLyric.style.opacity` | `95` | 有效 | 原歌词页透明度。 |
| `desktopLyric.style.ellipsis` | `false` | 有效 | 原歌词省略显示。 |
| `desktopLyric.style.isZoomActiveLrc` | `false` | 有效 | 原活动歌词缩放。 |
| `desktopLyric.style.isFontWeightFont` | `true` | 有效 | 原当前歌词字体加粗策略。 |
| `desktopLyric.style.isFontWeightLine` | `true` | 有效 | 原当前歌词行加粗策略。 |
| `desktopLyric.style.isFontWeightExtended` | `true` | 有效 | 原扩展歌词加粗策略。 |
## 列表
| 原键 | 上游默认值 | 状态 | 插件行为与限制 |
| --- | --- | --- | --- |
| `list.isClickPlayList` | `false` | 有效 | 原列表点击播放方式。 |
| `list.isShowSource` | `true` | 有效 | 原列表来源列显示。 |
| `list.isSaveScrollLocation` | `true` | 有效 | 原列表滚动位置保存。 |
| `list.addMusicLocationType` | `'top'` | 有效 | 原添加歌曲到顶部/底部策略。 |
| `list.actionButtonsVisible` | `false` | 有效 | 原列表操作按钮显示。 |
## 下载
| 原键 | 上游默认值 | 状态 | 插件行为与限制 |
| --- | --- | --- | --- |
| `download.enable` | `false` | 有效 | 原下载功能总开关；下载新文件要求目标卷支持hard link。 |
| `download.isSavePathGroupByListName` | `false` | 有效 | 原按列表名称分目录；需目录授权与有效文件名。 |
| `download.savePath` | `path.join(os.homedir(), 'Desktop')` | 有效 | 通过原目录选择器授权的下载目录；导入路径值不等于授权，所有新下载需hard link。 |
| `download.fileName` | `'歌名 - 歌手'` | 有效 | 原歌曲文件名模板；拒绝路径穿越、Windows设备名和非法尾点空格等。 |
| `download.maxDownloadNum` | `3` | 有效 | 原并发设置，队列每次调度读取当前值。 |
| `download.skipExistFile` | `true` | 有效 | 跳过同名文件用hard link原子no-clobber；覆盖走rename；两种模式创建checkpoint均需hard link。 |
| `download.isDownloadLrc` | `false` | 有效 | 原独立歌词下载开关。 |
| `download.isDownloadLxLrc` | `true` | 有效 | 独立歌词包含LX增强歌词。 |
| `download.isDownloadTLrc` | `false` | 有效 | 独立歌词包含翻译。 |
| `download.isDownloadRLrc` | `false` | 有效 | 独立歌词包含罗马音。 |
| `download.lrcFormat` | `'utf8'` | 有效 | 原UTF-8 BOM或真实GBK编码。 |
| `download.isEmbedPic` | `true` | 有效 | MP3/FLAC标签嵌图；只接受通过验证的PNG/JPEG，封面上限16MiB。 |
| `download.isEmbedLyric` | `false` | 有效 | MP3/FLAC歌词标签嵌入；WAV/APE不承诺该writer能力。 |
| `download.isEmbedLyricLx` | `true` | 有效 | 嵌入LX增强歌词；FLAC完整值保留在native vorbis LYRICS。 |
| `download.isEmbedLyricT` | `false` | 有效 | 标签内包含翻译歌词。 |
| `download.isEmbedLyricR` | `false` | 有效 | 标签内包含罗马音。 |
| `download.isUseOtherSource` | `false` | 有效 | 原下载换源策略；取决于用户音源对目标平台/音质的实际能力。 |
## 搜索
| 原键 | 上游默认值 | 状态 | 插件行为与限制 |
| --- | --- | --- | --- |
| `search.isShowHotSearch` | `false` | 有效 | 原热搜显示；外部接口是否可用需分别判断。 |
| `search.isShowHistorySearch` | `false` | 有效 | 原本地搜索历史显示。 |
| `search.isFocusSearchBox` | `false` | 有效 | 原应用启动时自动聚焦搜索框；不是每次进入搜索页都重新聚焦。 |
## 网络
| 原键 | 上游默认值 | 状态 | 插件行为与限制 |
| --- | --- | --- | --- |
| `network.proxy.enable` | `false` | 有效 | 原请求、用户音源请求、下载/封面，以及原播放器和下一首预加载媒体流均读取同一HTTP代理配置；原播放及预加载通过插件本地媒体代理转发，不控制ZTools自身或插件外部网页流量。受控和宿主证据见设置验证报告及服务审计。 |
| `network.proxy.host` | `''` | 有效 | 上述请求与播放/预加载媒体流的HTTP代理地址；需要用户可用代理，不代表所有真实代理组合均已验收。 |
| `network.proxy.port` | `''` | 有效 | 上述请求与播放/预加载媒体流的HTTP代理端口；需可达且配置有效。 |
## 托盘
| 原键 | 上游默认值 | 状态 | 插件行为与限制 |
| --- | --- | --- | --- |
| `tray.enable` | `false` | 界面已移除 | 原LX独立托盘/关闭到托盘控件已移除，原键为兼容保留；插件入口与后台由ZTools管理。 |
| `tray.themeId` | `0` | 界面已移除 | 原托盘图标主题控件已移除，原键为兼容保留；不修改宿主托盘。 |
## 同步
| 原键 | 上游默认值 | 状态 | 插件行为与限制 |
| --- | --- | --- | --- |
| `sync.mode` | `'server'` | 有效 | 原client/server角色；切换经插件串行生命周期，默认仍需显式启用。 |
| `sync.enable` | `false` | 有效 | 原同步开关，默认关闭；隐藏保持，终止释放。 |
| `sync.server.port` | `'23332'` | 有效 | 原服务端监听端口；校验1—65535，冲突报错。 |
| `sync.server.maxSsnapshotNum` | `5` | 有效 | 保留上游拼写，原快照保留数；创建/裁剪共用manager队列。 |
| `sync.client.host` | `''` | 有效 | 原客户端对端地址；显式认证，兼容范围见矩阵。 |
## 开放 API
| 原键 | 上游默认值 | 状态 | 插件行为与限制 |
| --- | --- | --- | --- |
| `openAPI.enable` | `false` | 有效 | 原开放API开关，默认关闭，操作同一原播放器。 |
| `openAPI.port` | `'23330'` | 有效 | 原开放API端口，校验1—65535，冲突报错。 |
| `openAPI.bindLan` | `false` | 有效 | 显式局域网绑定；false仅本机，沿用原无新增认证的访问模型。 |
## 主题
| 原键 | 上游默认值 | 状态 | 插件行为与限制 |
| --- | --- | --- | --- |
| `theme.id` | `'green'` | 有效 | 原当前主题；上游1/2月会设置新年默认主题。 |
| `theme.lightId` | `'green'` | 有效 | 原浅色主题。 |
| `theme.darkId` | `'black'` | 有效 | 原深色主题。 |
## 在线列表
| 原键 | 上游默认值 | 状态 | 插件行为与限制 |
| --- | --- | --- | --- |
| `odc.isAutoClearSearchInput` | `false` | 有效 | 原在线列表等搜索输入自动清理。 |
| `odc.isAutoClearSearchList` | `false` | 有效 | 原在线列表等搜索结果自动清理。 |

## 不在 defaultSetting 中的管理项

- 原快捷键页替换为五条宿主指令的配置入口：LX播放/暂停、上一首、下一首、搜索、桌面歌词，通过`redirectHotKeySetting`交给ZTools管理；原默认快捷键数据的保留不等于注册了所有原全局热键。物理快捷键、系统媒体键未完整验收。
- 主窗口最小化/关闭按钮隐藏，隐藏操作对应`outPlugin(false)`，继续后台；终止对应`outPlugin(true)`。原窗口全屏、尺寸、按钮位置、托盘及透明样式控件已移除；主题编辑中的关闭/最小化按钮配色也已移除，隐藏播放详情页按钮配色继续保留。
- Windows任务栏进度及独立电源锁控件已移除，原设置键仍保留；任务栏缩略图按钮没有可用公开接口。系统MediaSession只按运行时实际公开能力使用，不承诺任意系统面板/媒体键行为。状态栏歌词与桌面歌词全屏隐藏等歌词控件按用户要求保留，继续说明未支持的限制。
- 「其他」中的浏览器资源缓存显示/清理整段已移除；歌曲地址、歌词、换源缓存和不喜欢列表仍由插件独立管理，缓存清理失败时展示错误并恢复按钮供重试。
- 插件更新页说明市场/本地包安装管理，不使用LX桌面自动更新器，不把用户音源包含到升级包中。
- 音源管理、备份/恢复、下载目录授权、EQ/卷积预设等还有独立业务数据/文件，不由本表键值覆盖；全部备份按原格式只含设置与列表。
