<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRouter } from '../stores/router'
import { usePromptStore } from '../stores/prompt'
import { useAppSettings } from '../stores/app'
import { extractVariables, renderVariables, generateId } from '../utils/index'
import { copyText, showNotification, hideMainWindow } from '../utils/platform'
import type { PromptItem } from '../types'

interface CanvasItem {
  item: PromptItem
  position: 'front' | 'back'
}

const router = useRouter()
const promptStore = usePromptStore()
const appSettings = useAppSettings()
const selectedBaseId = ref('')
const canvasFrags = ref<CanvasItem[]>([])
const varOverrides = ref<Record<string, string>>({})
const rightTab = ref<'snippet' | 'constraint'>('snippet')

const basePrompts = computed(() => promptStore.liveItems.value.filter(i => i.type === 'prompt'))
const snippets = computed(() => promptStore.liveItems.value.filter(i => i.type === 'snippet'))
const constraints = computed(() => promptStore.liveItems.value.filter(i => i.type === 'constraint'))
const rightItems = computed(() => rightTab.value === 'snippet' ? snippets.value : constraints.value)
const selectedBase = computed(() => promptStore.liveItems.value.find(i => i.id === selectedBaseId.value) || basePrompts.value[0] || null)

const frontFrags = computed(() => canvasFrags.value.filter(f => f.position === 'front'))
const backFrags = computed(() => canvasFrags.value.filter(f => f.position === 'back'))

onMounted(async () => {
  await promptStore.ensureReady()
  if (basePrompts.value.length && !selectedBaseId.value) selectedBaseId.value = basePrompts.value[0].id
})

const composedText = computed(() => {
  let t = ''
  // 前置片段
  if (frontFrags.value.length) {
    frontFrags.value.forEach(f => { t += f.item.content + '\n\n' })
  }
  // 基础提示词
  t += selectedBase.value?.content || ''
  // 后置片段/约束
  if (backFrags.value.length) {
    t += '\n\n请遵循以下要求：\n'
    backFrags.value.forEach(f => { t += `- ${f.item.content}\n` })
  }
  return t
})
const composedVars = computed(() => extractVariables(composedText.value))
const renderedText = computed(() => {
  let t = composedText.value
  composedVars.value.forEach(v => {
    const val = varOverrides.value[v.name] || v.defaultValue || `{{${v.name}}}`
    t = t.replace(new RegExp(`\\{\\{${v.name}(?:=[^}]+)?\\}\\}`, 'g'), val)
  })
  return t
})

function addFrag(f: PromptItem, position: 'front' | 'back' = 'back') {
  if (canvasFrags.value.some(x => x.item.id === f.id)) { showNotification('已在画布中'); return }
  canvasFrags.value.push({ item: f, position })
}
function removeFrag(i: number) { canvasFrags.value.splice(i, 1) }
function moveFrag(i: number, dir: 'up' | 'down') {
  const arr = canvasFrags.value
  const t = dir === 'up' ? i - 1 : i + 1
  if (t < 0 || t >= arr.length) return
  ;[arr[i], arr[t]] = [arr[t], arr[i]]
}

async function copyComposite() {
  try {
    await copyText(renderedText.value)
    showNotification('✓ 已复制')
    if (appSettings.settings.value.closeAfterCopy) hideMainWindow()
  } catch (e: any) { showNotification(`失败: ${e.message}`) }
}

async function saveAsNew() {
  const name = prompt('请输入标题：', `组合 ${new Date().toLocaleDateString()}`)
  if (!name?.trim()) return
  const now = Date.now()
  promptStore.addItem({
    id: generateId(), title: name.trim(), content: composedText.value,
    type: 'prompt', tags: ['Composed'], variables: composedVars.value,
    favorite: false, usageCount: 0, version: 1, snapshots: [],
    createdAt: now, updatedAt: now,
  })
  showNotification('✓ 已另存')
  router.navigateTo('manage')
}
</script>

