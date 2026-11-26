/**
 * 目录 / 链接 / 进程能力 —— 需要 Node 侧（preload）支撑的能力集中在此。
 *
 * 宿主内：读取 preload 注入的 window.services，并把返回字段与状态值归一化到 store 模型
 * （preload 用 kebab-case 状态，store 用 camelCase，映射在本文件收敛）；
 * dev 无宿主：全部退化为内存虚拟实现（api/dev），零磁盘 IO，不触碰任何真实 IDE 目录。
 * 目录选择走宿主对话框，不依赖 preload。
 */
import type { LinkStatus } from '../store/types/mapping';
import { devDirStatus } from './dev';

/** preload 侧（kebab-case）链接状态，与 preload/core/status-enum.js 同构 */
export type NativeLinkStatus =
  | 'linked'
  | 'not-linked'
  | 'broken'
  | 'conflict'
  | 'target-only'
  | 'not-installed'
  | 'unknown';

/** preload checkDirStatus 的原始返回 */
export interface NativeDirStatus {
  path: string;
  target: string;
  status: NativeLinkStatus;
  size: number;
  realTarget?: string;
}

/** 目录链接状态检测结果（已归一化到 store 模型） */
export interface DirStatus {
  /** 链接状态 */
  status: LinkStatus;
  /** 源目录体积（字节），已链接为 0 */
  sizeBytes: number;
  /** 链接真实指向，非链接为空串 */
  realTarget: string;
}

/** preload 的 kebab-case 状态 → store 的 camelCase 状态 */
const STATUS_MAP: Record<NativeLinkStatus, LinkStatus> = {
  linked: 'linked',
  'not-linked': 'notLinked',
  broken: 'broken',
  conflict: 'conflict',
  'target-only': 'targetOnly',
  'not-installed': 'notInstalled',
  unknown: 'unknown',
};

/** dev 兜底的假可用空间（仅用于开发态不报错，不代表真实磁盘） */
const DEV_FREE_SPACE = 100_000_000_000;

/** 取 preload 注入的 Node 能力，无宿主返回 null */
function native() {
  return typeof window !== 'undefined' && window.services ? window.services : null;
}

/** 展开路径中的 %ENV% 与 ~（无宿主原样返回） */
export function expandPath(path: string): string {
  if (!path) return '';
  return native()?.expandEnv(path) ?? path;
}

/** 目标盘可用空间（字节） */
export function freeSpace(path: string): number {
  if (!path) return 0;
  return native()?.getDiskFreeSpace(path) ?? DEV_FREE_SPACE;
}

/** 检测「源 → 目标」的链接状态与体积 */
export function checkLink(source: string, target: string): DirStatus {
  const services = native();
  if (!services) {
    const virtual = devDirStatus(source, target);
    return {
      status: STATUS_MAP[virtual.status] ?? 'unknown',
      sizeBytes: virtual.size,
      realTarget: virtual.realTarget ?? '',
    };
  }
  const info = services.checkDirStatus(source, target);
  return {
    status: STATUS_MAP[info.status] ?? 'unknown',
    sizeBytes: info.size || 0,
    realTarget: info.realTarget ?? '',
  };
}

/** 关联进程是否运行中（迁移前置检查用，运行中应拒绝执行） */
export function isProcessRunning(exeNames: string[]): boolean {
  if (exeNames.length === 0) return false;
  return native()?.isProcessRunning(exeNames) ?? false;
}

/** 选择目录：宿主对话框，取消或无宿主返回空串 */
export function pickDirectory(title = '选择目录', defaultPath = ''): string {
  if (typeof ztools === 'undefined') return '';
  const picked = ztools.showOpenDialog({
    title,
    defaultPath,
    properties: ['openDirectory', 'createDirectory'],
  });
  return picked?.[0] ?? '';
}
