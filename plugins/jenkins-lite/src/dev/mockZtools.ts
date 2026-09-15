/**
 * ZTools API Mock for development mode
 * This provides a browser-compatible implementation of the ZTools APIs
 */

// In-memory storage for instances and favorites
const storage: Record<string, any[]> = {
  instance_: [],
  fav_: []
}

const dbStorage: Record<string, any> = {}

function generateId(prefix: string): string {
  return `${prefix}${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
}

// Mock ZTools API
export const ztoolsMock = {
  isDev: () => true,
  isDarkColors: () => true,
  getWindowType: () => 'main',
  getAppVersion: () => '1.0.0-dev',
  getAppName: () => 'ztools-jenkins',

  db: {
    put: (doc: any) => {
      if (!doc._id) {
        doc._id = generateId(storage[doc.type] ? doc.type.replace('jenkins-', 'instance_').replace('favorite', 'fav_') : 'doc_')
      }
      const key = doc._id.startsWith('instance_') ? 'instance_' :
                  doc._id.startsWith('fav_') ? 'fav_' : 'doc_'
      const existing = storage[key].findIndex(d => d._id === doc._id)
      if (existing >= 0) {
        storage[key][existing] = { ...doc }
      } else {
        storage[key].push({ ...doc })
      }
      return { ok: true, id: doc._id }
    },
    get: (id: string) => {
      const key = id.startsWith('instance_') ? 'instance_' :
                  id.startsWith('fav_') ? 'fav_' : 'doc_'
      return storage[key].find(d => d._id === id) || null
    },
    remove: (docOrId: string | any) => {
      const id = typeof docOrId === 'string' ? docOrId : docOrId._id
      const key = id.startsWith('instance_') ? 'instance_' :
                  id.startsWith('fav_') ? 'fav_' : 'doc_'
      storage[key] = storage[key].filter(d => d._id !== id)
      return { ok: true, id }
    },
    allDocs: (key?: string) => {
      if (key) {
        return storage[key] || []
      }
      return [...storage.instance_, ...storage.fav_]
    },
    promises: {
      put: async (doc: any) => ztoolsMock.db.put(doc),
      get: async (id: string) => ztoolsMock.db.get(id),
      remove: async (docOrId: string | any) => ztoolsMock.db.remove(docOrId),
      allDocs: async (key?: string) => ztoolsMock.db.allDocs(key)
    }
  },

  dbStorage: {
    setItem: (key: string, value: any) => {
      dbStorage[key] = value
    },
    getItem: (key: string) => {
      return dbStorage[key]
    },
    removeItem: (key: string) => {
      delete dbStorage[key]
    }
  },

  onPluginEnter: (callback: (action: any) => void) => {
    console.log('[Mock] Plugin enter handler registered')
    // In dev, trigger immediately with default action
    setTimeout(() => {
      callback({ code: 'jenkins', type: 'default', payload: null })
    }, 100)
  },

  onPluginOut: (callback: (exit: boolean) => void) => {
    console.log('[Mock] Plugin out handler registered')
  },

  onMainPush: (callback: (action: any) => any, selectCallback: (action: any, result: any) => void) => {
    console.log('[Mock] Main push handler registered')
  },

  hideMainWindow: () => true,
  showMainWindow: () => true,
  setExpendHeight: () => true,
  resizeWindow: () => true,
  outPlugin: () => true,

  setSubInput: () => true,
  removeSubInput: () => true,
  setSubInputValue: () => true,
  subInputFocus: () => true,
  subInputSelect: () => true,
  subInputBlur: () => true,

  copyText: (text: string) => {
    navigator.clipboard.writeText(text)
    return true
  },

  showNotification: (body: string, title?: string) => {
    if ('Notification' in window && Notification.permission === 'granted') {
      new Notification(title || 'ZTools', { body })
    }
  },

  shellOpenExternal: (url: string) => {
    window.open(url, '_blank')
  },

  setFeature: () => true,
  removeFeature: () => true,
  getFeatures: () => [],

  // ZBrowser mock (minimal)
  zbrowser: {
    goto: () => ztoolsMock.zbrowser,
    run: () => Promise.resolve([])
  }
}

// Mock Jenkins service (real fetch with CORS proxy warning)
const JENKINS_MOCK_JOBS = [
  { name: 'example-job-1', url: '#', color: 'blue', lastBuild: { number: 1, url: '#', result: 'SUCCESS', timestamp: Date.now() } },
  { name: 'example-job-2', url: '#', color: 'red', lastBuild: { number: 2, url: '#', result: 'FAILURE', timestamp: Date.now() } },
  { name: 'example-job-3', url: '#', color: 'animeblue', lastBuild: { number: 3, url: '#', result: null, timestamp: Date.now() } },
]

function delay(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

export const servicesMock = {
  jenkins: {
    getJobs: async (url: string, username: string, apiToken: string) => {
      console.warn('[Mock Jenkins] Using mock data. Real Jenkins API requires ZTools environment.')
      await delay(500)
      return { data: JENKINS_MOCK_JOBS, error: null }
    },
    getBuilds: async (url: string, username: string, apiToken: string, jobName: string) => {
      await delay(300)
      return {
        data: [
          { id: '1', number: 1, url: '#', result: 'SUCCESS', building: false, duration: 60000, timestamp: Date.now() - 86400000, displayName: `#1`, fullDisplayName: `${jobName} #1` },
          { id: '2', number: 2, url: '#', result: 'FAILURE', building: false, duration: 45000, timestamp: Date.now() - 43200000, displayName: `#2`, fullDisplayName: `${jobName} #2` },
          { id: '3', number: 3, url: '#', result: null, building: true, duration: 0, timestamp: Date.now(), displayName: `#3`, fullDisplayName: `${jobName} #3` },
        ],
        error: null
      }
    },
    triggerBuild: async (url: string, username: string, apiToken: string, jobName: string) => {
      console.warn('[Mock Jenkins] Build triggered (mock)')
      await delay(1000)
      return { error: null }
    },
    getViews: async (url: string, username: string, apiToken: string) => {
      await delay(300)
      return { data: [{ name: 'All', url: '#', color: 'blue', description: 'All jobs' }], error: null }
    },
    getViewJobs: async (url: string, username: string, apiToken: string, viewName: string) => {
      return servicesMock.jenkins.getJobs(url, username, apiToken)
    },
    testConnection: async (url: string, username: string, apiToken: string) => {
      await delay(800)
      return { success: true, error: null }
    },
    getBuildConsole: async (url: string, username: string, apiToken: string, jobName: string, buildNumber: number) => {
      await delay(300)
      const sample = [
        `Started by user admin`,
        `Running on Jenkins agent in workspace /var/jenkins_home/workspace/${jobName}`,
        `[Pipeline] Start of Pipeline`,
        `[Pipeline] node`,
        `[Pipeline] { (Checkout)`,
        `[Pipeline] echo 'Checking out source code'`,
        `[Pipeline] sh 'git fetch origin'`,
        `[Pipeline] sh 'git checkout main'`,
        `[Pipeline] }`,
        `[Pipeline] { (Build)`,
        `[Pipeline] sh 'npm ci'`,
        `[Pipeline] sh 'npm run build'`,
        `[Pipeline] sh 'npm run test'`,
        `[Pipeline] }`,
        `[Pipeline] // node`,
        `[Pipeline] End of Pipeline`,
        `Finished: SUCCESS`,
        ``
      ].join('\n')
      return { data: sample, error: null }
    }
  }
}

// Inject mocks into window
export function injectMocks() {
  ;(window as any).ztools = ztoolsMock
  ;(window as any).services = servicesMock
  console.log('[Dev] ZTools mocks injected')
}

// Auto-inject on load
if (typeof window !== 'undefined') {
  injectMocks()
}
