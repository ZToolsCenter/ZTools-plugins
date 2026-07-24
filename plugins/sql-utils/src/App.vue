<template>
  <n-config-provider
    :theme="isDark ? darkTheme : null"
    :theme-overrides="themeOverrides"
    :locale="zhCN"
    :date-locale="dateZhCN"
  >
    <n-global-style />
    <n-notification-provider>
      <n-message-provider>
        <div id="main">
          <div class="main-top">
            <n-tabs
              ref="tabsRef"
              v-model:value="activeName"
              type="line"
              @update:value="handleTabChange"
            >
              <n-tab name="textJoint">
                <i class="ali-icon-txt"/> 文本拼接
              </n-tab>
              <n-tab name="excelToSql">
                <i class="ali-icon-excel"/> Excel转SQL
              </n-tab>
              <n-tab name="generateTestData">
                <i class="ali-icon-shujuxiang"/> 生成测试数据
              </n-tab>
              <n-tab name="codeGenerator">
                <i class="ali-icon-daima"/> 代码生成
              </n-tab>
            </n-tabs>
            <div class="toggle-theme-button">
              <ThemeSwitch/>
            </div>
          </div>

          <div class="main-bottom">
            <router-view v-slot="{ Component }">
              <transition name="fade" mode="out-in">
                <component :is="Component"/>
              </transition>
            </router-view>
          </div>
        </div>
      </n-message-provider>
    </n-notification-provider>
  </n-config-provider>
</template>

<script setup>
import { computed, ref, watch, onMounted, nextTick } from 'vue'
import { useRouter } from 'vue-router'
import { darkTheme, dateZhCN, zhCN } from 'naive-ui'
import { useAppStore } from '@/store'
import ThemeSwitch from '@/components/ThemeSwitch.vue'

const router = useRouter()
const store = useAppStore()
const activeName = ref(router.currentRoute.value.name || 'textJoint')
const isDark = ref(false)

const baseThemeOverrides = {
  common: {
    fontFamily: 'ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif',
    fontFamilyMono: '"JetBrains Mono", "Cascadia Code", "SFMono-Regular", Consolas, monospace',
    fontSize: '13px',
    fontSizeSmall: '12px',
    fontSizeMedium: '13px',
    fontSizeLarge: '14px',
    fontSizeHuge: '15px',
    lineHeight: '1.45',
    heightSmall: '26px',
    heightMedium: '30px',
    heightLarge: '34px',
    borderRadius: '5px'
  },
  Button: {
    fontWeight: '500',
    paddingSmall: '0 10px'
  },
  DataTable: {
    fontSizeSmall: '12px',
    fontSizeMedium: '13px',
    thFontWeight: '600'
  },
  Input: {
    fontSizeSmall: '12px',
    fontSizeMedium: '13px'
  },
  Select: {
    peers: {
      InternalSelection: {
        fontSizeSmall: '12px',
        fontSizeMedium: '13px',
        heightSmall: '26px',
        heightMedium: '30px'
      }
    }
  },
  Tabs: {
    tabFontSizeSmall: '12px',
    tabFontSizeMedium: '13px',
    tabFontWeightActive: '600'
  },
  Card: {
    titleFontSizeSmall: '13px',
    fontSizeSmall: '12px',
    paddingSmall: '10px 12px'
  }
}

const lightThemeColors = {
  primaryColor: '#2080f0',
  primaryColorHover: '#4098fc',
  primaryColorPressed: '#1060c9',
  primaryColorSuppl: '#4098fc',
  infoColor: '#2080f0',
  infoColorHover: '#4098fc',
  infoColorPressed: '#1060c9',
  bodyColor: '#f6f7f9',
  cardColor: '#ffffff',
  modalColor: '#ffffff',
  popoverColor: '#ffffff',
  tableHeaderColor: '#f3f5f8',
  actionColor: '#f4f6f8',
  borderColor: '#d8dee8',
  dividerColor: '#e7ebf1',
  textColor1: '#172033',
  textColor2: '#334155',
  textColor3: '#64748b'
}

