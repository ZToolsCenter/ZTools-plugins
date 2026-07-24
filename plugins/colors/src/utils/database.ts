import zToolsApi from "./ztoolsapi";

// ============================================================================
// 数据库版本迁移 + 备份回滚机制（单文档设计）
//
// 核心设计思路：
//   所有数据存在同一个 CouchDB 文档中，通过内部字段管理元信息：
//     {
//       _id: "colors",        // CouchDB 文档 ID
//       __version: 2,         // 当前数据库版本号
//       __backup: { ... },    // 迁移前的数据快照（仅迁移期间存在）
//       __locked: true,       // 迁移锁标记（仅迁移期间存在）
//       ...用户数据            // 实际业务数据
//     }
//
//   版本升级规则：
//     - targetVersion == fromVersion → 无需迁移，直接返回
//     - targetVersion > fromVersion  → 必须有对应补丁，否则报错
//     - targetVersion < fromVersion  → 软件降级，直接报错（不支持向下迁移）
//
//   迁移流程：
//     build() 被调用时，先检查文档的 __locked 字段：
//       - 存在 → 说明上次迁移中断（进程被杀/崩溃），从 __backup 回滚，然后重新迁移
//       - 不存在 → 正常流程，写 __locked → 快照到 __backup → 执行迁移 → 清理
//
//   失败保护：
//     迁移过程中任何一步抛出异常，catch 块会：
//       1. 从 __backup 恢复用户数据和版本号
//       2. 清除 __locked 和 __backup
//       3. 抛出带有原始错误信息的新异常
//
//   设计约束：
//     - 只有真正需要执行迁移时才加锁/备份，避免每次 build() 的额外开销
//     - __backup 只保存用户数据 + 版本号，不保存 _id/_rev/__locked/__backup
//     - 内部字段以 __ 开头，与用户数据隔离，getDoc() 会自动过滤掉
// ============================================================================

/** 内部字段前缀，用于和用户数据隔离 */
const INTERNAL_PREFIX = "__";

/** 版本号字段名 */
const FIELD_VERSION = `${INTERNAL_PREFIX}version`;

/** 备份字段名 */
const FIELD_BACKUP = `${INTERNAL_PREFIX}backup`;

/** 锁字段名 */
const FIELD_LOCKED = `${INTERNAL_PREFIX}locked`;

/** 所有内部字段名列表，用于从用户数据中过滤 */
const INTERNAL_FIELDS = [FIELD_VERSION, FIELD_BACKUP, FIELD_LOCKED] as const;

// ============================================================================
// 类型定义
// ============================================================================

/** 迁移上下文，传递给每个 patch handler */
export type DatabaseMigrationContext<T extends Record<string, any> = Record<string, any>> = {
  /** 数据库 API 实例，可以在 handler 中读写数据 */
  db: DatabaseApi<T>;
  /** 迁移前的版本号 */
  fromVersion: number;
  /** 迁移到的目标版本号 */
  toVersion: number;
};

/** 单个版本迁移补丁的定义 */
export type DatabasePatch<T extends Record<string, any> = Record<string, any>> = {
  /** 此补丁要迁移到的版本号 */
  version: number;
  /** 迁移处理函数，可以是同步或异步 */
  handler: (context: DatabaseMigrationContext<T>) => Promise<void> | void;
};

/** 数据库 API 接口，封装了对 zToolsApi.db 的操作 */
export type DatabaseApi<T extends Record<string, any> = Record<string, any>> = {
  /** 数据库标识符（也是 CouchDB _id） */
  readonly id: string;
  /** 数据文档在 CouchDB 中的 _id（与 id 相同） */
  readonly dataId: string;
  /** 原始 zToolsApi.db 引用，用于高级操作 */
  readonly raw: typeof zToolsApi.db;
  /** 获取当前数据库版本号 */
  getVersion(): number;
  /** 获取用户数据文档（自动过滤内部字段 __*） */
  getDoc(): DbDoc<T>;
  /** 保存用户数据文档（自动保留内部字段） */
  saveDoc(doc: DbDoc<T>): DbReturn;
  /** 读取文档 → 传给 handler 处理 → 保存结果，一步完成读改写 */
  updateDoc(handler: (doc: DbDoc<T>) => Promise<DbDoc<T>> | DbDoc<T>): Promise<DbReturn>;
};

