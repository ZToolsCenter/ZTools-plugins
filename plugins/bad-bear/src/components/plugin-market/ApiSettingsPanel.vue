<script setup lang="ts">
import { ref, watch } from 'vue'
import { ZButton, ZInput } from 'ztools-ui'
import ztoolsLogoUrl from '@/assets/image/default.png?url'

type ResourceIcon = 'ztools' | 'github' | 'qq'

interface ResourceCard {
  key: string
  name: string
  icon: ResourceIcon
  url: string
}

const props = defineProps<{
  baseUrl: string
}>()

const emit = defineEmits<{
  (e: 'save', value: string): void
}>()

const resourceCards: ResourceCard[] = [
  {
    key: 'docs',
    name: 'ZTools开发者文档',
    icon: 'ztools',
    url: 'https://www.ohmyztools.cc/',
  },
  {
    key: 'ui',
    name: 'ZTools-UI',
    icon: 'ztools',
    url: 'https://ui.ohmyztools.cc/',
  },
  {
    key: 'github',
    name: 'Github开源地址',
    icon: 'github',
    url: 'https://github.com/Particaly/bad-bear',
  },
  {
    key: 'qq',
    name: 'QQ交流群',
    icon: 'qq',
    url: 'https://qun.qq.com/universal-share/share?ac=1&authKey=r%2B6EeSvEBORHprg3MteyKNku00kHFxnt6ROEwIl6K0snfdK3JeCGuIMW%2Bm5qLYdC&busi_data=eyJncm91cENvZGUiOiIxMDc2OTQyNjE5IiwidG9rZW4iOiI2ZFdDYU5PNlBpOXB3UWhUZVB2eTBZYlRUMVdMV1BuQzBVZGZoK1BOVDFWMXp5aUR6bER3Um5CU3JUS2NYOTFjIiwidWluIjoiOTgwMTQxMzc0In0%3D&data=P2c2D2IWIzbkMZykEG8ea4yjbyj5DpFiRaJq5-bKOC8VvoNoHdCeOB9Mo-BJ203kMiRlA5zi42oT4Fkc9ZpixA&svctype=4&tempid=h5_group_info',
  },
]

const draftBaseUrl = ref(props.baseUrl)
const showDeveloperSettings = ref(false)
const appVersion = __APP_VERSION__
const appWebsiteUrl = 'https://badbear.ydys.cc'

watch(
  () => props.baseUrl,
  (value) => {
    draftBaseUrl.value = value
  },
)

/**
 * 提交当前草稿地址给父组件，由现有运行时配置流程负责校验、保存和刷新商店数据。
 */
function submit(): void {
  emit('save', draftBaseUrl.value)
}

/**
 * 打开设置页资源卡片链接；宿主环境优先使用系统外部打开能力，浏览器预览时降级为新标签页。
 */
function openResourceCard(url: string): void {
  if (typeof window.ztools?.shellOpenExternal === 'function') {
    window.ztools.shellOpenExternal(url)
    return
  }

  window.open(url, '_blank', 'noopener,noreferrer')
}
</script>

<template>
  <div class="settings-panel">
    <div class="panel-card section-card settings-card">
      <label class="developer-toggle-row">
        <span class="developer-toggle-copy">
          <span class="section-title">开发者设置</span>
          <span class="field-help">高级选项，通常无需修改。</span>
        </span>
        <span class="toggle developer-toggle-control">
          <input
            v-model="showDeveloperSettings"
            type="checkbox"
            role="switch"
            aria-controls="developer-settings-panel"
            :aria-checked="showDeveloperSettings"
            :aria-expanded="showDeveloperSettings"
          />
          <span class="toggle-slider" aria-hidden="true"></span>
        </span>
      </label>

      <div v-if="showDeveloperSettings" id="developer-settings-panel" class="developer-settings-content">
        <div class="field-group">
          <label class="field-label" for="shop-api-base-url">商店后端地址</label>
          <ZInput
            id="shop-api-base-url"
            v-model="draftBaseUrl"
            class="text-input"
            type="text"
            placeholder="通常来说你不需要改这个"
            @keydown.enter="submit"
          />
          <p class="field-help">保存后会重新加载插件商店内容。</p>
        </div>
        <div class="action-row">
          <ZButton type="primary" @click="submit">保存地址</ZButton>
        </div>
      </div>
    </div>

    <div class="panel-card section-card resource-section">
      <div class="section-heading">
        <h3 class="section-title">常用资源</h3>
        <p class="field-help">开发插件、查看源码或加入交流群时可以从这里快速进入。</p>
      </div>

      <div class="resource-card-grid">
        <button
          v-for="card in resourceCards"
          :key="card.key"
          class="resource-card"
          type="button"
          @click="openResourceCard(card.url)"
        >
          <span class="resource-card-icon" :class="`resource-card-icon--${card.icon}`" aria-hidden="true">
            <img v-if="card.icon === 'ztools'" :src="ztoolsLogoUrl" alt="" class="resource-card-logo" draggable="false" />
            <svg v-else-if="card.icon === 'github'" class="resource-card-svg" viewBox="0 0 24 24" fill="currentColor">
              <path
                d="M12 2C6.48 2 2 6.59 2 12.25c0 4.53 2.87 8.37 6.84 9.73.5.1.68-.22.68-.49 0-.24-.01-.88-.01-1.73-2.78.62-3.37-1.37-3.37-1.37-.45-1.18-1.11-1.5-1.11-1.5-.91-.64.07-.63.07-.63 1 .07 1.53 1.06 1.53 1.06.89 1.56 2.34 1.11 2.91.85.09-.66.35-1.11.63-1.37-2.22-.26-4.56-1.14-4.56-5.06 0-1.12.39-2.03 1.03-2.75-.1-.26-.45-1.3.1-2.71 0 0 .84-.28 2.75 1.05A9.36 9.36 0 0 1 12 7c.85 0 1.71.12 2.51.34 1.91-1.33 2.75-1.05 2.75-1.05.55 1.41.2 2.45.1 2.71.64.72 1.03 1.63 1.03 2.75 0 3.93-2.34 4.79-4.57 5.05.36.32.68.95.68 1.91 0 1.38-.01 2.49-.01 2.83 0 .27.18.59.69.49A10.14 10.14 0 0 0 22 12.25C22 6.59 17.52 2 12 2Z"
              />
            </svg>
            <svg v-else class="resource-card-svg" viewBox="0 0 24 24" fill="currentColor">
              <path
                d="M12 2C7.58 2 4 5.08 4 8.88c0 1.5.5 3.12 1.24 4.86L4.1 17.16a1.4 1.4 0 0 0 .3 1.38 1.35 1.35 0 0 0 1.36.36l2.14-.68A6.1 6.1 0 0 0 9.2 19.6c-.6.27-1.34.67-1.34 1.08 0 .73 1.85 1.32 4.14 1.32s4.14-.59 4.14-1.32c0-.41-.74-.81-1.34-1.08a6.1 6.1 0 0 0 1.3-1.38l2.14.68a1.35 1.35 0 0 0 1.36-.36 1.4 1.4 0 0 0 .3-1.38l-1.14-3.42C19.5 12 20 10.38 20 8.88 20 5.08 16.42 2 12 2Zm-3.2 8.7c-.74 0-1.34-.76-1.34-1.7s.6-1.7 1.34-1.7 1.34.76 1.34 1.7-.6 1.7-1.34 1.7Zm6.4 0c-.74 0-1.34-.76-1.34-1.7s.6-1.7 1.34-1.7 1.34.76 1.34 1.7-.6 1.7-1.34 1.7Z"
              />
            </svg>
          </span>
          <span class="resource-card-name">{{ card.name }}</span>
        </button>
      </div>
    </div>

    <footer class="settings-signature">
      <span>🐻</span>@<a class="settings-version-link" :href="appWebsiteUrl" target="_blank" rel="noopener noreferrer">{{ appVersion }}</a>
      created with <span>☕️</span> and <span>🍯</span>
    </footer>
  </div>
