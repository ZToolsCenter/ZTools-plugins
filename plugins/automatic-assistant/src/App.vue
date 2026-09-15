<script setup lang="ts">
import { computed, nextTick, onMounted, reactive, ref } from 'vue'
import type { CategoryDoc, Feature, ScriptDoc } from './types'
import { INSET_SCRIPTS } from './insets'
import {
  SCRIPT_PREFIX,
  defaultCategory,
  getEnabledFeatureCodes,
  hasZtools,
  insetFeature,
  listCategories,
  listScripts,
  newCategoryId,
  newScriptCode,
  putDoc,
  removeDoc,
  removeFeature,
  setFeature,
  sortCategories,
  sortScripts
} from './store'
import { showMessage } from './message'
import SettingNav from './components/SettingNav.vue'
import ScriptRow from './components/ScriptRow.vue'
import ScriptEditor from './components/ScriptEditor.vue'
import RunView from './components/RunView.vue'
import Icon from './components/Icon.vue'
import MessageBar from './components/MessageBar.vue'
import ConfirmDialog from './components/ConfirmDialog.vue'

const view = ref<'main' | 'run'>('main')
const selected = ref<{ kind: 'inset' | 'custom'; id: string }>({ kind: 'inset', id: 'system' })
const categories = ref<CategoryDoc[]>([])
const scripts = ref<ScriptDoc[]>([])
const enabledCodes = ref<string[]>([])
const editing = ref<ScriptDoc | null>(null)
const editingIsNew = ref(false)
const editingReadonly = ref(false)
const deleteTarget = ref<ScriptDoc | null>(null)
const runInfo = reactive({
  logs: [] as string[],
  result: null as string | null,
  error: null as string | null,
  running: false,
  script: '',
  action: null as Record<string, unknown> | null
})


const insetList = computed(() => INSET_SCRIPTS.filter((x) => x.category === selected.value.id))
// 与原版一致：categoryId 不属于任何现存分类的脚本，收拢进默认分类展示
const customList = computed(() => {
  const ids = new Set(categories.value.map((c) => c._id))
  const fallback = defaultCategory(categories.value)?._id
  return sortScripts(
    scripts.value.filter((x) => (ids.has(x.categoryId) ? x.categoryId : fallback) === selected.value.id)
  )
})
const otherCategories = computed(() =>
  categories.value.filter((c) => c._id !== selected.value.id).map((c) => ({ _id: c._id, label: c.label }))
)

function reload() {
  categories.value = listCategories()
  scripts.value = listScripts()
  enabledCodes.value = getEnabledFeatureCodes()
}

// 与原版一致：print 日志用 String()
const stringify = (value: unknown) => String(value)