/** 数据库构建器，使用链式 API 配置迁移规则 */
export type DatabaseBuilder<T extends Record<string, any> = Record<string, any>> = {
  /** 设置目标版本号 */
  setVersion(version: number): DatabaseBuilder<T>;
  /** 注册一个版本迁移补丁 */
  patch(
    version: number,
    handler: (context: DatabaseMigrationContext<T>) => Promise<void> | void,
  ): DatabaseBuilder<T>;
  /** 构建数据库 API（不执行迁移，只确保文档存在） */
  build(): DatabaseApi<T>;
  /** 检查数据库当前状态 */
  checkStatus(): DatabaseMigrationStatus;
  /** 获取版本信息（当前版本、目标版本） */
  getVersionInfo(): { currentVersion: number; targetVersion: number };
  /** 执行迁移（含锁检测、回滚、版本校验） */
  migrate(): Promise<void>;
};

/** 数据库迁移信息（版本对比） */
export type DatabaseMigrationInfo = {
  /** 数据库标识符 */
  id: string;
  /** 当前版本号 */
  currentVersion: number;
  /** 目标版本号 */
  targetVersion: number;
  /** 是否需要迁移 */
  needsMigration: boolean;
};

/** 数据库状态 */
export type DatabaseMigrationStatus =
  | { status: "ok" } // 版本一致，无需操作
  | { status: "needs_migration" } // 需要迁移
  | { status: "interrupted" } // 上次迁移被中断，需要先回滚
  | { status: "corrupted" } // 锁存在但备份丢失，数据可能损坏
  | { status: "new" }; // 全新数据库

// ============================================================================
// 工具函数
// ============================================================================

/** 深拷贝：通过 JSON 序列化/反序列化实现简单克隆 */
function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

/**
 * 从文档中过滤掉内部字段（__*），只保留用户数据
 * 例如：{ _id: "x", __version: 1, name: "hello" } → { name: "hello" }
 */
function stripInternalFields<T extends Record<string, any>>(doc: T): DbDoc<T> {
  const result = { ...doc } as any;
  for (const field of INTERNAL_FIELDS) {
    delete result[field];
  }
  return result;
}

// ============================================================================
// 底层文档操作
// 直接调用 zToolsApi.db，是所有上层操作的基础
// ============================================================================

/**
 * 创建默认文档
 * 当 CouchDB 中找不到数据文档时，用 initialData 构造一个带 _id 的新文档
 * 同时初始化 __version 为 0
 */
function createDefaultDocument<T extends Record<string, any>>(
  id: string,
  initialData: T,
  version = 0,
): DbDoc<T> & { [FIELD_VERSION]: number } {
  return { _id: id, [FIELD_VERSION]: version, ...clone(initialData) };
}

/** 从 CouchDB 读取文档，不存在返回 null */
function loadDocument<T extends Record<string, any>>(
  id: string,
): (DbDoc<T> & Record<string, any>) | null {
  return zToolsApi.db.get<T>(id);
}

/**
 * 将文档深拷贝后写入 CouchDB（put 操作）
 * 写入后校验返回值，静默失败时抛出异常防止数据损坏
 */
function saveDocument<T extends Record<string, any>>(doc: DbDoc<T>): DbReturn {
  const result = zToolsApi.db.put(clone(doc));
  // 校验写入结果，防止静默失败
  if (!result || result.error || ("ok" in result && !result.ok)) {
    throw new Error(`数据库写入失败: ${JSON.stringify(result)}`);
  }
  return result;
}

/**
 * 从 CouchDB 删除文档
 * 需要先读取文档获取 _rev，才能执行 remove 操作（CouchDB 要求）
 * 如果文档不存在则静默返回成功
 */
