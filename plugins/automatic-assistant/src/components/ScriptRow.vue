<script setup lang="ts">
import { nextTick, ref } from 'vue'
import type { Cmd, Feature } from '../types'
import { CMD_TYPE_TIPS, platformName } from '../types'
import { cmdTypeIcon } from '../icons'
import { showMessage } from '../message'
import { hasZtools } from '../store'
import Icon from './Icon.vue'

const props = defineProps<{
  feature: Feature
  enabled: boolean
  custom: boolean
  // 可移动到的其它分类（仅自定义脚本）
  otherCategories?: { _id: string; label: string }[]
}>()
const emit = defineEmits<{
  (e: 'toggle', value: boolean): void
  (e: 'edit'): void
  (e: 'remove'): void
  (e: 'copy'): void
  (e: 'view'): void
  (e: 'move', categoryId: string): void
}>()

const menuOpen = ref(false)
const moveOpen = ref(false)
const menuEl = ref<HTMLElement>()
const btnEl = ref<HTMLElement>()
// 与 MUI Popover 一致：菜单以按钮左缘为锚点向右展开，但保留 16px 视口边距
const menuLeft = ref(0)

async function toggleMenu() {
  menuOpen.value = !menuOpen.value
  moveOpen.value = false
  if (!menuOpen.value) return
  menuLeft.value = 0
  await nextTick()
  const menu = menuEl.value
  const btn = btnEl.value
  if (!menu || !btn) return
  const btnLeft = btn.getBoundingClientRect().left
  const width = menu.offsetWidth
  const max = window.innerWidth - 16 - width
  menuLeft.value = btnLeft > max ? max - btnLeft : 0
}

const cmdText = (cmd: Cmd) => (typeof cmd === 'string' ? cmd : cmd.label)
const platforms = () => props.feature.platform || ['win32', 'darwin', 'linux']

// 点击指令：与原版分支逻辑完全一致
function clickCmd(cmd: Cmd) {
  if (!props.enabled) return showMessage('未启用！', 'warning')
  const current = hasZtools() ? window.platform || 'win32' : 'win32'
  if (!platforms().includes(current)) {
    return showMessage('无法在 ' + platformName(current) + ' 平台运行', 'error')
  }
  if (typeof cmd === 'string') {
    if (hasZtools()) (window.ztools.redirect as unknown as (l: string[]) => void)(['自动化助手', cmd])
    return
  }
  showMessage(CMD_TYPE_TIPS[cmd.type] || '', 'info')
}

function pick(action: 'edit' | 'remove' | 'copy' | 'view') {
  menuOpen.value = false
  if (action === 'edit') emit('edit')
  else if (action === 'remove') emit('remove')
  else if (action === 'view') emit('view')
  else emit('copy')
}

function pickMove(categoryId: string) {
  menuOpen.value = false
  moveOpen.value = false
  emit('move', categoryId)
}
</script>

