/**
 * 表示重命名工作流中的一个文件或目录。
 * 包含原始名称和新名称以及文件元数据。
 */
export interface FileItem {
  /** 文件项的唯一标识符 */
  id: string;
  /** 原始文件名，未经过任何修改 */
  originalName: string;
  /** 应用重命名工作流后的新名称 */
  newName: string;
  /** 文件的完整路径，包含文件名 */
  path: string;
  /** 如果文件之前被重命名，则为之前的名称 */
  lastRenamedFromName?: string;
  /** 如果文件之前被重命名，则为之前的完整路径 */
  lastRenamedFromPath?: string;
  /** 文件大小，以字节为单位 */
  size: number;
  /** 最后修改时间戳，毫秒级（Unix时间戳） */
  lastModified: number;
  /** 此项目是否为目录而非文件 */
  isDirectory: boolean;
  /** 重命名操作的当前状态 */
  status: 'idle' | 'modified' | 'success' | 'error';
  /** 如果状态为'error'，则包含错误消息 */
  errorMessage?: string;
  /** 文件扩展名，包含点号（例如'.txt'） */
  extension: string;
}

/**
 * 表示单次工作流运行期间的共享运行态。
 * 用于在同一批处理中为插件提供稳定的共享上下文。
 */
export interface WorkflowRuntimeContext {
  /** 插件共享状态容器，键通常由插件ID和实例ID组成 */
  sharedState: Map<string, unknown>;
  /** 当前批处理固定时间戳（毫秒） */
  batchTimestamp: number;
}

/**
 * 提供当前正在处理的文件在重命名工作流中的上下文信息。
 * 供插件根据文件在批处理中的位置做出决策使用。
 */
export interface WorkflowContext {
  /** 批处理中当前文件的零索引 */
  index: number;
  /** 当前批处理中正在处理的文件总数 */
  total: number;
  /** 正在处理的完整FileItem */
  file: FileItem;
  /** 当前处理的插件实例ID */
  actionInstanceId: string;
  /** 单次工作流运行期间的共享运行态 */
  runtime: WorkflowRuntimeContext;
}

/**
 * 定义可在重命名工作流中注册和调用的插件操作。
 * 每个插件提供一个基于配置转换文件名的转换函数。
 */
export interface PluginActionDefinition {
  /** 插件的唯一标识符 */
  id: string;
  /** 在UI中显示的名称 */
  name: string;
  /** 插件功能的简要描述 */
  description: string;
  /** UI显示的可选图标标识符 */
  icon?: string;
  /** UI渲染的配置模式或组件名称 */
  configSchema?: any;
  /**
   * 处理当前文件名的转换函数。
   * @param currentName - 当前文件名（可能已被之前的插件修改）
   * @param config - 插件特定的配置对象
   * @param context - 包含文件元数据和位置的工作流上下文
   * @returns 转换后的文件名
   */
  apply: (currentName: string, config: any, context: WorkflowContext) => string;
}

/**
 * 表示工作流中的插件实例。
 * 包含插件ID、用户配置和启用状态。
 */
export interface ActionInstance {
  /** 此操作实例的唯一标识符 */
  instanceId: string;
  /** 正在使用的插件引用（匹配PluginActionDefinition.id） */
  pluginId: string;
  /** 此插件实例的用户提供的配置 */
  config: any;
  /** 此操作是否在工作流中处于活动状态 */
  enabled: boolean;
}

/**
 * 表示由有序操作组成的完整重命名工作流。
 * 操作按顺序应用于批处理中的每个文件。
 */
export interface RenamingWorkflow {
  /** 要应用于每个文件的有序操作实例列表 */
  actions: ActionInstance[];
}
