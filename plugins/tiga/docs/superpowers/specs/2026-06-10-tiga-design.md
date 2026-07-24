# 提肛助手插件设计文档

> 定时提醒提肛运动，关爱久坐族盆底健康

## 概述

提肛助手是一个 Ztools 插件，帮助久坐用户养成提肛运动的习惯。通过定时提醒、运动引导、统计分析等功能，让盆底肌锻炼成为日常习惯。

## 功能清单

| 功能模块 | 描述 |
|---------|------|
| 定时提醒 | 可自定义提醒间隔（默认 30 分钟）及工作时段 |
| 桌面通知 | 到点发送桌面通知，支持多种文案风格 |
| 运动引导 | 弹窗展示收缩/放松倒计时过程，引导用户完成运动 |
| 教程指南 | 图文并茂的提肛姿势指南与呼吸配合教程 |
| 统计打卡 | 每日完成次数统计与连续打卡记录 |

---

## 架构设计

### 文件结构

```
tiga/
├── public/
│   ├── logo.png                    # 插件图标
│   ├── plugin.json                 # 插件配置（features 入口）
│   └── preload/
│       ├── package.json
│       └── services.js             # Node.js 服务层
│           ├── 定时器管理
│           ├── 工作时段判断
│           ├── 桌面通知发送
│           └── 本地存储读写
│
├── src/
│   ├── App.vue                     # 路由入口
│   ├── main.ts                     # 应用入口
│   ├── main.css                    # 全局样式
│   │
│   ├── Settings/                   # 设置模块（主入口）
│   │   └── index.vue               # 设置页面
│   │
│   ├── Stats/                      # 统计模块
│   │   └── index.vue               # 统计展示页面
│   │
│   ├── ExerciseGuide/              # 运动引导弹窗
│   │   └── index.vue               # 倒计时引导界面
│   │
│   ├── Tutorial/                   # 教程模块
│   │   └── index.vue               # 教程展示页面
│   │
│   └── assets/
│       └── tutorial.md             # 提肛教程内容
```

### 数据流

```
用户设置 → preload 层启动定时器
         → 定时器到达 → 检查工作时段 → 发送桌面通知
         → 用户点击通知 → Vue 层弹出 ExerciseGuide
         → 用户完成运动 → 更新统计数据 → 存储到本地
```

---

## 模块详细设计

### 1. Settings 设置页面

**功能**：用户配置所有提醒参数，作为插件主入口。

**配置项**：

| 配置项 | 类型 | 默认值 | 说明 |
|-------|------|-------|------|
| 提醒间隔 | number | 30 | 分钟 |
| 工作时段模式 | enum | single | single/multi/weekly |
| 固定时段 | object | 09:00-18:00 | start, end |
| 多时段 | array | - | 多个时间段 |
| 周几时段 | object | - | 按周几配置时段 |
| 提醒方式 | enum | notify+popup | 仅通知 / 通知+弹窗 |
| 计数方式 | enum | manual | 自动计数 / 手动计数 |
| 收缩时长 | number | 5 | 秒 |
| 放松时长 | number | 5 | 秒 |
| 重复次数 | number | 10 | 次 |
| 文案风格 | enum | random | 随机/正经/搞怪 |
| 运行状态 | boolean | true | 开关启停 |

**工作时段模式说明**：

- **固定时段 (single)**：单个时间范围，如 09:00 - 18:00
- **多时段 (multi)**：多个时间段，如 09:00-12:00, 14:00-18:00，支持添加/删除
- **周几时段 (weekly)**：按周一到周日配置，未选中的日子不提醒

---

### 2. Stats 统计页面

**功能**：展示今日完成次数、连续打卡天数、历史记录。

**数据展示**：

- 今日完成次数
- 连续打卡天数（只要有完成就算打卡）
- 历史记录列表（日期 + 完成次数）
- 清除历史确认弹窗

**连续打卡计算逻辑**：

- 从最近一天往前遍历记录
- 遇到 count > 0 继续计算
- 遇到 count = 0 停止，返回累计天数
- 跳过未记录日期（不算中断）

---

### 3. ExerciseGuide 运动引导弹窗

**功能**：展示收缩/放松倒计时，引导用户完成运动。

**运动流程**：

1. 收缩阶段：显示"收缩中..." + 倒计时秒数 + 进度条
2. 放松阶段：自动切换，显示"放松中..." + 倒计时 + 进度条
3. 重复循环：按配置次数执行
4. 结束提示：显示"已完成"/"跳过"按钮

**按钮行为**：

- 点击"已完成" → 关闭弹窗 → 计数一次 → 更新统计
- 点击"跳过" → 关闭弹窗 → 不计数

---

### 4. Tutorial 教程页面

**功能**：渲染 markdown 教程内容，展示提肛运动指南。

**内容**：

- 什么是提肛运动
- 正确姿势
- 呼吸配合
- 注意事项

