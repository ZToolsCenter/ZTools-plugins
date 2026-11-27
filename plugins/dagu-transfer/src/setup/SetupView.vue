<script setup>
import { computed, onMounted, ref } from 'vue';
import { targetAuthLabel, targetDestination } from '../core/targets.js';
import { iconMarkup } from '../ui/icons.js';
import TargetForm from './TargetForm.vue';
import { createDraft, isDirty, moveTarget, newTargetForm, removeTarget, splitTargetForForm, upsertTarget } from './settings-draft.js';

const props = defineProps({
  host: { type: Object, default: null },
  configStore: { type: Object, required: true }
});

const GUIDE = [
  '上传目标是把文件放到哪里：本地目录，或 SSH 服务器上的目录。上传时是一个下拉列表，上次使用的目标排在第一行，回车即上传。',
  '下载目录留空时用系统默认的下载目录。',
  'SSH 服务器默认用密钥免密登录（~/.ssh/config、SSH Agent 或已加载的私钥）。也可以给某台服务器填写「登录密码」，上传和下载都会用它登录；密码留空就是免密登录。'
];

// 所有改动都先留在草稿里，点「保存设置」才写入存储；saved 是上一次保存的内容，用来判断有没有未保存的改动。
const saved = ref(createDraft({}));
const draft = ref(createDraft({}));
// 正在添加或编辑的目标；为 null 表示没有打开表单。
const form = ref(null);
const editing = ref(false);
const errors = ref({});
const notice = ref('');
const loadFailed = ref(false);
const saving = ref(false);
const loaded = ref(false);

const dirty = computed(() => isDirty(draft.value, saved.value));
const status = computed(() => {
  if (!loaded.value) return '';
  if (loadFailed.value) return '读取配置失败';
  if (notice.value === '保存失败') return notice.value;
  if (dirty.value) return '有未保存的改动';
  return notice.value || '已保存';
});
const statusTone = computed(() => (loadFailed.value || notice.value === '保存失败' ? 'danger' : dirty.value ? 'warning' : ''));
const downloadLabel = computed(() => draft.value.downloadDir || '使用系统默认的下载目录');

onMounted(async () => {
  try {
    saved.value = createDraft(await props.configStore.load());
    draft.value = createDraft(saved.value);
  } catch {
    loadFailed.value = true;
  }
  loaded.value = true;
});

function openForm(target, isEditing) {
  errors.value = {};
  const formValue = { ...newTargetForm(target.type), ...target, password: target.password || '' };
  // 存储里的 user@host 拆开回填：账号进独立的用户名输入框，主机框只留主机部分，保存时再拼回去。
  const { username, host } = splitTargetForForm(formValue.target);
  formValue.username = username;
  formValue.target = host;
  form.value = formValue;
  editing.value = isEditing;
}

const startAdd = (type) => openForm(newTargetForm(type), false);
const startEdit = (target) => openForm(target, true);
const cancelForm = () => {
  errors.value = {};
  form.value = null;
};

// 表单只改草稿；真正写入存储要等「保存设置」。
function submitForm() {
  const result = upsertTarget(draft.value, form.value);
  errors.value = result.errors;
  if (Object.keys(result.errors).length) return;
  draft.value = result.draft;
  form.value = null;
}

function dropTarget(id) {
  draft.value = removeTarget(draft.value, id);
  if (form.value?.id === id) form.value = null;
}

const move = (id, offset) => {
  draft.value = moveTarget(draft.value, id, offset);
};

// 宿主里弹出目录选择框；普通浏览器没有这个接口，直接在输入框里填路径即可。
function pickDirectory(field) {
  const picked = props.host?.showOpenDialog?.({ title: '选择目录', properties: ['openDirectory'] });
  const dir = Array.isArray(picked) ? picked[0] : '';
  if (!dir) return;
  if (field === 'downloadDir') draft.value = { ...draft.value, downloadDir: dir };
  else if (form.value) form.value[field] = dir;
}

async function save() {
  if (saving.value || !dirty.value || loadFailed.value) return;
  saving.value = true;
  try {
    // 「上次使用的目标」不在这页编辑，保存时带上存储里最新的值（对应的目标还在时才有效）。
    const { lastUsedId } = await props.configStore.load();
    const ok = await props.configStore.saveSettings({ ...draft.value, lastUsedId });
    if (!ok) throw new Error('保存设置失败');
    saved.value = createDraft(draft.value);
    notice.value = '已保存';
  } catch {
    notice.value = '保存失败';
  }
  saving.value = false;
}

const close = () => props.host?.outPlugin?.(false);
</script>