function removeDocument(id: string): DbReturn {
  const existing = zToolsApi.db.get(id);
  if (!existing) {
    return { ok: true } as DbReturn;
  }
  return zToolsApi.db.remove(existing);
}

// ============================================================================
// DatabaseApi 实例工厂
// 创建封装了数据读写和版本管理的 API 对象
//
// 所有操作都基于同一个 CouchDB 文档：
//   - 版本号：doc.__version
//   - 备份快照：doc.__backup（仅迁移期间存在）
//   - 迁移锁：doc.__locked（仅迁移期间存在）
//   - 用户数据：doc 的其余字段
// ============================================================================

/**
 * 创建数据库 API 实例
 * @param dataId     文档的 CouchDB _id
 * @param initialData 首次使用时的初始数据
 */
function createDatabaseApi<T extends Record<string, any>>(
  dataId: string,
  initialData: T,
): DatabaseApi<T> {
  const api: DatabaseApi<T> = {
    id: dataId,
    dataId,
    raw: zToolsApi.db,

    /**
     * 获取当前版本号
     * 从文档的 __version 字段读取，不存在返回 0（表示未初始化）
     */
    getVersion() {
      const doc = loadDocument(dataId);
      return (doc?.[FIELD_VERSION] as number) ?? 0;
    },

    /**
     * 获取用户数据文档（自动过滤内部字段 __*）
     * 如果 CouchDB 中有就返回已有的（去掉 __version/__backup/__locked），
     * 否则用 initialData 创建默认文档
     * 注意：这里不会自动保存默认文档到 CouchDB，只是在内存中构造
     */
    getDoc() {
      const existing = loadDocument<T>(dataId);
      if (existing) {
        return stripInternalFields(existing);
      }
      return createDefaultDocument(dataId, initialData);
    },

    /**
     * 保存用户数据文档
     * 读取当前文档，保留内部字段（__version/__backup/__locked），
     * 用传入的用户数据覆盖其余字段，然后写回 CouchDB
     */
    saveDoc(doc: DbDoc<T>) {
      const existing = loadDocument(dataId);
      // 合并：用 existing 的 _rev（保证并发安全）+ 传入的用户数据
      // 注意：必须用 existing._rev 而不是 doc._rev，因为 doc 可能是过期的
      // 同时强制保留 existing 的 __version，防止 handler 意外覆盖版本号
      const merged = {
        ...existing,
        ...clone(doc),
        _id: dataId,
        _rev: existing?._rev,
        [FIELD_VERSION]: existing?.[FIELD_VERSION] ?? 0,
      } as DbDoc<T>;
      return saveDocument(merged);
    },

    /**
     * 读改写一步完成
     * 流程：读取当前文档 → 过滤内部字段 → 深拷贝后传给 handler → 保存 handler 返回的新文档
     * handler 中拿到的是干净的用户数据副本，修改后直接返回即可
     */
    async updateDoc(handler) {
      const doc = api.getDoc();
      const nextDoc = await handler(clone(doc));
      return api.saveDoc(nextDoc);
    },
  };

  return api;
}

// ============================================================================
// 内部字段操作（锁 + 备份 + 版本）
//
// 由于所有状态都在同一个文档中，锁/备份/版本的操作都是读取整个文档后
// 修改对应字段再写回。这比多文档方案更简单，CouchDB 的 _rev 机制保证了
// 并发安全——如果两个进程同时修改同一个文档，第二个会收到 409 冲突。
// ============================================================================

/** 获取文档当前的内部字段快照 */
function getInternals(dataId: string) {
  const doc = loadDocument(dataId);
  return {
    version: (doc?.[FIELD_VERSION] as number) ?? 0,
    locked: (doc?.[FIELD_LOCKED] as boolean) ?? false,
    backup: doc?.[FIELD_BACKUP] ?? null,
  };
}

