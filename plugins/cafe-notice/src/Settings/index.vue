<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

const cfg = ref<Record<string, string>>({})
const apps = ref<any[]>([])
const displays = ref<{ id: string; label: string; primary: boolean }[]>([])
const speed = ref(140)
const dmOpacity = ref(0.78)
const listOpacity = ref(0.92)
const sending = ref(false)
const appPage = ref(1)
const APP_PAGE_SIZE = 10
const pagedApps = computed(() => apps.value.slice((appPage.value - 1) * APP_PAGE_SIZE, appPage.value * APP_PAGE_SIZE))

const EMOJIS = ['🔔', '📣', '🎉', '✅', '❌', '⭐', '🔥', '💬', '📌', '🚀', '🎵', '☕', '🌙', '❤️', '⚠️', '🧩']
async function load() {
  cfg.value = window.services.notice.getConfig()
  speed.value = Number(cfg.value.dmSpeed) || 140
  dmOpacity.value = Number(cfg.value.dmOpacity) || 0.78
  listOpacity.value = Number(cfg.value.listOpacity) || 0.92
  displays.value = window.services.notice.getDisplays()
  apps.value = await window.services.notice.getApps()
}

function patch(p: Record<string, string | number>) {
  window.services.notice.setConfig(p)
  cfg.value = window.services.notice.getConfig()
}

function num(key: string, v: any) {
  patch({ [key]: Number(v) })
}

function saveApp(row: any, p: Record<string, any>) {
  window.services.notice.setAppConfig(row.aumid, p)
}

function toggleBanner(row: any, on: boolean) {
  row.suppressBanner = on
  window.services.notice.setSuppressBanner(row.aumid, on)
}

function clearAll() {
  window.services.notice.clearHistory()
  load()
}

async function testNotify() {
  sending.value = true
  try {
    await window.services.notice.sendTestNotification()
  } finally {
    sending.value = false
  }
}

onMounted(load)
</script>

