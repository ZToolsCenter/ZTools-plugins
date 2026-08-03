<script setup lang="ts">
import { ref, nextTick, onMounted } from 'vue'

interface CalcRow {
  id: number
  type: 'calculated' | 'input'
  expression?: string
  result?: string | number
  error?: boolean
  editing?: boolean
}

let nextId = 0
const rows = ref<CalcRow[]>([{ id: nextId++, type: 'input' }])

function makeInputRow(): CalcRow {
  return { id: nextId++, type: 'input' }
}

function makeCalcRow(expr: string, res: { value?: number; error: boolean }): CalcRow {
  return {
    id: nextId++,
    type: 'calculated',
    expression: expr,
    result: res.error ? 'Error' : res.value,
    error: res.error
  }
}

function safeEval(expr: string): { value?: number; error: boolean } {
  let e = expr.replace(/÷/g, '/').replace(/×/g, '*').replace(/\^/g, '**').replace(/%/g, '/100').replace(/--/g, '+')
  if (!/^[\d+\-*/().%\s^*]+$/.test(e)) return { error: true }
  try {
    const result = Function('"use strict"; return (' + e + ')')()
    if (typeof result !== 'number' || !isFinite(result)) return { error: true }
    return { value: result, error: false }
  } catch {
    return { error: true }
  }
}

function focusLastInput() {
  nextTick(() => {
    const lastInput = document.querySelector('.row:last-child .expr-input') as HTMLInputElement | null
    lastInput?.focus()
  })
}

function focusEditingInput() {
  nextTick(() => {
    const input = document.querySelector('.editing-input') as HTMLInputElement | null
    if (input) {
      input.focus()
      input.setSelectionRange(input.value.length, input.value.length)
    }
  })
}

// ---- New input calculation ----
function calculateInput(input: HTMLInputElement) {
  const expr = input.value.trim()
  if (!expr) {
    input.value = ''
    input.placeholder = '请输入算式'
    input.classList.add('shake')
    setTimeout(() => input.classList.remove('shake'), 400)
    return
  }
  const rowDiv = input.closest('.row') as HTMLElement | null
  if (!rowDiv) return
  const idx = parseInt(rowDiv.dataset.index || '')
  if (isNaN(idx) || idx < 0 || idx >= rows.value.length || rows.value[idx].type !== 'input') return

  const result = safeEval(expr)
  const calcRow = makeCalcRow(expr, result)
  const newRows = [...rows.value]
  newRows[idx] = calcRow
  newRows.push(makeInputRow())
  rows.value = newRows
  focusLastInput()
}

// ---- Edit mode calculation ----
function recalculateEditing(idx: number, expr: string) {
  if (!expr) {
    // Shake - keep editing
    const input = document.querySelector(`.row[data-index="${idx}"] .editing-input`) as HTMLInputElement | null
    if (input) {
      input.value = ''
      input.placeholder = '请输入算式'
      input.classList.add('shake')
      setTimeout(() => input.classList.remove('shake'), 400)
    }
    return
  }

  const result = safeEval(expr)
  const calcRow = makeCalcRow(expr, result)
  const newRows = [...rows.value]
  newRows[idx] = calcRow
  rows.value = newRows
}

// ---- Start editing ----
function startEditing(idx: number) {
  const newRows = [...rows.value]
  newRows[idx] = { ...newRows[idx], editing: true }
  rows.value = newRows
  focusEditingInput()
}

// ---- Input events (for new input rows) ----
function handleInput(e: Event) {
  const input = e.target as HTMLInputElement
  if (!input.classList.contains('expr-input') || input.classList.contains('editing-input')) return
  const val = input.value
  if (val.endsWith('=')) {
    input.value = val.slice(0, -1)
    calculateInput(input)
  }
}

function handleKeydown(e: KeyboardEvent) {
  if (e.key !== 'Enter') return
  const input = e.target as HTMLInputElement
  if (!input.classList.contains('expr-input') || input.classList.contains('editing-input')) return
  e.preventDefault()
  calculateInput(input)
}

// ---- Edit input events ----
function handleEditingInput(e: Event, idx: number) {
  const input = e.target as HTMLInputElement
  const val = input.value
  if (val.endsWith('=')) {
    input.value = val.slice(0, -1)
    recalculateEditing(idx, val.slice(0, -1))
  }
}

function handleEditingKeydown(e: KeyboardEvent, idx: number) {
  if (e.key !== 'Enter') return
  e.preventDefault()
  const input = e.target as HTMLInputElement
  recalculateEditing(idx, input.value.trim())
}

function handleEditingBlur(e: Event, idx: number) {
  const input = e.target as HTMLInputElement
  if (idx < 0 || idx >= rows.value.length) return
  const newExpr = input.value.trim()
  if (!newExpr || newExpr === rows.value[idx].expression) {
    const newRows = [...rows.value]
    newRows[idx] = { ...newRows[idx], editing: false }
    rows.value = newRows
    return
  }
  recalculateEditing(idx, newExpr)
}

