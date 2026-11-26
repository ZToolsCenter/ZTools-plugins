/** 日志级别 */
export type LogLevel = 'info' | 'success' | 'warn' | 'error';

/** 操作动作：纯动词，跨资源统一，新增资源无需扩枚举 */
export const LogAction = {
  /** 新增 */
  Create: 'create',
  /** 修改 */
  Update: 'update',
  /** 删除 */
  Delete: 'delete',
  /** 启停开关 */
  Toggle: 'toggle',
  /** 执行迁移 */
  Migrate: 'migrate',
  /** 重建链接 */
  Relink: 'relink',
  /** 修复链接 */
  Repair: 'repair',
  /** 失败回滚 */
  Rollback: 'rollback',
} as const;
export type LogAction = (typeof LogAction)[keyof typeof LogAction];

/** 操作对象：资源域，与 store 一一对应 */
export const LogResource = {
  /** 迁移目录配置行 */
  Mapping: 'mapping',
  /** 分组 */
  Group: 'group',
  /** 全局设置 */
  Setting: 'setting',
  /** 系统级（启动、整表刷新、批量任务） */
  System: 'system',
} as const;
export type LogResource = (typeof LogResource)[keyof typeof LogResource];

/** 日志实体（VO） */
export interface LogVO {
  /** 主键，uuid v4 */
  id: string;
  /** 操作对象 */
  resource: LogResource;
  /** 操作对象主键，空串表示无关联对象（系统级日志） */
  resourceId: string;
  /** 冗余对象名，空串表示无；对象删除后日志仍可读 */
  resourceName: string;
  /** 操作动作 */
  action: LogAction;
  /** 级别 */
  level: LogLevel;
  /** 信息 */
  message: string;
  /** 发生时间 ISO：展示与落库用 */
  createdAt: string;
  /** 发生时间毫秒时间戳：排序与耗时计算用，与 createdAt 同源生成 */
  timestamp: number;
}

/** C：新增入参（id / createdAt / timestamp 由服务端或本地生成） */
export type LogCreateDTO = Pick<LogVO, 'resource' | 'action' | 'level' | 'message'> & Partial<Pick<LogVO, 'resourceId' | 'resourceName'>>;

/** R：查询入参 */
export interface LogQueryDTO {
  resource?: LogResource;
  resourceId?: string;
  action?: LogAction;
  level?: LogLevel;
  /** 返回条数上限 */
  limit?: number;
}
