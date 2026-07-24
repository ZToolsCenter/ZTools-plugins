<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { ZButton, ZModal } from 'ztools-ui'
import { buildShopApiAssetUrl } from '../../../config/runtimeConfig'
import type { PluginCommentTreeNode } from '../../../types/pluginMarket'
import { formatDateTime } from '../utils'
import {
  formatRating,
  getCommentAuthorInitial,
  getCommentAuthorName,
} from './formatters'

const props = defineProps<{
  isLoggedIn?: boolean
  avgRating?: number
  ratingCount?: number
  currentUserRating?: number
  comments?: PluginCommentTreeNode[]
  commentsLoading?: boolean
  commentsLoadingMore?: boolean
  commentsError?: string
  hasMoreComments?: boolean
  ratingSubmitting?: boolean
  commentSubmitting?: boolean
  currentUserAvatarUrl?: string
  commentSubmitSuccessKey?: number
}>()

const emit = defineEmits<{
  (e: 'submit-rating', score: number): void
  (e: 'submit-comment', payload: { content: string; parentId?: string }): void
  (e: 'load-more-comments'): void
}>()

const selectedRating = ref(5)
const isRatingModalOpen = ref(false)
const commentDraft = ref('')
const replyTargetId = ref<string | null>(null)
const replyDraft = ref('')

const commentList = computed(() => props.comments ?? [])
const averageRating = computed(() => {
  const value = props.avgRating ?? 0
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
})
const totalRatings = computed(() => {
  const value = props.ratingCount ?? 0
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
})
const currentUserRatingValue = computed(() => {
  const value = props.currentUserRating
  return typeof value === 'number' && Number.isFinite(value) ? value : null
})
const roundedAverageRating = computed(() => Math.round(averageRating.value))
const ratingActionText = computed(() =>
  currentUserRatingValue.value ? '修改评分' : '去评分',
)
const ratingModalTitle = computed(() =>
  currentUserRatingValue.value ? '修改你的评分' : '为这个插件评分',
)
const commentDraftLength = computed(() => commentDraft.value.trim().length)
const replyDraftLength = computed(() => replyDraft.value.trim().length)

function getCommentAvatarUrl(comment: PluginCommentTreeNode): string {
  return buildShopApiAssetUrl(comment.user.avatarUrl)
}

function startReply(commentId: string): void {
  replyTargetId.value = commentId
  replyDraft.value = ''
}

function cancelReply(): void {
  replyTargetId.value = null
  replyDraft.value = ''
}

function openRatingModal(): void {
  selectedRating.value = currentUserRatingValue.value ?? selectedRating.value
  isRatingModalOpen.value = true
}

function closeRatingModal(): void {
  isRatingModalOpen.value = false
}

function handleSubmitRating(): void {
  emit('submit-rating', selectedRating.value)
}

function handleSubmitComment(): void {
  const content = commentDraft.value.trim()
  if (!content) {
    return
  }

  emit('submit-comment', { content })
}

function handleSubmitReply(parentId: string): void {
  const content = replyDraft.value.trim()
  if (!content) {
    return
  }

  emit('submit-comment', { content, parentId })
}

watch(
  () => props.currentUserRating,
  (value) => {
    if (!isRatingModalOpen.value) {
      selectedRating.value = value ?? 5
    }
  },
)

watch(
  () => props.ratingSubmitting,
  (submitting, previous) => {
    if (previous && !submitting) {
      isRatingModalOpen.value = false
    }
  },
)

watch(
  () => props.commentSubmitSuccessKey,
  (value, oldValue) => {
    if (value === undefined || value === oldValue) {
      return
    }

    commentDraft.value = ''
    cancelReply()
  },
)
</script>

