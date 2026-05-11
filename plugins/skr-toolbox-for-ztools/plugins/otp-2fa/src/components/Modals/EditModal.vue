<script setup lang="ts">
import { ref, nextTick, watch } from 'vue'

const props = defineProps<{
  show: boolean,
  title: string,
  modelValue: any,
  activeDropdown: string | null,
  nameError: boolean,
  nameWarn: boolean,
  secretError: boolean,
  secretErrorMsg: string,
  showSecret: boolean
}>()

const emits = defineEmits([
  'update:show', 'update:modelValue', 'update:activeDropdown', 
  'update:showSecret', 'submit', 'eye-click'
])

const nameInput = ref<HTMLInputElement | null>(null)

watch(() => props.show, (val) => {
  if (val) {
    nextTick(() => nameInput.value?.focus())
  }
})

const handleTypeClick = (t: string) => {
  const newVal = { ...props.modelValue, type: t }
  emits('update:modelValue', newVal)
  emits('update:activeDropdown', null)
}

const handleAlgoClick = (algo: string) => {
  const newVal = { ...props.modelValue, algorithm: algo }
  emits('update:modelValue', newVal)
  emits('update:activeDropdown', null)
}

const handleDigitsClick = (d: number) => {
  const newVal = { ...props.modelValue, digits: d }
  emits('update:modelValue', newVal)
  emits('update:activeDropdown', null)
}

const handlePeriodClick = (p: number) => {
  const newVal = { ...props.modelValue, period: p }
  emits('update:modelValue', newVal)
  emits('update:activeDropdown', null)
}
</script>

