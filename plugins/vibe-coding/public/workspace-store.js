const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

/**
 * 将工作区名称转换为稳定且安全的目录名。
 * @param {unknown} value 用户输入的工作区名称。
 * @returns {string} 可用于目录名的安全名称。
 * @throws {Error} 名称为空或不包含有效字符时抛出。
 */
function sanitizeWorkspaceName(value) {
  const name = String(value || '').trim().replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);
  if (!name) throw new Error('请输入有效的工作区名称');
  return name;
}

/**
 * 将任意工作区记录规范化为可持久化结构。
 * @param {Record<string, unknown>} value 原始工作区记录。
 * @returns {Record<string, unknown>} 规范化后的工作区记录；无效记录返回空对象。
 */
function normalizeWorkspace(value = {}) {
  const id = typeof value.id === 'string' ? value.id.trim() : '';
  const rawPath = typeof value.path === 'string' ? value.path.trim() : '';
  const workspacePath = rawPath ? path.resolve(rawPath) : '';
  if (!id || !workspacePath) return {};
  const name = String(value.name || path.basename(workspacePath) || '工作区').trim().slice(0, 80);
  return {
    id,
    name: name || '工作区',
    path: workspacePath,
    source: value.source === 'local' ? 'local' : 'managed',
    createdAt: Number(value.createdAt) || Date.now(),
    updatedAt: Number(value.updatedAt) || Date.now(),
  };
}

/**
 * 创建工作区记录服务，集中处理目录创建、路径注册和存储更新。
 * @param {{read: (key: string, fallback: unknown) => unknown, write: (key: string, value: unknown) => boolean, storageKey: string, rootDirectory: string}} options 存储和目录依赖。
 * @returns {{list: () => Array<Record<string, unknown>>, get: (id: unknown) => Record<string, unknown>|null, create: (name: unknown) => Record<string, unknown>, register: (directory: unknown) => Record<string, unknown>, remove: (id: unknown) => boolean}} 工作区服务接口。
 * @throws {Error} 工作区根目录为空或不是绝对路径时抛出。
 */
function createWorkspaceStore(options) {
  const configuredRoot = String(options.rootDirectory || '').trim();
  if (!configuredRoot || !path.isAbsolute(configuredRoot)) throw new Error('ZVC 工作区根目录不可用');
  const rootDirectory = path.resolve(configuredRoot);

  /**
   * 读取并去重所有工作区记录。
   * @returns {Array<Record<string, unknown>>} 按最近使用时间排序的工作区列表。
   */
  function list() {
    const stored = options.read(options.storageKey, []);
    const records = Array.isArray(stored) ? stored.map(normalizeWorkspace).filter((item) => item.id && item.path) : [];
    const seenPaths = new Set();
    return records
      .filter((item) => {
        if (seenPaths.has(item.path)) return false;
        seenPaths.add(item.path);
        return true;
      })
      .sort((left, right) => Number(right.updatedAt) - Number(left.updatedAt));
  }

  /**
   * 按标识读取一个工作区。
   * @param {unknown} id 工作区标识。
   * @returns {Record<string, unknown>|null} 匹配的工作区；不存在时返回空值。
   */
  function get(id) {
    const normalizedId = String(id || '').trim();
    return list().find((item) => item.id === normalizedId) || null;
  }

  /**
   * 将工作区列表写回宿主存储。
   * @param {Array<Record<string, unknown>>} records 待保存的工作区列表。
   * @returns {void} 无返回值。
   */
  function save(records) {
    // 只发布规范化记录，避免窗口重载后出现不可序列化的运行时字段。
    options.write(options.storageKey, records.map(normalizeWorkspace).filter((item) => item.id));
  }

  /**
   * 创建一个只包含空目录的托管工作区。
   * @param {unknown} name 用户可见工作区名称。
   * @returns {Record<string, unknown>} 新创建的工作区。
   * @throws {Error} 名称无效或目录创建失败时抛出。
   */
  function create(name) {
    const displayName = String(name || '').trim().slice(0, 80);
    const safeName = sanitizeWorkspaceName(displayName);
    fs.mkdirSync(rootDirectory, { recursive: true });
    let workspacePath = path.join(rootDirectory, safeName);
    let suffix = 2;
    // 只选择空闲路径，不触碰已有用户目录内容。
    while (fs.existsSync(workspacePath)) workspacePath = path.join(rootDirectory, `${safeName}-${suffix++}`);
    fs.mkdirSync(workspacePath, { recursive: true });
    const now = Date.now();
    const workspace = { id: randomUUID(), name: displayName || safeName, path: workspacePath, source: 'managed', createdAt: now, updatedAt: now };
    save([workspace, ...list()]);
    return workspace;
  }

  /**
   * 注册用户选择的本地目录，不修改目录内容。
   * @param {unknown} directory 用户选择的目录路径。
   * @returns {Record<string, unknown>} 已登记或已存在的工作区。
   * @throws {Error} 路径无效或不是目录时抛出。
   */
  function register(directory) {
    const resolved = path.resolve(String(directory || '').trim());
    if (!resolved || !fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) throw new Error('请选择有效的本地文件夹');
    const existing = list().find((item) => item.path === resolved);
    if (existing) return existing;
    const now = Date.now();
    const workspace = { id: randomUUID(), name: path.basename(resolved) || '本地工作区', path: resolved, source: 'local', createdAt: now, updatedAt: now };
    save([workspace, ...list()]);
    return workspace;
  }

  /**
   * 移除工作区登记但保留本地目录。
   * @param {unknown} id 工作区标识。
   * @returns {boolean} 是否移除了记录。
   */
  function remove(id) {
    const normalizedId = String(id || '').trim();
    const records = list();
    const next = records.filter((item) => item.id !== normalizedId);
    save(next);
    return next.length !== records.length;
  }

  return { list, get, create, register, remove };
}

module.exports = { normalizeWorkspace, sanitizeWorkspaceName, createWorkspaceStore };