/** 设置迁移锁标记 */
function acquireLock(dataId: string): void {
  const doc = loadDocument(dataId);
  if (doc) {
    saveDocument({ ...doc, [FIELD_LOCKED]: true });
  }
}

/** 清除迁移锁标记 */
function releaseLock(dataId: string): void {
  const doc = loadDocument(dataId);
  if (doc) {
    // 使用 delete 语义：写入 undefined 等同于删除该字段
    const cleaned = { ...doc };
    delete cleaned[FIELD_LOCKED];
    saveDocument(cleaned);
  }
}

/**
 * 创建备份快照
 * 将当前用户数据 + 版本号保存到 __backup 字段中
 * __backup 只包含用户数据和版本号，不包含 _id/_rev/__locked/__backup
 */
function createBackup(dataId: string): void {
  const doc = loadDocument(dataId);
  if (!doc) return;

  // 备份内容 = 用户数据 + 版本号（干净的数据，不含内部管理字段）
  // 必须删除 _id 和 _rev，防止恢复时覆盖当前的 _rev 导致 409 冲突
  const userData = stripInternalFields(doc);
  // @ts-ignore
  delete userData._id;
  delete userData._rev;

  const snapshot = {
    ...userData,
    [FIELD_VERSION]: doc[FIELD_VERSION],
  };

  saveDocument({ ...doc, [FIELD_BACKUP]: snapshot });
}

/**
 * 从 __backup 恢复数据
 * @returns true 表示恢复成功，false 表示没有找到备份
 *
 * 恢复逻辑：
 *   1. 读取当前文档的 __backup 内容
 *   2. 用 __backup 的数据覆盖当前文档的用户数据和版本号
 *   3. 保留当前文档的 _id 和 _rev（CouchDB 要求更新时必须带 _rev）
 *   4. 清除 __backup 和 __locked 字段
 */
function restoreFromBackup(dataId: string): boolean {
  const doc = loadDocument(dataId);
  if (!doc || !doc[FIELD_BACKUP]) {
    return false;
  }

  const snapshot = doc[FIELD_BACKUP] as Record<string, any>;

  // 构造恢复后的文档：
  // - _id、_rev 保持不变（CouchDB 并发控制需要）
  // - 用户数据 + 版本号从快照恢复
  // - 清除 __backup 和 __locked
  const restored: DbDoc = {
    _id: doc._id,
    _rev: doc._rev, // 必须带 _rev，否则 CouchDB 返回 409
    ...snapshot,
  };

  saveDocument(restored);
  return true;
}

/**
 * 清除备份和锁字段
 * 迁移成功或回滚完成后调用，释放文档中的冗余数据
 * 只删除实际存在的字段，避免无意义的写入
 */
function cleanupInternals(dataId: string): void {
  const doc = loadDocument(dataId);
  if (!doc) return;

  // 检查是否有需要清理的字段，没有就跳过写入
  const hasBackup = FIELD_BACKUP in doc;
  const hasLocked = FIELD_LOCKED in doc;
  if (!hasBackup && !hasLocked) return;

  const cleaned = { ...doc };
  if (hasBackup) delete cleaned[FIELD_BACKUP];
  if (hasLocked) delete cleaned[FIELD_LOCKED];
  saveDocument(cleaned);
}

/**
 * 设置数据库版本号（内部函数，不暴露给外部）
 * 更新文档的 __version 字段，保持其他字段不变
 * 文档必须已存在（由 build() 保证），不存在时抛出异常
 */
function setDatabaseVersion(dataId: string, version: number): void {
  const existing = loadDocument(dataId);
  if (!existing) {
    throw new Error(
      `[database:${dataId}] 无法设置版本号：文档不存在。` +
        `这通常表示 build() 流程异常，请检查初始化逻辑。`,
    );
  }
  saveDocument({ ...existing, [FIELD_VERSION]: version });
}

