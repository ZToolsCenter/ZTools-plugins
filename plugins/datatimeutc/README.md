# datatimeutc — UTC 标准时间

> ZTools 插件：实时显示 UTC 时间，支持多时区切换、自定义日期时间格式、NTP 网络校时，以及可拖拽的置顶悬浮时间小窗。

基于 **Vue 3 + Vite + TypeScript** 构建。

## ✨ 功能特性

- **实时 UTC 时间**：大字时钟，250ms 刷新，毫秒级显示
- **多时区切换**：覆盖 Intl 全部时区（按 UTC 偏移去重，约 40 项），中文显示名
- **自定义格式**：日期、时间、星期、毫秒可自由组合
- **NTP 网络校时**：依次尝试 `cn.ntp.org.cn` → `pool.ntp.org` → `time.nist.gov`，每 5 分钟自动校准一次；校准偏移持久化，悬浮窗启动即可用
- **悬浮时间窗**：无边框、透明、置顶、不占任务栏，可拖拽移动；透明度与大小（缩放）可调，偏好自动记忆
- **亮/暗双主题**：跟随系统

## 🚀 使用

在 ZTools 中触发以下指令：

| 指令 | 功能 |
| --- | --- |
| `utc` / `时间` / `时区` / `utc时间` | 打开主界面（时钟 + 时区/格式设置） |
| `悬浮时间` / `utc悬浮` / `时间悬浮` | 直接开启悬浮时间窗 |

悬浮窗内可用滑块调节透明度与大小，点击关闭按钮退出。

## 🛠️ 开发

```bash
npm install        # 安装依赖
npm run dev        # 开发服务器（端口 5173），ZTools 客户端自动加载 dev 版
npm run build      # 类型检查 + 构建 → 输出到 src-ztools/dist/
```

## 📁 项目结构

```
.
├── src/                        # Vue 3 前端源码
│   ├── main.ts                 # 入口
│   ├── App.vue                 # 根组件（三态路由：#float / utc-float / 主界面）
│   ├── env.d.ts                # window.services 类型声明
│   └── Utc/
│       ├── index.vue           # 主界面：大字时钟 + 时区/格式设置
│       ├── Float.vue           # 悬浮窗界面
│       ├── AutoFloat.vue       # 自动开悬浮窗（无 UI）
│       ├── time.ts             # NTP offset 单例（getNow / 周期校准）
│       └── format.ts           # Intl 时间格式化 + 时区列表/中文名
├── src-ztools/                 # 插件发布单元
│   ├── plugin.json             # 插件清单（实际生效的配置）
│   ├── preload/services.js     # Node 能力桥接（NTP 校时、悬浮窗管理）
│   ├── dist/                   # 构建产物
│   └── logo.png
├── index.html
├── vite.config.js              # base: './'（file:// 加载必需）
└── package.json
```

## 📚 相关资源

- [ZTools 文档](https://ztoolscenter.github.io/ZTools-doc)
- [Vue 3 文档](https://vuejs.org/)
- [Vite 文档](https://vitejs.dev/)

## 📄 开源协议

MIT License
