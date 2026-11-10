# 本地安装与搜索

代码文件和构建产物不会自动安装到日常使用的 ZTools。隔离测试实例的安装记录也不会出现在日常实例中。

## 安装开发包

1. 在仓库根目录执行 `npm ci`。构建时会自动安装插件的独立运行依赖。
2. 执行 `npm run pack`。运行依赖以可读文件包含在 ZIP 内，安装后无需运行 Vite/Node 开发服务器。
3. 在 ZTools 的设置中打开「插件应用」，点击「导入本地插件」。
4. 选择生成的 `../output/lx-music-ztools/lx-music-ztools-0.0.2.zip`，确认安装并启用。
5. 回到主搜索框输入 `lxmusic`、`LX Music` 或 `洛雪音乐`。

也可将 `src-ztools/plugin.json` 登记为开发项目后，在 ZTools 开发工具中安装、启用该项目。单纯选择目录或生成 plugin.json 还不等于安装。

默认入口为 `dist/lx.html`，保留原 LX 界面。`dist/index.html` 是诊断页，不应作为播放器入口。

## 导入音源

在原 LX 设置页点击「自定义源管理」，通过「本地导入」选择兼容 LX API 2.0.0 的 JS 文件，或通过「在线导入」输入脚本 HTTP(S) URL。导入后选择该源。插件不附带第三方音源。

## 验证边界

当前为开发版。隔离实例已验证 ZIP 安装、关键词搜索、原界面、两种音源导入、受控音源解析播放、暂停/继续、后台播放和下一首。下载、同步等功能仍在移植，详见 compatibility.md。

自动测试使用 ZTools app.asar 3.3.0-beta.2 和独立 Electron 42.3.3 / Node 24.15.0，临时数据与日常实例分开。本机 ZTools.exe 文件内标识为 Electron 41.4.0 / Node 24.15.0；直接启动该 EXE 的 Playwright 验证未成功，因此不能把前述测试当作对安装版 EXE 的完整实机验收。