**渲染方式**：Vue 组件渲染 markdown，样式适配 Ztools 主题。

---

### 5. preload/services.js 服务层

**核心职责**：

```javascript
window.services = {
  // 定时器管理
  startTimer(intervalMinutes, callback),
  stopTimer(),
  updateTimer(intervalMinutes),
  
  // 工作时段判断
  isInWorkTime(workTimeConfig),
  
  // 桌面通知
  sendNotification(title, body, onClickCallback),
  
  // 存储 API
  getItem(key),
  setItem(key, value),
  removeItem(key)
}
```

---

## 数据存储设计

### 数据结构

```typescript
// 配置数据
interface Config {
  interval: number              // 提醒间隔（分钟）
  workTimeMode: 'single' | 'multi' | 'weekly'
  workTime: {
    single: { start: string, end: string }
    multi: Array<{ start: string, end: string }>
    weekly: Record<number, { start: string, end: string }>
  }
  reminderMode: 'notify' | 'notify+popup'
  countMode: 'auto' | 'manual'
  exercise: {
    contractSeconds: number
    relaxSeconds: number
    repeatCount: number
  }
  style: 'random' | 'normal' | 'funny'
  enabled: boolean
}

// 统计数据
interface StatsData {
  records: Array<{
    date: string      // YYYY-MM-DD
    count: number     // 当日完成次数
  }>
}
```

### 存储键名

```typescript
const STORAGE_KEYS = {
  config: 'tiga_config',
  stats: 'tiga_stats'
}
```

### 存储方式

使用 `window.ztools` 提供的存储 API：

- `window.ztools.getItem(key)` - 读取
- `window.ztools.setItem(key, value)` - 写入
- `window.ztools.removeItem(key)` - 删除

---

## 通知文案设计

### 正经风格

```json
{
  "title": "提肛提醒",
  "body": "久坐伤身，该做提肛运动了，关爱您的盆底健康。"
}
```

### 搞怪风格（文案池）

```json
[
  {
    "title": "盆底肌呼叫中心",
    "body": "您的盆底肌已欠费停机，请立即充值（提肛）恢复服务！"
  },
  {
    "title": "提肛小助手",
    "body": "别坐了别坐了，屁股要废了！起来动一动，提肛保健康！"
  },
  {
    "title": "健康警报",
    "body": "警告：您的臀部已连续静止太久，建议立即启动提肛程序！"
  },
  {
    "title": "提肛时间到",
    "body": "收缩、放松，让盆底肌跳起健康的舞蹈！"
  },
  {
    "title": "盆底健康守护",
    "body": "提肛一分钟，健康一整天！现在就开始吧～"
  },
  {
    "title": "久坐预警",
    "body": "您的屁股正在酝酿抗议，请立即安抚（提肛）！"
  },
  {
    "title": "提肛大使",
    "body": "来自未来的你发来消息：感谢现在坚持提肛的我！"
  },
  {
    "title": "健康投递",
    "body": "叮咚！您的盆底健康快递已送达，请签收（提肛）！"
  },
  {
    "title": "提肛站",
    "body": "下一站：提肛站。请各位乘客做好准备，收缩放松！"
  },
  {
    "title": "盆底健身房",
    "body": "您有一张免费的盆底健身券，有效期：现在！"
  }
]
```

### 文案选择逻辑

| 设置风格 | 实际文案 |
|---------|---------|
| 正经 | 固定使用正经文案（唯一一条） |
| 搞怪 | 从搞怪文案池（10条）随机抽取一条 |
| 随机 | 从正经（1条）+ 搞怪池（10条）共 11 条文案中随机抽取一条 |

---

## plugin.json 配置

```json
{
  "name": "tiga",
  "title": "提肛助手",
  "description": "定时提醒提肛运动，关爱久坐族盆底健康",
  "author": "咖啡八杯",
  "version": "1.0.0",
  "main": "index.html",
  "preload": "preload/services.js",
  "logo": "logo.png",
  "features": [
    {
      "code": "settings",
      "explain": "提肛助手设置",
      "icon": "logo.png",
      "cmds": ["提肛", "提肛助手", "提肛设置"]
    },
    {
      "code": "stats",
      "explain": "查看提肛统计",
      "icon": "logo.png",
      "cmds": ["提肛统计"]
    },
    {
      "code": "tutorial",
      "explain": "提肛运动教程",
      "icon": "logo.png",
      "cmds": ["提肛教程"]
    }
  ]
}
```

---

## 实现优先级

1. **基础框架**：App.vue 路由 + plugin.json 配置
2. **Settings 页面**：配置项 UI + 存储功能
3. **preload 服务层**：定时器 + 存储 API
4. **桌面通知**：通知发送 + 点击回调
5. **ExerciseGuide**：运动引导弹窗
6. **Stats 页面**：统计展示
7. **Tutorial 页面**：教程渲染
8. **文案系统**：风格切换逻辑