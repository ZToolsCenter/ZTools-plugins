# Changelog

## 0.1.0 - 2026-09-14

- 初次可用版本：应用扫描、手动分类、启动组动态 Feature、批量启动
- Windows 扫描支持 `.exe` / `.bat` / `.cmd` / `.lnk`；忽略卸载类快捷方式
- 中文显示名修复（Node 路径名 + UTF-8 批量解析 .lnk）
- 扫描性能：批量 PowerShell、`withFileTypes`、入库 bulk/并行
- 对齐官方 Vue 模板目录：`src-ztools/` + `base: './'`
- 更换插件 Logo
- 退出时 `outPlugin(true)`，仅在唤起时运行、不常驻后台
