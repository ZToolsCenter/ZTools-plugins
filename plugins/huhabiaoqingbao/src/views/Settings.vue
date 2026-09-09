<template>
  <div class="settings-view">
    <h2>系统设置</h2>
    
    <el-card class="settings-card">
      <template #header>
        <div class="card-header">
          <span>界面设置</span>
        </div>
      </template>
      
      <div class="settings-item">
        <span class="label">暗黑模式</span>
        <el-switch
          v-model="localDarkMode"
          @change="handleDarkModeChange"
        />
      </div>

      <div class="settings-item">
        <span class="label">侧边栏关闭</span>
        <el-switch
          v-model="localCollapsed"
          @change="handleCollapseChange"
        />
      </div>
    </el-card>

    <el-card class="settings-card">
      <template #header>
        <div class="card-header">
          <span>主题设置</span>
        </div>
      </template>
      
      <div class="settings-item">
        <span class="label">主题颜色</span>
        <div class="theme-color-selector">
          <div class="color-preview" :style="{ backgroundColor: currentThemeColor.primary }">
            <span class="color-name">{{ currentThemeColor.name }}</span>
          </div>
          <el-select
            v-model="localThemeColor"
            @change="handleThemeColorChange"
            placeholder="选择主题颜色"
            class="theme-selector"
          >
            <el-option
              v-for="(color, key) in THEME_COLORS"
              :key="key"
              :label="color.name"
              :value="key"
            >
              <div class="color-option">
                <div class="color-dot" :style="{ backgroundColor: color.primary }"></div>
                <span>{{ color.name }}</span>
              </div>
            </el-option>
          </el-select>
        </div>
      </div>

      <div class="color-palette">
        <div 
          v-for="(color, key) in THEME_COLORS" 
          :key="key"
          class="color-item"
          :class="{ active: localThemeColor === key }"
          @click="handleThemeColorChange(key)"
          :title="color.name"
        >
          <div class="color-circle" :style="{ backgroundColor: color.primary }">
            <el-icon v-if="localThemeColor === key" class="check-icon">
              <Check />
            </el-icon>
          </div>
          <span class="color-label">{{ color.name }}</span>
        </div>
      </div>
    </el-card>

    <el-card class="settings-card">
      <template #header>
        <div class="card-header">
          <span>AI 生成（可选）</span>
        </div>
      </template>

      <el-alert
        type="info"
        :closable="false"
        show-icon
        title="需要你自己的扣子（Coze）凭据"
        description="填写后才能使用「AI 生成表情包」。凭据仅保存在本机设置文件中，不会上传。"
      />

      <div class="settings-item">
        <span class="label">Coze Token</span>
        <el-input
          v-model="cozeToken"
          type="password"
          show-password
          placeholder="sat_..."
          class="credential-input"
        />
      </div>

      <div class="settings-item">
        <span class="label">Coze Bot ID</span>
        <el-input v-model="cozeBotId" placeholder="Bot ID" class="credential-input" />
      </div>

      <div class="settings-actions">
        <el-button type="primary" @click="handleSaveCoze">保存</el-button>
      </div>
    </el-card>

    <el-card class="settings-card">
      <template #header>
        <div class="card-header">
          <span>壁纸搜索翻译（可选）</span>
        </div>
      </template>

      <el-alert
        type="info"
        :closable="false"
        show-icon
        title="需要你自己的百度翻译开放平台凭据"
        description="用于把中文搜索词翻译成英文以提升壁纸搜索效果；不填则直接用原词搜索。"
      />

      <div class="settings-item">
        <span class="label">百度翻译 APPID</span>
        <el-input v-model="baiduAppid" placeholder="APPID" class="credential-input" />
      </div>

      <div class="settings-item">
        <span class="label">百度翻译密钥</span>
        <el-input
          v-model="baiduKey"
          type="password"
          show-password
          placeholder="密钥"
          class="credential-input"
        />
      </div>

      <div class="settings-actions">
        <el-button type="primary" @click="handleSaveBaidu">保存</el-button>
      </div>
    </el-card>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, onMounted, computed } from 'vue'
