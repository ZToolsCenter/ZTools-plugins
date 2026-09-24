<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import type { Cmd, MatchCmd, MatchCmdType, ScriptDoc, WindowMatch } from '../types'
import { CMD_TYPE_NAMES, PLATFORMS } from '../types'
import { showMessage } from '../message'
import { hasZtools } from '../store'
import { cmdTypeIcon } from '../icons'
import CodeEditor from './CodeEditor.vue'
import CmdCard from './CmdCard.vue'
import TextField from './TextField.vue'
import Icon from './Icon.vue'

const props = defineProps<{ doc: ScriptDoc; isNew: boolean; readonly?: boolean }>()
const emit = defineEmits<{
  (e: 'close'): void
  (e: 'save', doc: ScriptDoc): void
}>()

// 编辑副本，点保存才写回
const draft = reactive<ScriptDoc>(JSON.parse(JSON.stringify(props.doc)))
const addMenuOpen = ref(false)

// 每种匹配类型只能添加一次（与原版一致）
const usedTypes = computed(
  () => new Set(draft.feature.cmds.filter((c) => typeof c !== 'string').map((c) => (c as MatchCmd).type))
)
const availableTypes = computed(() =>
  (['keyword', 'over', 'regex', 'files', 'img', 'window'] as const).filter(
    (t) => t === 'keyword' || !usedTypes.value.has(t as MatchCmdType)
  )
)

function togglePlatform(value: string, checked: boolean) {
  const list = draft.feature.platform || ['win32', 'darwin', 'linux']
  const set = new Set(list)
  if (checked) set.add(value)
  else set.delete(value)
  draft.feature.platform = ['win32', 'darwin', 'linux'].filter((p) => set.has(p))
}

const platformChecked = (value: string) =>
  (draft.feature.platform || ['win32', 'darwin', 'linux']).includes(value)

function addCmd(type: 'keyword' | MatchCmdType) {
  addMenuOpen.value = false
  if (type === 'keyword') draft.feature.cmds.push('')
  else draft.feature.cmds.push({ type, label: '' })
}

function updateCmd(index: number, cmd: Cmd) {
  draft.feature.cmds[index] = cmd
}

function removeCmd(index: number) {
  draft.feature.cmds.splice(index, 1)
}

// 与原版一致：只校验 /.../flags 的语法形状，不做编译校验，flag 仅认 gimuy
const isRegex = (value: unknown) => typeof value === 'string' && /^\/.+\/[gimuy]*$/.test(value)

// 校验链与原版逐条一致
function getData(): ScriptDoc | undefined {
  const data: ScriptDoc = JSON.parse(JSON.stringify(draft))
  const f = data.feature
  if (!f.explain.trim()) return showMessage('未配置功能说明', 'error')
  const platform = f.platform || ['win32', 'darwin', 'linux']
  if (platform.length === 0) return showMessage('未配置运行平台', 'error')
  if (platform.length === 3) delete f.platform
  else f.platform = platform
  if (f.cmds.length === 0) return showMessage('未配置运行平台', 'error')
  for (const cmd of f.cmds) {
    if (typeof cmd === 'string') {
      if (!cmd.trim()) return showMessage('未配置功能指令', 'error')
    } else {
      if (!cmd.label.trim()) return showMessage('未配置指令名称', 'error')
      if (cmd.label.length > 60) return showMessage('指令名称字符太长, 不能超过60位', 'error')
      if (cmd.type === 'regex') {
        if (!isRegex(cmd.match)) return showMessage('"文本匹配" 正则错误', 'error')
      } else if (cmd.type === 'over') {
        if (cmd.exclude && !isRegex(cmd.exclude)) return showMessage('"任意文本" 排除正则错误', 'error')
      } else if (cmd.type === 'files') {
        if (cmd.match && !isRegex(cmd.match)) return showMessage('"文件或文件夹" 名称匹配正则错误', 'error')
        if (cmd.fileType === '') delete cmd.fileType
      } else if (cmd.type === 'window') {
        const match = cmd.match as WindowMatch | undefined
        // 原版：app 存在（含纯空白串）即校验 title 并把 app 转数组
        if (match?.app !== undefined && match.app !== null && match.app !== '') {
          if (match.title && !isRegex(match.title)) return showMessage('"应用窗口" 标题匹配正则错误', 'error')
          if (typeof match.app === 'string') match.app = match.app.trim().split(',')
        }
        if (match?.class && typeof match.class === 'string') match.class = match.class.trim().split(',')
        if (match && Object.values(match).join('').trim() === '') delete cmd.match
      }
    }
  }
  return data
}

// 选择图标：与原版一致——选图 → 居中裁剪正方形 → 缩放 72×72 → PNG dataURL
async function selectIcon() {
  if (props.readonly) return
  if (!hasZtools()) return showMessage('当前非 ZTools 环境，无法选择图标', 'error')
  const picked = window.ztools.showOpenDialog({
    filters: [{ name: '选择图标', extensions: ['png', 'jpg', 'jpeg'] }],
    properties: ['openFile']
  })
  if (!picked || !picked.length) return
  const dataUrl = window.services.readImageDataUrl(picked[0])
  if (!dataUrl) return showMessage('图标读取失败', 'error')
  try {
    draft.feature.icon = await cropToSquare(dataUrl)
  } catch {
    showMessage('图标解析失败', 'error')
  }
}

function cropToSquare(src: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      const { width: w, height: h } = img
      const size = Math.min(w, h)
      const sx = w > h ? (w - size) / 2 : 0
      const sy = w > h ? 0 : (h - size) / 2
      const canvas = document.createElement('canvas')
      canvas.width = 72
      canvas.height = 72
      const ctx = canvas.getContext('2d')
      if (!ctx) return reject(new Error('canvas unavailable'))
      ctx.drawImage(img, sx, sy, size, size, 0, 0, 72, 72)
      const out = canvas.toDataURL('image/png')
      canvas.remove()
      resolve(out)
    }
    img.onerror = () => reject(new Error('img load error'))
    img.src = src
  })
}