// ============================================================================
// 对外暴露的入口：createDatabase
//
// 使用方式（链式调用）：
//   const db = await createDatabase({
//     id: "colors",
//     initialData: { items: [] },
//     version: 2,
//   })
//     .patch(1, ({ db }) => { /* 迁移 v0→v1 的逻辑 */ })
//     .patch(2, ({ db }) => { /* 迁移 v1→v2 的逻辑 */ })
//     .build();
//
// build() 的完整流程：
//   1. 创建 DatabaseApi 实例
//   2. 如果是全新的数据库（没有文档），写入初始数据（含 __version: 0）
//   3. 检查文档的 __locked 字段：
//      a. 存在 → 上次迁移中断 → 从 __backup 回滚 → 清理 → 重新迁移
//      b. 不存在 → 正常进入迁移流程
//   4. 调用 runMigrations 执行所有待处理的迁移补丁
// ============================================================================

export function createDatabase<T extends Record<string, any> = Record<string, any>>(options: {
  /** 数据库标识符，也是 CouchDB 文档的 _id */
  id: string;
  /** 首次使用时的初始数据 */
  initialData: T;
  /** 目标版本号，默认为 0（不执行任何迁移） */
  version?: number;
  /** 自定义文档 key（默认使用 id） */
  dataId?: string;
  /** @deprecated 保留用于兼容，现在与 dataId 相同 */
  versionId?: string;
}): DatabaseBuilder<T> {
  const dataId = options.dataId ?? options.id;
  let targetVersion = options.version ?? 0;

  /** 存储所有注册的迁移补丁，key 是版本号，value 是处理函数 */
  const patches = new Map<number, DatabasePatch<T>["handler"]>();

  const builder: DatabaseBuilder<T> = {
    /**
     * 设置目标版本号
     * 必须是 >= 0 的整数，小数会被向下取整
     */
    setVersion(version: number) {
      targetVersion = Math.max(0, Math.floor(version));
      return builder;
    },

    /**
     * 注册一个迁移补丁
     * version 不能重复，必须是 >= 0 的整数
     * handler 会在 build() 时按版本号升序依次执行
     */
    patch(version: number, handler) {
      const normalized = Math.max(0, Math.floor(version));
      if (patches.has(normalized)) {
        throw new Error(`Patch for version ${normalized} already exists.`);
      }
      patches.set(normalized, handler);
      return builder;
    },

    /**
     * 构建数据库 API
     * 验证数据库状态正常后返回：
     *   - 文档不存在 → 创建初始文档（版本 0）
     *   - 有迁移锁 → 报错（需要先 migrate() 回滚）
     *   - 版本号不匹配 → 报错（需要先 migrate() 升级）
     *   - 全部正常 → 返回可用的数据库 API
     */
    build() {
      const database = createDatabaseApi(dataId, options.initialData);

      // 全新数据库：直接写入初始数据文档，版本为目标版本，无需迁移
      const existingDoc = loadDocument<T>(dataId);
      if (!existingDoc) {
        saveDocument(createDefaultDocument(dataId, options.initialData, targetVersion));
        return database;
      }

      // 检查状态
      const status = this.checkStatus();

      if (status.status === "interrupted") {
        throw new Error(`[database:${dataId}] 上次迁移被中断，请先调用 migrate() 回滚后重试。`);
      }

      if (status.status === "corrupted") {
        throw new Error(
          `[database:${dataId}] 数据库状态损坏：迁移锁存在但备份丢失，需要手动恢复。`,
        );
      }

      if (status.status === "needs_migration") {
        const currentVersion = database.getVersion();
        throw new Error(
          `[database:${dataId}] 版本不匹配（当前 v${currentVersion}，目标 v${targetVersion}），请先调用 migrate()。`,
        );
      }

      return database;
    },

    /**
     * 检查数据库当前状态
     * 只读取文档，不做任何修改
     */
    checkStatus(): DatabaseMigrationStatus {
      const doc = loadDocument(dataId);

      // 文档不存在 → 全新数据库
      if (!doc) {
        return { status: "new" };
      }

      const internals = getInternals(dataId);

      // 有锁标记 → 上次迁移被中断
      if (internals.locked) {
        // 有备份可以回滚
        if (internals.backup) {
          return { status: "interrupted" };
        }
        // 锁存在但没有备份 → 数据损坏
        return { status: "corrupted" };
      }

      // 检查版本号
      const currentVersion = (doc[FIELD_VERSION] as number) ?? 0;
      if (currentVersion === targetVersion) {
        return { status: "ok" };
      }

      return { status: "needs_migration" };
    },

    /**
     * 获取版本信息
     */
    getVersionInfo() {
      const doc = loadDocument(dataId);
      const currentVersion = (doc?.[FIELD_VERSION] as number) ?? 0;
      return { currentVersion, targetVersion };
    },

    /**
     * 执行数据库迁移
     * 先检查状态，根据状态决定行为：
     *   - interrupted → 先回滚，再迁移
     *   - corrupted → 抛错，需要人工处理
     *   - new → 创建初始文档
     *   - needs_migration → 直接迁移
     *   - ok → 无操作
     */
    async migrate() {
      const database = createDatabaseApi(dataId, options.initialData);
      const status = this.checkStatus();

      switch (status.status) {
        case "ok":
          // 无需操作
          return;

        case "new":
          // 全新数据库：initialData 就是当前版本的数据结构，直接写入目标版本，无需迁移
          saveDocument(createDefaultDocument(dataId, options.initialData, targetVersion));
          return;

        case "needs_migration":
          // 直接迁移
          break;

        case "corrupted":
          throw new Error(
            `[database:${dataId}] 数据库状态损坏：迁移锁存在但备份丢失，需要手动恢复数据。`,
          );

        case "interrupted":
          // 先回滚到备份状态
          console.warn(`[database:${dataId}] 检测到上次迁移未完成，正在回滚...`);
          const rollbackSuccess = restoreFromBackup(dataId);
          if (!rollbackSuccess) {
            throw new Error(`[database:${dataId}] 回滚失败：备份不存在，数据可能已损坏。`);
          }
          console.warn(`[database:${dataId}] 回滚完成，继续执行迁移...`);
          // 回滚后重新读取版本号
          break;
      }

      // 执行迁移
      const currentVersion = database.getVersion();
      await runMigrations(database, dataId, currentVersion, targetVersion, patches);
    },
  };

  return builder;
}

