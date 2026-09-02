/**
 * ZToolsStorageProvider - ZTools 存储适配器
 *
 * 实现 StorageProvider 接口，封装 ZTools 的 db / dbStorage API。
 */

// [browser] 上述模块已通过 <script> 标签全局加载
class ZToolsStorageProvider extends StorageProvider {
  getNativeId() {
    return ztools.getNativeId();
  }

  getItem(key) {
    return ztools.dbStorage.getItem(key);
  }

  setItem(key, value) {
    ztools.dbStorage.setItem(key, value);
  }

  removeItem(key) {
    ztools.dbStorage.removeItem(key);
  }

  async getDoc(id) {
    return await ztools.db.promises.get(id);
  }

  async putDoc(doc) {
    const result = await ztools.db.promises.put(doc);
    return !!(result && result.ok !== false);
  }

  async removeDoc(id) {
    try {
      const doc = await ztools.db.promises.get(id);
      if (doc && doc._rev) {
        await ztools.db.promises.remove(doc._id, doc._rev);
      }
    } catch (e) {
      // 忽略
    }
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = ZToolsStorageProvider;
}
