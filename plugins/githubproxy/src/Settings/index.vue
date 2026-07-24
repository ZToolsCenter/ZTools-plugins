<script lang="ts" setup>
import { ref, onMounted } from 'vue'
import Header from '../components/Header/index.vue'
import { Timer, Edit, Delete, Refresh, Plus } from '@element-plus/icons-vue'

interface ProxyServer {
  name: string
  status: string
  responseTime?: number
}

const DEFAULT_SERVERS: ProxyServer[] = [
  { name: 'ghproxy.net', status: '' },
  { name: 'gh.llkk.cc', status: '' },
  { name: 'gitproxy.click', status: '' },
  { name: 'github.tbedu.top', status: '' },
  { name: 'ghfile.geekertao.top', status: '' },
  { name: 'ghf.xn--eqrr82bzpe.top', status: '' },
  { name: 'ghm.078465.xyz', status: '' }
]

const proxyServers = ref<ProxyServer[]>([])
const isTesting = ref(false)
const editingServer = ref<ProxyServer | null>(null)
const editingOriginalName = ref('')
const showAddModal = ref(false)
const showEditModal = ref(false)
const showCleanConfirmModal = ref(false)
const newServerName = ref('')

const loadProxyServers = async () => {
  try {
    let resultJson = await window.ztools.db.get('proxyServers')
    if (resultJson === null) {
      proxyServers.value = [...DEFAULT_SERVERS]
      await testAllServers()
      resultJson = await window.ztools.db.get('proxyServers')
    }
    
    let result: ProxyServer[] = []
    if (resultJson && resultJson.data) {
      try {
        result = JSON.parse(resultJson.data)
      } catch {
        result = []
      }
    }
    
    if (result && Array.isArray(result) && result.length > 0) {
      proxyServers.value = result
    } else {
      proxyServers.value = [...DEFAULT_SERVERS]
      await testAllServers()
    }
  } catch (error) {
    console.error('加载代理服务器列表失败:', error)
    window.ztools.showNotification('代理服务器列表加载失败，请检查数据库连接')
  }
}

const saveProxyServers = async () => {
  try {
    await window.ztools.db.remove('proxyServers')
    // 此处只执行put操作，无法更新数据，需要先删除再插入
    await window.ztools.db.put({ _id: 'proxyServers', data: JSON.stringify(proxyServers.value) })
  } catch (error) {
    console.error('保存代理服务器列表失败:', error)
    window.ztools.showNotification('代理服务器列表保存失败，请检查数据库连接')
  }
}

const testServer = async (server: ProxyServer) => {
  server.status = '测试中...'
  
  try {
    const startTime = Date.now()
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 3000)
    const response = await fetch(`https://${server.name}`, {
      method: 'HEAD',
      signal: controller.signal
    })
    clearTimeout(timeoutId)
    const responseTime = Date.now() - startTime
    
    if (response.ok) {
      server.status = `正常 (${responseTime}ms)`
      server.responseTime = responseTime
    } else {
      server.status = '连接失败'
    }
  } catch (error) {
    server.status = '连接超时'
  }
}

const testAllServers = async () => {
  isTesting.value = true
  
  const promises = proxyServers.value.map(server => testServer(server))
  await Promise.all(promises)
  
  isTesting.value = false
  await saveProxyServers()
}

const addServer = () => {
  if (!newServerName.value.trim()) return
  
  proxyServers.value.push({
    name: newServerName.value.trim(),
    status: '未测试'
  })
  newServerName.value = ''
  showAddModal.value = false
  saveProxyServers()
}

const editServer = (server: ProxyServer) => {
  editingServer.value = { ...server }
  editingOriginalName.value = server.name
  showEditModal.value = true
}

const saveEdit = () => {
  if (!editingServer.value) return
  
  const index = proxyServers.value.findIndex(s => s.name === editingOriginalName.value)
  if (index !== -1) {
    proxyServers.value[index] = { ...editingServer.value }
  }
  editingServer.value = null
  editingOriginalName.value = ''
  showEditModal.value = false
  saveProxyServers()
}

const cancelEdit = () => {
  editingServer.value = null
  editingOriginalName.value = ''
  showEditModal.value = false
}

const deleteServer = (serverName: string) => {
  proxyServers.value = proxyServers.value.filter(s => s.name !== serverName)
  saveProxyServers()
}

const getInvalidServerCount = () => {
  return proxyServers.value.filter(s => !s.status.includes('正常')).length
}

const cleanInvalidServers = () => {
  const initialCount = proxyServers.value.length
  proxyServers.value = proxyServers.value.filter(s => s.status.includes('正常'))
  const removedCount = initialCount - proxyServers.value.length
  saveProxyServers()
  showCleanConfirmModal.value = false
  window.ztools.showNotification(`已清理 ${removedCount} 个失效代理服务器`)
}

