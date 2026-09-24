# Changelog


## 1.0.2 - 2026-04-28

- cpexcel.js 从 vendor/dist/ 移到 vendor/ 根目录
- 消除 vendor/ 目录，xlsx/cpexcel 移入 lib/ 统一管理
- compressSQL 空白字符正则优化 + vite.config 去空 catch

## 1.0.1 - 2026-04-27

- build 后自动清理 dist/preload/node_modules
- 新增 SQL 格式化与压缩功能
- 批量修复 code review 发现的 9 项 SQL 解析健壮性问题
- 修复 build 报错，将 cpexcel.js 纳入 git 跟踪
- CSV 换行字段解析、块注释跨行、xlsx 阈值、schema 表名

## 1.0.0 - 2026-04-23

- 修复 SQL 解析转义、schema 表名、流式 OOM 等问题，更新图标
- 新增 CSV ↔ SQL 互转功能
- 完善进度反馈并开启 TypeScript strict
- 替换 setImmediate 为 setTimeout 并修复注释乱码
- 导出流式化、文件管理器定位、移除侧边 S 图标
- 修复多行 SQL 解析、正则缓存、临时文件清理等多项 BUG

## 0.1.0 - 2026-04-23

- 初次发布，将插件提交至 ZTools 插件仓库。
- 修复 6 类大文件处理与 SQL 解析 BUG
