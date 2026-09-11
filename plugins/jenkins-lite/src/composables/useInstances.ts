import { ref, computed } from 'vue'
import type { JenkinsInstance } from '../types'
import { JenkinsClient } from '../utils/jenkins'

// 内存缓存
const instances = ref<JenkinsInstance[]>([])
const currentInstanceId = ref<string | null>(null)
const clients = new Map<string, JenkinsClient>()

export function useInstances() {
  /**
   * 加载所有实例
   */
  const loadInstances = async () => {
    const docs = window.ztools.db.allDocs<JenkinsInstance>('instance_')
    instances.value = docs.map(doc => ({
      ...doc,
      ...doc._id ? { _id: doc._id } : {},
      ...doc.type ? { type: doc.type } : {}
    }))

    // 加载上次使用的实例
    const lastId = window.ztools.dbStorage.getItem<string>('lastInstanceId')
    if (lastId && instances.value.some(i => i._id === lastId)) {
      currentInstanceId.value = lastId
    } else if (instances.value.length > 0) {
      currentInstanceId.value = instances.value[0]._id
    }
  }

  /**
   * 获取当前实例
   */
  const currentInstance = computed(() => {
    return instances.value.find(i => i._id === currentInstanceId.value) || null
  })

  /**
   * 获取当前 JenkinsClient
   */
  const currentClient = computed(() => {
    if (!currentInstance.value) return null
    return getClient(currentInstance.value)
  })

  /**
   * 获取或创建 JenkinsClient
   */
  const getClient = (instance: JenkinsInstance): JenkinsClient => {
    if (!clients.has(instance._id)) {
      clients.set(instance._id, new JenkinsClient(instance.url, instance.username, instance.apiToken))
    }
    return clients.get(instance._id)!
  }

  /**
   * 切换当前实例
   */
  const switchInstance = (instanceId: string) => {
    currentInstanceId.value = instanceId
    window.ztools.dbStorage.setItem('lastInstanceId', instanceId)
  }

  /**
   * 添加实例
   */
  const addInstance = async (data: Omit<JenkinsInstance, '_id' | 'type' | 'createdAt' | 'updatedAt'>): Promise<{ success: boolean; error?: string }> => {
    // 验证连接
    const client = new JenkinsClient(data.url, data.username, data.apiToken)
    const testResult = await client.testConnection()

    if (testResult.error) {
      return { success: false, error: `连接失败: ${testResult.error}` }
    }

    const instance: JenkinsInstance = {
      _id: `instance_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      type: 'jenkins-instance',
      ...data,
      createdAt: Date.now(),
      updatedAt: Date.now()
    }

    window.ztools.db.put(instance)
    instances.value.push(instance)

    if (!currentInstanceId.value) {
      switchInstance(instance._id)
    }

    return { success: true }
  }

  /**
   * 更新实例
   */
  const updateInstance = async (id: string, data: Partial<JenkinsInstance>): Promise<{ success: boolean; error?: string }> => {
    const instance = instances.value.find(i => i._id === id)
    if (!instance) {
      return { success: false, error: '实例不存在' }
    }

    // 如果 URL/用户名/Token 变化，验证新连接
    if (data.url || data.username || data.apiToken) {
      const client = new JenkinsClient(
        data.url || instance.url,
        data.username || instance.username,
        data.apiToken || instance.apiToken
      )
      const testResult = await client.testConnection()

      if (testResult.error) {
        return { success: false, error: `连接失败: ${testResult.error}` }
      }

      // 清除缓存的 client
      clients.delete(id)
    }

    const updated: JenkinsInstance = {
      ...instance,
      ...data,
      updatedAt: Date.now()
    }

    window.ztools.db.put(updated)
    const index = instances.value.findIndex(i => i._id === id)
    if (index !== -1) {
      instances.value[index] = updated
    }

    return { success: true }
  }

  /**
   * 删除实例
   */
  const deleteInstance = (id: string) => {
    window.ztools.db.remove(id)
    instances.value = instances.value.filter(i => i._id !== id)
    clients.delete(id)

    if (currentInstanceId.value === id) {
      currentInstanceId.value = instances.value.length > 0 ? instances.value[0]._id : null
      if (currentInstanceId.value) {
        window.ztools.dbStorage.setItem('lastInstanceId', currentInstanceId.value)
      } else {
        window.ztools.dbStorage.removeItem('lastInstanceId')
      }
    }
  }

  /**
   * 是否有已配置的实例
   */
  const hasInstances = computed(() => instances.value.length > 0)

  /**
   * 测试连接（无需保存实例）
   */
  const testConnection = async (
    url: string,
    username: string,
    apiToken: string
  ): Promise<{ success: boolean; error?: string }> => {
    const client = new JenkinsClient(url, username, apiToken)
    return await client.testConnection()
  }

  return {
    instances,
    currentInstance,
    currentClient,
    hasInstances,
    loadInstances,
    switchInstance,
    addInstance,
    updateInstance,
    deleteInstance,
    getClient,
    testConnection
  }
}