onMounted(() => {
  loadProxyServers()
})
</script>

<template>
  <div class="settings">
    <el-container>
      <Header current-view="settings" @navigate="$emit('navigate', $event)" />

      <el-main>
        <div class="page-header">
          <h2>代理服务器设置</h2>
          <p>管理 GitHub 代理服务器列表，支持测速和持久化存储</p>
        </div>

        <el-card class="action-card">
          <div class="action-buttons">
            <el-button type="primary" @click="testAllServers" :disabled="isTesting" :icon="Refresh">
              全部测速
            </el-button>
            <el-button type="success" @click="showAddModal = true" :icon="Plus">
              添加服务器
            </el-button>
            <el-button 
              type="danger" 
              @click="showCleanConfirmModal = true" 
              :disabled="getInvalidServerCount() === 0"
            >
              清理失效代理 ({{ getInvalidServerCount() }})
            </el-button>
          </div>
        </el-card>

        <el-card class="server-list-card">
          <template #header>
            <h3>服务器列表</h3>
          </template>
          <el-table :data="proxyServers" :stripe="true" border style="width: 100%">
            <el-table-column prop="name" label="服务器地址" min-width="150" />
            <el-table-column prop="status" label="状态" min-width="150">
              <template #default="scope">
                <el-tag
                  :type="scope.row.status.includes('正常') ? 'success' : scope.row.status.includes('测试中') ? 'warning' : 'danger'"
                >
                  {{ scope.row.status }}
                </el-tag>
              </template>
            </el-table-column>
            <el-table-column label="操作" width="250">
              <template #default="scope">
                <el-button
                  size="small"
                  type="primary"
                  @click="testServer(scope.row)"
                  :disabled="isTesting"
                  :icon="Timer"
                >
                  测速
                </el-button>
                <el-button
                  size="small"
                  type="warning"
                  :icon="Edit"
                  @click="editServer(scope.row)"
                >
                  编辑
                </el-button>
                <el-button
                  size="small"
                  type="danger"
                  :icon="Delete"
                  @click="deleteServer(scope.row.name)"
                >
                  删除
                </el-button>
              </template>
            </el-table-column>
          </el-table>
          <el-empty v-if="proxyServers.length === 0" description="暂无代理服务器" />
        </el-card>
      </el-main>
    </el-container>

    <el-dialog title="添加服务器" v-model="showAddModal">
      <el-form label-width="100px">
        <el-form-item label="服务器地址">
          <el-input
            v-model="newServerName"
            placeholder="例如: ghproxy.net"
          />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showAddModal = false">取消</el-button>
        <el-button type="primary" @click="addServer">添加</el-button>
      </template>
    </el-dialog>

    <el-dialog title="编辑服务器" v-model="showEditModal">
      <el-form label-width="100px">
        <el-form-item label="服务器地址">
          <el-input
            v-model="editingServer.name"
            placeholder="例如: ghproxy.net"
          />
        </el-form-item>
        <el-form-item label="状态">
          <el-input
            v-model="editingServer.status"
            placeholder="状态"
          />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="cancelEdit">取消</el-button>
        <el-button type="primary" @click="saveEdit">保存</el-button>
      </template>
    </el-dialog>

    <el-dialog title="确认清理" v-model="showCleanConfirmModal">
      <p>确定要清理所有失效的代理服务器吗？</p>
      <p style="color: #f56c6c; margin-top: 10px;">
        将删除 {{ getInvalidServerCount() }} 个状态为"连接失败"或"连接超时"的服务器。
      </p>
      <template #footer>
        <el-button @click="showCleanConfirmModal = false">取消</el-button>
        <el-button type="danger" @click="cleanInvalidServers">确认清理</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.settings {
  width: 100%;
  height: 100%;
}

.el-container {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
}

.el-main {
  flex: 1;
  padding: 24px;
  overflow-y: auto;
  box-sizing: border-box;
  background-color: var(--bg-secondary);
}

.page-header {
  margin-bottom: 24px;
}

.page-header h2 {
  margin: 0 0 8px 0;
  font-size: 24px;
  color: var(--text-primary);
}

.page-header p {
  margin: 0;
  color: var(--text-secondary);
  font-size: 14px;
}

.action-card {
  margin-bottom: 16px;
}

.action-buttons {
  display: flex;
  gap: 12px;
}

.server-list-card {
  margin-top: 0;
}

.server-list-card h3 {
  margin: 0;
  color: var(--text-primary);
}
</style>