// ============================================================================
// 迁移执行器
//
// 负责按版本号升序执行所有待处理的迁移补丁。
// 包含完整的 锁 + 备份 + 错误处理 + 回滚 逻辑。
//
// 所有状态（__locked、__backup、__version）都存储在同一个文档中，
// 通过读取→修改→写回的方式操作。CouchDB 的 _rev 机制保证并发安全。
//
// 设计要点：
//   - 只有在确实需要执行迁移时才加锁/备份（避免无迁移时的性能损耗）
//   - 每个补丁执行后立即更新版本号（保持中间状态一致性）
//   - 异常被捕获后自动回滚，不会留下半成品数据
// ============================================================================

/**
 * 执行数据库迁移
 * @param database     数据库 API 实例
 * @param dataId       文档的 CouchDB _id
 * @param fromVersion  当前版本号（迁移起点）
 * @param targetVersion 目标版本号（迁移终点）
 * @param patches      所有注册的迁移补丁
 */
async function runMigrations<T extends Record<string, any>>(
  database: DatabaseApi<T>,
  dataId: string,
  fromVersion: number,
  targetVersion: number,
  patches: Map<number, DatabasePatch<T>["handler"]>,
): Promise<DatabaseApi<T>> {
  let appliedVersion = fromVersion;

  // ── 版本号没变，无需迁移 ──
  if (targetVersion === fromVersion) {
    return database;
  }

  // ── 版本号降低了，软件降级，直接报错 ──
  // 目前不支持向下迁移，降级必然导致数据结构不兼容
  if (targetVersion < fromVersion) {
    throw new Error(
      `[database:${dataId}] 当前数据库版本 ${fromVersion} 高于目标版本 ${targetVersion}，` +
        `疑似软件降级。向下迁移暂不支持，请勿降级软件版本。`,
    );
  }

  // ── 校验补丁完整性 ──
  ensurePatchesComplete(dataId, fromVersion, targetVersion, patches);

  // ── 加锁：标记迁移开始 ──
  // 在文档中写入 __locked: true
  // 如果此时应用崩溃，下次启动会检测到 __locked 并触发回滚
  acquireLock(dataId);

  try {
    // ── 备份：保存迁移前的状态 ──
    // 将当前用户数据 + 版本号快照到 __backup 字段
    // 这是回滚的数据来源
    createBackup(dataId);

    // ── 按版本号升序执行迁移补丁 ──
    for (let v = fromVersion + 1; v <= targetVersion; v++) {
      const handler = patches.get(v);
      if (!handler) {
        // 理论上不会到这里（上面已经校验过了），双重保险
        throw new Error(`[database:${dataId}] 缺少版本 ${v} 的迁移补丁。`);
      }

      // 执行迁移处理函数
      // handler 中可以使用 db API 读写数据，完成数据结构的变更
      await handler({ db: database, fromVersion: appliedVersion, toVersion: v });

      // 每个补丁执行成功后立即更新版本号
      // 这样即使后续补丁失败，已完成的迁移也不会被重复执行
      setDatabaseVersion(dataId, v);
      appliedVersion = v;
    }

    // ── 迁移成功 ──
    // 清除 __locked 和 __backup，释放文档中的冗余数据
    cleanupInternals(dataId);

    return database;
  } catch (error) {
    // ── 迁移失败 ──
    // 任何补丁抛出异常都会进入这里
    // 需要：从 __backup 回滚 → 清理 __locked/__backup → 抛出带有上下文的错误

    console.error(`[database:${dataId}] 迁移失败，正在回滚...`, error);

    // 从 __backup 恢复用户数据和版本号
    // 如果恢复本身也失败，需要保留原始错误信息
    let restored = false;
    try {
      restored = restoreFromBackup(dataId);
    } catch (restoreError) {
      console.error(`[database:${dataId}] 回滚过程也出错了`, restoreError);
      throw new Error(
        `[database:${dataId}] 迁移失败且回滚失败。` +
          `原始错误: ${error instanceof Error ? error.message : String(error)}` +
          ` | 回滚错误: ${restoreError instanceof Error ? restoreError.message : String(restoreError)}`,
      );
    }

    // 恢复失败（极端情况：__backup 也丢失了）
    // 不清理，保留现场供排查
    if (!restored) {
      throw new Error(
        `[database:${dataId}] 迁移失败且回滚失败（备份不存在）。` +
          `原始错误: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    // 恢复成功，清理 __backup 和 __locked
    cleanupInternals(dataId);

    // 抛出错误让调用方知道迁移没有完成
    // 数据已经被回滚到迁移前的状态，可以安全重试
    throw new Error(
      `[database:${dataId}] 迁移失败，已回滚到迁移前的状态。` +
        `原始错误: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/**
 * 校验补丁完整性
 * 检查从 fromVersion 到 targetVersion 之间的每个版本是否都注册了补丁
 * 缺少任何一个都直接报错，防止静默升版本号但数据没迁移的情况
 */
function ensurePatchesComplete<T extends Record<string, any>>(
  dataId: string,
  fromVersion: number,
  targetVersion: number,
  patches: Map<number, DatabasePatch<T>["handler"]>,
): void {
  const missingVersions: number[] = [];
  for (let v = fromVersion + 1; v <= targetVersion; v++) {
    if (!patches.has(v)) {
      missingVersions.push(v);
    }
  }
  if (missingVersions.length > 0) {
    throw new Error(
      `[database:${dataId}] 数据库版本从 ${fromVersion} 升级到 ${targetVersion}，` +
        `但缺少以下版本的迁移补丁: ${missingVersions.join(", ")}。` +
        `每个版本升级都必须注册对应的 patch()。`,
    );
  }
}