<template>
  <transition name="modal-fade">
    <div class="modal-overlay" v-if="show" @click.self="emits('update:show', false)">
      <div class="modal-content">
        <h3 class="modal-title">{{ title }}</h3>
        <div class="form-row">
          <div class="form-item full-width">
            <label>
              <span>账号名称</span>
              <span v-if="nameError" class="label-error">请输入账号名称</span>
              <span v-else-if="nameWarn" class="label-warn">已存在同名账号，再次确认保存</span>
            </label>
            <input type="text" v-model="modelValue.name" placeholder="例如: Github" ref="nameInput" spellcheck="false">
          </div>
          <div class="form-item full-width">
            <label>
              <span>密钥 (所有密钥都加密存储)</span>
              <span v-if="secretError" class="label-error">{{ secretErrorMsg }}</span>
            </label>
            <div class="form-input-container">
              <input :type="showSecret ? 'text' : 'password'" v-model="modelValue.secret" placeholder="例如：A1B2C3D4..." spellcheck="false">
              <div class="eye-btn" @click="emits('eye-click')">
                <svg v-if="showSecret" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>
                <svg v-else width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path><line x1="1" y1="1" x2="23" y2="23"></line></svg>
              </div>
            </div>
          </div>

          <div class="form-item">
            <label>类型</label>
            <div class="settings-select" :class="{ open: activeDropdown === 'type', disabled: modelValue.id }"
              @click.stop="!modelValue.id && emits('update:activeDropdown', activeDropdown === 'type' ? null : 'type')">
              <span>{{ modelValue.type === 'steam' ? 'Steam 令牌' : modelValue.type.toUpperCase() }}</span>
              <svg class="arrow" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="6 9 12 15 18 9"></polyline>
              </svg>
              <div class="select-menu up" v-if="activeDropdown === 'type'">
                <div class="select-item" v-for="t in ['totp', 'hotp', 'steam']" :key="t"
                  :class="{ active: modelValue.type === t }" @click.stop="handleTypeClick(t)">
                  <span>{{ t === 'steam' ? 'Steam 令牌' : t.toUpperCase() }}</span>
                  <svg v-if="modelValue.type === t" width="12" height="12" viewBox="0 0 24 24" fill="none"
                    stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
                    <polyline points="20 6 9 17 4 12"></polyline>
                  </svg>
                </div>
              </div>
            </div>
          </div>

          <div class="form-item">
            <label>算法</label>
            <div class="settings-select"
              :class="{ open: activeDropdown === 'algo', disabled: modelValue.type === 'steam' || modelValue.id }"
              @click.stop="modelValue.type !== 'steam' && !modelValue.id && emits('update:activeDropdown', activeDropdown === 'algo' ? null : 'algo')">
              <span>{{ modelValue.algorithm }}</span>
              <svg class="arrow" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="6 9 12 15 18 9"></polyline>
              </svg>
              <div class="select-menu up" v-if="activeDropdown === 'algo'">
                <div v-for="algo in ['SHA1', 'SHA256', 'SHA512']" :key="algo" class="select-item"
                  :class="{ active: modelValue.algorithm === algo }"
                  @click.stop="handleAlgoClick(algo)">
                  <span>{{ algo }}</span>
                  <svg v-if="modelValue.algorithm === algo" width="12" height="12" viewBox="0 0 24 24" fill="none"
                    stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
                    <polyline points="20 6 9 17 4 12"></polyline>
                  </svg>
                </div>
              </div>
            </div>
          </div>

          <div class="form-item">
            <label>位数</label>
            <div class="settings-select"
              :class="{ open: activeDropdown === 'digits', disabled: modelValue.type === 'steam' || modelValue.id }"
              @click.stop="modelValue.type !== 'steam' && !modelValue.id && emits('update:activeDropdown', activeDropdown === 'digits' ? null : 'digits')">
              <span>{{ modelValue.digits }}</span>
              <svg class="arrow" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="6 9 12 15 18 9"></polyline>
              </svg>
              <div class="select-menu up" v-if="activeDropdown === 'digits'">
                <div v-for="d in [6, 7, 8]" :key="d" class="select-item" :class="{ active: modelValue.digits === d }"
                  @click.stop="handleDigitsClick(d)">
                  <span>{{ d }}</span>
                  <svg v-if="modelValue.digits === d" width="12" height="12" viewBox="0 0 24 24" fill="none"
                    stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
                    <polyline points="20 6 9 17 4 12"></polyline>
                  </svg>
                </div>
              </div>
            </div>
          </div>

          <div class="form-item">
            <label v-if="modelValue.type === 'totp' || modelValue.type === 'steam'">时间间隔</label>
            <label v-else-if="modelValue.type === 'hotp'">计数器</label>
            <label v-else>设置</label>

            <div v-if="modelValue.type === 'totp' || modelValue.type === 'steam'" class="settings-select"
              :class="{ open: activeDropdown === 'period', disabled: modelValue.type === 'steam' || modelValue.id }"
              @click.stop="modelValue.type !== 'steam' && !modelValue.id && emits('update:activeDropdown', activeDropdown === 'period' ? null : 'period')">
              <span>{{ modelValue.period }}s</span>
              <svg class="arrow" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="6 9 12 15 18 9"></polyline>
              </svg>
              <div class="select-menu up" v-if="activeDropdown === 'period'">
                <div v-for="p in [15, 30, 60]" :key="p" class="select-item"
                  :class="{ active: modelValue.period === p }" @click.stop="handlePeriodClick(p)">
                  <span>{{ p }}s</span>
                  <svg v-if="modelValue.period === p" width="12" height="12" viewBox="0 0 24 24" fill="none"
                    stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
                    <polyline points="20 6 9 17 4 12"></polyline>
                  </svg>
                </div>
              </div>
            </div>
            <input v-else type="number" v-model="modelValue.counter" placeholder="1" :disabled="!!modelValue.id">
          </div>
        </div>
        <div class="modal-actions">
          <button class="btn btn-secondary" @click="emits('update:show', false)">取消</button>
          <button class="btn btn-primary" @click="emits('submit')">
            <span class="btn-text">确定</span>
          </button>
        </div>
      </div>
    </div>
  </transition>
</template>
