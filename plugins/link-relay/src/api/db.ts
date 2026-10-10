/**
 * 持久化底座 —— 封装宿主 ztools.db（每个插件独立文档库）。
 *
 * 文档 _id 约定：'{collection}:{业务主键}'，用 allDocs(prefix) 即按表取数，三张表天然隔离。
 * 全部方法异步：优先走 db.promises，避免同步 IO 阻塞 UI。
 * 无宿主（pnpm dev 跑在浏览器）时退化为内存 Map：纯内存、零磁盘 IO，不触碰任何真实目录。
 */

/** 宿主文档的元字段（业务侧不需要，取出后剥离） */
interface DocMeta {
  _id: string;
  _rev?: string;
}

/** 宿主文档：元字段 + 业务字段 */
type Doc = DocMeta & Record<string, unknown>;

/** dev 内存兜底库，key = 完整文档 id */
const memory = new Map<string, Record<string, unknown>>();

/** 取宿主文档库，无宿主返回 null */
function hostDb() {
  return typeof ztools !== 'undefined' && ztools.db ? ztools.db : null;
}

/** 拼文档 id */
export function docKey(collection: string, id: string): string {
  return `${collection}:${id}`;
}

/** 深拷贝，避免内存兜底库与 store state 共享引用 */
function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/** 剥离 _id/_rev，还原业务实体 */
function toEntity<T>(doc: Doc): T {
  const entity: Record<string, unknown> = { ...doc };
  delete entity._id;
  delete entity._rev;
  return entity as T;
}

/** R：列出集合内全部实体 */
export async function listCollection<T>(collection: string): Promise<T[]> {
  const db = hostDb();
  const prefix = `${collection}:`;
  if (!db) {
    return [...memory.entries()].filter(([key]) => key.startsWith(prefix)).map(([, doc]) => clone(doc) as T);
  }
  const docs = (await db.promises.allDocs(prefix)) as Doc[];
  return docs.map((doc) => toEntity<T>(doc));
}

/** R：按主键取单个实体 */
export async function getDoc<T>(collection: string, id: string): Promise<T | null> {
  const db = hostDb();
  const key = docKey(collection, id);
  if (!db) {
    const hit = memory.get(key);
    return hit ? (clone(hit) as T) : null;
  }
  const doc = (await db.promises.get(key)) as Doc | null;
  return doc ? toEntity<T>(doc) : null;
}

/** R：同步按主键取实体（store 水合用，换取首帧不出现空表） */
export function getDocSync<T>(collection: string, id: string): T | null {
  const db = hostDb();
  const key = docKey(collection, id);
  if (!db) {
    const hit = memory.get(key);
    return hit ? (clone(hit) as T) : null;
  }
  try {
    const doc = db.get<Record<string, unknown>>(key) as Doc | null;
    return doc ? toEntity<T>(doc) : null;
  } catch {
    // 宿主库异常时降级为空数据，不阻塞 store 创建
    return null;
  }
}

/** C/U：写入实体（已存在则带 _rev 更新） */
export async function putDoc<T>(collection: string, id: string, entity: T): Promise<void> {
  const db = hostDb();
  const key = docKey(collection, id);
  if (!db) {
    memory.set(key, clone(entity) as Record<string, unknown>);
    return;
  }
  const existing = (await db.promises.get(key)) as Doc | null;
  const payload = { ...(entity as Record<string, unknown>) };
  await db.promises.put(existing?._rev ? { _id: key, _rev: existing._rev, ...payload } : { _id: key, ...payload });
}

/** C/U：同步写入（退出兜底用：进程被杀时异步写入可能来不及落地） */
export function putDocSync<T>(collection: string, id: string, entity: T): void {
  const db = hostDb();
  const key = docKey(collection, id);
  if (!db) {
    memory.set(key, clone(entity) as Record<string, unknown>);
    return;
  }
  try {
    const existing = db.get(key) as Doc | null;
    const payload = { ...(entity as Record<string, unknown>) };
    db.put(existing?._rev ? { _id: key, _rev: existing._rev, ...payload } : { _id: key, ...payload });
  } catch {
    // 退出路径上不抛出，避免中断宿主流程
  }
}

/** D：删除单个实体 */
export async function removeDoc(collection: string, id: string): Promise<void> {
  const db = hostDb();
  const key = docKey(collection, id);
  if (!db) {
    memory.delete(key);
    return;
  }
  await db.promises.remove(key);
}

/** D：清空整个集合 */
export async function clearCollection(collection: string): Promise<void> {
  const db = hostDb();
  const prefix = `${collection}:`;
  if (!db) {
    for (const key of [...memory.keys()]) {
      if (key.startsWith(prefix)) memory.delete(key);
    }
    return;
  }
  const docs = (await db.promises.allDocs(prefix)) as Doc[];
  await Promise.all(docs.map((doc) => db.promises.remove(doc)));
}

/** 当前是否落在宿主文档库（false 表示 dev 内存态，重启即丢） */
export function isPersisted(): boolean {
  return hostDb() !== null;
}
