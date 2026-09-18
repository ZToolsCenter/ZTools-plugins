/**
 * api 层出口 —— 按作用/功能分模块封装，命名空间导出避免同名冲突。
 *
 * envApi     宿主环境与 UI 交互（平台 / 主题 / 通知 / 窗口高度 / 系统路径 / Shell / 插件进入）
 * dbApi      持久化底座（宿主文档库 collection 读写，dev 内存兜底）；
 *            三张表的落库由 store/plugins/ztoolsPersist 插件以快照方式自动完成，不再各表一套 CRUD
 * dirApi     目录 / 链接 / 进程能力（preload Node 桥接 + 宿主目录选择对话框）
 * migrateApi 迁移引擎能力（dry-run / 迁移 / 重建 / 修复 / 进度，preload Node 桥接 + dev 模拟）
 */
export * as envApi from './env';
export * as dbApi from './db';
export * as dirApi from './dir';
export * as migrateApi from './migrate';
