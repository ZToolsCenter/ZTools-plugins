<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRouter } from '../stores/router'
import { usePromptStore } from '../stores/prompt'
import { useProjectStore } from '../stores/project'
import { extractVariables, generateId, inferTitle } from '../utils/index'
import type { PromptItem } from '../types'

const router = useRouter()
const promptStore = usePromptStore()
const projectStore = useProjectStore()
const step = ref(1)
const content = ref('')
const title = ref('')
const tagsRaw = ref('')
const selectedProjectId = ref('')
const selectedType = ref<'prompt' | 'snippet' | 'template' | 'constraint'>('prompt')
const varConfigs = ref<Record<string, { required: boolean; defaultValue: string }>>({})
const error = ref('')
const saving = ref(false)

const detectedVars = computed(() => extractVariables(content.value))
const autoTitle = computed(() => title.value.trim() || inferTitle(content.value))
const tags = computed(() => tagsRaw.value.split(',').map(s => s.trim()).filter(Boolean))

onMounted(() => {
  const p = router.consumeWizardPrefill()
  if (p) content.value = p
  // 接收项目上下文
  const pid = router.consumeWizardProjectId()
  if (pid) selectedProjectId.value = pid
  setTimeout(() => { const ta = document.querySelector('.ta') as HTMLTextAreaElement; ta?.focus() }, 100)
})

function next() {
  if (step.value === 1 && !content.value.trim()) { error.value = '正文不能为空'; return }
  error.value = ''; if (step.value < 3) step.value++
}

async function save(type?: 'prompt' | 'snippet' | 'template' | 'constraint') {
  if (saving.value || !content.value.trim()) { error.value = '请先输入正文'; return }
  saving.value = true
  try {
    await promptStore.ensureReady()
    const now = Date.now()
    const vars = detectedVars.value.map(v => {
      const cfg = varConfigs.value[v.name]
      return { name: v.name, required: cfg?.required ?? v.required, defaultValue: cfg?.defaultValue ?? v.defaultValue }
    })
    const item: PromptItem = {
      id: generateId(), title: autoTitle.value || '未命名', content: content.value.trim(),
      type: type || selectedType.value, tags: tags.value, variables: vars,
      favorite: false, usageCount: 0, version: 1, snapshots: [],
      projectId: selectedProjectId.value || undefined,
      createdAt: now, updatedAt: now,
    }
    promptStore.addItem(item)
    router.navigateTo('space')
  } catch (e: any) { error.value = e.message || '保存失败' } finally { saving.value = false }
}
</script>

<template>
  <div class="wiz">
    <div class="stepper">
      <div :class="['step', { active: step === 1, done: step > 1 }]"><span class="num">{{ step > 1 ? '✓' : '1' }}</span>正文</div>
      <div :class="['div', { done: step > 1 }]"></div>
      <div :class="['step', { active: step === 2, done: step > 2 }]"><span class="num">{{ step > 2 ? '✓' : '2' }}</span>信息</div>
      <div :class="['div', { done: step > 2 }]"></div>
      <div :class="['step', { active: step === 3 }]"><span class="num">3</span>变量</div>
    </div>
    <div class="wiz-body">
      <div v-if="step === 1" class="pane">
        <h2>编写正文</h2>
        <p class="hint">用 <code v-text="`{{name}}`"></code> 标记变量</p>
        <div class="field"><label>正文 *</label><textarea v-model="content" class="ta" placeholder="你是一位 {{role}} 专家…" /></div>
        <div v-if="error" class="err">{{ error }}</div>
        <div v-if="detectedVars.length" class="detected"><span class="dl">识别到 {{ detectedVars.length }} 个变量</span><span v-for="v in detectedVars" :key="v.name" class="vb">{{ v.name }}</span></div>
      </div>
      <div v-if="step === 2" class="pane">
        <h2>基本信息</h2>
        <div class="field"><label>标题 <span class="hi">默认：{{ autoTitle }}</span></label><input v-model="title" placeholder="如：PRD 评审建议" /></div>
        <div class="field"><label>标签 <span class="hi">逗号分隔</span></label><input v-model="tagsRaw" placeholder="PRD, 评审" /></div>
        <div class="field"><label>类型</label>
          <div class="type-grid">
            <button v-for="t in [{v:'prompt',l:'提示词'},{v:'snippet',l:'片段'},{v:'template',l:'模板'},{v:'constraint',l:'约束'}] as const"
              :key="t.v" :class="['type-btn', { active: selectedType === t.v }]" @click="selectedType = t.v">{{ t.l }}</button>
          </div>
        </div>
        <div class="field"><label>归属项目 <span class="hi">可选</span></label>
          <select v-model="selectedProjectId">
            <option value="">无项目（资产）</option>
            <option v-for="p in projectStore.items.value" :key="p.id" :value="p.id">{{ p.group }} / {{ p.name }}</option>
          </select>
        </div>
      </div>
      <div v-if="step === 3" class="pane">
        <h2>变量配置</h2>
        <div v-if="detectedVars.length" class="var-table">
          <div class="vr header"><div>变量名</div><div>默认值</div><div style="text-align:center">必填</div></div>
          <div v-for="v in detectedVars" :key="v.name" class="vr">
            <div class="vn">{{ v.name }}</div>
            <div><input :value="varConfigs[v.name]?.defaultValue ?? v.defaultValue ?? ''" @input="varConfigs[v.name] = { required: varConfigs[v.name]?.required ?? v.required, defaultValue: ($event.target as HTMLInputElement).value }" placeholder="默认值…" /></div>
            <div style="text-align:center"><input type="checkbox" :checked="varConfigs[v.name]?.required ?? v.required" @change="varConfigs[v.name] = { required: ($event.target as HTMLInputElement).checked, defaultValue: varConfigs[v.name]?.defaultValue ?? v.defaultValue ?? '' }" /></div>
          </div>
        </div>
        <div v-else class="empty">无变量</div>
      </div>
    </div>
    <div class="wiz-foot">
      <button v-if="step > 1" class="btn" @click="step--">← 上一步</button>
      <button v-else class="btn" @click="router.navigateTo('space')">取消</button>
      <span class="spacer"></span>
      <button v-if="step === 1" class="btn" @click="save()" :disabled="saving || !content.trim()">⚡ 快速保存</button>
      <template v-if="step < 3"><button class="btn primary" @click="next">下一步 →</button></template>
      <template v-else>
        <button class="btn" @click="save('snippet')">片段</button>
        <button class="btn primary" @click="save()">发布</button>
      </template>
    </div>
  </div>