const showConfirmDialog = ref(false)

function clearAll() {
  if (rows.value.length <= 1) return
  showConfirmDialog.value = true
}

function confirmClear() {
  showConfirmDialog.value = false
  rows.value = [makeInputRow()]
}

function cancelClear() {
  showConfirmDialog.value = false
}

function saveToTxt() {
  const calculatedRows = rows.value.filter(r => r.type === 'calculated')
  if (calculatedRows.length === 0) {
    if (window.ztools) window.ztools.showNotification('没有可保存的计算记录')
    else alert('没有可保存的计算记录')
    return
  }
  const lines = calculatedRows.map(r => {
    const resultText = r.error ? 'Error' : r.result
    return r.expression + ' = ' + resultText
  })
  const content = lines.join('\r\n')
  const now = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  const timestamp = now.getFullYear() + pad(now.getMonth()+1) + pad(now.getDate()) + '_' + pad(now.getHours()) + pad(now.getMinutes()) + pad(now.getSeconds())
  const filename = '计算草稿_' + timestamp + '.txt'

  try {
    if (window.services) {
      const savedPath = window.services.saveTextFile(content, filename)
      if (savedPath) {
        if (window.ztools) window.ztools.showNotification('已保存到: ' + savedPath)
        else alert('已保存到: ' + savedPath)
      }
      return
    }
    throw new Error('no preload')
  } catch {
    // Fallback: browser download
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }
}

// ---- Init ----
  onMounted(() => {
  const rowsAreaEl = document.querySelector('.calc-rows') as HTMLElement
  rowsAreaEl?.addEventListener('input', handleInput)
  rowsAreaEl?.addEventListener('keydown', handleKeydown)

  const clearBtn = document.getElementById('clearBtn') as HTMLElement | null
  const saveBtn = document.getElementById('saveBtn') as HTMLElement | null
  clearBtn?.addEventListener('click', clearAll)
  saveBtn?.addEventListener('click', saveToTxt)
})
</script>

<template>
  <div class="calc-container">
    <div class="calc-header">
      <h1 class="calc-title">计算草稿</h1>
      <span class="calc-hint">输入算式，按回车 或 = 计算结果</span>
    </div>

    <div class="calc-rows">
      <div
        v-for="(row, idx) in rows"
        :key="row.id"
        class="row"
        :data-index="idx"
      >
        <template v-if="row.type === 'calculated'">
          <input
            v-if="row.editing"
            class="expr-input editing-input"
            type="text"
            :value="row.expression"
             spellcheck="false"
             @input="handleEditingInput($event, idx)"
             @keydown="handleEditingKeydown($event, idx)"
             @blur="handleEditingBlur($event, idx)"
          />
          <span v-else class="expr-display" @click="startEditing(idx)">{{ row.expression }}</span>
          <span class="result-display">{{ row.error ? '= Error' : '= ' + row.result }}</span>
        </template>
        <input
          v-else
          class="expr-input"
          type="text"
          placeholder=""
          autofocus
          spellcheck="false"
          @input="handleInput"
          @keydown="handleKeydown"
        />
      </div>
    </div>

    <!-- Confirm dialog -->
    <div v-if="showConfirmDialog" class="dialog-overlay" @click.self="cancelClear">
      <div class="dialog-box">
        <p class="dialog-msg">确认清空所有计算记录？</p>
        <div class="dialog-buttons">
          <button class="dialog-btn dialog-btn-cancel" @click="cancelClear">取消</button>
          <button class="dialog-btn dialog-btn-confirm" @click="confirmClear">确认</button>
        </div>
      </div>
    </div>

    <div class="calc-footer">
      <div class="calc-buttons">
        <button class="btn-icon" title="清屏" @click="clearAll">
          <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
            <path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM8 9h8v10H8V9zm7.5-5l-1-1h-5l-1 1H5v2h14V4h-3.5z"/>
          </svg>
        </button>
        <button class="btn-icon" title="保存" @click="saveToTxt">
          <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
            <path d="M17 3H5c-1.11 0-2 .9-2 2v14c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V7l-4-4zm-5 16c-1.66 0-3-1.34-3-3s1.34-3 3-3 3 1.34 3 3-1.34 3-3 3zm3-10H5V5h10v4z"/>
          </svg>
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.calc-container {
  width: 100%;
  height: 100vh;
  background: #faf6ed;
  border: 1px solid #d4c9b8;
  border-radius: 16px;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  box-sizing: border-box;
  box-shadow: 0 4px 24px rgba(0,0,0,0.06);
  font-family: 'Segoe UI', 'Arial', 'PingFang SC', 'Microsoft YaHei', sans-serif;
  color: #5a4a3a;
}