function handleSave() {
  const data = getData()
  if (data) emit('save', data)
}
</script>

<template>
  <div class="script-editor-body">
    <div class="editor-pane">
      <CodeEditor v-model="draft.script" :readonly="readonly" />
    </div>
    <div class="form-pane">
      <fieldset class="script-feature-form" :disabled="readonly">
        <div class="feature-form-icon">
          <img class="feature-icon" draggable="false" :src="draft.feature.icon || 'logo.png'" alt="" />
          <button class="btn-text pick-icon" :disabled="readonly" @click="selectIcon">选择图标</button>
        </div>
        <div>
          <legend>运行平台</legend>
          <div class="feature-platform-checkbox">
            <label v-for="p in PLATFORMS" :key="p.value">
              <span class="mui-checkbox-root" :class="{ checked: platformChecked(p.value) }">
                <input
                  type="checkbox"
                  :value="p.value"
                  :checked="platformChecked(p.value)"
                  @change="togglePlatform(p.value, ($event.target as HTMLInputElement).checked)"
                />
                <Icon :name="platformChecked(p.value) ? 'checkBox' : 'checkBoxOutline'" />
              </span>
              {{ p.name }}
            </label>
          </div>
        </div>
        <div>
          <label class="feature-mainhide">
            <span class="mui-switch" :class="{ on: draft.feature.mainHide }">
              <input type="checkbox" v-model="draft.feature.mainHide" />
              <span class="track"></span>
              <span class="thumb"></span>
            </span>
            <span>脚本隐藏后台运行</span>
          </label>
        </div>
        <div>
          <TextField label="功能说明" v-model="draft.feature.explain" />
        </div>
        <div>
          <CmdCard
            v-for="(cmd, i) in draft.feature.cmds"
            :key="i"
            :cmd="cmd"
            :readonly="readonly"
            @update="updateCmd(i, $event)"
            @remove="removeCmd(i)"
          />
        </div>
        <div class="feature-add-cmd" v-if="!readonly">
          <button class="btn-text with-icon" @click="addMenuOpen = !addMenuOpen">
            <Icon name="add" />
            新增指令
          </button>
          <template v-if="addMenuOpen">
            <div class="mask" @click="addMenuOpen = false"></div>
            <div class="menu-pop type-menu">
              <div v-for="t in availableTypes" :key="t" @click="addCmd(t)">
                <Icon v-if="cmdTypeIcon(t)" :paths="cmdTypeIcon(t)!" />
                {{ CMD_TYPE_NAMES[t] }}
              </div>
            </div>
          </template>
        </div>
      </fieldset>
      <div class="script-editor-footer">
        <button class="footer-btn close" @click="emit('close')">
          <Icon name="close" />
          关闭
        </button>
        <button v-if="!readonly" class="footer-btn save" @click="handleSave">
          <Icon name="save" />
          {{ isNew ? '创建' : '保存' }}
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.script-editor-body {
  display: flex;
  position: fixed;
  inset: 0;
  z-index: 1100;
  background: var(--bg);
  animation: editor-slide-in 225ms cubic-bezier(0, 0, 0.2, 1);
}

@keyframes editor-slide-in {
  from {
    transform: translateX(100%);
  }
  to {
    transform: translateX(0);
  }
}

.editor-pane {
  width: 63%;
  height: 100%;
  overflow: hidden;
}

.form-pane {
  width: 37%;
  height: 100%;
  display: flex;
  flex-direction: column;
}

.script-feature-form {
  flex: 1;
  overflow: hidden auto;
  background: var(--form-bg);
  padding: 10px 16px;
  border: none;
  min-width: 0;
}

.script-feature-form > div {
  padding-bottom: 12px;
}

.feature-form-icon {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.pick-icon:not(:disabled) {
  color: rgb(2, 136, 209);
}

.pick-icon {
  font-size: 13px;
  padding: 4px 5px;
  min-width: 0;
}

.pick-icon:hover {
  background: rgba(2, 136, 209, 0.04);
}

.feature-form-icon img {
  width: 42px;
  height: 42px;
}

legend {
  font-size: 16px;
  line-height: 23px;
  letter-spacing: 0.15px;
  color: var(--text-secondary);
}

.feature-platform-checkbox {
  display: flex;
}

.feature-platform-checkbox label {
  display: flex;
  align-items: center;
  font-size: 16px;
  line-height: 24px;
  cursor: pointer;
  margin: 0 16px 0 -11px;
}

.feature-mainhide {
  display: flex;
  flex-direction: row-reverse;
  align-items: center;
  justify-content: flex-end;
  font-size: 16px;
  line-height: 24px;
  cursor: pointer;
  margin: 0 -11px 0 0;
}

.feature-add-cmd {
  position: relative;
}

.feature-add-cmd .menu-pop {
  left: 0;
  bottom: 40px;
}

.script-editor-footer {
  display: flex;
}

.footer-btn {
  flex: 1;
  height: 36.5px;
  font-size: 14px;
  font-weight: 500;
  letter-spacing: 0.4px;
  border-radius: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.footer-btn :deep(.icon) {
  font-size: 20px;
  margin: 0 8px 0 -4px;
}

.with-icon {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}

.with-icon :deep(.icon) {
  font-size: 20px;
}

.footer-btn.close {
  background: var(--btn-gray);
  color: var(--text);
}

.footer-btn.save {
  background: var(--primary);
  color: #fff;
}
</style>
