/**
 * 分组表 —— 实体与 CRUD 入参（1:1 对应 groupStore.ts）。
 * 分组可为空：不预置固定组，组 id 由 uuid v4 生成。
 */

/** 分组实体（VO） */
export interface GroupVO {
  /** 主键，uuid v4 */
  id: string;
  /** 组显示名 */
  name: string;
  /** 整组开关，停用只灰显不删数据 */
  enabled: boolean;
  /** 创建时间 ISO */
  createdAt: string;
}

/** C：新增入参（id / createdAt 由服务端或本地生成） */
export type GroupCreateDTO = Pick<GroupVO, 'name'>;

/** U：更新入参（改名 / 整组启停） */
export type GroupUpdateDTO = Partial<Pick<GroupVO, 'name' | 'enabled'>>;

/** R：查询入参 */
export interface GroupQueryDTO {
  /** 名称模糊匹配 */
  name?: string;
  enabled?: boolean;
}