</template>

<style scoped>
.wiz { width: 100%; flex: 1; min-height: 0; display: flex; flex-direction: column; background: var(--pf-bg); overflow: hidden; }
.stepper { height: 48px; flex-shrink: 0; display: flex; align-items: center; justify-content: center; gap: 16px; background: var(--pf-bg-elevated); border-bottom: 1px solid var(--pf-border); }
.step { font-size: 13px; color: var(--pf-text-faint); display: flex; align-items: center; gap: 6px; font-weight: 500; }
.step.active { color: var(--pf-accent); font-weight: 700; }
.step.done { color: var(--pf-success); }
.num { width: 20px; height: 20px; border-radius: 50%; border: 2px solid var(--pf-border); display: flex; align-items: center; justify-content: center; font-size: 10px; font-weight: 700; }
.step.active .num { border-color: var(--pf-accent); background: var(--pf-accent-soft); color: var(--pf-accent); }
.step.done .num { border-color: var(--pf-success); background: var(--pf-success-soft); color: var(--pf-success); }
.div { width: 32px; height: 2px; background: var(--pf-border); border-radius: 1px; }
.div.done { background: var(--pf-success); }
.wiz-body { flex: 1; overflow-y: auto; padding: 24px 32px; }
.pane h2 { font-size: 18px; font-weight: 700; margin: 0 0 4px; }
.hint { font-size: 12.5px; color: var(--pf-text-muted); margin: 0 0 16px; }
.hint code { background: var(--pf-accent-soft); color: var(--pf-accent); padding: 2px 6px; border-radius: 3px; font-size: 11px; font-family: var(--pf-font-mono); }
.hi { font-size: 11px; color: var(--pf-text-faint); font-weight: 400; text-transform: none; letter-spacing: 0; }
.field { margin-bottom: 16px; }
.field label { display: flex; align-items: center; gap: 6px; font-size: 12px; font-weight: 600; color: var(--pf-text-secondary); margin-bottom: 6px; text-transform: uppercase; letter-spacing: 0.04em; }
.field input, .field textarea { width: 100%; border: 1px solid var(--pf-border); background: var(--pf-surface); border-radius: var(--pf-radius-sm); padding: 10px 14px; font-size: 13.5px; }
.field input:focus, .field textarea:focus { border-color: var(--pf-accent); outline: none; box-shadow: 0 0 0 3px var(--pf-accent-soft); }
.ta { min-height: 200px; resize: vertical; font-family: var(--pf-font-mono); line-height: 1.6; }
.err { padding: 8px 12px; border: 1px solid var(--pf-danger); background: var(--pf-danger-soft); color: var(--pf-danger); border-radius: var(--pf-radius-sm); font-size: 12px; margin-bottom: 12px; }
.detected { display: flex; align-items: center; gap: 8px; padding: 10px 14px; background: var(--pf-accent-soft); border-radius: var(--pf-radius-md); flex-wrap: wrap; }
.dl { font-size: 12px; font-weight: 700; color: var(--pf-accent); }
.vb { background: var(--pf-surface); color: var(--pf-accent); border: 1px solid var(--pf-border); border-radius: var(--pf-radius-pill); padding: 2px 10px; font-family: var(--pf-font-mono); font-size: 11px; font-weight: 700; }
.type-grid { display: flex; gap: 6px; }
.type-btn { padding: 6px 14px; border: 1px solid var(--pf-border); border-radius: var(--pf-radius-sm); font-size: 12px; color: var(--pf-text-muted); background: var(--pf-surface); transition: all 0.12s; }
.type-btn:hover { border-color: var(--pf-accent); color: var(--pf-accent); }
.type-btn.active { background: var(--pf-accent-soft); color: var(--pf-accent); border-color: var(--pf-accent); font-weight: 600; }
.var-table { border: 1px solid var(--pf-border); border-radius: var(--pf-radius-md); }
.vr { display: grid; grid-template-columns: 1fr 1fr 60px; gap: 10px; align-items: center; padding: 8px 14px; border-bottom: 1px solid var(--pf-border); }
.vr:last-child { border-bottom: 0; }
.vr.header { font-size: 11px; font-weight: 700; color: var(--pf-text-muted); background: var(--pf-bg-elevated); }
.vn { font-family: var(--pf-font-mono); font-weight: 700; color: var(--pf-accent); font-size: 12px; }
.vr input { height: 30px; padding: 2px 8px; border: 1px solid var(--pf-border); border-radius: var(--pf-radius-xs); background: var(--pf-surface); width: 100%; }
.vr input:focus { border-color: var(--pf-accent); outline: none; }
.empty { padding: 24px; text-align: center; color: var(--pf-text-muted); }
.wiz-foot { height: 50px; flex-shrink: 0; padding: 8px 24px; background: var(--pf-bg-elevated); border-top: 1px solid var(--pf-border); display: flex; align-items: center; gap: 8px; }
.spacer { flex: 1; }
</style>