const darkThemeColors = {
  primaryColor: '#70c0e8',
  primaryColorHover: '#8acbec',
  primaryColorPressed: '#5aa6cf',
  primaryColorSuppl: '#8acbec',
  infoColor: '#70c0e8',
  infoColorHover: '#8acbec',
  infoColorPressed: '#5aa6cf',
  bodyColor: '#101418',
  cardColor: '#171c22',
  modalColor: '#171c22',
  popoverColor: '#1d232b',
  tableHeaderColor: '#202731',
  actionColor: '#202731',
  borderColor: '#303946',
  dividerColor: '#252d38',
  textColor1: '#f3f6fb',
  textColor2: '#d7dde8',
  textColor3: '#98a4b5'
}

const themeOverrides = computed(() => ({
  ...baseThemeOverrides,
  common: {
    ...baseThemeOverrides.common,
    ...(isDark.value ? darkThemeColors : lightThemeColors)
  }
}))

function handlePluginEnter(action) {
  if (action.type === 'regex') {
    activeName.value = 'textJoint'
    router.push('textJoint')
    nextTick(() => {
      window.dispatchEvent(new CustomEvent('set-regex-payload', { detail: action.payload }))
    })
  }
}

function handleTabChange(name) {
  router.push(name)
}

onMounted(() => {
  if (window.ztools) {
    window.ztools.onPluginEnter((action) => handlePluginEnter(action))
    window.ztools.onPluginOut(() => {})
  }
  if (navigator.userAgent.includes('uTools')) {
    utools.onPluginEnter(({ code, type, payload, option, from }) => {
      console.log("用户进入插件应用", code, type, payload);
      if (type === 'regex') {
        activeName.value = 'textJoint'
        router.push('textJoint')
        nextTick(() => {
          window.dispatchEvent(new CustomEvent('set-regex-payload', { detail: payload }))
        })
      }
    });
  }
})

watch(() => router.currentRoute.value.name, (name) => {
  if (name) activeName.value = name
})

store.$subscribe((mutation, state) => {
  isDark.value = state.isDarkTheme
})

isDark.value = store.isDarkTheme

watch(isDark, (dark) => {
  document.body.classList.toggle('dark', dark)
}, { immediate: true })
</script>

<style>
html, body {
  height: 100%;
  overflow: hidden;
  margin: 0;
  font-size: 13px;
  line-height: 1.45;
  background: var(--app-body-bg);
  color: var(--app-text-color);
  text-rendering: optimizeLegibility;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}

:root {
  --app-body-bg: #f6f7f9;
  --app-top-bg: linear-gradient(180deg, rgba(255, 255, 255, 0.92), rgba(248, 250, 252, 0.92));
  --app-panel-bg: #f6f7f9;
  --app-border-color: #e7ebf1;
  --app-text-color: #334155;
}

body.dark {
  --app-body-bg: #101418;
  --app-top-bg: linear-gradient(180deg, rgba(23, 28, 34, 0.96), rgba(17, 22, 28, 0.96));
  --app-panel-bg: #101418;
  --app-border-color: #252d38;
  --app-text-color: #d7dde8;
}

*, *::before, *::after {
  box-sizing: border-box;
}

#main {
  height: 100vh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.main-top {
  flex-shrink: 0;
  padding: 8px 12px 6px;
  background: var(--app-top-bg);
  border-bottom: 1px solid var(--app-border-color);
}

.main-bottom {
  flex: 1;
  min-height: 0;
  overflow: hidden;
  display: flex;
  padding: 10px 12px 12px;
  border-radius: 0 0 6px 6px;
  background: var(--app-panel-bg);
}

.toggle-theme-button {
  position: absolute;
  top: 12px;
  right: 20px;
}
</style>