<template>
  <div class="comments-panel-inner">
    <div class="rating-overview card">
      <div class="rating-overview-main">
        <div class="section-title">插件评分</div>
        <div class="rating-summary-inline">
          <div class="rating-stars rating-stars--readonly" aria-hidden="true">
            <span
              v-for="star in 5"
              :key="`summary-${star}`"
              class="rating-star"
              :class="{ active: star <= roundedAverageRating }"
            >
              ★
            </span>
          </div>
          <div class="rating-value">{{ formatRating(averageRating) }}</div>
          <div v-if="totalRatings > 0" class="rating-meta">{{ `${totalRatings} 人评分` }}</div>
        </div>
      </div>

      <ZButton
        class="rating-trigger-btn"
        :disabled="ratingSubmitting"
        @click="openRatingModal"
      >
        <span v-if="ratingSubmitting">提交中...</span>
        <span v-else>{{ ratingActionText }}</span>
      </ZButton>
    </div>

    <div class="comment-section">
      <div v-if="commentsLoading" class="loading-container">
        <div class="spinner"></div>
        <span>评论加载中...</span>
      </div>
      <div v-else-if="commentsError" class="error-container">
        <span>{{ commentsError }}</span>
      </div>
      <div v-else-if="commentList.length === 0" class="empty-message">还没有评论，来抢沙发吧</div>
      <div v-else class="comment-list">
        <div v-for="comment in commentList" :key="comment.id" class="comment-card">
          <div class="comment-main">
            <div v-if="getCommentAvatarUrl(comment)" class="comment-avatar-wrap">
              <img :src="getCommentAvatarUrl(comment)" alt="用户头像" class="comment-avatar" />
            </div>
            <div v-else class="comment-avatar comment-avatar--fallback">{{ getCommentAuthorInitial(comment) }}</div>

            <div class="comment-body">
              <div class="comment-header-row">
                <div class="comment-author">{{ getCommentAuthorName(comment) }}</div>
                <div class="comment-time">{{ formatDateTime(comment.createdAt) }}</div>
              </div>
              <div class="comment-content">{{ comment.content }}</div>
              <div class="comment-actions-row">
                <button class="link-btn" type="button" @click="startReply(comment.id)">回复</button>
              </div>
            </div>
          </div>

          <div v-if="replyTargetId === comment.id" class="reply-editor">
            <textarea
              v-model="replyDraft"
              class="comment-textarea comment-textarea--reply"
              :disabled="commentSubmitting"
              maxlength="1000"
              :placeholder="`回复 ${getCommentAuthorName(comment)}...`"
            ></textarea>
            <div class="comment-editor-footer">
              <span class="comment-counter">{{ replyDraftLength }}/1000</span>
              <div class="reply-actions">
                <ZButton :disabled="commentSubmitting" @click="cancelReply">取消</ZButton>
                <ZButton
                  class="comment-submit-btn"
                  type="primary"
                  :disabled="commentSubmitting || !replyDraft.trim()"
                  :loading="commentSubmitting"
                  @click="handleSubmitReply(comment.id)"
                >
                  提交回复
                </ZButton>
              </div>
            </div>
          </div>

          <div v-if="comment.replies.length > 0" class="reply-list">
            <div v-for="reply in comment.replies" :key="reply.id" class="reply-card">
              <div v-if="getCommentAvatarUrl(reply)" class="comment-avatar-wrap">
                <img :src="getCommentAvatarUrl(reply)" alt="用户头像" class="comment-avatar comment-avatar--small" />
              </div>
              <div v-else class="comment-avatar comment-avatar--fallback comment-avatar--small">{{ getCommentAuthorInitial(reply) }}</div>

              <div class="comment-body">
                <div class="comment-header-row">
                  <div class="comment-author">{{ getCommentAuthorName(reply) }}</div>
                  <div class="comment-time">{{ formatDateTime(reply.createdAt) }}</div>
                </div>
                <div class="comment-content">{{ reply.content }}</div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div v-if="hasMoreComments && !commentsLoading" class="load-more-wrap">
        <ZButton :disabled="commentsLoadingMore" :loading="commentsLoadingMore" @click="emit('load-more-comments')">
          加载更多
        </ZButton>
      </div>
    </div>

    <ZModal
      :show="isRatingModalOpen"
      to="body"
      :mask-closable="true"
      @update:show="(value) => !value && closeRatingModal()"
    >
      <div class="rating-modal card" :aria-label="ratingModalTitle">
        <div class="rating-modal-header">
          <div>
            <div class="section-title">{{ ratingModalTitle }}</div>
            <div class="form-hint">{{ isLoggedIn ? '重复提交会更新你的评分。' : '登录后可提交评分。' }}</div>
          </div>
          <button class="icon-btn rating-modal-close" type="button" :disabled="ratingSubmitting" @click="closeRatingModal">×</button>
        </div>

        <div class="rating-stars rating-stars--interactive rating-stars--modal">
          <button
            v-for="star in 5"
            :key="star"
            type="button"
            class="rating-star-btn"
            :class="{ active: star <= selectedRating }"
            :disabled="ratingSubmitting"
            @click="selectedRating = star"
          >
            ★
          </button>
        </div>
        <div class="selected-rating-text">当前：{{ selectedRating }} 星</div>

        <div class="rating-modal-actions">
          <ZButton :disabled="ratingSubmitting" @click="closeRatingModal">取消</ZButton>
          <ZButton class="rating-submit-btn" type="primary" :disabled="ratingSubmitting" :loading="ratingSubmitting" @click="handleSubmitRating">
            {{ currentUserRatingValue ? '更新评分' : '提交评分' }}
          </ZButton>
        </div>
      </div>
    </ZModal>

    <div class="comment-editor card">
      <div class="comment-editor-header">
        <div v-if="currentUserAvatarUrl" class="comment-avatar-wrap">
          <img :src="currentUserAvatarUrl" alt="当前用户头像" class="comment-avatar" />
        </div>
        <div v-else class="comment-avatar comment-avatar--fallback">我</div>
        <div>
          <div class="section-title">发表评论</div>
          <div class="form-hint">{{ isLoggedIn ? '说点什么吧。' : '当前可只读查看，提交时会引导登录。' }}</div>
        </div>
      </div>

      <textarea
        v-model="commentDraft"
        class="comment-textarea"
        :disabled="commentSubmitting"
        maxlength="1000"
        placeholder="写下你的使用体验..."
      ></textarea>

      <div class="comment-editor-footer">
        <span class="comment-counter">{{ commentDraftLength }}/1000</span>
        <ZButton class="comment-submit-btn" type="primary" :disabled="commentSubmitting || !commentDraft.trim()" :loading="commentSubmitting" @click="handleSubmitComment">
          发表评论
        </ZButton>
      </div>
    </div>
  </div>
