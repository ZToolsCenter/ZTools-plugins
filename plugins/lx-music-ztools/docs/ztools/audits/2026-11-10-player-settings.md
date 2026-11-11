# 播放、播放详情、桌面歌词逐项审计

日期：2026-11-10。范围为原 LX 2.12.6 控件、Vue store、ZTools 构建适配、preload/runtime 的行为链。本分工没有启动 Electron，没有修改 `vendor/lx`，没有提交。下文“连通”仅表示源码存在完整消费者，不等同于已经逐项通过真实宿主验收。

## 判定及共同链路

- **连通，待宿主验证**：原控件到实际消费者可定位；本次没有验证该项画面、声音或设备行为。
- **回归通过，待宿主验证**：已执行真实构建适配后代码；只替代浏览器设备等外部边界，验证分支、异步行为和设置写入。不能代替物理音频输出验证。
- **不支持，保留说明**：已禁用的歌词相关项目，用户明确要求“歌词相关先保留”。
- **已批准移除控件**：非歌词的独立桌面能力，由主任务统一移除；本分工不删除控件或默认设置键。

所有原设置控件调用 `vendor/lx/src/renderer/store/setting.ts:23-25` → 原 IPC（构建时由 `src/ztools/rendererIpc.ts:16-18` 转发）→ `src-ztools/preload/runtime/index.cjs:115-118` → `AppEvent.update_config`（`preload/upstream/main/event/AppEvent.cjs:34-41`）→ 设置数据库及 `updated_config` 事件 → 原 `useSettingSync` 合并到响应式 store。桌面歌词由 `runtime/windows.cjs:4-6,59-61` 筛选并推送配置到歌词页面，原 `renderer-lyric/main.ts:16-35` 初始化/合并。

## 本次发现与修复

| 问题 | 修复前证据 | 修复与证据 | 验证级别 |
| --- | --- | --- | --- |
| 只有 `mediaDevices` 对象就假定所有输出 API 可用 | 旧 `media-device-loader.cjs` 只增加对象存在判断；上游 `plugins/player/index.ts:452-454` 直接调用 `audio.setSinkId` | `src/ztools/audio-capabilities.cjs:2-6` 分别检测枚举、sink、设备事件；构建后的 SettingPlay 禁用无能力控件 | 回归通过；真实宿主能力由主任务采集 |
| 同名不同设备被拔除时不暂停 | 上游 `useMediaDevice.ts:56-65` 只比较 label；不同设备可有同一个 label | `src/ztools/use-media-device.js:27,46-51` 比较 deviceId、groupId、label，当前输出改变时触发暂停 | 同名设备移除回归通过；物理拔插待验证 |
| 设备切换失败再回退失败，仍保存默认输出并产生未处理 rejection | 上游 `useMediaDevice.ts:44-52` 第二次切换使用 `.finally(save default)`，未处理其拒绝 | `use-media-device.js:60-81` 只保存成功结果；双失败恢复最近实际应用的选择，捕获全部拒绝 | 回归通过 |
| 连续切换时旧结果覆盖新选择；卸载后仍写设置 | 上游 `useMediaDevice.ts:79-84` 对每次变化直接启动 Promise，没有序号/卸载取消 | `use-media-device.js:18-31,60-91` 串行、revision、disposed；旧正常切换及旧默认回退完成后记录物理结果，随后重新应用最新选择；销毁不写回 | 两类旧请求晚完成、卸载晚完成回归通过 |
| 枚举拒绝导致未处理错误 | 上游 `useMediaDevice.ts:12,81,84` 无拒绝处理；原 SettingPlay 枚举亦未捕获 | `use-media-device.js:35-41` 保留最近应用输出；SettingPlay 列表失败为空且禁用选择 | 回归通过 |
| 桌面频谱启用绕过非默认设备确认 | 原 SettingDesktopLyric `:13` 直接写开关；桌面 `AudioVisualizer.vue:127` 请求主窗口 `core/lyric.ts:27` 的 analyser；后者会创建默认 destination | `host-settings-loader.cjs` 的 SettingDesktopLyric 分支加入确认，默认输出切换成功才一次写入 deviceId 与开关；失败/取消不启用 | 取消、输出失败回归通过；真实频谱/声音待验证 |
| 主频谱、最大输出通道在 sink 失败后仍声称已切默认 | 原详情 `ControlBtns.vue:83-86`；SettingPlay `:135-137` 均吞异常后存默认并启用功能 | `audio-routing-loader.cjs:4-9` 和 SettingPlay 构建分支改为失败即返回并反馈 | 主频谱成功/失败、最大通道失败回归通过 |
| 最大通道勾选不跟随外部恢复设置 | 原 SettingPlay `:121` 仅以初值建立 ref | 构建分支增加 appSetting → ref 的 watch | 外部设置恢复回归通过 |
| EQ/其他DSP或导入配置创建AudioContext后，实际默认输出与保存的自选设备不一致 | 原 `plugins/player/index.ts:124,141` 构造context时未指定sink，直接接到默认destination；旧setMediaDeviceId只切audio | `engine-routing-loader.cjs:11-50` 跟踪effectiveSink；没有mediaSource时只切元素，有mediaSource时只切当前context；切换串行、失败回滚。创建context承接此前实际输出；元素await期间若被DSP接管，转为切新owner | DSP前/后/切换中创建、导入已有DSP、context失败不写选中目标、关闭效果不改路由回归通过 |
| 引擎已经支持同sink，旧UI仍禁止DSP后选设备或强制回默认 | 原 SettingPlay `:83-105`、详情ControlBtns `:76-84`、SoundEffectBtn `index.vue:20,54-56` | SettingPlay改为按现代双路能力放行；现代频谱/最大通道保留当前输出；旧音效冲突警告只在legacy显示且改为“仅默认输出，音效可使用” | 5项UI实际脚本行为先失败后通过 |
| 输出失败只记录console，用户看不到原因 | 原设备hook只console.log | `use-media-device.js:20-25,73-77` 发布窗口内窄事件及内存消息；SettingPlay输出role=alert，分别说明已回默认或默认也失败且保留上次设备设置；后续成功清除 | 3项真实Pug→Vue→SSR行为先失败后通过，含晚打开设置读取错误快照 |

