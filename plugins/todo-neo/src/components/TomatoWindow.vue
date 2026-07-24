<script setup lang="ts">
import alarmClockIcon from '../assets/icons/alarm-clock.svg'
import minusIcon from '../assets/icons/minus.svg'
import pauseIcon from '../assets/icons/pause.svg'
import playIcon from '../assets/icons/play.svg'
import plusIcon from '../assets/icons/plus.svg'
import rotateIcon from '../assets/icons/rotate-ccw.svg'
import watchIcon from '../assets/icons/watch.svg'
import xIcon from '../assets/icons/x.svg'
import { useTodoStore } from '../composables/useTodoStore'
import SvgIcon from './SvgIcon.vue'

const store = useTodoStore()
</script>

<template>
  <main class="tomato-window" :class="store.settings.tomatoSkin" :style="{ transform: `scale(${store.settings.tomatoScale})` }">
    <header class="tomato-toolbar">
      <button title="番茄皮肤" @click="store.settings.tomatoSkin = 'tomato'; store.saveSettings()">
        <SvgIcon :src="alarmClockIcon" />
        番茄
      </button>
      <button title="电子表皮肤" @click="store.settings.tomatoSkin = 'EWatch'; store.saveSettings()">
        <SvgIcon :src="watchIcon" />
        电子表
      </button>
      <button class="icon-only" title="关闭" @click="store.closeCurrentWindow">
        <SvgIcon :src="xIcon" />
      </button>
    </header>

    <section v-if="store.settings.tomatoSkin === 'tomato'" class="tomato-card">
      <label class="tomato-title">
        <input v-if="store.currentTomatoTask.value" type="checkbox" :checked="store.currentTomatoTask.value.completed" @change="store.toggleTask(store.currentTomatoTask.value)" />
        <span>{{ store.currentTomatoTask.value?.text || '番茄钟' }}</span>
      </label>
      <div class="timer">{{ store.formatTimer(store.tomatoRemaining.value) }}</div>
      <div class="tomato-graphic" :style="{ '--progress': `${store.tomatoProgress.value * 360}deg` }"></div>
      <div class="tomato-actions">
        <button @click="store.toggleTomato">
          <SvgIcon :src="store.tomatoRunning.value ? pauseIcon : playIcon" />
          {{ store.tomatoRunning.value ? 'Pause' : 'Start' }}
        </button>
        <button @click="store.resetTomato">
          <SvgIcon :src="rotateIcon" />
          Reset
        </button>
      </div>
    </section>

    <section v-else class="watch-card">
      <label class="watch-title">
        <input v-if="store.currentTomatoTask.value" type="checkbox" :checked="store.currentTomatoTask.value.completed" @change="store.toggleTask(store.currentTomatoTask.value)" />
        <span>{{ store.currentTomatoTask.value?.text || 'FOCUS' }}</span>
        <button title="重置" @click="store.resetTomato">
          <SvgIcon :src="rotateIcon" />
        </button>
      </label>
      <div class="watch-segments">
        <span v-for="(active, index) in store.tomatoSegments.value" :key="index" :class="{ active }"></span>
      </div>
      <button class="watch-time" @click="store.toggleTomato">
        <SvgIcon :src="store.tomatoRunning.value ? pauseIcon : playIcon" :size="28" />
        {{ store.formatTimer(store.tomatoRemaining.value) }}
      </button>
    </section>

    <footer class="tomato-settings">
      <button title="减少时长" :disabled="store.tomatoRunning.value" @click="store.updateTomatoMinutes(store.settings.tomatoMinutes - 5)">
        <SvgIcon :src="minusIcon" />
      </button>
      <span>{{ store.settings.tomatoMinutes }} min</span>
      <button title="增加时长" :disabled="store.tomatoRunning.value" @click="store.updateTomatoMinutes(store.settings.tomatoMinutes + 5)">
        <SvgIcon :src="plusIcon" />
      </button>
      <input v-model.number="store.settings.tomatoScale" type="range" min="1" max="2" step="0.05" @input="store.saveSettings" />
    </footer>
  </main>
