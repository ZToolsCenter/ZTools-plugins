# Changelog

## 1.0.0 - 2026-11-06

### Added

- 双分组待办清单：仅「待处理」与「已完成」，任务勾选后自动移入已完成，取消勾选自动移回待处理
- 底部输入框新建任务，支持编辑（Enter / i）、删除（dd / Delete）、搜索过滤与实时分组计数
- 设置面板（? 打开、Esc 关闭）：渲染 Markdown、显示创建时间、两段确认清空已完成任务
- Vim 风格快捷键：j/k、h/l、Space、Tab / Ctrl+N、/、dd、gg / G、?、Esc
- 数据与设置通过 ztools.dbStorage 持久化，重进插件后自动恢复；宿主不可用时开发预览回退 localStorage
- 独立设计的插件 Logo（源文件 logo.svg），界面适配宿主主题色、暗色模式与窄窗口