`media-device-loader.cjs` 只替换宿主相关 hook 的构建输入，读取 `src/ztools/use-media-device.js`；原 vendor 保持不变。音频UI loader 由主任务统一在 webpack 接入，规则只匹配 `renderer/components/layout/PlayDetail/components/ControlBtns.vue` 与 `renderer/components/common/SoundEffectBtn/index.vue`。引擎loader规则只匹配 `renderer/plugins/player/index.ts`。自选输出需要元素及AudioContext均支持setSinkId，保证后续开启DSP仍与同一输出保持一致；缺任一路由能力时只提供系统默认输出，hook也会纠正后来导入的自选deviceId。

## 播放设置与相关控制

表中短路径均相对于 `vendor/lx/src/renderer`，`runtime/` 相对于 `src-ztools/preload/runtime`。

| 设置键/控件 | 实际行为消费者及证据 | 当前结论 | 真实验证方法 |
| --- | --- | --- | --- |
| `player.startupAutoPlay` | `core/useApp/useDataInit.ts:14-29` 恢复列表后依开关调用播放 | 连通，待宿主验证 | 播放有效本地曲目后终止；分别开/关冷启动，观察实际 audio.paused 与进度 |
| `player.togglePlayMethod` | `core/useApp/usePlayer/usePlayer.ts:127-130`；`core/player/action.ts` 的上一首/下一首选择 | 连通，待宿主验证 | 两首曲目分别验证单曲、列表循环、顺序、随机及历史清理差异 |
| `player.playQuality` | SettingPlay `:37-42` → `core/music/utils.ts:258,305`/`core/music/online.ts:54` | 连通，受音源能力约束 | 记录音源收到的实际 quality；资源不支持时区分原降级逻辑 |
| `player.isShowTaskProgess` | host loader 禁用；原任务栏行为未适配 | 已批准移除控件 | 主任务移除后确认 UI 不再提供此项；默认键保留供备份兼容 |
| `player.isShowStatusBarLyric` | Windows 条件下原 SettingPlay 不显示；原 `core/useApp/useStatusbarLyric.ts` 只有系统状态栏输出协议，无 ZTools 渲染器 | 不支持，歌词相关保留说明 | 不能以 player_status 收到歌词冒充系统状态栏真的显示 |
| `player.volume` | `core/useApp/usePlayer/useVolume.ts` → `plugins/player/index.ts:457-458` audio.volume | 连通，待宿主验证 | 滑块/静音分别检查同一个 audio.volume、声音与重启值 |
| `player.powerSaveBlocker` | `core/player/utils.ts:51-62` → `runtime/host.cjs:31` 明确返回 supported:false | 已批准移除控件 | 不承诺防系统睡眠；主任务移除控件 |
| `player.isMute` | `useVolume.ts` → `plugins/player/index.ts:439-440` audio.muted | 连通，待宿主验证 | 点击静音与取消，断言实际 audio.muted 并听音 |
| `player.playbackRate` | `core/useApp/usePlayer/usePlaybackRate.ts` 同步音频与歌词时钟 | 连通，待宿主验证 | 0.5/1/2 倍观察时间增速；主歌词、桌面歌词同步 |
| `player.preservesPitch` | `usePlaybackRate.ts:14,45-46` → `plugins/player/index.ts:430-432` | 连通，待宿主验证 | 在改变速度时开/关，检查 audio.preservesPitch 并听音高 |
| `player.isMaxOutputChannelCount` | `useMaxOutputChannelCount.ts:8-11` → `plugins/player/index.ts:185-205` destination.channelCount | 回归通过，设备通道待验证 | 读取实际 destination.maxChannelCount/channelCount；两声道设备不能冒充多声道成功 |
| `player.mediaDeviceId` | 新 `src/ztools/use-media-device.js` → 引擎构建适配后的setMediaDeviceId → 当前owner的setSinkId | 回归通过，修正后的真实输出由主任务复验 | 无DSP看元素sink；已接入DSP看context.sinkId或引擎getMediaDeviceId；元素裸sink不再代表输出。失败看role=alert与回退值；旧context仅默认输出 |
| `player.isMediaDeviceRemovedStopPlay` | 新 hook `:31-37,66-71`；缺事件能力时 UI 禁用 | 回归通过，物理拔插待验证 | 开/关分别拔当前设备；同名设备；默认设备切换；仅新增无关设备不应暂停 |
| `player.isShowLyricTranslation` | `core/lyric.ts:163-169`；桌面 `renderer-lyric/useApp/useLyric.ts:7` | 连通，待宿主验证 | 使用有翻译的固定歌词，开/关主歌词及桌面副行 |
| `player.isShowLyricRoma` | `core/lyric.ts:163`；桌面 `useLyric.ts:8` | 连通，待宿主验证 | 使用有罗马音的固定歌词，开/关两页面副行 |
| `player.isSwapLyricTranslationAndRoma` | `core/lyric.ts:165`；桌面 `useLyric.ts:9` | 连通，待宿主验证 | 同时显示翻译/罗马音，再比较顺序；单副行时不可当作无效 |
| `player.isS2t` | `core/music/utils.ts:80-87` 读取歌词时转换 | 连通，需重新加载歌词 | 固定简体歌词，切换后重新取词/换歌，检查简繁内容；不承诺当前曲即时原地转换 |
| `player.isPlayLxlrc` | `core/lyric.ts:168`；桌面 `useLyric.ts:10` 选增强词 | 连通，待宿主验证 | 同一曲同时给普通词/逐字增强词，分别观察逐字推进 |
| `player.isSavePlayTime` | `usePlayProgress.ts:146` 保存；`core/player/action.ts:156` 决定恢复时间 | 连通，待宿主验证 | 播至中段并落盘后冷启动；开则续播、关则从头；临时播放排除规则单独判断 |
| `player.audioVisualization` | `components/layout/PlayDetail/index.vue:25` → `common/AudioVisualizer.vue:44,74,137-158` | 开启路由回归通过；频谱画面待验证 | 播放有声音 fixture，开关 canvas、像素变化；进出详情/暂停停止动画；不得增加第二个 audio |
| `player.waitPlayEndStop` | `core/player/timeoutStop.ts:26-28` 决定定时到后立即暂停或等当前首结束 | 连通，待宿主验证 | 两首 fixture，短定时；分别检查立即暂停/播完后不跳下一首 |
| `player.waitPlayEndStopTime` | `views/Setting/components/PlayTimeoutModal.vue:37,66-67` 保存分钟并启动定时器 | 连通；持久化类型由主任务数据域修复 | 输入分钟、启动/取消、重开取值；时间标签和真实停止点分别验证 |
| `player.autoSkipOnError` | `core/player/action.ts:91,140`、`usePlayEvent.ts:62,97`、`usePlayProgress.ts:40` | 连通，待宿主验证 | 列表第一首返回错误/超时、第二首有效；分别开/关观察是否自动跳过 |
| `player.isAutoCleanPlayedList` | `core/player/action.ts:247,262` 调用 clearPlayedList | 连通，待宿主验证 | 相同列表不同播放入口，开/关后比较随机播放历史/上一首可回溯范围 |
| `player.soundEffect.convolution.fileName` | `useSoundEffect.ts:19-51,65-68,88-97` 对**打包的 filters 资源名**加载/解码并设置 Convolver | 连通，资源解码待验证 | 逐个内置预设实际加载、获取 buffer；它不是任意自定义文件路径授权控件 |
| `player.soundEffect.convolution.mainGain` | `useSoundEffect.ts:99-102` → `setConvolverMainGain` | 连通，声音待验证 | 选内置卷积后读实际 gain，听干声变化；未选卷积时原控件禁用 |
| `player.soundEffect.convolution.sendGain` | `useSoundEffect.ts:103-105` → `setConvolverSendGain` | 连通，声音待验证 | 同上，检查实际湿声 gain 和听感 |
| `player.soundEffect.biquadFilter.hz31` | `useSoundEffect.ts:107-110` → BiquadFilter.gain | 连通，音效待验证 | 读 31Hz 节点实际 gain，对低频 fixture 验证频谱/声音变化 |
| `player.soundEffect.biquadFilter.hz62` | `useSoundEffect.ts:111-114` | 连通，音效待验证 | 同上，62Hz |
| `player.soundEffect.biquadFilter.hz125` | `useSoundEffect.ts:115-118` | 连通，音效待验证 | 同上，125Hz |
| `player.soundEffect.biquadFilter.hz250` | `useSoundEffect.ts:119-122` | 连通，音效待验证 | 同上，250Hz |
| `player.soundEffect.biquadFilter.hz500` | `useSoundEffect.ts:123-126` | 连通，音效待验证 | 同上，500Hz |
| `player.soundEffect.biquadFilter.hz1000` | `useSoundEffect.ts:127-130` | 连通，音效待验证 | 同上，1000Hz |
| `player.soundEffect.biquadFilter.hz2000` | `useSoundEffect.ts:131-134` | 连通，音效待验证 | 同上，2000Hz |
| `player.soundEffect.biquadFilter.hz4000` | `useSoundEffect.ts:135-138` | 连通，音效待验证 | 同上，4000Hz |
| `player.soundEffect.biquadFilter.hz8000` | `useSoundEffect.ts:139-142` | 连通，音效待验证 | 同上，8000Hz |
| `player.soundEffect.biquadFilter.hz16000` | `useSoundEffect.ts:143-146` | 连通，音效待验证 | 同上，16000Hz |
| `player.soundEffect.panner.enable` | `useSoundEffect.ts:56,75-80` → `plugins/player/index.ts:284` 周期更新声像位置 | 连通，音效待验证 | 双声道耳机听左右移动；关后定时器清除 |
| `player.soundEffect.panner.soundR` | `useSoundEffect.ts:57,82-84` 半径除以10 | 连通，音效待验证 | 比较最小/最大半径及 Panner.position 值 |
| `player.soundEffect.panner.speed` | `useSoundEffect.ts:58,85-87` 周期速度换算 | 连通，音效待验证 | 比较两档实际位置变化周期 |
| `player.soundEffect.pitchShifter.playbackRate` | `useSoundEffect.ts:70-71,148-150` → `plugins/player/index.ts:356,373` AudioWorklet | 连通，Worklet待验证 | 检查 pitch_shifter Worklet 加载、实际 AudioParam，正常时长下音高改变 |