// 与原版一致：结果面板字符串直出，其余 JSON.stringify（失败回退 String）
const stringifyResult = (value: unknown) => {
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

// ===== 运行 =====
// 与原版一致：
//   进入时 feature.mainHide && ENTER.from === 'main' → 先隐藏主窗口
//   脚本返回 undefined → 隐藏主窗口，50ms 后退出插件（纯后台执行）
//   有返回值 / 抛错     → 重新显示主窗口并展示结果面板
//   结果出来后 print 的内容不再追加

// mainHide 为 true 时，在运行页挂载后隐藏主窗口，再开始执行脚本
// （对齐原版 componentDidMount 里先 hideMainWindow、再 setTimeout(run) 的时序；
//   在 onPluginEnter 回调里同步隐藏会被宿主随后的显示/聚焦覆盖）
function runScript(script: string, action: Record<string, unknown>, mainHide = false) {
  runInfo.script = script
  runInfo.action = action
  view.value = 'run'
  runInfo.logs = []
  runInfo.result = null
  runInfo.error = null
  runInfo.running = true

  nextTick(() => {
    if (mainHide) window.ztools.hideMainWindow()
    window.setTimeout(() => execScript(script, action), 0)
  })
}

function execScript(script: string, action: Record<string, unknown>) {
  const print = (msg: unknown) => {
    if (runInfo.result !== null || runInfo.error !== null) return
    runInfo.logs = [...runInfo.logs, stringify(msg)]
  }

  window.services
    .vmRunScript(script, { ...action }, print)
    .then((ret) => {
      if (ret === undefined) {
        window.ztools.hideMainWindow()
        window.setTimeout(() => window.ztools.outPlugin(), 50)
        return
      }
      window.ztools.showMainWindow()
      runInfo.result = stringifyResult(ret)
      runInfo.running = false
    })
    .catch((err) => {
      window.ztools.showMainWindow()
      runInfo.error = err instanceof Error ? err.message : String(err)
      runInfo.running = false
    })
}

function rerun() {
  if (!runInfo.action) return
  const script = runInfo.script
  const action = runInfo.action
  runInfo.logs = []
  runInfo.result = null
  runInfo.error = null
  window.setTimeout(() => runScript(script, action, false), 50)
}

function handleEnter(action: { code: string; type: string; payload: unknown; option: unknown; from?: string }) {
  reload()
  if (action.code === 'setting') {
    // 仅设置页需要撑高并移除 ZTools 默认顶部子输入框；
    // 脚本运行入口不动窗口，与原版对齐
    window.ztools.setExpendHeight(560)
    if (typeof window.ztools.removeSubInput === 'function') window.ztools.removeSubInput()
    view.value = 'main'
    return
  }
  // 与原版一致：失效指令静默清理并退出，不弹通知
  const bail = (code: string) => {
    window.ztools.removeFeature(code)
    window.ztools.outPlugin()
  }
  // ZTools 的 action.from 为可选字段，未提供时按主输入框入口处理，
  // 否则 mainHide 会因判断恒为假而完全失效
  const fromMain = (action.from || 'main') === 'main'
  const enter = action as unknown as Record<string, unknown>
  const inset = INSET_SCRIPTS.find((x) => x.id === action.code)
  if (inset) {
    const script = window.services.getInsetScript(inset.id)
    if (!script) return bail(action.code)
    runScript(script, enter, !!insetFeature(inset.id)?.mainHide && fromMain)
    return
  }
  const doc = scripts.value.find((s) => s.feature.code === action.code)
  if (!doc) return bail(action.code)
  runScript(doc.script, enter, !!doc.feature.mainHide && fromMain)
}

onMounted(() => {
  // 普通浏览器预览时无 ztools 环境，仅展示 UI
  if (!hasZtools()) {
    categories.value = listCategories()
    if (categories.value.length) selected.value = { kind: 'inset', id: 'system' }
    return
  }
  reload()
  const onReady = (window.ztools as unknown as { onPluginReady?: (cb: () => void) => void }).onPluginReady
  if (typeof onReady === 'function') onReady(() => reload())
  window.ztools.onPluginEnter(handleEnter as never)
})

// ===== 启用/停用 =====

function toggleFeature(feature: Feature, enabled: boolean) {
  if (enabled) {
    if (!setFeature(feature)) return showMessage('保存失败', 'error')
  } else {
    removeFeature(feature.code)
  }
  enabledCodes.value = getEnabledFeatureCodes()
}

const isEnabled = (code: string) => enabledCodes.value.includes(code)

// ===== 自定义脚本 CRUD =====

function newDoc(categoryId: string): ScriptDoc {
  const code = newScriptCode()
  return {
    _id: SCRIPT_PREFIX + code,
    categoryId,
    feature: { code, mainHide: true, explain: '', cmds: [''] },
    script: ''
  }
}

function createScript() {
  const categoryId = selected.value.kind === 'custom' ? selected.value.id : categories.value[0]?._id
  if (!categoryId) return
  editing.value = newDoc(categoryId)
  editingIsNew.value = true
  editingReadonly.value = false
}

function editScript(doc: ScriptDoc) {
  editing.value = doc
  editingIsNew.value = false
  editingReadonly.value = false
}

// 查看内置脚本（只读，与原版一致）
function viewInset(id: string) {
  const inset = INSET_SCRIPTS.find((x) => x.id === id)
  if (!inset) return
  const script = hasZtools() ? window.services.getInsetScript(id) : null
  editing.value = {
    _id: inset.id,
    categoryId: '',
    feature: insetFeature(inset.id)!,
    script: script || '// 该脚本源码需在 ZTools 环境中读取'
  }
  editingIsNew.value = false
  editingReadonly.value = true
}

function handleSave(data: ScriptDoc) {
  const isUpdate = !!data._rev
  ;(data as unknown as Record<string, unknown>).updateAt = Date.now()
  const err = putDoc(data)
  if (err) return showMessage('保存失败', 'error')
  if (isUpdate) {
    const old = scripts.value.find((s) => s._id === data._id)
    if (old && isEnabled(data.feature.code) && JSON.stringify(old.feature) !== JSON.stringify(data.feature)) {
      setFeature(data.feature)
    }
    showMessage('保存成功', 'success')
  } else {
    setFeature(data.feature)
    showMessage('创建成功', 'success')
  }
  editing.value = null
  reload()
}

function confirmDelete() {
  const doc = deleteTarget.value
  deleteTarget.value = null
  if (!doc) return
  if (!removeDoc(doc._id)) return showMessage('删除失败', 'error')
  // 与原版一致：仅在该指令处于启用态时才注销
  if (isEnabled(doc.feature.code)) removeFeature(doc.feature.code)
  reload()
}

// 拷贝创建：与原版一致，多个分类时先弹「请选择保存的分类」
const cloneSource = ref<{ feature: Feature; script: string; fromCategoryId?: string } | null>(null)
const pickCategoryOpen = ref(false)

function copyCreate(source: { feature: Feature; script?: string; insetId?: string; fromCategoryId?: string }) {
  let script = source.script
  if (!script && source.insetId) {
    script = hasZtools() ? window.services.getInsetScript(source.insetId) || '' : ''
    if (!script) return showMessage('内置脚本读取失败', 'error')
  }
  cloneSource.value = {
    feature: JSON.parse(JSON.stringify(source.feature)),
    script: script || '',
    fromCategoryId: source.fromCategoryId
  }
  // 与原版一致：自定义脚本拷贝不选分类（留在原分类）；仅内置脚本在多分类时弹选择框
  if (!source.insetId || categories.value.length <= 1) {
    doClone(source.insetId ? categories.value[0]?._id : undefined)
    return
  }
  pickCategoryOpen.value = true
}

function doClone(categoryId?: string) {
  pickCategoryOpen.value = false
  const src = cloneSource.value
  cloneSource.value = null
  if (!src) return
  const target = categoryId || src.fromCategoryId || defaultCategory(categories.value)?._id
  if (!target) return
  const doc = newDoc(target)
  doc.feature = { ...src.feature, code: doc.feature.code }
  doc.script = src.script
  editing.value = doc
  editingIsNew.value = true
  editingReadonly.value = false
}

// 移动到分类
function moveToCategory(doc: ScriptDoc, categoryId: string) {
  doc.categoryId = categoryId
  const err = putDoc(doc)
  if (err) return showMessage('保存失败', 'error')
  showMessage('修改成功', 'success')
  reload()
}

// ===== 分类管理 =====

function addCategory(label: string) {
  const doc: CategoryDoc = { _id: newCategoryId(), label }
  const err = putDoc(doc)
  if (err) return showMessage('保存失败', 'error')
  reload()
  selected.value = { kind: 'custom', id: doc._id }
}

function renameCategory(id: string, label: string) {
  const doc = categories.value.find((c) => c._id === id)
  if (!doc) return
  doc.label = label
  const err = putDoc(doc)
  if (err) return showMessage('保存失败', 'error')
  reload()
}

function removeCategory(id: string) {
  const owned = scripts.value.filter((s) => s.categoryId === id)
  if (owned.length) return showMessage('分类下存在内容，无法删除', 'error')
  if (!removeDoc(id)) return showMessage('保存失败', 'error')
  scripts.value = listScripts()
  categories.value = sortCategories((window.ztools.db.allDocs('category/') || []) as unknown as CategoryDoc[])
  enabledCodes.value = getEnabledFeatureCodes()
  const next = categories.value[0]
  selected.value = next ? { kind: 'custom', id: next._id } : { kind: 'inset', id: 'system' }
}
</script>

<template>
  <RunView
    v-if="view === 'run'"
    :running="runInfo.running"
    :logs="runInfo.logs"
    :result="runInfo.result"
    :error="runInfo.error"
    @rerun="rerun"
  />
  <div v-else class="setting-body">
    <SettingNav
      :categories="categories"
      :selected="selected"
      @select="(kind, id) => (selected = { kind, id })"
      @add="addCategory"
      @rename="renameCategory"
      @remove="removeCategory"
    />
    <div class="setting-content">
      <div class="setting-content-body">
        <!-- 内置脚本 -->
        <template v-if="selected.kind === 'inset'">
          <ul v-if="insetList.length" class="script-list">
            <ScriptRow
              v-for="inset in insetList"
              :key="inset.id"
              :feature="insetFeature(inset.id)!"
              :enabled="isEnabled(inset.id)"
              :custom="false"
              @toggle="toggleFeature(insetFeature(inset.id)!, $event)"
              @view="viewInset(inset.id)"
              @copy="copyCreate({ feature: insetFeature(inset.id)!, insetId: inset.id })"
            />
          </ul>
          <div v-else class="setting-content-empty">
            <img src="/res/empty-bg.png" alt="" />
          </div>
        </template>
        <!-- 自定义脚本 -->
        <template v-else>
          <ul v-if="customList.length" class="script-list">
            <ScriptRow
              v-for="doc in customList"
              :key="doc._id"
              :feature="doc.feature"
              :enabled="isEnabled(doc.feature.code)"
              :custom="true"
              :other-categories="otherCategories"
              @toggle="toggleFeature(doc.feature, $event)"
              @edit="editScript(doc)"
              @remove="deleteTarget = doc"
              @copy="copyCreate({ feature: doc.feature, script: doc.script, fromCategoryId: doc.categoryId })"
              @move="moveToCategory(doc, $event)"
            />
          </ul>
          <div v-else class="setting-content-empty">
            <img src="/res/empty-bg.png" alt="" />
          </div>
        </template>
      </div>
      <div class="setting-content-footer" v-if="selected.kind === 'custom'">
        <button class="btn-contained" @click="createScript">
          <Icon name="add" />
          创建自动化脚本
        </button>
      </div>
    </div>
  </div>

  <ScriptEditor
    v-if="editing"
    :doc="editing"
    :is-new="editingIsNew"
    :readonly="editingReadonly"
    @close="editing = null"
    @save="handleSave"
  />

  <template v-if="pickCategoryOpen">
    <div class="dialog-mask" @click.self="pickCategoryOpen = false">
      <div class="pick-dialog">
        <div class="pick-dialog-title">请选择保存的分类</div>
        <ul>
          <li v-for="c in categories" :key="c._id" @click="doClone(c._id)">{{ c.label }}</li>
        </ul>
      </div>
    </div>
  </template>

  <ConfirmDialog
    v-if="deleteTarget"
    title="确定删除该自动化脚本？"
    confirm-text="删除"
    danger
    @cancel="deleteTarget = null"
    @confirm="confirmDelete"
  />

  <MessageBar />
</template>

<style scoped>
.setting-body {
  display: flex;
  width: 100%;
  height: 100%;
  border-top: 1px solid var(--divider);
}

.setting-content {
  flex: 1;
  min-width: 0;
  height: 100%;
  display: flex;
  flex-direction: column;
}

.setting-content-body {
  flex: 1;
  overflow: hidden auto;
}

.script-list {
  list-style: none;
  padding: 8px 0;
}

.setting-content-empty {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
}

.setting-content-empty > img {
  width: 256px;
  opacity: 0.08;
}

.dialog-mask {
  position: fixed;
  inset: 0;
  z-index: 1300;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
}

.pick-dialog {
  min-width: 280px;
  background: var(--paper);
  border-radius: 4px;
  box-shadow: 0 11px 15px -7px rgba(0, 0, 0, 0.2), 0 24px 38px 3px rgba(0, 0, 0, 0.14);
  padding-bottom: 8px;
}

.pick-dialog-title {
  font-size: 17px;
  padding: 16px 24px;
}

.pick-dialog ul {
  list-style: none;
}

.pick-dialog li {
  font-size: 15px;
  padding: 6px 24px;
  cursor: pointer;
}

.pick-dialog li:hover {
  background: var(--hover);
}

.setting-content-footer {
  display: flex;
  justify-content: flex-end;
  align-items: center;
  height: 48px;
  padding-right: 20px;
  border-top: 1px solid var(--divider);
  flex-shrink: 0;
}
</style>