<template>
  <li class="script-item">
    <div class="script-item-avatar">
      <img :src="feature.icon || 'logo.png'" draggable="false" alt="" />
    </div>
    <div class="script-item-text">
      <div class="script-item-cmd">
        <div
          class="chip"
          :class="[typeof cmd === 'string' ? 'filled' : 'outlined', { on: enabled }]"
          v-for="(cmd, i) in feature.cmds"
          :key="i"
          @click="clickCmd(cmd)"
        >
          <Icon v-if="typeof cmd !== 'string' && cmdTypeIcon(cmd.type)" :paths="cmdTypeIcon(cmd.type)!" />
          <span class="chip-label">{{ cmdText(cmd) }}</span>
        </div>
      </div>
      <div class="script-item-info">
        <span class="script-item-platform">
          <img
            v-for="p in platforms()"
            :key="p"
            :src="'res/' + p + '.png'"
            :alt="p"
            :title="'可在 ' + platformName(p) + ' 平台运行'"
            draggable="false"
          />
        </span>
        <span class="script-item-explain" :title="feature.explain">{{ feature.explain }}</span>
      </div>
    </div>
    <span class="script-item-more">
      <button ref="btnEl" class="icon-btn" @click="toggleMenu">
        <Icon name="moreHoriz" />
      </button>
      <template v-if="menuOpen">
        <div class="mask" @click="menuOpen = false; moveOpen = false"></div>
        <div ref="menuEl" class="menu-pop" :style="{ left: menuLeft + 'px' }">
          <div v-if="custom" @click="pick('edit')"><Icon name="edit" />编辑</div>
          <div v-if="custom" @click="pick('remove')"><Icon name="delete" />删除</div>
          <div v-if="!custom" @click="pick('view')"><Icon name="viewScript" />查看脚本</div>
          <div v-if="custom" class="menu-divider"></div>
          <div @click="pick('copy')"><Icon name="copyCreate" />拷贝创建</div>
          <template v-if="custom && otherCategories && otherCategories.length">
            <div class="menu-divider"></div>
            <div class="has-sub" @mouseenter="moveOpen = true" @mouseleave="moveOpen = false">
              <Icon name="moveCategory" />
              <span class="sub-label">移动到分类</span>
              <div v-if="moveOpen" class="menu-pop sub-menu">
                <div v-for="c in otherCategories" :key="c._id" @click="pickMove(c._id)">{{ c.label }}</div>
              </div>
            </div>
          </template>
        </div>
      </template>
    </span>
    <label class="script-item-switch">
      <span class="mui-switch" :class="{ on: enabled }">
        <input type="checkbox" :checked="enabled" @change="emit('toggle', ($event.target as HTMLInputElement).checked)" />
        <span class="track"></span>
        <span class="thumb"></span>
      </span>
      启用
    </label>
  </li>
</template>

<style scoped>
.script-item {
  display: flex;
  align-items: center;
  padding: 8px 16px;
  list-style: none;
}

/* 指令 chip 可点击；配色/边框按变体在全局 .chip.filled/.outlined 定义 */
.script-item-cmd .chip {
  cursor: pointer;
}

.script-item-cmd .chip:active {
  box-shadow: 0 2px 1px -1px rgba(0, 0, 0, 0.2), 0 1px 1px 0 rgba(0, 0, 0, 0.14),
    0 1px 3px 0 rgba(0, 0, 0, 0.12);
}

.script-item-avatar {
  flex-shrink: 0;
  min-width: 56px;
}

.script-item-avatar img {
  width: 40px;
  height: 40px;
  border-radius: 0;
  display: block;
}

.script-item-text {
  flex: 1;
  min-width: 0;
  margin: 6px 0;
}

.script-item-cmd {
  display: flex;
  flex-wrap: wrap;
}

.script-item-cmd > div {
  margin: 0 6px 2px 0;
}

.script-item-info {
  margin-top: 6px;
  display: flex;
  align-items: center;
  font-size: 14px;
  line-height: 20.02px;
  color: #000;
}

.script-item-platform {
  display: flex;
  align-items: center;
  border-right: 1px solid var(--divider);
  padding-right: 4px;
  margin-right: 8px;
}

.script-item-platform img {
  width: 14px;
  filter: grayscale(1);
  margin-right: 4px;
}

.script-item-platform img:hover {
  filter: none;
}

.script-item-explain {
  flex: 1;
  line-height: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.script-item-more {
  position: relative;
  margin: 0 8px;
}

.script-item-more .menu-pop {
  top: 40px;
}

.menu-divider {
  height: 1px;
  background: var(--divider);
  margin: 8px 0;
}

.has-sub {
  position: relative;
  display: flex;
  align-items: center;
}

.has-sub .sub-label {
  flex: 1;
}

.has-sub .arrow {
  color: var(--text-secondary);
}

.sub-menu {
  left: auto;
  right: 100%;
  top: -8px;
  box-shadow: 0 2px 4px -1px rgba(0, 0, 0, 0.2), 0 4px 5px 0 rgba(0, 0, 0, 0.14),
    0 1px 10px 0 rgba(0, 0, 0, 0.12);
}

.script-item-switch {
  display: flex;
  align-items: center;
  white-space: nowrap;
  font-size: 16px;
  line-height: 24px;
  margin: 0 0 0 -11px;
  cursor: pointer;
}
</style>