## 播放详情

| 设置键 | 控件与消费者 | 当前结论 | 真实验证方法 |
| --- | --- | --- | --- |
| `playDetail.isZoomActiveLrc` | SettingPlayDetail `:5` → `PlayDetail/LyricPlayer.vue:7,69` 切 class | 连通，待宿主验证 | 比较活动词行的实际 transform/font 样式；非活动行不得一起放大 |
| `playDetail.isShowLyricProgressSetting` | SettingPlayDetail `:9` → `LyricPlayer.vue:17,70,86`、`utils/compositions/useLyric.js:79` | 连通，待宿主验证 | 拖动/滚离当前词行后比较进度快捷控件；在自动滚动时不显示是原条件 |
| `playDetail.style.fontSize` | 详情 `components/LyricMenu.vue:110-115` → `LyricPlayer.vue:141` 百分比字号 | 连通，待宿主验证 | 70/140/200及重置100；检查实际字号与重新进入后的保存值 |
| `playDetail.style.align` | SettingPlayDetail `:14-16` → `LyricPlayer.vue:137` textAlign | 连通，待宿主验证 | left/center/right 与详情快捷菜单双向同步 |
| `playDetail.isDelayScroll` | SettingPlayDetail `:7` → `utils/compositions/useLyric.js:196` | 连通，待宿主验证 | 给足多行跨时歌词，比较换行延迟/立即滚动的实际时间 |

