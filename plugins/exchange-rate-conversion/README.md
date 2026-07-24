# 汇率换算 · Exchange Rate Conversion

> ZTools 扩展插件 — 蓝白简约风格，实时汇率换算工具。

基于 React 19 + Vite 6 + TypeScript 构建，支持多渠道数据源（海外/国内），实时汇率换算、历史走势图、货币搜索选择。

## ✨ 功能特性

- **实时汇率换算** — 输入金额，在 22 种主流货币间自由转换
- **双向切换** — 一键交换源货币和目标货币
- **历史走势图** — 7 天 / 30 天折线图，含最高/最低/均值/涨跌统计
- **货币搜索** — 自定义下拉组件，支持按代码/中文名/英文名过滤，键盘导航
- **多渠道数据源** — 支持 8 个 API 供应商，设置面板标签页切换
- **蓝白简约主题** — 清新天蓝配色，卡片化设计，自动适配暗色模式

### 数据源

| 区域 | 供应商 | 免费额度 | 历史走势 |
|------|--------|----------|----------|
| 海外 | Open Exchange Rates | 1000 次/月 | ✓ |
| 海外 | ExchangeRate.host | 100 次/月 | ✓ |
| 海外 | Fixer.io | 100 次/月 | ✓ |
| 海外 | CurrencyAPI | 300 次/月 | ✓ |
| 国内 | 聚合数据 | 100 次/天 | - |
| 国内 | 极速数据 | 100 次/天 | - |
| 国内 | 阿里云市场 | 需订阅 | - |
| 国内 | 华为云市场 | 需订阅 | - |

## 📁 项目结构

```
.
├── public/
│   ├── logo.png              # 插件图标
│   ├── plugin.json           # 插件配置（功能指令、图标等）
│   └── preload/
│       ├── package.json
│       └── services.js       # Node.js 文件读写能力
├── src/
│   ├── main.tsx              # 入口
│   ├── main.css              # 全局样式
│   ├── App.tsx               # 根组件 · 路由分发
│   ├── env.d.ts              # ztools/services 类型声明
│   ├── api/
│   │   ├── currencies.ts     # 货币元数据（22 种）
│   │   ├── providers.ts      # 渠道定义 + 配置存储
│   │   ├── exchangeApi.ts    # 多渠道适配器 + 中转换算
│   │   ├── historyApi.ts     # 历史区间 + 统计
│   │   └── storage.ts        # 本地存储（上次状态）
│   └── Rate/
│       ├── index.tsx         # 主换算组件
│       ├── index.css         # 蓝白主题样式
│       ├── CurrencyPicker.tsx # 自定义货币选择器
│       ├── SettingsPanel.tsx  # 数据源设置面板
│       └── TrendChart.tsx     # SVG 趋势折线图
├── index.html
├── vite.config.js
├── tsconfig.json
├── package.json
├── .gitignore
└── README.md
```

## 🚀 快速开始

```bash
# 安装依赖
npm install

# 开发模式（ZTools 自动加载 dev 版本）
npm run dev

# 构建生产版本
npm run build
```

开发服务器在 `http://localhost:5173` 启动。

## 📖 使用说明

### 触发指令

在 ZTools 中输入以下指令唤起插件：

- `汇率` / `换算` / `汇率换算`
- `exchange` / `currency`

### 配置数据源

1. 点击右上角齿轮图标打开设置
2. 在海外/国内标签页中选择一个供应商
3. 点击"没有账号？去注册 →"获取免费 API Key
4. 粘贴 Key，点击"测试连接"验证，再点击"保存"

### 货币换算

- 选择源货币和目标货币（支持搜索过滤）
- 输入金额，自动显示换算结果
- 点击 ⇄ 按钮交换货币方向
- 点击"刷新汇率"同时更新汇率和走势图

## 🎨 主题

- 蓝白简约风格，天蓝 `#3b82f6` 品牌色
- 卡片化设计 + 大面积留白
- 入场动画：fade-in + 错峰 fade-up
- 趋势图折线描边动画
- 自动适配系统暗色模式

## 🛠 技术栈

- **React 19** + **TypeScript**
- **Vite 6** 构建
- 纯 SVG 趋势图（无第三方图表库）
- localStorage 持久化配置
- CSS 自定义属性 + 暗色媒体查询

## 📄 开源协议

MIT License