</template>

<style scoped>
.comments-panel-inner {
  display: flex;
  flex-direction: column;
  gap: 18px;
}

.rating-overview,
.comment-editor,
.comment-card,
.reply-card,
.rating-modal {
  border: 1px solid var(--divider-color);
  border-radius: 16px;
  background: var(--surface-color, var(--card-bg));
}

.rating-overview {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
  padding: 18px 20px;
  background: linear-gradient(135deg, color-mix(in srgb, var(--primary-color) 8%, var(--surface-color, var(--card-bg))) 0%, var(--surface-color, var(--card-bg)) 100%);
}

.rating-overview-main {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
  flex: 1;
}

.rating-summary-inline {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 10px;
}

.rating-value {
  font-size: 18px;
  font-weight: 700;
  line-height: 1;
  color: var(--text-color);
}

.rating-meta,
.form-hint,
.comment-time,
.comment-counter,
.selected-rating-text {
  font-size: 12px;
  color: var(--text-secondary);
}

.section-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-color);
}

.rating-stars {
  display: flex;
  align-items: center;
  gap: 4px;
}

.rating-star,
.rating-star-btn {
  font-size: 22px;
  line-height: 1;
  color: var(--text-muted, #c5c7ce);
}

.rating-star.active,
.rating-star-btn.active {
  color: #f59e0b;
}

.rating-star-btn {
  width: 36px;
  height: 36px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  border: none;
  border-radius: 10px;
  background: transparent;
  cursor: pointer;
  transition: background 0.2s ease, transform 0.2s ease;
}

.rating-star-btn:hover:not(:disabled) {
  background: rgba(245, 158, 11, 0.12);
  transform: translateY(-1px);
}

.rating-star-btn:disabled {
  cursor: not-allowed;
  opacity: 0.7;
}

.rating-trigger-btn,
.rating-submit-btn,
.comment-submit-btn {
  align-self: flex-start;
}

.rating-trigger-btn {
  flex-shrink: 0;
}

.rating-modal {
  width: min(420px, calc(100vw - 40px));
  padding: 20px;
  box-sizing: border-box;
  box-shadow: 0 24px 80px rgba(0, 0, 0, 0.24);
}

.rating-modal-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 16px;
}

