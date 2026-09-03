/**
 * DEV 内存虚拟世界 —— 仅在「无宿主（pnpm dev 跑浏览器）」时使用。
 *
 * 约束（硬要求）：
 * - 纯内存、零磁盘 IO，绝不读取/修改真实 IDE（.vscode / AppData 等）目录；
 * - 界面与日志中出现的路径全部落在 RelocatorTest 虚拟根下；
 * - 仅用于开发态跑通「扫描 → 预览 → 迁移 → 状态翻转」闭环，生产构建中这些数据不会被触达。
 */
import type { MappingCreateDTO } from '../store/types/mapping';
import type { NativeDirStatus, NativeLinkStatus } from './dir';

/** 虚拟测试根：源在 C 盘、目标在 D 盘，与真实用户目录完全隔离 */
export const DEV_SOURCE_ROOT = 'C:\\RelocatorTest\\source';
export const DEV_TARGET_ROOT = 'D:\\RelocatorTest\\target';

/** 一条样例记录（同时驱动：首帧种子数据 + 虚拟状态检测） */
interface DevRecord {
  /** 所属样例分组名（空串表示未分组） */
  group: string;
  /** 行显示名 */
  name: string;
  /** 目录叶子名（拼出虚拟源/目标路径） */
  leaf: string;
  /** 初始链接状态（kebab，与 preload 同形） */
  status: NativeLinkStatus;
  /** 源体积（字节），linked 为 0 */
  size: number;
  /** 关联进程名（可空） */
  exeNames?: string[];
}

/** 固定样例：覆盖全部主要状态，便于开发态看到不同 UI 分支 */
const RECORDS: DevRecord[] = [
  { group: '开发工具 A', name: '扩展目录', leaf: 'tool-a/home', status: 'not-linked', size: 361_000_000, exeNames: ['Code.exe'] },
  { group: '开发工具 A', name: '配置目录', leaf: 'tool-a/roaming', status: 'conflict', size: 198_000_000, exeNames: ['Code.exe'] },
  { group: '开发工具 B', name: '扩展目录', leaf: 'tool-b/home', status: 'linked', size: 0 },
  { group: '开发工具 B', name: '配置目录', leaf: 'tool-b/roaming', status: 'target-only', size: 74_000_000 },
  { group: '', name: 'npm 缓存', leaf: 'npm-cache', status: 'not-linked', size: 200_000_000 },
  { group: '', name: 'Maven 仓库', leaf: 'm2', status: 'broken', size: 150_000_000 },
];

/** 迁移后被改写为 linked 的状态覆盖表，key = 源路径 */
const overrides = new Map<string, NativeLinkStatus>();

function sourceOf(leaf: string): string {
  return `${DEV_SOURCE_ROOT}\\${leaf.replace(/\//g, '\\')}`;
}
function targetOf(leaf: string): string {
  return `${DEV_TARGET_ROOT}\\${leaf.replace(/\//g, '\\')}`;
}

function findBySource(source: string): DevRecord | undefined {
  return RECORDS.find((r) => sourceOf(r.leaf) === source);
}

/** 虚拟状态检测：按源路径查样例表，叠加迁移后的 linked 覆盖 */
export function devDirStatus(source: string, target: string): NativeDirStatus {
  const record = findBySource(source);
  const status = overrides.get(source) ?? record?.status ?? 'not-linked';
  const size = status === 'linked' ? 0 : (record?.size ?? 12_000_000);
  return {
    path: source,
    target,
    status,
    size,
    ...(status === 'linked' ? { realTarget: target } : {}),
  };
}

/** dev 模拟迁移成功后把该源标记为已链接 */
export function devMarkLinked(source: string): void {
  overrides.set(source, 'linked');
}

/** 样例分组名（去重、保序，空串代表的未分组不建组） */
export function devSeedGroupNames(): string[] {
  return [...new Set(RECORDS.map((r) => r.group).filter(Boolean))];
}

/**
 * 样例映射行 DTO；groupNameToId 把样例分组名映射为建组后生成的 uuid，未分组传 ''。
 * 状态/体积不在 DTO 中，由首次 refresh 经 devDirStatus 检测后写回，模拟真实扫描。
 */
export function devSeedMappings(groupNameToId: (name: string) => string): MappingCreateDTO[] {
  return RECORDS.map((r) => ({
    name: r.name,
    groupId: r.group ? groupNameToId(r.group) : '',
    sourcePath: sourceOf(r.leaf),
    targetPath: targetOf(r.leaf),
    exeNames: r.exeNames ?? [],
    cachePatterns: [],
  }));
}