import { getStorageItem, setStorageItemSync, STORAGE_KEYS, THEME_COLORS, type ThemeColorKey } from '@/utils/storage'
import { Check } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import {
  getBaiduTranslateCredentials,
  getCozeCredentials,
  saveBaiduTranslateCredentials,
  saveCozeCredentials
} from '@/config/credentials'

const props = defineProps<{
  isDarkMode: boolean,
  isCollapsed: boolean,
  themeColor?: ThemeColorKey
}>()

const emit = defineEmits<{
  (e: 'darkModeToggle', isDark: boolean): void
  (e: 'collapseToggle', isCollapsed: boolean): void
  (e: 'themeColorChange', color: ThemeColorKey): void
}>()

// 初始化本地状态
const localDarkMode = ref(props.isDarkMode)
const localCollapsed = ref(props.isCollapsed)
// 确保主题颜色是有效的，如果无效则使用默认值
const getValidThemeColor = (color?: ThemeColorKey): ThemeColorKey => {
  return color && THEME_COLORS[color] ? color : 'blue'
}
const localThemeColor = ref<ThemeColorKey>(getValidThemeColor(props.themeColor))

const cozeToken = ref('')
const cozeBotId = ref('')
const baiduAppid = ref('')
const baiduKey = ref('')

const handleSaveCoze = async () => {
  try {
    await saveCozeCredentials({ token: cozeToken.value, botId: cozeBotId.value })
    ElMessage.success('AI 生成凭据已保存')
  } catch (error) {
    console.error('Failed to save Coze credentials:', error)
    ElMessage.error('保存失败，请重试')
  }
}

const handleSaveBaidu = async () => {
  try {
    await saveBaiduTranslateCredentials({ appid: baiduAppid.value, key: baiduKey.value })
    ElMessage.success('翻译凭据已保存')
  } catch (error) {
    console.error('Failed to save Baidu credentials:', error)
    ElMessage.error('保存失败，请重试')
  }
}

// 计算当前主题颜色配置
const currentThemeColor = computed(() => {
  const color = THEME_COLORS[localThemeColor.value]
  // 如果找不到对应的主题颜色，返回默认的蓝色主题
  return color || THEME_COLORS.blue
})

// 组件挂载时，从本地存储读取并同步状态
onMounted(async () => {
  try {
    const storedDarkMode = await getStorageItem(STORAGE_KEYS.DARK_MODE, props.isDarkMode)
    const storedCollapsed = await getStorageItem(STORAGE_KEYS.SIDEBAR_STATE, props.isCollapsed)
    const storedThemeColor = await getStorageItem(STORAGE_KEYS.THEME_COLOR, getValidThemeColor(props.themeColor))

    // 确保存储的主题颜色是有效的
    const validThemeColor = getValidThemeColor(storedThemeColor)

    if (storedDarkMode !== props.isDarkMode) {
      emit('darkModeToggle', storedDarkMode)
    }
    if (storedCollapsed !== props.isCollapsed) {
      emit('collapseToggle', storedCollapsed)
    }
    if (validThemeColor !== props.themeColor) {
      emit('themeColorChange', validThemeColor)
    }

    localDarkMode.value = storedDarkMode
    localCollapsed.value = storedCollapsed
    localThemeColor.value = validThemeColor
  } catch (error) {
    console.error('Failed to load settings:', error)
    // 如果加载失败，使用传入的 props 作为默认值
    localDarkMode.value = props.isDarkMode
    localCollapsed.value = props.isCollapsed
    localThemeColor.value = getValidThemeColor(props.themeColor)
  }

  try {
    const [coze, baidu] = await Promise.all([getCozeCredentials(), getBaiduTranslateCredentials()])
    cozeToken.value = coze.token
    cozeBotId.value = coze.botId
    baiduAppid.value = baidu.appid
    baiduKey.value = baidu.key
  } catch (error) {
    console.error('Failed to load credentials:', error)
  }
})

