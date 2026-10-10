<script setup lang="ts">
import { onMounted, ref } from 'vue'
import Hello from './Hello/index.vue'
import Read from './Read/index.vue'
import Write from './Write/index.vue'
import Random from './Random/index.vue'
import RandomString from './RandomString/index.vue'
import Xml from './Xml/index.vue'
import { enterFeature, exitFeature, getDevRouteFromUrl, isZtoolsMocked } from './dev/ztools-mock'

const features = [
  { code: 'xml', label: 'XML 工具' },
  { code: 'random', label: '随机数' },
  { code: 'randomstring', label: '随机字符串' },
  { code: 'hello', label: 'Hello 示例' },
  { code: 'read', label: '读文件' }
]

const route = ref('')
const enterAction = ref<any>({})
const ztoolsReady = ref(Boolean(window.ztools?.onPluginEnter))

onMounted(() => {
  if (!window.ztools?.onPluginEnter) {
    return
  }

  window.ztools.onPluginEnter((action) => {
    route.value = action.code
    enterAction.value = action
  })

  window.ztools.onPluginOut(() => {
    route.value = ''
    enterAction.value = {}
  })

  ztoolsReady.value = true

  const codeFromUrl = getDevRouteFromUrl()
  if (codeFromUrl) {
    enterFeature(codeFromUrl)
  }
})
</script>

<template>
  <div v-if="!ztoolsReady" class="plugin-error">
    <h2>插件加载失败</h2>
    <p>未检测到 ZTools 运行环境，请在 ZTools 中安装并打开此插件。</p>
  </div>

  <div v-else-if="!route" class="plugin-home">
    <h2>开发工具箱</h2>
    <p v-if="isZtoolsMocked">浏览器预览模式：选择功能进行测试。</p>
    <p v-else>选择功能开始使用，或在 ZTools 搜索框输入对应指令。</p>
    <div class="plugin-home__actions">
      <button v-for="feature in features" :key="feature.code" @click="enterFeature(feature.code)">
        {{ feature.label }}
      </button>
    </div>
  </div>

  <div v-else class="plugin-shell">
    <button v-if="isZtoolsMocked" class="plugin-back" @click="exitFeature">返回功能列表</button>
    <Hello v-if="route === 'hello'" :enter-action="enterAction" />
    <Read v-if="route === 'read'" :enter-action="enterAction" />
    <Write v-if="route === 'write'" :enter-action="enterAction" />
    <Random v-if="route === 'random'" :enter-action="enterAction" />
    <RandomString v-if="route === 'randomstring'" :enter-action="enterAction" />
    <Xml v-if="route === 'xml'" :enter-action="enterAction" />
  </div>
</template>

<style scoped>
.plugin-shell {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}

.plugin-shell > :last-child {
  flex: 1;
  min-height: 0;
}

.plugin-home,
.plugin-error {
  padding: 24px;
  box-sizing: border-box;
}

.plugin-home h2,
.plugin-error h2 {
  margin: 0 0 8px;
  font-size: 18px;
}

.plugin-home p,
.plugin-error p {
  margin: 0 0 20px;
  font-size: 13px;
  opacity: 0.75;
}

.plugin-error p {
  color: #e74c3c;
  opacity: 1;
}

.plugin-home__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
}

.plugin-home__actions button {
  padding: 0 16px;
  border-radius: 4px;
}

.plugin-back {
  margin: 12px 20px 0;
  padding: 0 12px;
  border-radius: 4px;
  font-size: 12px;
  line-height: 2;
  flex-shrink: 0;
}
</style>
