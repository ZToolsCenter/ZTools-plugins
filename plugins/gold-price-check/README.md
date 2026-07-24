# 每日金价 · ZTools 插件

实时查看每日金价、品牌金店饰品价、银行金条价、黄金回收价，以及日内/月度/年度价格波动走势。

## 功能

| Tab | 内容 |
|-----|------|
| **今日金价** | 品牌金店饰品价、银行投资金条价、黄金回收参考价，实时更新 |
| **日内波动** | 当日 OHLC（开/高/低/收）+ 24小时分时走势图 |
| **月度走势** | 近30天日线图 + 指定月份明细查询 |
| **年度走势** | 12个月月均线图，支持切换年份 |

## 触发指令

在 ZTools 中输入以下命令：

`金价` / `每日金价` / `黄金价格` / `gold` / `实时金价` / `今日金价` / `金条价格` / `回收金价` / `金价走势`

## 数据源

| 数据 | 来源 | 更新频率 |
|------|------|----------|
| 品牌金店/银行/回收价 (CNY) | Tmini API | 5分钟 |
| 实时金价 (USD) | gold-api.com | 5分钟 |
| 历史金价 (USD) | FreeGoldAPI | 24小时 |
| 本地快照累积 | 浏览器本地存储 | 每小时/每天/每月 |

## 技术栈

- React 19 + TypeScript 5.3
- Vite 6
- recharts（图表）

## 快速开始

```bash
npm install
npm run dev      # 开发模式 http://localhost:5173
npm run build    # 构建产物 → dist/
```

## 项目结构

```
.
├── public/
│   ├── logo.png          # 插件图标
│   ├── plugin.json       # 插件配置
│   └── preload/          # Preload 脚本
├── src/
│   ├── main.tsx
│   ├── App.tsx           # 路由入口
│   ├── env.d.ts          # 类型声明
│   └── GoldPrice/
│       ├── index.tsx     # 主组件（4个Tab）
│       ├── index.css     # 全局样式
│       ├── services/
│       │   └── goldApi.ts    # 数据层（API + 缓存 + 快照累积）
│       └── components/
│           ├── PriceCard.tsx         # 实时价格卡片
│           ├── FluctuationChart.tsx  # 波动图表
│           └── BrandTable.tsx        # 品牌价格表格
├── index.html
├── vite.config.js
├── tsconfig.json
└── package.json
```

## License

MIT