## 桌面歌词全量键

下表歌词 renderer 路径相对于 `vendor/lx/src/renderer-lyric`。原页面实际入口为 `src/ztools/lyric-entry.ts:3`；独立歌词 preload 为 `src-ztools/preload/lyric.cjs`。播放器数据经 `src/ztools/rendererIpc.ts:5-13` 的原 MessagePort 协议适配、`runtime/windows.cjs:73-119` 白名单、parent/child session 消息传递，仍读取同一个 audio/analyser。

| 设置键 | 消费者与证据 | 当前结论 | 真实验证方法 |
| --- | --- | --- | --- |
| `desktopLyric.enable` | `runtime/windows.cjs:43-53` createBrowserWindow/closeNow | 本轮 Node 窗口回归通过；宿主待验证 | 勾选/取消和宿主“LX桌面歌词”指令，检查实际独立窗口及关闭后资源 |
| `desktopLyric.isLock` | `windows.cjs:57` setIgnoreMouseEvents；`App.vue:2,5` 锁定样式/隐藏控制条 | Node 回归通过；宿主待验证 | 锁定后点击落到底层程序；主设置解锁后可操作 |
| `desktopLyric.isAlwaysOnTop` | `windows.cjs:56` setAlwaysOnTop | Node 回归通过；宿主待验证 | 与普通应用切换层级；系统安全窗口不在承诺范围 |
| `desktopLyric.isAlwaysOnTopLoop` | `windows.cjs:121-139` 每500ms在两个开关均开启时 moveTop | 连通，待宿主验证 | 置顶关时不得调用；置顶开时观察持续层级和开关停止效果 |
| `desktopLyric.isShowTaskbar` | `windows.cjs:58` setSkipTaskbar | 连通，待宿主验证 | 比较歌词窗口任务栏入口；与主播放器进度条是不同功能 |
| `desktopLyric.audioVisualization` | `App.vue:12`、`common/AudioVisualizer.vue:69-127`；主 `renderer/core/lyric.ts:25-37` 送 Uint8Array | 输出确认回归通过；IPC频谱待宿主验证 | 实际非零数据/像素变化、暂停后停止；确认通过宿主跨窗传输后仍保留 length/字节值 |
| `desktopLyric.fullscreenHide` | 原控件由 host loader 禁用；没有其他应用全屏检测消费者 | 不支持；依用户要求保留说明 | 不把窗口自身全屏事件当作“检测其他应用全屏”验收 |
| `desktopLyric.pauseHide` | `useApp/usePauseHide.ts:13-37` 暂停200ms后 hide；`App.vue:88-93` 透明度0.05 | 连通，待宿主验证 | 播放/暂停/恢复及切开关；原行为为淡出，窗口不会销毁，悬停未锁定时可回显 |
| `desktopLyric.width` | `windows.cjs:25,31,55,65-67,135-136` bounds与回写 | Node边界回归通过；宿主待验证 | 手动调整、最小38、超过工作区、关闭重开；对照真实 getBounds |
| `desktopLyric.height` | 同上 | Node边界回归通过；宿主待验证 | 同上，高度方向 |
| `desktopLyric.x` | `windows.cjs:26-33,65-67` null按工作区右侧初始化 | Node负坐标回归通过；宿主待验证 | 多屏、负坐标、拖动回写、重置位置 |
| `desktopLyric.y` | 同上，按工作区底侧初始化 | Node负坐标回归通过；宿主待验证 | 同上，纵向工作区及任务栏边界 |
| `desktopLyric.isLockScreen` | `windows.cjs:30-33` 将 bounds 限制在目标显示器 workArea | Node回归通过；宿主待验证 | 勾选后不能越工作区；它是限制越屏，不是系统锁屏 |
| `desktopLyric.isDelayScroll` | `components/layout/LyricHorizontal/useLyric.js:198`、Vertical对应文件 `:198` | 连通，待宿主验证 | 两方向下比较换行延迟/立即滚动 |
| `desktopLyric.scrollAlign` | Horizontal/Vertical `useLyric.js:9` | 连通，待宿主验证 | top/center 与横/竖排组合，观察活动行实际落点 |
| `desktopLyric.isHoverHide` | `useApp/useHoverHide.ts:9,15-31`；`windows.cjs:97` 回传鼠标状态 | 有条件连通，待宿主验证 | 未锁/锁定分别进出歌词区；锁定穿透后 forward 鼠标事件由宿主决定，不可只验证未锁情况 |
| `desktopLyric.direction` | `App.vue:9-10` 切组件；`useApp/useLyric.ts:19-20` 切歌词播放器方向 | 连通，待宿主验证 | 当前播放中切横/竖，词、时间、滚动、频谱不丢失 |
| `desktopLyric.style.align` | Horizontal `index.vue:40`、Vertical `index.vue:39` textAlign | 连通，待宿主验证 | left/center/right，两方向分别比对实际布局 |
| `desktopLyric.style.font` | Horizontal/Vertical `index.vue:37` fontFamily；字体列表来自系统字体接口 | 连通，待宿主验证 | 选择本机明显不同字体并检查 computed fontFamily/字形；无安装字体会回退 |
| `desktopLyric.style.fontSize` | Horizontal/Vertical `index.vue:38`；`ControlBar.vue:83-93` 限制10—80 | 连通，待宿主验证 | 通过歌词窗口工具栏加减与重开后保存值/真实字号 |
| `desktopLyric.style.lineGap` | Horizontal `index.vue:41-42`、Vertical `index.vue:40-41` CSS变量 | 连通，待宿主验证 | 设置页增/减0—25；两方向词行间距实测 |
| `desktopLyric.style.lyricUnplayColor` | `useApp/useTheme.ts:10` 更新样式变量 | 连通，待宿主验证 | 选明显不同颜色，未播字/播过字分别核验 |
| `desktopLyric.style.lyricPlayedColor` | 同上 | 连通，待宿主验证 | 当前字推进后的颜色；同时测默认色恢复 |
| `desktopLyric.style.lyricShadowColor` | 同上 | 连通，待宿主验证 | 深色/透明阴影分别比较 computed shadow 与画面 |
| `desktopLyric.style.opacity` | Horizontal/Vertical `index.vue:39`；`ControlBar.vue:96-105` 6—100 | 连通，待宿主验证 | 歌词窗口工具栏加减；文本透明度应变化，不能只读设置值 |
| `desktopLyric.style.ellipsis` | Horizontal `index.vue:30`、Vertical `index.vue:29` ellipsis class | 连通，待宿主验证 | 很窄窗口+长歌词，两方向开关看省略效果 |
| `desktopLyric.style.isZoomActiveLrc` | Horizontal `index.vue:29,45`、Vertical `index.vue:28,44`；控制条 `:80` | 连通，待宿主验证 | 当前行缩放；与延迟滚动组合比较，不只看 class名 |
| `desktopLyric.style.isFontWeightFont` | Horizontal `index.vue:31`、Vertical `index.vue:30` | 连通，待宿主验证 | 逐字歌词当前字/已播字实际字重与普通行比较 |
| `desktopLyric.style.isFontWeightLine` | Horizontal `index.vue:32`、Vertical `index.vue:31` | 连通，待宿主验证 | 当前歌词整行加粗开关，普通歌词和逐字歌词分别看 |
| `desktopLyric.style.isFontWeightExtended` | Horizontal `index.vue:33`、Vertical `index.vue:32` | 连通，待宿主验证 | 有翻译/罗马音副行时检查字重；无副行不适合作验收数据 |