<template>
  <div class="page">
    <div class="bar">
      <el-button size="small" type="primary" plain :loading="sending" @click="testNotify">发一条测试通知</el-button>
    </div>

    <div class="cols">
      <section>
        <h3>通用</h3>
        <el-form label-width="96px" size="small">
          <el-form-item label="采集通知">
            <el-switch :model-value="cfg.enabled === '1'" @change="v => patch({ enabled: v ? '1' : '0' })" />
          </el-form-item>
          <el-form-item label="历史条数">
            <el-input-number :model-value="Number(cfg.historyLimit)" :min="50" :max="1000" :step="50" @change="v => num('historyLimit', v)" />
          </el-form-item>
          <el-form-item label="防刷屏合并">
            <el-input-number :model-value="Number(cfg.mergeWindowMs) / 1000" :min="1" :max="60" @change="v => patch({ mergeWindowMs: Number(v) * 1000 })" />
            <span class="unit">秒内超</span>
            <el-input-number :model-value="Number(cfg.mergeAfter)" :min="0" :max="20" @change="v => num('mergeAfter', v)" />
            <span class="unit">条合并</span>
          </el-form-item>
          <el-form-item label="留存天数">
            <el-input-number :model-value="Number(cfg.keepDays)" :min="1" :max="365" @change="v => num('keepDays', v)" />
          </el-form-item>
          <el-form-item label="留存上限">
            <el-input-number :model-value="Number(cfg.keepMax)" :min="100" :max="50000" :step="500" @change="v => num('keepMax', v)" />
          </el-form-item>
          <el-form-item label="清空历史">
            <el-popconfirm title="删除全部已入库通知？" @confirm="clearAll">
              <template #reference>
                <el-button type="danger" plain>清空</el-button>
              </template>
            </el-popconfirm>
          </el-form-item>
        </el-form>
      </section>

      <section>
        <h3>通知内容</h3>
        <el-form label-width="96px" size="small">
          <el-form-item label="显示应用名">
            <el-switch :model-value="cfg.showApp !== '0'" @change="v => patch({ showApp: v ? '1' : '0' })" />
          </el-form-item>
          <el-form-item label="显示时间">
            <el-switch :model-value="cfg.showTime === '1'" @change="v => patch({ showTime: v ? '1' : '0' })" />
          </el-form-item>
          <el-form-item label="弹幕字体色">
            <el-color-picker :model-value="cfg.dmText || undefined" @change="v => patch({ dmText: v || '' })" />
            <span class="unit">留空 = 按底色自动反色</span>
          </el-form-item>
          <el-form-item label="卡片字体色">
            <el-color-picker :model-value="cfg.listText || undefined" @change="v => patch({ listText: v || '' })" />
          </el-form-item>
          <el-form-item label="弹幕边框">
            <el-select :model-value="cfg.dmBorder" style="width: 120px" @change="v => patch({ dmBorder: v })">
              <el-option label="无" value="none" />
              <el-option label="实线" value="solid" />
              <el-option label="虚线" value="dashed" />
            </el-select>
          </el-form-item>
          <el-form-item label="emoji 挂件">
            <el-popover placement="bottom" :width="272" trigger="click">
              <template #reference>
                <el-button size="small">{{ cfg.dmEmoji || '选择表情' }}</el-button>
              </template>
              <div class="emoji-grid">
                <span v-for="e in EMOJIS" :key="e" class="emoji-cell" @click="patch({ dmEmoji: e })">{{ e }}</span>
                <span class="emoji-cell" title="清除" @click="patch({ dmEmoji: '' })">✕</span>
              </div>
              <el-input :model-value="cfg.dmEmoji" maxlength="4" placeholder="或自定义输入" style="margin-top: 8px" @change="v => patch({ dmEmoji: v })" />
            </el-popover>
          </el-form-item>
        </el-form>
      </section>
    </div>

    <div class="cols">
      <section>
        <h3>弹幕</h3>
        <el-form label-width="96px" size="small">
          <el-form-item label="启用">
            <el-switch :model-value="cfg.danmaku === '1'" @change="v => patch({ danmaku: v ? '1' : '0' })" />
          </el-form-item>
          <el-form-item label="速度 px/s">
            <el-slider v-model="speed" :min="40" :max="400" :step="10" style="width: 200px" @change="v => num('dmSpeed', v)" />
          </el-form-item>
          <el-form-item label="方向">
            <el-select :model-value="cfg.dmDirection" style="width: 130px" @change="v => patch({ dmDirection: v })">
              <el-option label="右 → 左" value="rtl" />
              <el-option label="左 → 右" value="ltr" />
            </el-select>
          </el-form-item>
          <el-form-item label="位置">
            <el-select :model-value="cfg.dmPosition" style="width: 130px" @change="v => patch({ dmPosition: v })">
              <el-option label="屏幕上" value="top" />
              <el-option label="屏幕中" value="middle" />
              <el-option label="屏幕下" value="bottom" />
            </el-select>
          </el-form-item>
          <el-form-item label="跨屏">
            <el-select :model-value="cfg.dmSpan" style="width: 180px" @change="v => patch({ dmSpan: v })">
              <el-option label="横跨所有显示器" value="all" />
              <el-option label="仅主显示器" value="primary" />
            </el-select>
          </el-form-item>
          <el-form-item label="轨道数">
            <el-input-number :model-value="Number(cfg.dmLanes)" :min="1" :max="6" @change="v => num('dmLanes', v)" />
          </el-form-item>
          <el-form-item label="字号">
            <el-input-number :model-value="Number(cfg.dmFontSize)" :min="10" :max="24" @change="v => num('dmFontSize', v)" />
          </el-form-item>
          <el-form-item label="底色 / 透明">
            <el-color-picker :model-value="cfg.dmBg" @change="v => patch({ dmBg: v || '#14161c' })" />
            <el-slider v-model="dmOpacity" :min="0.2" :max="1" :step="0.05" style="width: 140px; margin-left: 12px" @change="v => num('dmOpacity', v)" />
          </el-form-item>
        </el-form>
      </section>

      <section>
        <h3>卡片</h3>
        <el-form label-width="96px" size="small">
          <el-form-item label="启用">
            <el-switch :model-value="cfg.list === '1'" @change="v => patch({ list: v ? '1' : '0' })" />
          </el-form-item>
          <el-form-item label="显示器">
            <el-select :model-value="cfg.listDisplay" style="width: 220px" @change="v => patch({ listDisplay: v })">
              <el-option label="主显示器" value="primary" />
              <el-option v-for="d in displays" :key="d.id" :label="d.label" :value="d.id" />
            </el-select>
          </el-form-item>
          <el-form-item label="角落">
            <el-select :model-value="cfg.listCorner" style="width: 130px" @change="v => patch({ listCorner: v })">
              <el-option label="右上" value="tr" />
              <el-option label="左上" value="tl" />
              <el-option label="右下" value="br" />
              <el-option label="左下" value="bl" />
            </el-select>
          </el-form-item>
          <el-form-item label="停留 ms">
            <el-input-number :model-value="Number(cfg.stayMs)" :min="1000" :max="20000" :step="500" @change="v => num('stayMs', v)" />
          </el-form-item>
          <el-form-item label="宽度">
            <el-input-number :model-value="Number(cfg.listWidth)" :min="280" :max="520" :step="20" @change="v => num('listWidth', v)" />
          </el-form-item>
          <el-form-item label="同时上限">
            <el-input-number :model-value="Number(cfg.listMax)" :min="1" :max="8" @change="v => num('listMax', v)" />
            <span class="unit">超出排队等位</span>
          </el-form-item>
          <el-form-item label="底色 / 透明">
            <el-color-picker :model-value="cfg.listBg" @change="v => patch({ listBg: v || '#181a20' })" />
            <el-slider v-model="listOpacity" :min="0.2" :max="1" :step="0.05" style="width: 140px; margin-left: 12px" @change="v => num('listOpacity', v)" />
          </el-form-item>
        </el-form>
      </section>
    </div>

    <h3>按应用</h3>
    <el-table :data="pagedApps" size="small" max-height="360">
      <el-table-column label="显示名" min-width="140">
        <template #default="{ row }">
          <el-input v-model="row.name" size="small" placeholder="显示名" @change="v => saveApp(row, { name: String(v) })" />
        </template>
      </el-table-column>
      <el-table-column label="颜色" width="70">
        <template #default="{ row }">
          <el-color-picker v-model="row.color" size="small" @change="v => saveApp(row, { color: v })" />
        </template>
      </el-table-column>
      <el-table-column label="形态" width="120">
        <template #default="{ row }">
          <el-select v-model="row.mode" size="small" @change="v => saveApp(row, { mode: v })">
            <el-option label="弹幕+卡片" value="both" />
            <el-option label="仅弹幕" value="danmaku" />
            <el-option label="仅卡片" value="list" />
          </el-select>
        </template>
      </el-table-column>
      <el-table-column label="静音" width="70">
        <template #default="{ row }">
          <el-switch v-model="row.muted" size="small" @change="v => saveApp(row, { muted: v })" />
        </template>
      </el-table-column>
      <el-table-column label="接管横幅" width="90">
        <template #default="{ row }">
          <el-switch v-model="row.suppressBanner" size="small" @change="v => toggleBanner(row, !!v)" />
        </template>
      </el-table-column>
      <el-table-column prop="count" label="条数" width="70" />
    </el-table>
    <el-pagination
      v-model:current-page="appPage"
      :page-size="APP_PAGE_SIZE"
      :total="apps.length"
      layout="prev, pager, next"
      small
      style="margin-top: 8px; justify-content: flex-end"
    />
    <p class="tip">
      应用列表 = 系统通知设置里登记过的应用 ∪ 已采集应用。接管横幅 = 关掉该应用原生弹窗（ShowBanner=0），通知仍进通知中心与本插件；关掉开关即恢复。
    </p>
  </div>
</template>

<style scoped>
.page {
  padding: 4px 2px;
}
.bar {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 8px;
}
.unit {
  margin: 0 8px;
  opacity: 0.7;
  font-size: 12px;
}
.emoji-grid {
  display: grid;
  grid-template-columns: repeat(8, 1fr);
  gap: 4px;
}
.emoji-cell {
  display: grid;
  place-items: center;
  height: 28px;
  border-radius: 6px;
  cursor: pointer;
  font-size: 16px;
}
.emoji-cell:hover {
  background: rgba(127, 127, 127, 0.2);
}
.cols {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0 24px;
  align-items: start;
}
h3 {
  font-size: 14px;
  margin: 12px 0 8px;
}
.tip {
  opacity: 0.6;
  font-size: 12px;
  margin-top: 8px;
}
</style>
