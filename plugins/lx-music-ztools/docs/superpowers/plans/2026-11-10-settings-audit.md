# 设置逐项验收与插件归属实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 验收全部设置，修复实际失效功能并更新关于页维护者归属。

**Architecture:** 保留上游快照，在已有 ZTools 适配层修复。界面交互、持久化、消费端效果分开记录；无公开宿主能力的项目只汇总，获批后才移除。

**Tech Stack:** Vue 3、Webpack、Node preload、SQLite、Playwright Electron 41.4.0、真实 ZTools app.asar。

**Spec:** `docs/superpowers/specs/2026-11-10-settings-audit.md`

## Global Constraints
- 不修改 vendor/lx；不把用户音源写入仓库、测试产物跟踪文件或插件 ZIP。
- 不删除未经用户批准的设置；不动日常宿主配置；宿主用例串行。
- By: jiang66-so；From: 洛雪无痕（lyswhut），保留原作者许可。
- 不擅自市场发布或远端推送。

## Review Focus
- 控件可勾选且保存，但实际消费者未响应：必须检查 DOM/音频/服务效果。
- 备份恢复及重启后值正确，消费者仍持有旧状态：复测重载和切换。
- 新增适配涉及宿主 Node 跨上下文能力：必须在真实 app.asar 验证。
- 禁用项和平台条件项：不能冒充已通过，且不得未获批删除。
- 关于页外链及协议入口：必须指向适配仓库并保留上游来源。

### Task 1: 全量清单与缺陷复现
- [x] 逐分区追踪所有控件，记录键、消费者、现有测试及缺口。
- [x] 新建 `scripts/test-settings.mjs`，实际操作控件并观察持久化/效果；发现断链保留失败证据。
- [x] 汇总宿主管理及不适合插件项目，向用户统一询问。

### Task 2: 行为修复与关于页
- [x] 对每个已复现缺陷写失败用例，再在适配层实现并复测。
- [x] 新增 `src/ztools/SettingAbout.vue`，通过既有 Webpack 模块替换接入。
- [x] 根据用户对移除清单的答复处理界面，不擅自删项。

### Task 3: 完整回归及交付
- [x] 运行 `npm run test:ztools`、完整 build、设置宿主验收和受影响模块的实际宿主用例。
- [x] 更新 `docs/ztools/settings-map.md` 和新增逐项验收报告，区分实测/条件/待批准。
- [x] 生成并检验本地 ZIP，扫描用户音源排除规则，报告剩余现实限制。

## 执行记录

- 基线：4fde853，开始时工作区干净。用户已授权检查并实现，不重复索取实施批准。
- Ruling: 关于页 GitHub 名称取 jiang66-so — 用户给定仓库和现有 manifest 一致。
- Ruling: 三个独立设置域先并行只读审计，宿主验证与修改集中串行 — 避免共享 Electron 状态及适配文件冲突。
- Ruling: 用户答复“歌词相关先保留”，保留全部歌词项及限制说明，其余列出项移除UI但兼容键留存。
- Ruling: 实际DSP接管后元素setSinkId拒绝，而context同设备成功；纠正“双路同切”假设，改为当前输出owner路由。最终ZIP实际切换与回默认通过。
- 验证：完整构建及0.1.1最终ZIP16个串行宿主专项通过；89个控件操作/持久化、4个管理操作、39项实际音频/歌词/网络效果通过；指定自备音源实际播放下载通过，23个私有源hash未出现在仓库/产品/ZIP。
- 最终单元：243项，242通过、0失败、1条件跳过。曾出现媒体测试代理半关闭夹具泄漏，确定性复现后仅修测试并完整重跑通过。生产ZIP哈希未改变。