<template>
  <div class="compose">
    <div class="compose-body">
      <!-- 左：基础 -->
      <div class="col"><div class="ch">基础提示词</div><div class="cl"><div v-for="p in basePrompts" :key="p.id" :class="['mini-card', { active: p.id === selectedBaseId }]" @click="selectedBaseId = p.id"><div class="ct">{{ p.title }}</div><div class="cd">{{ p.content }}</div></div></div></div>
      <!-- 中：画布 -->
      <div class="canvas">
        <!-- 前置片段 -->
        <div v-for="(f, i) in frontFrags" :key="f.item.id" class="cc front">
          <div class="cc-h"><span>📌 前置 {{ i+1 }}</span><span class="moves"><button :disabled="i===0" @click="moveFrag(canvasFrags.indexOf(f),'up')">▲</button><button :disabled="i===frontFrags.length-1" @click="moveFrag(canvasFrags.indexOf(f),'down')">▼</button></span><span class="x" @click="removeFrag(canvasFrags.indexOf(f))">×</span></div>
          <div class="ct">{{ f.item.title }}</div><div class="cc-b">{{ f.item.content }}</div>
        </div>
        <!-- 基础 -->
        <div class="cc muted"><div class="cc-h">基础</div><div class="ct">{{ selectedBase?.title || '未选择' }}</div><div class="cc-b">{{ selectedBase?.content }}</div></div>
        <!-- 后置片段/约束 -->
        <div v-for="(f, i) in backFrags" :key="f.item.id" class="cc back">
          <div class="cc-h"><span>{{ f.item.type === 'constraint' ? '🛡 约束' : '📎 片段' }} {{ i+1 }}</span><span class="moves"><button :disabled="i===0" @click="moveFrag(canvasFrags.indexOf(f),'up')">▲</button><button :disabled="i===backFrags.length-1" @click="moveFrag(canvasFrags.indexOf(f),'down')">▼</button></span><span class="x" @click="removeFrag(canvasFrags.indexOf(f))">×</span></div>
          <div class="ct">{{ f.item.title }}</div><div class="cc-b">{{ f.item.content }}</div>
        </div>
        <div v-if="!canvasFrags.length" class="empty-c">在右侧选择片段或约束添加至此</div>
        <!-- 合成预览 -->
        <div class="cc preview"><div class="cc-h">合成预览</div><div class="cc-b mono">{{ renderedText }}</div>
          <div v-if="composedVars.length" class="vars"><span v-for="v in composedVars" :key="v.name" class="vt">{{ v.name }} <input v-model="varOverrides[v.name]" :placeholder="v.defaultValue||'输入…'" /></span></div>
        </div>
      </div>
      <!-- 右：片段/约束 -->
      <div class="col">
        <div class="ch">
          <span :class="['tab', { active: rightTab === 'snippet' }]" @click="rightTab = 'snippet'">片段</span>
          <span class="tab-sep">/</span>
          <span :class="['tab', { active: rightTab === 'constraint' }]" @click="rightTab = 'constraint'">约束</span>
        </div>
        <div class="cl">
          <template v-if="rightItems.length">
            <div v-for="f in rightItems" :key="f.id" class="mini-card">
              <div class="ct">{{ f.title }}</div>
              <div class="cd">{{ f.content }}</div>
              <div class="add-btns">
                <button class="abtn" @click="addFrag(f, 'front')" title="添加到前置">↑ 前置</button>
                <button class="abtn" @click="addFrag(f, 'back')" title="添加到后置">↓ 后置</button>
              </div>
            </div>
          </template>
          <div v-else class="empty-c">{{ rightTab === 'snippet' ? '暂无片段' : '暂无约束' }}</div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.compose { width: 100%; flex: 1; min-height: 0; display: flex; flex-direction: column; background: var(--pf-bg); overflow: hidden; }
