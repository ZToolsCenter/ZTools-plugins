# datetime-tools（时间日期工具）

ZTools 插件，Vue 3 + TypeScript + Vite 重写自 uTools 插件「时间日期计算」。
全部功能为纯本地计算，不依赖任何外部接口。

## 功能

| 入口 code | 功能 |
| --- | --- |
| datetime | 时间戳 ↔ 北京时间互转，实时当前时间戳（支持毫秒） |
| dateDiff | 计算两个日期的天数差，可开启时分秒模式 |
| dateCalc | 从基准日期按天 / 周 / 月推算日期 |
| dateWeekday | 推算若干个工作日之后的日期（含节假日与调休） |
| dateWorkdays | 统计日期区间内的工作天数（含节假日与调休明细） |
| dateFormat | 日期转美式 / 英式英文格式，点击复制 |
| dateTimezone | 世界时间转换器（37 城市，自动处理夏令时） |
| stopWatch | 在线秒表（计次、暂停记录、复位，A/S/C 快捷键） |

节假日与调休补班数据内置 2024-2026 年官方放假安排
（来源：国务院办公厅历年节假日安排通知），新一年安排公布后在
`src/utils/holidays.ts` 中补充即可。

相比原插件，移除了「历史上的今天」（依赖作者私有服务器接口）和「赞赏」页面。

## 开发

```bash
npm install
npm run dev      # Vite 开发服务器，配合 plugin.json 的 development.main 调试
npm run build    # vue-tsc 类型检查 + 产物构建
npm run release  # 通过代理调用 ztools plugin-cli 发布（需先 git commit）
```
