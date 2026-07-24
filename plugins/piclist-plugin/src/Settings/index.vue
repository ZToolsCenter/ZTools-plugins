<script lang="ts" setup>
import { ref, onMounted } from 'vue'
import Header from '../components/Header/index.vue'
import { ElButton, ElInput, ElCard, ElMessage, ElSwitch, ElSelect, ElOption } from 'element-plus'
import { Download, Refresh } from '@element-plus/icons-vue'

interface PicListConfig {
  host: string
  port: string
  apiKey: string
  useHttps: boolean
  historyMaxCount: number
  copyFormat: 'markdown' | 'html' | 'url' | 'ubb' | 'custom'
  customFormat: string
}

const config = ref<PicListConfig>({
  host: '127.0.0.1',
  port: '36677',
  apiKey: '',
  useHttps: false,
  historyMaxCount: 50,
  copyFormat: 'markdown',
  customFormat: '![{filename}]({url})'
})

const loading = ref(false)

const loadConfig = async () => {
  try {
    const savedConfig = await window.ztools.db.get('piclist_config')
    if (savedConfig) {
      const configStr = typeof savedConfig === 'string' ? savedConfig : savedConfig.data
      const saved = JSON.parse(configStr)
      config.value = {
        historyMaxCount: 50,
        copyFormat: 'markdown',
        customFormat: '![{filename}]({url})',
        ...saved
      }
    }
  } catch (error) {
    window.ztools.showNotification(`加载配置失败: ${error}`)
  }
}

const saveConfig = async () => {
  loading.value = true
  try {
    await window.ztools.db.remove('piclist_config')
    await window.ztools.db.put({ _id: 'piclist_config', data: JSON.stringify(config.value)})
    ElMessage.success('配置保存成功')
  } catch (error) {
    ElMessage.error('配置保存失败')
    window.ztools.showNotification(`保存配置失败: ${error}`)
  } finally {
    loading.value = false
  }
}

const resetConfig = () => {
  config.value = {
    host: '127.0.0.1',
    port: '36677',
    apiKey: '',
    useHttps: false,
    historyMaxCount: 50,
    copyFormat: 'markdown',
    customFormat: '![{filename}]({url})'
  }
}

const testConnection = async () => {
  loading.value = true
  try {
    const protocol = config.value.useHttps ? 'https' : 'http'
    let url = `${protocol}://${config.value.host}:${config.value.port}/heartbeat`
    if (config.value.apiKey) {
      url += `?key=${config.value.apiKey}`
    }
    const response = await fetch(url, {
      method: 'GET',
    })
    
    if (response.ok) {
      ElMessage.success('连接测试成功')
    } else {
      ElMessage.error('连接测试失败')
    }
  } catch (error) {
    window.ztools.showNotification(`连接测试失败，请确保已启动 PicList 并开启内置 HTTP 服务`)
  } finally {
    loading.value = false
  }
}

onMounted(() => {
  loadConfig()
})
</script>