.compose-body { flex: 1; display: grid; grid-template-columns: 200px 1fr 200px; grid-template-rows: 1fr; min-height: 0; overflow: hidden; }
.col { display: flex; flex-direction: column; min-height: 0; border-right: 1px solid var(--pf-border); background: var(--pf-bg-elevated); }
.col:last-child { border-right: 0; border-left: 1px solid var(--pf-border); }
.ch { padding: 10px 12px 6px; font-size: 11px; font-weight: 600; color: var(--pf-text-muted); text-transform: uppercase; letter-spacing: 0.06em; }
.cl { flex: 1; overflow-y: auto; padding: 0 8px 10px; }
.mini-card, .cl > div { padding: 8px 10px; border-radius: var(--pf-radius-sm); background: var(--pf-surface); border: 1px solid var(--pf-border); cursor: pointer; margin-bottom: 4px; transition: all 0.12s; }
.cl > div:hover, .cl > div.active { border-color: var(--pf-accent); background: var(--pf-accent-soft); }
.ct { font-size: 12px; font-weight: 600; display: flex; align-items: center; justify-content: space-between; margin-bottom: 2px; }
.cd { font-size: 11px; color: var(--pf-text-muted); display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; line-height: 1.4; }
.add { color: var(--pf-text-faint); }
.cl > div:hover .add { color: var(--pf-accent); }
.canvas { background: var(--pf-bg); overflow-y: auto; padding: 12px; display: flex; flex-direction: column; gap: 8px; }
.cc { background: var(--pf-surface); border: 1px solid var(--pf-border); border-radius: var(--pf-radius-sm); padding: 10px; }
.cc.muted { background: var(--pf-surface-raised); border-style: dashed; }
.cc.preview { border-color: var(--pf-accent); }
.cc-h { display: flex; align-items: center; gap: 6px; font-size: 10px; color: var(--pf-text-muted); font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 4px; }
.cc-b { font-size: 11.5px; color: var(--pf-text-muted); line-height: 1.5; }
.cc-b.mono { font-family: var(--pf-font-mono); white-space: pre-wrap; color: var(--pf-text); }
.moves { display: flex; gap: 2px; margin-left: 4px; }
.moves button { border: 0; background: none; font-size: 10px; color: var(--pf-text-muted); }
.moves button:disabled { opacity: 0.3; }
.x { margin-left: auto; color: var(--pf-text-faint); cursor: pointer; }
.x:hover { color: var(--pf-danger); }
.empty-c { border: 1px dashed var(--pf-border); border-radius: var(--pf-radius-sm); padding: 20px; text-align: center; color: var(--pf-text-faint); font-size: 12px; }
.cc.front { border-left: 3px solid var(--pf-success); }
.cc.back { border-left: 3px solid var(--pf-accent); }
.tab { cursor: pointer; color: var(--pf-text-muted); transition: color 0.12s; }
.tab.active { color: var(--pf-accent); font-weight: 700; }
.tab:hover { color: var(--pf-accent); }
.tab-sep { color: var(--pf-text-faint); margin: 0 2px; }
.add-btns { display: flex; gap: 4px; margin-top: 6px; }
.abtn { flex: 1; padding: 4px 0; border: 1px solid var(--pf-border); border-radius: var(--pf-radius-xs); font-size: 10.5px; color: var(--pf-text-muted); background: var(--pf-surface); cursor: pointer; transition: all 0.12s; }
.abtn:hover { border-color: var(--pf-accent); color: var(--pf-accent); background: var(--pf-accent-soft); }
.vars { display: flex; gap: 4px; flex-wrap: wrap; margin-top: 8px; padding-top: 8px; border-top: 1px solid var(--pf-border); }
.vt { display: inline-flex; align-items: center; gap: 4px; background: var(--pf-accent-soft); color: var(--pf-accent); padding: 2px 6px; border-radius: var(--pf-radius-xs); font-size: 11px; font-weight: 500; }
.vt input { width: 70px; border: 0; border-bottom: 1px solid var(--pf-border); background: transparent; font-size: 11px; }
.vt input:focus { border-bottom-color: var(--pf-accent); outline: none; }
.compose-foot { height: 48px; flex-shrink: 0; border-top: 1px solid var(--pf-border); background: var(--pf-bg-elevated); display: flex; align-items: center; gap: 8px; padding: 0 14px; }
.ok { font-size: 12px; color: var(--pf-success); font-weight: 600; }
.spacer { flex: 1; }
</style>