</template>

<style scoped>
.settings-panel {
  display: flex;
  flex-direction: column;
  gap: 16px;
  min-height: 100%;
}

.panel-card {
  padding: 18px;
  border: 1px solid var(--divider-color);
  border-radius: 8px;
  background: var(--card-bg);
  backdrop-filter: blur(40px) saturate(180%);
}

.section-card {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.section-heading,
.developer-toggle-copy {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.section-title {
  margin: 0;
  color: var(--text-color);
  font-size: 15px;
  font-weight: 700;
  line-height: 1.4;
}

.resource-card-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}

.resource-card {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  padding: 14px;
  border: 1px solid var(--divider-color);
  border-radius: 12px;
  background: var(--surface-elevated);
  color: var(--text-color);
  cursor: pointer;
  transition: border-color 0.2s ease, background 0.2s ease, transform 0.2s ease;
}

.resource-card:hover {
  border-color: color-mix(in srgb, var(--primary-color) 45%, var(--divider-color));
  background: color-mix(in srgb, var(--primary-color) 8%, var(--surface-elevated));
  transform: translateY(-1px);
}

.resource-card:focus-visible {
  outline: none;
  border-color: var(--primary-color);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--primary-color) 18%, transparent);
}

.resource-card-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
  width: 36px;
  height: 36px;
  border-radius: 10px;
  overflow: hidden;
  color: var(--primary-color);
}

.resource-card-icon--github {
  background: #24292f;
  color: #ffffff;
}

.resource-card-icon--qq {
  background: #12b7f5;
  color: #ffffff;
}

.resource-card-logo {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.resource-card-svg {
  width: 22px;
  height: 22px;
}

.resource-card-name {
  color: var(--text-color);
  font-size: 13px;
  font-weight: 600;
  line-height: 1.4;
  text-align: left;
}

.settings-signature {
  margin-top: auto;
  padding-top: 8px;
  color: var(--text-secondary);
  font-size: 14px;
  line-height: 1.6;
  text-align: center;
  span {
    font-size: 24px;
  }
}

.settings-version-link {
  color: var(--primary-color);
  font-weight: 700;
  text-decoration: none;
}

.settings-version-link:hover {
  text-decoration: none;
}

.settings-card {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.developer-toggle-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  cursor: pointer;
}

.developer-toggle-control {
  flex: 0 0 auto;
}

.developer-settings-content {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding-top: 16px;
  border-top: 1px solid var(--divider-color);
}

.field-group {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.field-label {
  color: var(--text-color);
  font-size: 13px;
  font-weight: 600;
}

.text-input {
  width: 100%;
  min-height: 40px;
  padding: 10px 12px;
  border: 1px solid var(--divider-color);
  border-radius: 10px;
  background: var(--bg-color);
  color: var(--text-color);
  outline: none;
}

.text-input:focus {
  border-color: var(--primary-color);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--primary-color) 18%, transparent);
}

.field-help {
  margin: 0;
  color: var(--text-secondary);
  font-size: 12px;
  line-height: 1.6;
}

.action-row {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 10px;
}

@media (max-width: 640px) {
  .resource-card-grid {
    grid-template-columns: 1fr;
  }

  .developer-toggle-row {
    align-items: flex-start;
  }
}
</style>
