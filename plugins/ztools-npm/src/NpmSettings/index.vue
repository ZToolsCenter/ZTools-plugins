<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue'

const STORAGE_KEY = 'npm-proxy'

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ close: [] }>()

const proxy = ref('')
const saved = ref('')
const status = ref<{ type: 'idle' | 'saved' | 'cleared' }>({ type: 'idle' })
let statusTimer: any = null

function load() {
  if (!window.ztools?.dbStorage) return
  const stored = window.ztools.dbStorage.getItem(STORAGE_KEY)
  const value = typeof stored === 'string' ? stored : ''
  saved.value = value
  proxy.value = value
}

function flash(type: 'saved' | 'cleared') {
  clearTimeout(statusTimer)
  status.value = { type }
  statusTimer = setTimeout(() => { status.value = { type: 'idle' } }, 1500)
}

function save() {
  if (!window.ztools?.dbStorage) return
  const value = proxy.value.trim()
  window.ztools.dbStorage.setItem(STORAGE_KEY, value)
  // setProxy 会规范化/校验并返回实际生效的 URL（非法输入清空）
  const applied = window.services?.setProxy(value) ?? ''
  saved.value = applied
  flash('saved')
}

function reset() {
  if (!window.ztools?.dbStorage) return
  window.ztools.dbStorage.removeItem(STORAGE_KEY)
  window.services?.setProxy('')
  saved.value = ''
  proxy.value = ''
  flash('cleared')
}

function onEsc(e: KeyboardEvent) {
  if (e.key === 'Escape') emit('close')
}

watch(() => props.open, (open) => {
  if (open) { load(); document.addEventListener('keydown', onEsc) }
  else document.removeEventListener('keydown', onEsc)
}, { immediate: true })

onBeforeUnmount(() => {
  document.removeEventListener('keydown', onEsc)
  clearTimeout(statusTimer)
})
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="settings-overlay" @click.self="emit('close')">
      <div class="settings-dialog" role="dialog" aria-modal="true" aria-labelledby="npm-settings-title">
        <header>
          <h2 id="npm-settings-title">Npm 插件设置</h2>
          <button class="close" @click="emit('close')" title="关闭 (Esc)" aria-label="关闭">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true">
              <path d="M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
            </svg>
          </button>
        </header>

        <div class="field">
          <label for="proxy">HTTP 代理</label>
          <input
            id="proxy"
            v-model="proxy"
            type="text"
            placeholder="http://127.0.0.1:7890"
            spellcheck="false"
          />
          <p class="hint">
            用于访问 <code>registry.npmjs.org</code> 官方源。留空 = 直连（无代理）。
            <br />
            国内访问官方源时填写本地代理地址，例如 <code>http://127.0.0.1:7890</code>。
            <br />
            npmmirror 国内镜像为固定默认，无需配置。
          </p>
        </div>

        <div class="actions">
          <button class="primary" @click="save">保存</button>
          <button @click="reset">恢复默认</button>
          <button class="ghost" @click="emit('close')">取消</button>
        </div>

        <div v-if="status.type === 'saved'" class="status saved">
          <span class="ok-dot"></span> 已保存
        </div>
        <div v-else-if="status.type === 'cleared'" class="status cleared">已重置为默认</div>

        <div v-if="saved" class="current">
          当前代理：<code>{{ saved }}</code>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.settings-overlay {
  position: fixed; inset: 0;
  background: rgba(0,0,0,0.55);
  display: flex; align-items: center; justify-content: center;
  z-index: 500; backdrop-filter: blur(2px);
}
.settings-dialog {
  background: var(--bg-secondary); border: 1px solid var(--border);
  border-radius: 10px; padding: 20px 24px; width: min(520px, 90vw);
  box-shadow: 0 12px 48px rgba(0,0,0,0.4); color: var(--text-primary);
}
header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 16px; }
header h2 { margin: 0; font-size: 1.15em; }
.close { background: transparent; border: none; color: var(--text-muted); font-size: 1.4em; line-height: 1; padding: 4px 8px; border-radius: 6px; cursor: pointer; }
.close:hover { background: var(--bg-hover); color: var(--text-primary); }
.field { margin-bottom: 16px; }
label { display: block; margin-bottom: 6px; font-weight: 600; color: var(--text-secondary); font-size: 0.95em; }
input {
  width: 100%; padding: 8px 10px; font-family: var(--font-mono); font-size: 0.95em;
  border: 1px solid var(--border); border-radius: 6px; background: var(--bg-primary);
  color: var(--text-primary); box-sizing: border-box;
}
input:focus { outline: none; border-color: var(--accent); }
.hint { margin: 6px 0 0; font-size: 0.85em; color: var(--text-muted); line-height: 1.4; }
.hint code { background: var(--bg-hover); padding: 1px 5px; border-radius: 3px; font-family: var(--font-mono); }
.actions { display: flex; gap: 8px; }
button { padding: 6px 14px; border: 1px solid var(--border); border-radius: 6px; background: transparent; color: var(--text-primary); cursor: pointer; font-size: 0.95em; }
button:hover { background: var(--bg-hover); }
button.primary { background: var(--accent); color: white; border-color: var(--accent); }
button.primary:hover { background: var(--accent-hover); }
button.ghost { color: var(--text-muted); }
.status { margin-top: 12px; padding: 6px 10px; border-radius: 6px; font-size: 0.9em; display: flex; align-items: center; gap: 6px; }
.status.saved { background: var(--status-stable); color: white; }
.status.cleared { background: var(--bg-hover); color: var(--text-secondary); }
.ok-dot { width: 8px; height: 8px; border-radius: 50%; background: currentColor; flex-shrink: 0; }
.current { margin-top: 14px; padding-top: 10px; border-top: 1px solid var(--border); font-size: 0.85em; color: var(--text-secondary); }
.current code { font-family: var(--font-mono); background: var(--bg-hover); padding: 1px 5px; border-radius: 3px; }
</style>
