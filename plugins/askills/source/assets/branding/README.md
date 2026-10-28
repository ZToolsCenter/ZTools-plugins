# Askills 软件标志

- `ASkills.source.svg`：用户提供的原始矢量稿，按原字节保留。
- `../../src/assets/askills.svg`：用于界面和浏览器图标的可移植版本。保留原稿的颜色、布局、字号和变换，将 MiSans SemiBold（可变字体 `wght=600`）的 `S`、`kills` 转为路径，不依赖目标系统安装字体。通过构建工具生成资源地址，更新标志后避免沿用旧缓存。
- `../../src-tauri/icons/`：由上述可移植 SVG 生成的 Windows、macOS 和 PNG 桌面图标。

字体来源和许可见 [MiSans 说明](../../third-party/fonts/README.md)。原字体文件未改动。

重新生成桌面图标：

```sh
pnpm tauri icon src/assets/askills.svg --output .askills/generated-icons
```

将生成目录顶层的桌面图标文件复制到 `src-tauri/icons/`。Android/iOS 子目录不属于当前桌面项目的打包范围。

主窗口启动时显式应用程序图标。Windows 的窗口小图标和任务栏大图标分别设置，均使用可执行文件内嵌的同一套 ICO 资源；任务栏图标句柄由 Windows 管理。需要重新启动应用才能更新正在运行的窗口。
