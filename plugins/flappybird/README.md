# Flappy Bird

ZTools 插件版经典小鸟闯关。点击屏幕或按下空格，小鸟向上扇翅；松开后受重力下落。控制节奏穿过上下水管之间的缝隙，每穿过一组得 1 分；碰到水管或地面即结束。

在 ZTools 主输入框输入 `flappy`、`小鸟`、`飞鸟` 或 `Flappy Bird` 即可开始。

## 玩法

- **起飞**：点击鼠标 / 触摸屏幕，或按 `空格` / `↑` / `Enter`
- **穿越**：小鸟会自动向前飞，水管从右侧滚来，从缝隙中穿过；开口高度固定，分数越高水管略快（40 分时约快 35%）
- **计分**：成功穿过一组水管 +1 分；最高分会写入 ZTools 本地存储
- **结束**：撞到水管或地面后进入结算，稍候再点一下即可重开
- **奖牌**：5 / 10 / 20 / 40 分分别点亮铜、银、金、白金牌

## 快速开始

```bash
npm install
npm run dev
```

开发服务器默认在 `http://localhost:5173`。在 ZTools 中加载本插件后，会读取 `plugin.json` 的 `development.main`，自动打开开发版本。

浏览器里直接打开开发地址也可以预览（没有 ZTools API 时，最高分会存到 `localStorage`）。

```bash
npm run build
```

产物在 `dist/`。把该目录下的全部文件放到 ZTools 插件目录即可安装测试。

## 项目结构

```
.
├── public/
│   ├── logo.png              # 插件图标
│   ├── plugin.json           # 插件配置（指令、高度、入口）
│   └── preload/
│       └── services.js       # Preload 脚本（本游戏不依赖 Node 能力）
├── src/
│   ├── App.vue               # 按 feature code 进入游戏
│   ├── game/
│   │   ├── index.vue         # Canvas 舞台
│   │   └── engine.ts         # 物理、碰撞、绘制、音效
│   ├── main.ts
│   └── main.css
├── index.html
├── vite.config.js
└── package.json
```

## 插件配置

`public/plugin.json` 中的关键项：

| 字段 | 说明 |
| --- | --- |
| `features[].code` | `flappy`，与 `App.vue` 路由对应 |
| `features[].cmds` | `flappy` / `小鸟` / `飞鸟` / `Flappy Bird` 等触发词 |
| `pluginSetting.height` | 固定插件高度 600px，避免拖拽改变游玩区域 |
| `logo` | `logo.png` |

进入游戏时会调用 `ztools.setExpendHeight(600)`，并取消子输入框焦点，避免空格被搜索框吃掉。

## 技术说明

- **Vue 3 + Vite + TypeScript** 作为 ZTools UI 插件骨架
- **Canvas 2D** 自绘小鸟、水管、地面与云层，不依赖外部精灵图
- 物理按真实时间步长更新（重力、扇翅冲量、下落上限），避免刷新率影响手感
- 碰撞使用略小于外形的圆形判定，水管与地面为即时失败
- 最高分优先写入 `window.ztools.dbStorage`，开发预览回退到 `localStorage`
- 扇翅 / 得分 / 撞击使用 Web Audio 合成短音，无需音频文件

## 开发提示

- 调试：`npm run dev` 后在插件头像菜单中打开开发者工具
- 图标：替换 `public/logo.png` 后重新构建即可
- 本插件为单功能游戏，不再包含模板里的「读文件 / 写文件」示例

## 相关链接

- [ZTools 官方仓库](https://github.com/ztool-center/ztools)
- [插件 API](https://ztoolscenter.github.io/ZTools-doc/plugin-api.html)
- [plugin.json 配置](https://ztoolscenter.github.io/ZTools-doc/plugin-json.html)

## 开源协议

MIT License
