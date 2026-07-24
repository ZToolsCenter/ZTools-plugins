<template>
  <div class="ui-autocomplete-wrapper" ref="wrapperRef" :class="{ 'is-disabled': disabled }">
    <input
      ref="inputRef"
      class="ui-autocomplete-input"
      :value="modelValue"
      :placeholder="placeholder"
      :disabled="disabled"
      @input="onInput"
      @focus="onFocus"
      @blur="onBlur"
      @keydown="onKeydown"
    />
    <Teleport to="body">
      <div
        v-if="showDropdown && filteredOptions.length > 0"
        ref="dropdownRef"
        class="ui-autocomplete-dropdown"
        :style="dropdownStyle"
        @mousedown.prevent
      >
        <div
          v-for="(option, idx) in filteredOptions"
          :key="option"
          class="ui-autocomplete-option"
          :class="{ 'is-focused': focusedIndex === idx, 'is-selected': modelValue === option }"
          @mouseenter="focusedIndex = idx"
          @click="selectOption(option)"
        >
          {{ option }}
        </div>
      </div>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onUnmounted, nextTick } from 'vue'

const props = withDefaults(defineProps<{
  modelValue: string
  options: string[]
  placeholder?: string
  disabled?: boolean
}>(), {
  modelValue: '',
  options: () => [],
  placeholder: '',
  disabled: false
})

const emit = defineEmits<{
  'update:modelValue': [value: string]
  'focus': [event: FocusEvent]
  'blur': [event: FocusEvent]
}>()

const wrapperRef = ref<HTMLElement | null>(null)
const inputRef = ref<HTMLInputElement | null>(null)
const dropdownRef = ref<HTMLElement | null>(null)

const showDropdown = ref(false)
const focusedIndex = ref(0)
const dropdownStyle = ref<Record<string, string>>({})
const filterQuery = ref('')

const filteredOptions = computed(() => {
  const query = filterQuery.value.trim().toLowerCase()
  if (!query) return props.options
  return props.options.filter(opt => opt.toLowerCase().includes(query))
})

watch(showDropdown, (val) => {
  if (val) {
    updateDropdownPosition()
    window.addEventListener('scroll', updateDropdownPosition, true)
    window.addEventListener('resize', updateDropdownPosition)
  } else {
    window.removeEventListener('scroll', updateDropdownPosition, true)
    window.removeEventListener('resize', updateDropdownPosition)
  }
})

onUnmounted(() => {
  window.removeEventListener('scroll', updateDropdownPosition, true)
  window.removeEventListener('resize', updateDropdownPosition)
})

function updateDropdownPosition() {
  if (!inputRef.value) return
  const rect = inputRef.value.getBoundingClientRect()
  dropdownStyle.value = {
    position: 'fixed',
    top: `${rect.bottom + 4}px`,
    left: `${rect.left}px`,
    width: `${rect.width}px`,
    zIndex: '9999'
  }
}

function onInput(e: Event) {
  const target = e.target as HTMLInputElement
  filterQuery.value = target.value
  emit('update:modelValue', target.value)
  showDropdown.value = true
  focusedIndex.value = 0
  nextTick(() => {
    updateDropdownPosition()
  })
}

function onFocus(e: FocusEvent) {
  emit('focus', e)
  filterQuery.value = ''
  showDropdown.value = true
  const selectedIndex = props.options.findIndex((opt) => opt === props.modelValue)
  focusedIndex.value = selectedIndex >= 0 ? selectedIndex : 0
  nextTick(() => {
    updateDropdownPosition()
    scrollToFocused()
  })
}

function onBlur(e: FocusEvent) {
  emit('blur', e)
  // small delay to allow click on option to fire before closing dropdown
  setTimeout(() => {
    showDropdown.value = false
    filterQuery.value = ''
  }, 150)
}

function selectOption(option: string) {
  emit('update:modelValue', option)
  showDropdown.value = false
  filterQuery.value = ''
  if (inputRef.value) {
    inputRef.value.focus()
  }
}

function onKeydown(e: KeyboardEvent) {
  if (!showDropdown.value) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      filterQuery.value = ''
      showDropdown.value = true
      const selectedIndex = props.options.findIndex((opt) => opt === props.modelValue)
      focusedIndex.value = selectedIndex >= 0 ? selectedIndex : 0
      updateDropdownPosition()
      scrollToFocused()
      e.preventDefault()
    }
    return
  }

  const maxIndex = filteredOptions.value.length - 1
  if (e.key === 'ArrowDown') {
    e.preventDefault()
    focusedIndex.value = focusedIndex.value < maxIndex ? focusedIndex.value + 1 : 0
    scrollToFocused()
  } else if (e.key === 'ArrowUp') {
    e.preventDefault()
    focusedIndex.value = focusedIndex.value > 0 ? focusedIndex.value - 1 : maxIndex
    scrollToFocused()
  } else if (e.key === 'Enter') {
    e.preventDefault()
    if (filteredOptions.value[focusedIndex.value]) {
      selectOption(filteredOptions.value[focusedIndex.value])
    }
  } else if (e.key === 'Escape') {
    e.preventDefault()
    showDropdown.value = false
  }
}

function scrollToFocused() {
  nextTick(() => {
    if (!dropdownRef.value) return
    const options = dropdownRef.value.querySelectorAll('.ui-autocomplete-option')
    const active = options[focusedIndex.value] as HTMLElement
    if (active) {
      if (active.offsetTop < dropdownRef.value.scrollTop) {
        dropdownRef.value.scrollTop = active.offsetTop
      } else if (active.offsetTop + active.offsetHeight > dropdownRef.value.scrollTop + dropdownRef.value.offsetHeight) {
        dropdownRef.value.scrollTop = active.offsetTop + active.offsetHeight - dropdownRef.value.offsetHeight
      }
    }
  })
}
</script>

<style scoped>
.ui-autocomplete-wrapper {
  position: relative;
  width: 100%;
  height: 100%;
}

.ui-autocomplete-input {
  width: 100%;
  height: 100%;
  padding: 6px 12px;
  border: none;
  background: transparent;
  color: var(--text-primary);
  font-size: 13px;
  font-family: inherit;
  outline: none;
}

.ui-autocomplete-input::placeholder {
  color: var(--text-muted);
  font-family: inherit;
}

.ui-autocomplete-wrapper.is-disabled .ui-autocomplete-input {
  cursor: not-allowed;
}

.ui-autocomplete-dropdown {
  background: var(--bg-surface);
  border: 1px solid var(--border-color);
  border-radius: 8px;
  box-shadow: var(--shadow-md);
  max-height: 240px;
  overflow-y: auto;
  padding: 4px;
  font-size: 13px;
}

.ui-autocomplete-option {
  padding: 6px 10px;
  cursor: pointer;
  border-radius: var(--radius-xs);
  color: var(--text-primary);
  transition: background var(--transition-fast), color var(--transition-fast);
}

.ui-autocomplete-option:hover,
.ui-autocomplete-option.is-focused {
  background: var(--bg-elevated);
}

.ui-autocomplete-option.is-selected {
  background: var(--accent-primary);
  color: var(--bg-surface);
}
</style>
