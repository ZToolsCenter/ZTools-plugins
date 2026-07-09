const api = window.ztools || window.utools

module.exports = {
  meta: {
    getPlatform: () => {
      if (window.utools) return 'utools'
      else if (window.ztools) return 'ZTools'
      else return 'webdav-client'
    },
    getNativeId: () => {
      return api.getNativeId()
    },
    getWindowType: () => {
      return api.getWindowType()
    },
    getPath: (name) => {
      return api.getPath(name)
    }
  },
  isWindows: () => {
    return api.isWindows()
  },
  isDev: () => {
    return api.isDev()
  },
  event: {
    onPluginEnter: (callback) => {
      api.onPluginEnter(callback)
    }
  },
  shell: {
    openExternal: (url) => {
      api.shellOpenExternal(url)
    },
    showItemInFolder: (folderName) => {
      api.shellShowItemInFolder(folderName)
    }
  },
  dialog: {
    open: (options) => {
      return api.showOpenDialog(options)
    },
    save: (options) => {
      return api.showSaveDialog(options)
    },
    notification: (body, featureName) => {
      api.showNotification(body, featureName)
    }
  },
  dbStorage: {
    setItem: (key, value) => {
      return api.dbStorage.setItem(key, value)
    },
    getItem: (key) => {
      return api.dbStorage.getItem(key)
    },
    removeItem: (key) => {
      api.dbStorage.removeItem(key)
    }
  },
  db: {
    /**
     * 创建/更新文档
     */
    put: (doc) => {
      return api.db.promises.put(doc)
    },
    get: (id) => {
      return api.db.promises.get(id)
    },
    remove: (doc) => {
      return api.db.promises.remove(doc)
    },
    bulkDocs: (docs) => {
      return api.db.promises.bulkDocs(docs)
    },
    allDocs: (key) => {
      return api.db.promises.allDocs(key)
    },
    postAttachment: (docId, attachment, type) => {
      return api.db.promises.postAttachment(docId, attachment, type)
    },
    getAttachment: (docId) => {
      return api.db.promises.getAttachment(docId)
    },
    getAttachmentType: (docId) => {
      return api.db.promises.getAttachmentType(docId)
    },
    replicateStateFromCloud: () => {
      return api.db.promises.replicateStateFromCloud()
    }
  },
  feature: {
    set: (feature) => {
      return api.setFeature(feature)
    },
    get: (codes) => {
      return api.getFeatures(codes)
    },
    remove: (code) => {
      return api.removeFeature(code)
    }
  }
}
