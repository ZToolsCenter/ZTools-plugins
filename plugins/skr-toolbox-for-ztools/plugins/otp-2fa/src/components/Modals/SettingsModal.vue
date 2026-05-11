<script setup lang="ts">
import { PINYIN_SCHEMES } from '../../utils/pinyin'

const props = defineProps<{
  show: boolean,
  config: any,
  showSelectMenu: boolean,
  showNextSelectMenu: boolean,
  showPinyinSelectMenu: boolean
}>()

const emits = defineEmits([
  'update:show', 'update:showSelectMenu', 'update:showNextSelectMenu',
  'update:showPinyinSelectMenu',
  'save-config', 'reset-database', 'export-data', 'import-data', 'change-password'
])

const currentPinyinLabel = () =>
  PINYIN_SCHEMES.find(s => s.value === props.config.pinyinScheme)?.label ?? '全拼'
</script>

<template>
  <transition name="modal-fade">
    <div class="modal-overlay" v-if="show" @click.self="emits('update:show', false)">
      <div class="modal-content">
        <h3 class="modal-title">插件设置</h3>
        
        <div class="settings-item">
          <span class="settings-label">时间指示器样式</span>
          <div class="settings-select" :class="{ open: showSelectMenu }" @click.stop="emits('update:showSelectMenu', !showSelectMenu)">
            <span>{{ config.timerStyle === 'circle' ? '环形' : '条形' }}</span>
            <svg class="arrow" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"
              stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="6 9 12 15 18 9"></polyline>
            </svg>
            <div class="select-menu up" v-if="showSelectMenu">
              <div class="select-item" :class="{ active: config.timerStyle === 'circle' }"
                @click.stop="config.timerStyle = 'circle'; emits('save-config'); emits('update:showSelectMenu', false)">
                <span>环形</span>
                <svg v-if="config.timerStyle === 'circle'" width="12" height="12" viewBox="0 0 24 24" fill="none"
                  stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
                  <polyline points="20 6 9 17 4 12"></polyline>
                </svg>
              </div>
              <div class="select-item" :class="{ active: config.timerStyle === 'bar' }"
                @click.stop="config.timerStyle = 'bar'; emits('save-config'); emits('update:showSelectMenu', false)">
                <span>条形</span>
                <svg v-if="config.timerStyle === 'bar'" width="12" height="12" viewBox="0 0 24 24" fill="none"
                  stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
                  <polyline points="20 6 9 17 4 12"></polyline>
                </svg>
              </div>
            </div>
          </div>
        </div>

        <div class="settings-item">
          <span class="settings-label">下一个验证码预览</span>
          <div class="settings-select" :class="{ open: showNextSelectMenu }"
            @click.stop="emits('update:showNextSelectMenu', !showNextSelectMenu)">
            <span>{{ config.nextPreview ? '开启' : '关闭' }}</span>
            <svg class="arrow" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"
              stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="6 9 12 15 18 9"></polyline>
            </svg>
            <div class="select-menu up" v-if="showNextSelectMenu">
              <div class="select-item" :class="{ active: config.nextPreview }"
                @click.stop="config.nextPreview = true; emits('save-config'); emits('update:showNextSelectMenu', false)">
                <span>开启</span>
                <svg v-if="config.nextPreview" width="12" height="12" viewBox="0 0 24 24" fill="none"
                  stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
                  <polyline points="20 6 9 17 4 12"></polyline>
                </svg>
              </div>
              <div class="select-item" :class="{ active: !config.nextPreview }"
                @click.stop="config.nextPreview = false; emits('save-config'); emits('update:showNextSelectMenu', false)">
                <span>关闭</span>
                <svg v-if="!config.nextPreview" width="12" height="12" viewBox="0 0 24 24" fill="none"
                  stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
                  <polyline points="20 6 9 17 4 12"></polyline>
                </svg>
              </div>
            </div>
          </div>
        </div>

        <div class="settings-item">
          <span class="settings-label">搜索拼音方案</span>
          <div class="settings-select" :class="{ open: showPinyinSelectMenu }"
            @click.stop="emits('update:showPinyinSelectMenu', !showPinyinSelectMenu)">
            <span>{{ currentPinyinLabel() }}</span>
            <svg class="arrow" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"
              stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="6 9 12 15 18 9"></polyline>
            </svg>
            <div class="select-menu up" v-if="showPinyinSelectMenu">
              <div v-for="scheme in PINYIN_SCHEMES" :key="scheme.value"
                class="select-item" :class="{ active: config.pinyinScheme === scheme.value }"
                @click.stop="config.pinyinScheme = scheme.value; emits('save-config'); emits('update:showPinyinSelectMenu', false)">
                <span>{{ scheme.label }}</span>
                <svg v-if="config.pinyinScheme === scheme.value" width="12" height="12" viewBox="0 0 24 24" fill="none"
                  stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
                  <polyline points="20 6 9 17 4 12"></polyline>
                </svg>
              </div>
            </div>
          </div>
        </div>

        <div class="settings-item btn-grid">
          <button class="btn setting-btn-align" @click="emits('export-data')">导出数据</button>
          <span></span>
          <button class="btn setting-btn-align btn-change-pwd" @click="emits('change-password')">修改主密码</button>
        </div>

        <div class="settings-item btn-grid">
          <button class="btn setting-btn-align" @click="emits('import-data')">导入数据</button>
          <span></span>
          <button class="btn btn-danger setting-btn-align" @click="emits('reset-database')">重置数据</button>
        </div>

        <div class="modal-actions">
          <button class="btn" @click="emits('update:show', false)">完成</button>
        </div>
      </div>
    </div>
  </transition>
</template>

<style scoped>
.btn-grid {
  display: grid;
  grid-template-columns: 120px 1fr 120px;
  gap: 10px;
  justify-content: flex-end;
}

.btn-change-pwd {
  background: #7c3aed;
  color: #ffffff !important;
  border: none;
}

.btn-change-pwd:hover {
  background: #6d28d9;
}
</style>