// 监听属性变化
watch(() => props.isDarkMode, (newValue) => {
  localDarkMode.value = newValue
})

watch(() => props.isCollapsed, (newValue) => {
  localCollapsed.value = newValue
})

watch(() => props.themeColor, (newValue) => {
  if (newValue) {
    localThemeColor.value = getValidThemeColor(newValue)
  }
})

const handleDarkModeChange = (value: boolean) => {
  emit('darkModeToggle', value)
  // 使用同步版本避免阻塞UI
  setStorageItemSync(STORAGE_KEYS.DARK_MODE, value)
}

const handleCollapseChange = (value: boolean) => {
  emit('collapseToggle', value)
  // 使用同步版本避免阻塞UI
  setStorageItemSync(STORAGE_KEYS.SIDEBAR_STATE, value)
}

const handleThemeColorChange = (color: ThemeColorKey) => {
  localThemeColor.value = color
  emit('themeColorChange', color)
  // 使用同步版本避免阻塞UI
  setStorageItemSync(STORAGE_KEYS.THEME_COLOR, color)
}
</script>

<style scoped lang="scss">
.settings-view {
  padding: 20px;
  max-width: 800px;
  margin: 0 auto;

  h2 {
    margin-bottom: 24px;
    font-size: 24px;
    font-weight: 500;
    color: var(--el-text-color-primary);
  }
}

.settings-card {
  margin-bottom: 20px;
  border-radius: 8px;
  box-shadow: 0 2px 12px 0 rgba(0, 0, 0, 0.1);
  
  .card-header {
    display: flex;
    align-items: center;
    
    span {
      font-size: 16px;
      font-weight: 500;
      color: var(--el-text-color-primary);
    }
  }
}

.settings-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 0;

  .label {
    font-size: 14px;
    color: var(--el-text-color-regular);
  }
}

.credential-input {
  max-width: 320px;
}

.settings-actions {
  display: flex;
  justify-content: flex-end;
  padding-top: 8px;
}

// 主题颜色选择器样式
.theme-color-selector {
  display: flex;
  align-items: center;
  gap: 12px;
  
  .color-preview {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 60px;
    height: 32px;
    border-radius: 6px;
    color: white;
    font-size: 12px;
    font-weight: 500;
    text-shadow: 0 1px 2px rgba(0, 0, 0, 0.3);
    
    .color-name {
      font-size: 11px;
    }
  }
  
  .theme-selector {
    min-width: 120px;
  }
}

.color-option {
  display: flex;
  align-items: center;
  gap: 8px;
  
  .color-dot {
    width: 16px;
    height: 16px;
    border-radius: 50%;
    border: 2px solid #fff;
    box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.1);
  }
}

// 颜色调色板样式
.color-palette {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(80px, 1fr));
  gap: 16px;
  margin-top: 16px;
  padding: 16px 0;
  border-top: 1px solid var(--el-border-color-light);
}

.color-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 8px;
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.3s ease;
  
  &:hover {
    background-color: var(--el-fill-color-light);
    transform: translateY(-2px);
  }
  
  &.active {
    background-color: var(--el-color-primary-light-9);
    
    .color-circle {
      transform: scale(1.1);
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
    }
  }
  
  .color-circle {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 40px;
    height: 40px;
    border-radius: 50%;
    border: 3px solid #fff;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
    transition: all 0.3s ease;
    
    .check-icon {
      color: white;
      font-size: 18px;
      font-weight: bold;
      text-shadow: 0 1px 2px rgba(0, 0, 0, 0.3);
    }
  }
  
  .color-label {
    font-size: 12px;
    color: var(--el-text-color-regular);
    text-align: center;
    font-weight: 500;
  }
}
</style> 