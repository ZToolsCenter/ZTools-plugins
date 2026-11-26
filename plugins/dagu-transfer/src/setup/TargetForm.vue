<script setup>
// 上传目标的表单字段：添加时在列表上方，编辑时在被编辑行下方展开（inline），两处共用同一份字段。
// 表单只是草稿的编辑视图，提交/取消/选目录都交回给父级处理。
import { ref } from 'vue';
import { iconMarkup } from '../ui/icons.js';

defineProps({
  form: { type: Object, required: true },
  errors: { type: Object, required: true },
  editing: { type: Boolean, default: false },
  // inline：在被编辑行下方展开的样式（缩进对齐行内容）。
  inline: { type: Boolean, default: false }
});

const emit = defineEmits(['submit', 'cancel', 'pick-directory']);

const showPassword = ref(false);
</script>

<template>
  <form class="form-grid target-form" :class="{ 'target-form-inline': inline }" novalidate @submit.prevent="emit('submit')">
    <label class="field" :class="{ 'full-field': form.type === 'ssh' }">
      <span>名称</span>
      <input v-model="form.name" data-field="name" />
      <small v-if="errors.name" class="field-error">{{ errors.name }}</small>
    </label>

    <template v-if="form.type === 'local'">
      <label class="field full-field">
        <span>本地目录</span>
        <span class="field-control">
          <input v-model="form.dir" data-field="dir" />
          <button type="button" class="secondary-button" @click="emit('pick-directory', 'dir')">浏览…</button>
        </span>
        <small v-if="errors.dir" class="field-error">{{ errors.dir }}</small>
      </label>
    </template>

    <template v-else>
      <label class="field">
        <span>SSH 目标</span>
        <input v-model="form.target" data-field="target" placeholder="主机、账号@主机，或 ~/.ssh/config 里的别名" />
        <small v-if="errors.target" class="field-error">{{ errors.target }}</small>
      </label>
      <label class="field">
        <span>端口</span>
        <input v-model="form.port" data-field="port" placeholder="留空用 ~/.ssh/config 或 22" />
        <small v-if="errors.port" class="field-error">{{ errors.port }}</small>
      </label>
      <label class="field full-field">
        <span>远端目录</span>
        <input v-model="form.remoteDir" data-field="remote-dir" placeholder="/绝对路径" />
        <small v-if="errors.remoteDir" class="field-error">{{ errors.remoteDir }}</small>
      </label>
      <label class="field">
        <span>用户名（可选）</span>
        <input v-model="form.username" data-field="username" placeholder="留空则按 SSH 目标里填的账号连接" />
        <small v-if="errors.username" class="field-error">{{ errors.username }}</small>
      </label>
      <label class="field full-field">
        <span>登录密码（可选）</span>
        <span class="field-control">
          <input
            v-model="form.password"
            data-field="password"
            :type="showPassword ? 'text' : 'password'"
            autocomplete="new-password"
            placeholder="留空则用密钥免密登录"
          />
          <button type="button" class="text-button" :aria-pressed="showPassword" @click="showPassword = !showPassword">
            {{ showPassword ? '隐藏' : '显示' }}
          </button>
        </span>
        <small v-if="errors.password" class="field-error">{{ errors.password }}</small>
      </label>
    </template>

    <div class="form-actions">
      <button type="submit" class="primary-button">{{ editing ? '更新' : '添加' }}</button>
      <button type="button" class="secondary-button" @click="emit('cancel')">取消</button>
    </div>
  </form>
</template>