</template>

<style scoped>
.tomato-window {
  width: 100%;
  height: 100%;
  transform-origin: top left;
  overflow: hidden;
}

.tomato-toolbar {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  z-index: 2;
  display: flex;
  justify-content: flex-end;
  gap: 6px;
  padding: 8px;
  opacity: 0;
  transition: opacity 0.15s;
  -webkit-app-region: drag;
}

.tomato-window:hover .tomato-toolbar {
  opacity: 1;
}

.tomato-toolbar button {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 28px;
  border-radius: 7px;
  padding: 0 8px;
  background: rgba(255, 255, 255, 0.75);
  color: #111827;
  -webkit-app-region: no-drag;
}

.tomato-toolbar button.icon-only {
  width: 28px;
  justify-content: center;
  padding: 0;
}

.tomato-card {
  display: grid;
  justify-items: center;
  align-content: center;
  gap: 18px;
  width: 100%;
  height: 100%;
  padding: 38px 26px 78px;
  border-radius: 18px;
  background: #f5dad1;
  color: #7f1d1d;
}

.tomato-title,
.watch-title {
  display: flex;
  align-items: center;
  max-width: 100%;
  gap: 8px;
}

.tomato-title span,
.watch-title span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.timer {
  font-size: clamp(56px, 16vmax, 96px);
  font-weight: 800;
  line-height: 1;
}

.tomato-graphic {
  --progress: 0deg;
  width: min(34vmax, 145px);
  aspect-ratio: 1;
  border-radius: 50%;
  background:
    radial-gradient(circle at 50% 42%, #f5dad1 0 47%, transparent 48%),
    conic-gradient(#ed7161 var(--progress), rgba(255, 255, 255, 0.72) 0),
    #ef8677;
  box-shadow: inset 0 -14px 0 rgba(127, 29, 29, 0.08);
}

.tomato-actions {
  display: flex;
  gap: 10px;
}

.tomato-actions button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  min-width: 86px;
  min-height: 34px;
  padding: 0 12px;
  border-radius: 7px;
  background: #fff;
  color: #b91c1c;
}

.watch-card {
  display: grid;
  align-content: center;
  gap: 24px;
  height: 100%;
  padding: 38px 24px 84px;
  border-radius: 18px;
  background: #050505;
  color: #7cff70;
  font-family: Consolas, "Courier New", monospace;
}

.watch-title {
  justify-content: space-between;
}

.watch-title button {
  display: inline-grid;
  place-items: center;
  width: 30px;
  height: 30px;
  border-radius: 50%;
  background: #111;
  color: #7cff70;
}

.watch-segments {
  display: grid;
  grid-template-columns: repeat(25, 1fr);
  gap: 4px;
  height: 86px;
}

.watch-segments span {
  border-radius: 999px;
  background: rgba(124, 255, 112, 0.16);
}

.watch-segments span.active {
  background: #7cff70;
  box-shadow: 0 0 14px rgba(124, 255, 112, 0.68);
}

.watch-time {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
  width: 100%;
  background: transparent;
  color: #7cff70;
  font-family: inherit;
  font-size: clamp(56px, 15vmax, 96px);
  line-height: 1;
}

.tomato-settings {
  position: fixed;
  right: 12px;
  bottom: 12px;
  left: 12px;
  display: grid;
  grid-template-columns: auto auto auto minmax(0, 1fr);
  align-items: center;
  gap: 8px;
  padding: 10px;
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.78);
  color: #111827;
}

.tomato-settings button {
  display: inline-grid;
  min-width: 34px;
  min-height: 34px;
  place-items: center;
  padding: 0 12px;
  border-radius: 7px;
  background: var(--primary);
  color: #fff;
}

.tomato-settings input {
  width: 100%;
}
</style>