<template>
  <div class="settings">
    <el-container>
      <Header current-view="settings" @navigate="$emit('navigate', $event)" />

      <el-main>
        <div class="settings-content">
          <h1 class="page-title">PicList 设置</h1>
          <p class="page-desc">配置 PicList 服务连接信息</p>

          <elCard class="config-card">
            <h2 class="card-title">服务配置</h2>
            
            <div class="form-item">
              <label class="form-label">协议</label>
              <div class="form-switch">
                <ElSwitch 
                  v-model="config.useHttps" 
                  active-text="HTTPS" 
                  inactive-text="HTTP"
                />
              </div>
            </div>

            <div class="form-item">
              <label class="form-label">服务地址</label>
              <ElInput 
                v-model="config.host" 
                placeholder="输入 PicList 服务地址，默认为 127.0.0.1"
              />
            </div>

            <div class="form-item">
              <label class="form-label">端口</label>
              <ElInput 
                v-model="config.port" 
                placeholder="输入 PicList 服务端口，默认为 36677"
              />
            </div>

            <div class="form-item">
              <label class="form-label">API Key（可选）</label>
              <ElInput 
                v-model="config.apiKey" 
                placeholder="如果 PicList 启用了鉴权，请输入 API Key"
                type="password"
              />
            </div> <div class="form-actions">
              <ElButton 
                type="primary" 
                :loading="loading"
                :icon="Download"
                @click="saveConfig"
              >
                保存配置
              </ElButton>
              <ElButton 
                :loading="loading"
                :icon="Refresh"
                @click="testConnection"
              >
                测试连接
              </ElButton>
              <ElButton @click="resetConfig">重置</ElButton>
            </div>           
          </elCard>

          <elCard class="history-card">
            <h2 class="card-title">历史记录配置</h2>
            
            <div class="form-item">
              <label class="form-label">最大保存条数</label>
              <ElInput 
                v-model.number="config.historyMaxCount" 
                type="number"
                min="1"
                max="500"
                placeholder="输入最大保存条数，默认为 50"
              />
              <p class="form-hint">超过此数量时，最早的记录将被自动删除</p>
            </div>

            <div class="form-item">
              <label class="form-label">复制 URL 格式</label>
              <ElSelect 
                v-model="config.copyFormat" 
                placeholder="请选择格式"
              >
                <ElOption label="Markdown" value="markdown" />
                <ElOption label="HTML" value="html" />
                <ElOption label="URL" value="url" />
                <ElOption label="UBB" value="ubb" />
                <ElOption label="自定义" value="custom" />
              </ElSelect>
              <p class="form-hint">选择复制图片链接时使用的格式</p>
            </div>

            <div v-if="config.copyFormat === 'custom'" class="form-item">
              <label class="form-label">自定义格式</label>
              <ElInput 
                v-model="config.customFormat" 
                placeholder="输入自定义格式，支持 {url} 和 {filename} 占位符"
              />
              <p class="form-hint">可用占位符：{url} - 图片链接，{filename} - 文件名（不含扩展名）</p>
            </div>
            <div class="form-actions">
              <ElButton 
                type="primary" 
                :loading="loading"
                :icon="Download"
                @click="saveConfig"
              >
                保存配置
              </ElButton>              
            </div>
          </elCard>

          <elCard class="tips-card">
            <h2 class="card-title">使用说明</h2>
            <ul class="tips-list">
              <li>确保 PicList 已开启内置 HTTP 服务（设置 -> 服务设置 -> 开启服务）</li>
              <li>默认端口为 36677，可在 PicList 设置中修改</li>
              <li>如果开启了 API 鉴权，请在此输入 API Key</li>
              <li>配置会自动保存到 ZTools 数据库中</li>
            </ul>
          </elCard>
        </div>
      </el-main>
    </el-container>
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

.settings-content {
  max-width: 600px;
  margin: 0 auto;
}

.page-title {
  margin: 0 0 8px 0;
  font-size: 28px;
  font-weight: bold;
  color: var(--text-primary);
}

.page-desc {
  margin: 0 0 24px 0;
  color: var(--text-secondary);
  font-size: 14px;
}

.config-card,
.history-card,
.tips-card {
  margin-bottom: 16px;
}

.card-title {
  margin: 0 0 20px 0;
  font-size: 18px;
  color: var(--text-primary);
  padding-bottom: 12px;
  border-bottom: 1px solid var(--border-color);
}

.form-item {
  margin-bottom: 16px;
}

.form-label {
  display: block;
  margin-bottom: 8px;
  font-size: 14px;
  color: var(--text-primary);
  font-weight: 500;
}

.form-hint {
  margin: 8px 0 0 0;
  font-size: 12px;
  color: #999;
}

.form-switch {
  display: flex;
  align-items: center;
  gap: 12px;
}

.form-actions {
  display: flex;
  gap: 12px;
  margin-top: 24px;
}

.tips-list {
  list-style: none;
  padding: 0;
  margin: 0;
}

.tips-list li {
  padding: 8px 0;
  font-size: 14px;
  color: var(--text-secondary);
  line-height: 1.6;
}
</style>