设置页“颜色恢复”同时写三种颜色，原 `SettingDesktopLyric.vue:235-246`；“窗口恢复”同时写450×300及x/y=null，原同文件 `:287-294`。两者应分别执行真实视觉/窗口核验，不能只看 updateSetting 参数。

## 尚需主任务处理或明确限制

1. **真实硬件/画面未在本分工验收。** 上表不能整列改成“有效已验证”。需由主任务在宿主实际执行，尤其是 setSinkId、devicechange、AudioContext、AudioWorklet、歌词跨窗 Uint8Array、锁定下 hoverHide。
2. **实际宿主发现并纠正了元素/context双切的错误假设。** 主任务在Electron41.4.0测到元素setSinkId抛AbortError，而同一context直接切物理ID成功。本次失败来自DSP接管后继续切已失去输出权的元素，不能写成硬件限制。Chromium源实现的SetClient会移除元素sink；SwitchOutputDevice在client存在或sink为空时返回错误（[Chromium实现](https://chromium.googlesource.com/chromium/src/+/7020a2cd5b02f820f500b93e6e21a29eb217aa85/third_party/blink/renderer/platform/media/web_audio_source_provider_impl.cc#326)）。最终引擎只操作当前owner，不要求两个裸sink相同：创建DSP后元素sink保留旧值正常，实际输出以context为准。测试double也已加入该真实拒绝行为，修复前5项预期失败得到复现。现代主/桌面频谱及最大通道保留当前选择，旧宿主只开放系统默认输出；原冲突提示已按能力改写/隐藏。
3. **settings-map 需要纠正卷积含义。** 该键值是打包 filters 的资源名，原控件是预设选择，不是“必须经文件对话框授权的任意卷积文件”。
4. **歌词保留要求。** `player.isShowStatusBarLyric`、`desktopLyric.fullscreenHide` 应保留但标记禁用及原因。其余歌词键也保留。`player.powerSaveBlocker`、`player.isShowTaskProgess` 非歌词项由主任务按用户批准移除控件，保留兼容数据键。

## 本次实际执行的检查

- `node --test tests/ztools/audio-routing.test.cjs`：包含设备能力、异步切换、当前owner接管、导入/DSP顺序竞争、现代UI及可见错误。新owner模型的测试double模拟捕获后的元素AbortError；可见错误通过真实Pug、Vue编译和SSR核验。当前音频回归34项通过，含接管中context失败仍保留上次成功输出。
- `npm run test:ztools`：当前owner及错误提示修复后最新完整运行共242项，241通过、0失败、1跳过，输出在 `artifacts/settings-node-test.log`。原 SQLite experimental 提示与同步取消日志仍输出；它们不是本次音频验收凭证。主任务后续若增加/修改测试应以新的完整运行计数为准。
- 未启动 Electron，未实际播放设备声音，未完成逐个歌词样式的截图比较，未改变 vendor 或提交代码。
