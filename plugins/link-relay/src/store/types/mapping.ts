/** 链接状态 */
export type LinkStatus =
  | 'linked' // 已链接且指向正确
  | 'notLinked' // 未迁移，源为实体目录
  | 'broken' // 链接断裂或指向错误
  | 'conflict' // 源与目标都有实体目录
  | 'targetOnly' // 源不存在、目标有数据
  | 'notInstalled' // 源目录本机不存在
  | 'unknown'; // 无法判定

/** 配置行实体（VO） */
export interface MappingVO {
  /** 主键，uuid v4 */
  id: string;
  /** 显示名 */
  name: string;
  /** 所属分组 id，空串表示未分组 */
  groupId: string;
  /** 源目录 */
  sourcePath: string;
  /** 目标目录 */
  targetPath: string;
  /** 关联进程检测名 */
  exeNames: string[];
  /** 缓存排除目录名 */
  cachePatterns: string[];
  /** 是否参与一键迁移 */
  enabled: boolean;
  /** 实时链接状态 */
  status: LinkStatus;
  /** 可释放空间（字节），linked 为 0 */
  sizeBytes: number;
  /** 上次成功迁移时间 ISO，空串表示从未迁移 */
  lastMigratedAt: string;
  /** 上次失败原因，空串表示无 */
  lastError: string;
  /** 创建时间 ISO */
  createdAt: string;
}

/** C：新增入参 */
export type MappingCreateDTO = Pick<MappingVO, 'name' | 'sourcePath' | 'targetPath'> &
  Partial<Pick<MappingVO, 'groupId' | 'exeNames' | 'cachePatterns'>>;

/**
 * U：更新入参。
 * - 用户可编辑列来自 CreateDTO 与 enabled；
 * - status/sizeBytes/lastMigratedAt/lastError 为扫描/迁移流程内部回写的系统列，
 *   仅允许业务 hook 更新，不在新增表单中出现。
 */
export type MappingUpdateDTO = Partial<MappingCreateDTO> &
  Partial<Pick<MappingVO, 'enabled' | 'status' | 'sizeBytes' | 'lastMigratedAt' | 'lastError'>>;

/** R：查询入参 */
export interface MappingQueryDTO {
  groupId?: string;
  status?: LinkStatus;
  enabled?: boolean;
  /** 名称模糊匹配 */
  keyword?: string;
}
