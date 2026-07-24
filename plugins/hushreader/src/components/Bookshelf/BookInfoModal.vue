<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import type { Book } from '../../stores/books'
import { useBookStore } from '../../stores/books'
import { saveCustomCover } from '../../utils/db'

const props = defineProps<{ book: Book }>()
const emit = defineEmits<{
  close: []
  saved: [updates: Partial<Book>]
}>()

const bookStore = useBookStore()

const existingCategories = computed(() => bookStore.categories.filter(c => c !== '全部'))

const isEditing = ref(false)

const editTitle = ref('')
const editAuthor = ref('')
const editDescription = ref('')
const editCategories = ref<string[]>([])
const editNewCategory = ref('')

const imgError = ref(false)

const displayCover = computed(() => {
  if (imgError.value) return undefined
  return props.book.customCoverImage || props.book.coverImage
})

function formatDateTime(ts: number | undefined): string {
  if (!ts) return '-'
  const d = new Date(ts)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

function formatReadingTime(ms: number | undefined): string {
  if (!ms) return '00:00:00'
  const totalSeconds = Math.floor(ms / 1000)
  const h = Math.floor(totalSeconds / 3600)
  const m = Math.floor((totalSeconds % 3600) / 60)
  const s = totalSeconds % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

function formatReadingSpeed(speed: number | undefined): string {
  if (!speed) return '-'
  return String(Math.round(speed))
}

function enterEditMode() {
  editTitle.value = props.book.title
  editAuthor.value = props.book.author
  editDescription.value = props.book.description || ''
  editCategories.value = [...(props.book.categories || [])]
  editNewCategory.value = ''
  isEditing.value = true
}

function cancelEdit() {
  isEditing.value = false
}

function toggleEditCategory(cat: string) {
  const idx = editCategories.value.indexOf(cat)
  if (idx > -1) {
    editCategories.value.splice(idx, 1)
  } else {
    editCategories.value.push(cat)
  }
}

function uploadCover() {
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = 'image/*'
  input.onchange = () => {
    const file = input.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      const data = reader.result as string
      emit('saved', { customCoverImage: data, updatedAt: Date.now() })
      saveCustomCover(props.book.id, data).catch(() => { })
    }
    reader.readAsDataURL(file)
  }
  input.click()
}

function addCustomCategory() {
  const val = editNewCategory.value.trim()
  if (!val) return
  const cats = val.split(/[,，]/).map(s => s.trim()).filter(Boolean)
  cats.forEach(c => {
    if (!editCategories.value.includes(c)) {
      editCategories.value.push(c)
    }
  })
  editNewCategory.value = ''
}

function saveEdit() {
  addCustomCategory()
  const finalCats = [...new Set(editCategories.value)]

  const updates: Partial<Book> = {
    title: editTitle.value.trim() || '未命名',
    author: editAuthor.value.trim(),
    description: editDescription.value.trim() || undefined,
    categories: finalCats.length > 0 ? finalCats : undefined,
    updatedAt: Date.now()
  }
  emit('saved', updates)
  isEditing.value = false
}

watch(() => props.book, () => {
  imgError.value = false
  isEditing.value = false
})
</script>

<template>
  <div class="info-overlay" @click.self="emit('close')">
    <div class="info-box">
      <div class="info-header">
        <h3 class="info-title">书籍信息</h3>
        <button class="info-close" @click="emit('close')">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>
      <div class="info-body">
        <!-- Card 1: Cover + Title/Author -->
        <div class="info-card">
          <div class="cover-section">
            <div v-if="!isEditing" class="cover-thumb"
              :style="displayCover ? {} : { background: book.coverColor || '#4a7fa5' }">
              <img v-if="displayCover" :src="displayCover" :alt="book.title" class="cover-img"
                @error="imgError = true" />
              <template v-else>
                <span class="cover-format">{{ book.format.toUpperCase() }}</span>
                <span class="cover-title-text">{{ book.title }}</span>
              </template>
            </div>
            <div v-else class="cover-thumb editable" @click="uploadCover">
              <img v-if="displayCover" :src="displayCover" :alt="book.title" class="cover-img"
                @error="imgError = true" />
              <template v-else>
                <span class="cover-format">{{ book.format.toUpperCase() }}</span>
                <span class="cover-title-text">{{ book.title }}</span>
              </template>
              <div class="cover-upload-hint">点击更换</div>
            </div>
          </div>
          <div class="title-section">
            <template v-if="!isEditing">
              <h2 class="book-main-title">{{ book.title }}</h2>
              <p class="book-main-author">{{ book.author || '未知作者' }}</p>
              <span class="book-format-badge">{{ book.format.toUpperCase() }}</span>
            </template>
            <template v-else>
              <label class="edit-label">标题</label>
              <input v-model="editTitle" class="edit-input" placeholder="书籍标题" />
              <label class="edit-label">作者</label>
              <input v-model="editAuthor" class="edit-input" placeholder="作者名称" />
            </template>
          </div>
        </div>

        <!-- Card 2: Description -->
        <div class="info-card">
          <div class="card-label">简介</div>
          <template v-if="!isEditing">
            <p v-if="book.description" class="description-text">{{ book.description }}</p>
            <p v-else class="description-empty">暂无简介</p>
          </template>
          <template v-else>
            <textarea v-model="editDescription" class="edit-textarea" placeholder="输入书籍简介..." rows="4"></textarea>
          </template>
        </div>

        <!-- Card 3: Categories -->
        <div class="info-card">
          <div class="card-label">分类</div>
          <template v-if="!isEditing">
            <div v-if="book.categories?.length" class="category-list">
              <span v-for="cat in book.categories" :key="cat" class="category-chip">{{ cat }}</span>
            </div>
            <p v-else class="description-empty">未分类</p>
          </template>
          <template v-else>
            <div v-if="existingCategories.length" class="edit-category-pick">
              <button v-for="cat in existingCategories" :key="cat" class="category-chip toggleable"
                :class="{ active: editCategories.includes(cat) }" @click="toggleEditCategory(cat)">{{ cat }}</button>
            </div>
            <div class="edit-category-tags" style="margin-top: 8px">
              <button v-for="cat in editCategories.filter(c => !existingCategories.includes(c))" :key="cat"
                class="category-chip removable" @click="toggleEditCategory(cat)">
                {{ cat }}
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
            <input v-model="editNewCategory" class="edit-input" placeholder="新分类，回车或逗号添加..." style="margin-top: 8px"
              @keydown.enter.prevent="addCustomCategory" @keydown.comma.prevent="addCustomCategory"
              @blur="addCustomCategory" />
          </template>
        </div>

        <!-- Card 4: Reading Info -->
        <div class="info-card">
          <div class="card-label">阅读信息</div>
          <div class="reading-grid">
            <div class="reading-item">
              <span class="reading-key">导入时间</span>
              <span class="reading-val">{{ formatDateTime(book.addedAt) }}</span>
            </div>
            <div class="reading-item">
              <span class="reading-key">更新时间</span>
              <span class="reading-val">{{ formatDateTime(book.updatedAt || book.addedAt) }}</span>
            </div>
            <div class="reading-item">
              <span class="reading-key">首次阅读</span>
              <span class="reading-val">{{ formatDateTime(book.firstReadAt) }}</span>
            </div>
            <div class="reading-item">
              <span class="reading-key">最近阅读</span>
              <span class="reading-val">{{ formatDateTime(book.lastReadAt) }}</span>
            </div>
            <div class="reading-item">
              <span class="reading-key">阅读时长</span>
              <span class="reading-val">{{ formatReadingTime(book.readingTimeMs) }}</span>
            </div>
            <div class="reading-item">
              <span class="reading-key">阅读速度</span>
              <span class="reading-val">{{ formatReadingSpeed(book.readingSpeed) }} 字/分钟</span>
            </div>
          </div>
        </div>
      </div>

      <!-- Footer buttons -->
      <div class="info-footer">
        <template v-if="!isEditing">
          <button class="btn-secondary" @click="emit('close')">关闭</button>
          <button class="btn-primary" @click="enterEditMode">编辑</button>
        </template>
        <template v-else>
          <button class="btn-secondary" @click="cancelEdit">取消</button>
          <button class="btn-primary" @click="saveEdit">保存</button>
        </template>
      </div>
    </div>
  </div>
</template>

<style scoped>
.info-overlay {
  position: fixed;
  inset: 0;
  background: var(--c-overlay-bg);
  backdrop-filter: blur(4px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 8000;
  animation: fade-in 0.15s var(--ease-out);
}

.info-box {
  background: var(--c-surface-overlay);
  border: 1px solid var(--c-border);
  border-radius: var(--radius-xl);
  width: 90%;
  max-width: 520px;
  max-height: 85vh;
  display: flex;
  flex-direction: column;
  box-shadow: var(--shadow-xl);
  animation: slide-up 0.2s var(--ease-out);
}

.info-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px 14px;
  border-bottom: 1px solid var(--c-border);
  flex-shrink: 0;
}

.info-title {
  font-size: 15px;
  font-weight: 700;
  letter-spacing: -0.01em;
}

.info-close {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: var(--radius-sm);
  color: var(--c-ink-tertiary);
  transition: background 0.12s var(--ease-out), color 0.12s var(--ease-out);
}

.info-close:hover {
  background: var(--c-surface-sunken);
  color: var(--c-ink);
}

.info-body {
  padding: 16px 20px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.info-card {
  background: var(--c-surface-sunken);
  border: 1px solid var(--c-border);
  border-radius: var(--radius-lg);
  padding: 14px 16px;
}

.card-label {
  font-size: 11px;
  font-weight: 700;
  color: var(--c-ink-tertiary);
  text-transform: uppercase;
  letter-spacing: 0.06em;
  margin-bottom: 10px;
}

/* Card 1: Cover + Title */
.cover-section {
  flex-shrink: 0;
}

.cover-thumb {
  width: 80px;
  height: 112px;
  border-radius: var(--radius-sm);
  overflow: hidden;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
  padding: 8px;
  box-shadow: var(--shadow-sm);
  position: relative;
}

.cover-thumb.editable {
  cursor: pointer;
}

.cover-thumb.editable:hover .cover-upload-hint {
  opacity: 1;
}

.cover-upload-hint {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  padding: 4px;
  background: var(--c-progress-bg);
  color: var(--c-progress-label);
  font-size: 10px;
  text-align: center;
  opacity: 0;
  transition: opacity 0.15s var(--ease-out);
}

.cover-img {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.cover-format {
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 1.5px;
  color: var(--c-cover-text-muted);
  text-transform: uppercase;
}

.cover-title-text {
  font-size: 10px;
  color: var(--c-cover-text);
  text-align: center;
  line-height: 1.3;
  overflow: hidden;
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  word-break: break-all;
}

.info-card:first-child {
  display: flex;
  gap: 16px;
  align-items: flex-start;
}

.title-section {
  flex: 1;
  min-width: 0;
}

.book-main-title {
  font-size: 16px;
  font-weight: 700;
  color: var(--c-ink);
  line-height: 1.35;
  margin-bottom: 4px;
  word-break: break-word;
}

.book-main-author {
  font-size: 13px;
  color: var(--c-ink-secondary);
  margin-bottom: 8px;
}

.book-format-badge {
  display: inline-block;
  padding: 2px 8px;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.05em;
  color: var(--c-accent);
  background: var(--c-accent-soft);
  border-radius: var(--radius-full);
}

/* Card 2: Description */
.description-text {
  font-size: 13px;
  color: var(--c-ink-secondary);
  line-height: 1.65;
  white-space: pre-wrap;
  word-break: break-word;
}

.description-empty {
  font-size: 13px;
  color: var(--c-ink-tertiary);
  font-style: italic;
}

/* Card 3: Categories */
.category-list {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.category-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 3px 10px;
  font-size: 12px;
  color: var(--c-ink-secondary);
  background: var(--c-surface);
  border: 1px solid var(--c-border);
  border-radius: var(--radius-full);
}

.category-chip.removable {
  cursor: pointer;
  transition: all 0.12s var(--ease-out);
}

.category-chip.removable:hover {
  border-color: var(--c-danger);
  color: var(--c-danger);
}

.category-chip.removable svg {
  opacity: 0.5;
}

.category-chip.removable:hover svg {
  opacity: 1;
}

.category-chip.toggleable {
  cursor: pointer;
  transition: all 0.12s var(--ease-out);
}

.category-chip.toggleable:hover {
  border-color: var(--c-accent);
  color: var(--c-accent);
}

.category-chip.toggleable.active {
  background: var(--c-accent);
  color: var(--c-ink-inverse);
  border-color: var(--c-accent);
}

.edit-category-pick {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.edit-category-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

/* Card 4: Reading info */
.reading-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px 16px;
}

.reading-item {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.reading-key {
  font-size: 11px;
  color: var(--c-ink-tertiary);
}

.reading-val {
  font-size: 13px;
  color: var(--c-ink);
  font-variant-numeric: tabular-nums;
  font-family: var(--font-mono);
  line-height: 1.4;
}

/* Edit mode inputs */
.edit-label {
  font-size: 11px;
  font-weight: 600;
  color: var(--c-ink-tertiary);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  margin-bottom: 4px;
  display: block;
}

.edit-input {
  width: 100%;
  border: 1px solid var(--c-border);
  background: var(--c-surface);
  color: var(--c-ink);
  border-radius: var(--radius-sm);
  padding: 7px 10px;
  font-size: 13px;
  transition: border-color 0.15s var(--ease-out), box-shadow 0.15s var(--ease-out);
}

.edit-input:focus {
  border-color: var(--c-accent);
  box-shadow: 0 0 0 3px var(--c-accent-soft);
}

.edit-textarea {
  width: 100%;
  border: 1px solid var(--c-border);
  background: var(--c-surface);
  color: var(--c-ink);
  border-radius: var(--radius-sm);
  padding: 8px 10px;
  font-size: 13px;
  line-height: 1.6;
  resize: vertical;
  min-height: 80px;
  transition: border-color 0.15s var(--ease-out), box-shadow 0.15s var(--ease-out);
}

.edit-textarea:focus {
  border-color: var(--c-accent);
  box-shadow: 0 0 0 3px var(--c-accent-soft);
}

/* Footer */
.info-footer {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
  padding: 14px 20px;
  border-top: 1px solid var(--c-border);
  flex-shrink: 0;
}

.btn-primary,
.btn-secondary {
  padding: 7px 20px;
  border-radius: var(--radius-sm);
  font-size: 13px;
  font-weight: 500;
  transition: all 0.15s var(--ease-out);
}

.btn-primary {
  background: var(--c-accent);
  color: var(--c-ink-inverse);
}

.btn-primary:hover {
  background: var(--c-accent-hover);
}

.btn-secondary {
  background: var(--c-surface-sunken);
  color: var(--c-ink);
}

.btn-secondary:hover {
  background: var(--c-border);
}
</style>
