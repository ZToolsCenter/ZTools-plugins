<template>
  <n-modal
    :show="show"
    preset="card"
    style="width: 600px"
    :title="isEdit ? '任务详情' : '新建任务'"
    :mask-closable="true"
    @update:show="v => emit('update:show', v)"
  >
    <n-form label-placement="left" label-width="56" size="small">
      <n-form-item label="标题" required>
        <n-input v-model:value="form.title" placeholder="任务标题" maxlength="60" @keyup.enter="save" />
      </n-form-item>

      <n-form-item label="描述">
        <MarkdownEditor v-model="form.desc" :dark="dark" />
      </n-form-item>
    </n-form>

    <div v-if="isEdit" class="subtasks">
      <div class="sub-head">
        <span class="sub-title">
          子任务
          <span class="sub-count">{{ subDoneCount }}/{{ form.subtasks.length }} 完成</span>
        </span>
      </div>

      <div v-for="s in form.subtasks" :key="s.id" class="sub-item" :class="{ 'sub-done': s.done }">
        <n-checkbox :checked="s.done" size="small" @update:checked="() => toggleSub(s.id)" />
        <span class="sub-label">{{ s.title }}</span>
        <button class="sub-op danger" title="删除" @click="removeSub(s.id)">✕</button>
      </div>

      <n-input
        v-model:value="newSubTitle"
        size="small"
        placeholder="添加子任务，回车确认"
        maxlength="100"
        @keyup.enter="addSub"
      >
        <template #suffix>
          <n-button text size="tiny" type="primary" @click="addSub">添加</n-button>
        </template>
      </n-input>
    </div>

    <template #footer>
      <div class="footer">
        <n-button v-if="isEdit" quaternary type="error" @click="del">删除</n-button>
        <span v-else></span>
        <div class="right">
          <n-button size="small" @click="emit('update:show', false)">取消</n-button>
          <n-button size="small" type="primary" @click="save">{{ isEdit ? '保存' : '创建' }}</n-button>
        </div>
      </div>
    </template>
  </n-modal>
</template>

<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import {
  NButton,
  NCheckbox,
  NForm,
  NFormItem,
  NInput,
  NModal,
  useMessage
} from 'naive-ui'
import { columns, removeTask, saveTask, newId } from '../store'
import MarkdownEditor from './MarkdownEditor.vue'
import type { SubTask, TaskDoc } from '../types'

const props = defineProps<{ show: boolean; task: TaskDoc | null; dark?: boolean }>()
const emit = defineEmits<{ (e: 'update:show', v: boolean): void }>()

const message = useMessage()

const emptyForm = () => ({
  _id: '',
  title: '',
  desc: '',
  columnId: '',
  subtasks: [] as SubTask[]
})

const form = reactive(emptyForm())
const newSubTitle = ref('')

watch(
  () => props.show,
  s => {
    if (!s) return
    const t = props.task
    Object.assign(form, emptyForm(), {
      _id: t?._id ?? '',
      title: t?.title ?? '',
      desc: t?.desc ?? '',
      columnId: t?.columnId || columns.value[0]?.id || '',
      subtasks: (t?.subtasks ?? []).map(x => ({ ...x }))
    })
    newSubTitle.value = ''
  }
)

const isEdit = computed(() => !!form._id)

const subDoneCount = computed(() => form.subtasks.filter(s => s.done).length)
const subPercent = computed(() =>
  form.subtasks.length ? Math.round((subDoneCount.value / form.subtasks.length) * 100) : 0
)

/** 子任务为草稿模式：仅修改本地副本，点击「保存」时统一持久化 */
function addSub() {
  const title = newSubTitle.value.trim()
  if (!title) return
  form.subtasks.push({ id: newId(), title, done: false })
  newSubTitle.value = ''
}

function toggleSub(id: string) {
  const s = form.subtasks.find(x => x.id === id)
  if (s) s.done = !s.done
}

function removeSub(id: string) {
  form.subtasks = form.subtasks.filter(x => x.id !== id)
}

async function save() {
  const title = form.title.trim()
  if (!title) {
    message.warning('请填写标题')
    return
  }
  try {
    await saveTask({
      _id: form._id || undefined,
      projectId: props.task!.projectId,
      title,
      desc: form.desc,
      columnId: form.columnId,
      subtasks: form.subtasks.map(s => ({ ...s }))
    })
    message.success(isEdit.value ? '已保存' : '已创建')
    emit('update:show', false)
  } catch (e) {
    console.error('[task-plugin] save failed', e)
    message.error('保存失败，请重试')
  }
}

async function del() {
  const t = props.task
  if (!t) return
  try {
    await removeTask(t)
    message.success('已删除')
    emit('update:show', false)
  } catch (e) {
    console.error('[task-plugin] delete failed', e)
    message.error('删除失败，请重试')
  }
}
</script>

<style scoped>
.subtasks {
  margin-top: 4px;
  padding-top: 10px;
  border-top: 1px dashed rgba(128, 128, 128, 0.3);
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.sub-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.sub-title {
  font-size: 13px;
  font-weight: 600;
}
.sub-count {
  font-size: 11px;
  font-weight: 400;
  opacity: 0.65;
  margin-left: 6px;
}
.sub-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 3px 4px;
  border-radius: 4px;
}
.sub-item:hover {
  background: rgba(128, 128, 128, 0.1);
}
.sub-label {
  flex: 1;
  font-size: 13px;
  cursor: default;
  word-break: break-all;
}
.sub-done .sub-label {
  text-decoration: line-through;
  opacity: 0.5;
}
.sub-op {
  border: none;
  background: transparent;
  cursor: pointer;
  font-size: 11px;
  border-radius: 4px;
  opacity: 0;
  padding: 1px 5px;
}
.sub-item:hover .sub-op {
  opacity: 0.65;
}
.sub-op.danger:hover {
  background: rgba(208, 48, 80, 0.12);
  color: #d03050;
  opacity: 1;
}
.footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.right {
  display: flex;
  gap: 8px;
}
</style>
