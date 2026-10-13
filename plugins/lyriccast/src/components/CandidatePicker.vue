<script setup lang="ts">
/**
 * 候选面板(任务 3.1"歌词不对?换一个"):
 * - 顶部"正在播放"参考条:当前曲目的歌名/歌手/时长,选词对照用;
 * - 列出各来源的候选(标题/歌手/专辑/时长/来源徽标 + 时间轴/翻译/纯文本标记);
 * - 当前已固定的候选高亮并带"当前"徽标(按 source+id 匹配,历史固定/无 id 候选无从
 *   匹配则不标);
 * - 点击立即固定展示并写入缓存(userPinned,优先于自动匹配);
 * - 底部"恢复自动匹配"清除固定;关闭面板即取消在途候选请求。
 * 覆盖层渲染在主页舞台之上(App.vue),深色玻璃拟态与主界面一致。
 */
import { computed } from 'vue'
import { candidatePicker, chooseCandidate, closeCandidatePicker, unpinCurrent, nowPlayingInfo } from '../store'
import { lyric } from '../store'
import type { PickerCandidate } from '../lyric/types'

function formatDuration(ms?: number): string {
  if (!ms || ms <= 0) return '--:--'
  const total = Math.round(ms / 1000)
  const minutes = Math.floor(total / 60)
  const seconds = total % 60
  return `${minutes}:${seconds.toString().padStart(2, '0')}`
}

const showRestore = computed(() => lyric.pinned)

/** 该候选是否为当前已固定项(source+id 双重匹配;无 id 的候选无法标识) */
function isCurrent(item: PickerCandidate): boolean {
  const cur = candidatePicker.current
  return !!cur && !!item.id && item.source === cur.source && item.id === cur.id
}
</script>

<template>
  <Teleport to="body">
    <transition name="fade">
      <div v-if="candidatePicker.open" class="overlay" @click.self="closeCandidatePicker">
        <section class="panel" role="dialog" aria-label="候选歌词">
          <header class="head">
            <div>
              <h3 class="title">换一个候选</h3>
              <p class="sub">选择后立即生效并记住(不再自动更换)</p>
            </div>
            <button class="close" aria-label="关闭" @click="closeCandidatePicker">×</button>
          </header>

          <div v-if="nowPlayingInfo" class="now-playing">
            <span class="np-label">正在播放</span>
            <span class="np-main">
              <span class="np-title" :title="nowPlayingInfo.title">{{ nowPlayingInfo.title }}</span>
              <span class="np-sub" :title="nowPlayingInfo.artist">{{ nowPlayingInfo.artist }}</span>
            </span>
            <span class="np-dur mono">{{ formatDuration(nowPlayingInfo.durationMs) }}</span>
          </div>

          <div class="list">
            <div v-if="candidatePicker.loading" class="placeholder">
              <span class="pulse">候选搜索中<i>…</i></span>
            </div>
            <div v-else-if="candidatePicker.error" class="placeholder">{{ candidatePicker.error }}</div>
            <template v-else>
              <button
                v-for="(item, index) in candidatePicker.items"
                :key="`${item.source}-${item.id ?? index}`"
                class="candidate"
                :class="{ active: isCurrent(item) }"
                :disabled="candidatePicker.loading"
                @click="chooseCandidate(item)"
              >
                <span class="c-main">
                  <span class="c-title">{{ item.title }}</span>
                  <span class="c-sub">
                    {{ item.artist }}<template v-if="item.album"> · {{ item.album }}</template>
                  </span>
                </span>
                <span class="c-side">
                  <span class="c-badges">
                    <span v-if="isCurrent(item)" class="tag current">当前</span>
                    <span class="tag source">{{ item.source }}</span>
                    <span v-if="item.synced" class="tag">时间轴</span>
                    <span v-else-if="item.plain" class="tag">纯文本</span>
                    <span v-if="item.translation" class="tag">翻译</span>
                  </span>
                  <span class="c-dur mono">{{ formatDuration(item.durationMs) }}</span>
                </span>
              </button>
            </template>
          </div>

          <footer class="foot">
            <button v-if="showRestore" class="ghost" @click="unpinCurrent">恢复自动匹配</button>
            <span v-else class="hint">候选来自已启用的歌词来源</span>
          </footer>
        </section>
      </div>
    </transition>
  </Teleport>
</template>

<style scoped>
.overlay {
  position: fixed;
  inset: 0;
  z-index: 60;
  display: flex;
  align-items: flex-end;
  justify-content: center;
  background: rgba(8, 10, 14, 0.45);
  backdrop-filter: blur(6px);
}

