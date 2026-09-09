# Changelog

Native OCR 从官方 `wechat-ocr` 插件 fork 而来，作者署名 Samson。以下版本历史已按里程碑整合。

## 0.6.13 - 2026-09-09

- **修复 ONNX 表格识别列分割线不生效**：PP-OCR 识别阶段会把同一行的多个单元格合并成一个横跨整行的宽框（`afAfRec` 同行合并），导致下游列聚类退化为 1 列；改为逐单元格独立解码，保留 det 输出的原始单元格框，列分割恢复正常（验证：采购订单样例 10 行 × 7 列）
- 表格行/列聚类算法加固：链式合并改为相邻间隙比较，防止聚类中心漂移吞并相邻列/行
- ONNX 管线新增宽行切列兜底（`onnx_table_split.mjs`）：det 输出整行宽框时按暗像素投影自动切列后重识别

## 0.6.12 - 2026-09-09

- **运行时文件迁移至 ZTools 插件数据目录**（`ztools.getPath("pluginData")`），插件卸载时自动清理，不留残留
- Vision / WinRT 脚本副本与编译产物同步迁移至插件数据目录
- 首次运行自动迁移旧缓存目录（`~/Library/Application Support/ZTools/native-ocr`），避免重复下载

## 0.6.11 - 2026-09-09

- Windows 引擎排序调整：ONNX OCR（识别率最优）排第一
- 切换引擎时自动用新引擎重新识别当前图片

## 历史里程碑：v0.6.7 ~ v0.6.10

- **微信 OCR 收缩为 macOS 专属**，Windows 引擎定稿为：ONNX OCR + Windows OCR（系统 WinRT）
- Windows OCR（WinRT）稳定性修复：补齐 `System.Runtime.WindowsRuntime` 程序集加载；输出统一 UTF-8 消除中文乱码；脚本带版本标记
- Windows OCR 识别率优化：小图（最长边 < 1200px）解码阶段自动放大，提升小字识别率
- 防御性回退：放大路径失败时自动退回原始路径，保证识别始终可用

## 历史里程碑：v0.6.0 ~ v0.6.6

- **三大引擎双端架构落地，全程零 Python**：
  - ONNX OCR：PP-OCR v4 模型（约 60MB 一次性下载），Electron 自带 Node 子进程运行，双端通用，支持表格识别
  - 系统 OCR：macOS Vision（Swift）/ Windows OCR（WinRT PowerShell）
  - 微信 OCR：macOS 原生运行时（npmmirror 按需下载）
- 运行时下载框架：npmmirror 源 + sha1 校验 + 原子替换
- 修复 ONNX 引擎 "process is not defined"（改为 `ELECTRON_RUN_AS_NODE` 子进程常驻服务）

## 历史里程碑：v0.5.0 ~ v0.5.3

- Windows 平台初步支持（过渡方案：RapidOCR / wechat-ocr Python 链路）
- Windows 引擎不可用时的自动降级与引导

## 0.4.0 - 2026-09-09

- 双平台能力补齐：Windows 系统级 OCR 与历史管理适配

## 历史里程碑：v0.3.0 ~ v0.3.1

- 表格视图翻译修复
- Windows 引擎错误处理与引导优化

## 历史里程碑：v0.2.0 ~ v0.2.1

- **表格识别**：行列聚类模型、分隔线拖拽/增删、单元格编辑、低置信度标记、TSV/CSV 导出
- **OCR 后翻译**：文本/表格双视图翻译
- **识别历史**：本地持久化、回放、单条删除、一键清空

## 历史里程碑：v0.1.0 ~ v0.1.1

- 从官方 `wechat-ocr` 插件 fork，改名 `native-ocr`（Native OCR）
- 新增 macOS Vision 引擎（系统内置，零依赖）
- 平台支持 darwin + win32