.calc-header {
  flex-shrink: 0;
  padding: 24px 40px 16px;
  border-bottom: 1px solid #e8e0d0;
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.calc-title {
  font-size: 18px;
  font-weight: 600;
  color: #5a4a3a;
  letter-spacing: 0.5px;
  margin: 0;
}

.calc-hint {
  font-size: 13px;
  color: #b0a090;
}

.calc-rows {
  flex: 1;
  overflow-y: auto;
  overflow-x: hidden;
  min-height: 0;
}

.row {
  width: 100%;
  min-height: 64px;
  border-bottom: 1px solid #ece5d8;
  display: flex;
  align-items: center;
  padding: 14px 40px;
  background: #faf6ed;
  flex-shrink: 0;
  box-sizing: border-box;
  transition: background 0.15s;
}
.row:last-child {
  border-bottom: none;
}
.row:hover {
  background: #f8f3e8;
}

.expr-display {
  font-size: 18px;
  color: #5a4a3a;
  flex: 1;
  min-width: 0;
  padding-right: 20px;
  font-weight: 450;
  outline: none;
  word-break: break-all;
  white-space: pre-wrap;
}
.expr-display.editing {
  caret-color: #5a4a3a;
}

.result-display {
  font-size: 24px;
  color: #8b6f4e;
  white-space: nowrap;
  flex-shrink: 0;
  font-weight: 500;
  letter-spacing: 0.5px;
}

.expr-input {
  font-size: 18px;
  color: #5a4a3a;
  border: none;
  background: transparent;
  outline: none;
  font-family: inherit;
  flex: 1;
  min-width: 0;
  padding: 4px 0;
  caret-color: #8b6f4e;
  font-weight: 450;
}
.expr-input.shake {
  animation: shakeInput 0.35s ease;
}
.expr-display.shake {
  animation: shakeInput 0.35s ease;
}
.expr-input::placeholder {
  color: #c0392b;
  font-size: 18px;
}

@keyframes shakeInput {
  0%, 100% { transform: translateX(0); }
  20% { transform: translateX(-6px); }
  40% { transform: translateX(6px); }
  60% { transform: translateX(-4px); }
  80% { transform: translateX(4px); }
}

.calc-footer {
  flex-shrink: 0;
  border-top: 1px solid #e8e0d0;
  padding: 14px 0;
  display: flex;
  justify-content: center;
}

.calc-buttons {
  display: flex;
  gap: 24px;
}

.btn-icon {
  width: 36px;
  height: 36px;
  cursor: pointer;
  border: none;
  background: #ece5d8;
  border-radius: 50%;
  padding: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s;
  color: #8b7a6a;
}
.btn-icon:hover {
  background: #e0d6c4;
  transform: scale(1.05);
  color: #6b5a4a;
}
.btn-icon:active {
  transform: scale(0.95);
}
.btn-icon svg {
  width: 18px;
  height: 18px;
  display: block;
  fill: currentColor;
}

/* ---- Confirm Dialog ---- */
.dialog-overlay {
  position: absolute;
  inset: 0;
  background: rgba(0,0,0,0.25);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 100;
}
.dialog-box {
  background: #faf6ed;
  border: 1px solid #d4c9b8;
  border-radius: 12px;
  padding: 28px 32px 24px;
  min-width: 280px;
  box-shadow: 0 8px 32px rgba(0,0,0,0.12);
  text-align: center;
}
.dialog-msg {
  font-size: 16px;
  color: #5a4a3a;
  margin: 0 0 24px;
  line-height: 1.5;
}
.dialog-buttons {
  display: flex;
  justify-content: center;
  gap: 16px;
}
.dialog-btn {
  padding: 8px 28px;
  border-radius: 8px;
  border: 1px solid #d4c9b8;
  font-size: 14px;
  cursor: pointer;
  font-family: inherit;
  transition: all 0.15s;
}
.dialog-btn-cancel {
  background: #faf6ed;
  color: #8b7a6a;
}
.dialog-btn-cancel:hover {
  background: #ece5d8;
}
.dialog-btn-confirm {
  background: #c0392b;
  color: #fff;
  border-color: #c0392b;
}
.dialog-btn-confirm:hover {
  background: #a93226;
}

@media (max-width: 600px) {
  .calc-header { padding: 16px 20px 12px; }
  .calc-title { font-size: 16px; }
  .calc-hint { font-size: 12px; }
  .row { padding: 12px 20px; min-height: 54px; }
  .expr-display { font-size: 16px; padding-right: 12px; }
  .result-display { font-size: 20px; }
  .expr-input { font-size: 16px; }
  .calc-footer { padding: 10px 0; }
  .calc-buttons { gap: 20px; }
  .btn-icon { width: 32px; height: 32px; }
  .btn-icon svg { width: 16px; height: 16px; }
}
</style>