.panel {
  display: flex;
  flex-direction: column;
  width: min(560px, calc(100vw - 24px));
  max-height: 72vh;
  margin: 12px;
  border-radius: 16px;
  background: rgba(28, 30, 38, 0.92);
  border: 1px solid rgba(255, 255, 255, 0.12);
  box-shadow: 0 18px 60px rgba(0, 0, 0, 0.55);
  overflow: hidden;
}

.head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
  padding: 14px 16px 10px;
}

.title {
  margin: 0;
  font-size: 15px;
  font-weight: 700;
  color: #fff;
}

.sub {
  margin: 3px 0 0;
  font-size: 11px;
  color: rgba(255, 255, 255, 0.45);
}

.close {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  padding: 0;
  border: none;
  background: rgba(255, 255, 255, 0.08);
  color: rgba(255, 255, 255, 0.7);
  width: 26px;
  height: 26px;
  border-radius: 8px;
  font-size: 15px;
  line-height: 1;
  cursor: pointer;
}

.close:hover {
  background: rgba(255, 255, 255, 0.16);
  color: #fff;
}

.now-playing {
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 0 16px 8px;
  padding: 7px 10px;
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.08);
}

.np-label {
  flex-shrink: 0;
  font-size: 10px;
  padding: 1px 7px;
  border-radius: 999px;
  border: 1px dashed rgba(150, 190, 255, 0.4);
  color: rgba(150, 190, 255, 0.75);
}

.np-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.np-title {
  font-size: 12px;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.88);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.np-sub {
  font-size: 11px;
  color: rgba(255, 255, 255, 0.45);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.np-dur {
  flex-shrink: 0;
  font-size: 11px;
  color: rgba(255, 255, 255, 0.45);
}

.list {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 2px 8px 8px;
}

.candidate {
  display: flex;
  width: 100%;
  align-items: center;
  gap: 10px;
  padding: 9px 10px;
  border: none;
  border-radius: 10px;
  background: transparent;
  color: inherit;
  text-align: left;
  cursor: pointer;
}

.candidate:hover {
  background: rgba(255, 255, 255, 0.08);
}

/* 当前固定项:淡蓝底 + 左侧描边;写在 hover 之后,悬停时不被通用底色覆盖 */
.candidate.active,
.candidate.active:hover {
  background: rgba(96, 165, 250, 0.12);
  box-shadow: inset 2px 0 0 rgba(96, 165, 250, 0.7);
}

.candidate:disabled {
  opacity: 0.55;
  cursor: default;
}

.c-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.c-title {
  font-size: 13px;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.92);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.c-sub {
  font-size: 11px;
  color: rgba(255, 255, 255, 0.5);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.c-side {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 4px;
  flex-shrink: 0;
}

.c-badges {
  display: flex;
  gap: 4px;
}

.tag {
  font-size: 10px;
  padding: 1px 7px;
  border-radius: 999px;
  border: 1px solid rgba(255, 255, 255, 0.16);
  color: rgba(255, 255, 255, 0.6);
  white-space: nowrap;
}

.tag.source {
  border-style: dashed;
  color: rgba(150, 190, 255, 0.75);
}

.tag.current {
  border-color: rgba(96, 165, 250, 0.5);
  background: rgba(96, 165, 250, 0.14);
  color: rgba(150, 190, 255, 0.95);
}

.c-dur {
  font-size: 11px;
  color: rgba(255, 255, 255, 0.45);
}

.placeholder {
  padding: 32px 0;
  text-align: center;
  font-size: 12px;
  color: rgba(255, 255, 255, 0.45);
}

.pulse i {
  font-style: normal;
  animation: blink 1.2s infinite;
}

@keyframes blink {
  0%, 100% { opacity: 0.2; }
  50% { opacity: 1; }
}

.foot {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 10px 16px 12px;
  border-top: 1px solid rgba(255, 255, 255, 0.08);
}

.ghost {
  border: 1px solid rgba(255, 255, 255, 0.18);
  background: transparent;
  color: rgba(255, 255, 255, 0.7);
  padding: 5px 14px;
  border-radius: 999px;
  font-size: 12px;
  cursor: pointer;
}

.ghost:hover {
  color: #fff;
  border-color: rgba(255, 255, 255, 0.36);
}

.hint {
  font-size: 11px;
  color: rgba(255, 255, 255, 0.35);
}

.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.2s;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}

.mono {
  font-family: ui-monospace, Consolas, monospace;
}
</style>