<template>
  <main class="setup-shell">
    <section class="config-panel" aria-label="快传配置">
      <header class="config-header">
        <h2>快传配置</h2>
        <div class="setup-header-side">
          <span class="setup-notice" role="status" :data-tone="statusTone">{{ status }}</span>
          <button type="button" class="icon-button" title="关闭" @click="close">
            <span class="button-icon" v-html="iconMarkup('close')"></span>关闭
          </button>
        </div>
      </header>

      <div class="config-scroll">
        <details class="provider-guide">
          <summary>设置说明</summary>
          <div class="provider-guide-body">
            <p v-for="line in GUIDE" :key="line">{{ line }}</p>
          </div>
        </details>

        <section class="config-card" aria-label="上传目标">
          <div class="card-label">
            <span>上传目标</span>
            <small>列表里上次使用的目标排在第一行</small>
            <span class="setup-actions">
              <button type="button" class="secondary-button" @click="startAdd('local')">添加本地目录</button>
              <button type="button" class="secondary-button" @click="startAdd('ssh')">添加 SSH 服务器</button>
            </span>
          </div>

          <!-- 添加新目标：表单保持在列表上方；编辑已有目标：表单在被编辑行下方展开（见列表内）。 -->
          <TargetForm
            v-if="form && !editing"
            :form="form"
            :errors="errors"
            :editing="editing"
            @submit="submitForm"
            @cancel="cancelForm"
            @pick-directory="pickDirectory"
          />

          <p v-if="loaded && !loadFailed && !draft.targets.length" class="setup-empty">还没有上传目标。添加一个本地目录或 SSH 服务器。</p>
          <ul v-else-if="!loadFailed" class="target-list" :class="{ 'target-list-editing': form && editing }">
            <template v-for="(target, index) in draft.targets" :key="target.id">
              <li class="target-item" :data-target-id="target.id">
              <span class="target-icon" v-html="iconMarkup(target.type === 'ssh' ? 'server' : 'folder')"></span>
              <span class="target-main">
                <span class="target-name">
                  {{ target.name }}
                  <span v-if="targetAuthLabel(target)" class="target-auth" :data-auth="target.password ? 'password' : 'key'">{{ targetAuthLabel(target) }}</span>
                </span>
                <span class="target-dest">{{ targetDestination(target) }}</span>
              </span>
              <span class="target-tools">
                <button type="button" class="tool-btn" title="上移" aria-label="上移" :disabled="index === 0" @click="move(target.id, -1)" v-html="iconMarkup('up')"></button>
                <button type="button" class="tool-btn" title="下移" aria-label="下移" :disabled="index === draft.targets.length - 1" @click="move(target.id, 1)" v-html="iconMarkup('down')"></button>
                <button type="button" class="tool-btn" title="编辑" aria-label="编辑" @click="startEdit(target)" v-html="iconMarkup('edit')"></button>
                <button type="button" class="tool-btn danger" title="删除" aria-label="删除" @click="dropTarget(target.id)" v-html="iconMarkup('trash')"></button>
              </span>
              </li>
              <!-- 编辑表单在被编辑行正下方展开；被编辑行移动时表单跟着走，删除时表单关闭。 -->
              <li v-if="form && editing && form.id === target.id" class="target-edit-slot">
                <TargetForm
                  :form="form"
                  :errors="errors"
                  editing
                  inline
                  @submit="submitForm"
                  @cancel="cancelForm"
                  @pick-directory="pickDirectory"
                />
              </li>
            </template>
          </ul>
        </section>

        <section class="config-card" aria-label="下载目录">
          <div class="card-label">
            <span>下载目录</span>
          </div>
          <div class="download-row">
            <span class="download-dir">{{ downloadLabel }}</span>
            <button type="button" class="secondary-button" @click="pickDirectory('downloadDir')">更改…</button>
          </div>
        </section>

        <section class="sync-warning" aria-label="同步密钥">
          <label class="switch-line">
            <input v-model="draft.syncSecrets" type="checkbox" role="switch" />
            <span class="switch-ui" aria-hidden="true"></span>
            <span>同步密钥</span>
          </label>
          <p>开启后登录密码写入 ZTools dbStorage 并随备份同步；该存储未声明端到端加密。关闭后删除同步副本，保留本机密码。</p>
        </section>
      </div>

      <footer class="config-footer">
        <span class="setup-footer-note">改动要点「保存设置」才生效</span>
        <button type="button" class="primary-button" :disabled="!loaded || loadFailed || !dirty || saving" @click="save">
          <span class="button-icon" v-html="iconMarkup('check')"></span>保存设置
        </button>
      </footer>
    </section>
  </main>
</template>