.rating-modal-close {
  flex-shrink: 0;
  font-size: 22px;
  line-height: 1;
}

.rating-stars--modal {
  margin-bottom: 12px;
}

.rating-modal-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 16px;
}

.comment-editor {
  padding: 18px;
}

.comment-editor-header {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 14px;
}

.comment-avatar-wrap {
  flex-shrink: 0;
}

.comment-avatar {
  width: 40px;
  height: 40px;
  border-radius: 12px;
  object-fit: cover;
  background: var(--surface-elevated, var(--active-bg));
}

.comment-avatar--small {
  width: 32px;
  height: 32px;
  border-radius: 10px;
}

.comment-avatar--fallback {
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--primary-color);
  font-weight: 700;
}

.comment-textarea {
  width: 100%;
  min-height: 96px;
  padding: 12px;
  border: 1px solid var(--divider-color);
  border-radius: 12px;
  background: var(--bg-color);
  color: var(--text-color);
  font: inherit;
  line-height: 1.6;
  resize: vertical;
}

.comment-textarea--reply {
  min-height: 80px;
}

.comment-textarea:focus {
  outline: none;
  border-color: var(--primary-color);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--primary-color) 16%, transparent);
}

.comment-editor-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
  margin-top: 12px;
}

.comment-section {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.comment-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.comment-card {
  padding: 18px;
}

.comment-main,
.reply-card {
  display: flex;
  gap: 12px;
}

.comment-body {
  flex: 1;
  min-width: 0;
}

.comment-header-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.comment-author {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-color);
}

.comment-content {
  margin-top: 6px;
  color: var(--text-color);
  font-size: 14px;
  line-height: 1.7;
  white-space: pre-wrap;
  word-break: break-word;
}

.comment-actions-row {
  margin-top: 10px;
}

.link-btn {
  padding: 0;
  border: none;
  background: transparent;
  color: var(--primary-color);
  font-size: 13px;
  cursor: pointer;
}

.link-btn:hover {
  opacity: 0.8;
}

.reply-editor {
  margin-top: 12px;
  margin-left: 52px;
  padding: 14px;
  border-radius: 12px;
  background: var(--hover-bg);
}

.reply-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-top: 12px;
  margin-left: 52px;
}

.reply-card {
  padding: 12px;
  background: color-mix(in srgb, var(--surface-color, var(--card-bg)) 75%, var(--hover-bg));
}

.reply-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.load-more-wrap {
  display: flex;
  justify-content: center;
}

.loading-container,
.error-container,
.empty-message {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 40px 20px;
  gap: 12px;
  text-align: center;
}

.error-container {
  color: var(--error-color);
}

.empty-message {
  color: var(--text-secondary);
  font-size: 14px;
}

.spinner {
  width: 16px;
  height: 16px;
  border: 2px solid transparent;
  border-top-color: currentColor;
  border-right-color: currentColor;
  border-radius: 50%;
  animation: spin 0.6s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
