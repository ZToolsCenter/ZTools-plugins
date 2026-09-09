<template>
  <Teleport to="body">
    <Transition name="update-progress-fade">
      <section class="update-progress-panel" role="status" aria-live="polite">
        <el-card shadow="always" :body-style="{ padding: '14px 16px 12px' }">
          <header class="update-progress-header">
            <div class="update-progress-title">
              <span class="update-progress-icon" aria-hidden="true">
                <span class="i-mdi-download" />
              </span>
              <span>{{ phaseLabel }}</span>
            </div>

            <div class="update-progress-actions">
              <el-tooltip :content="t('update.background')" placement="top">
                <el-button text circle :aria-label="t('update.background')" @click="$emit('background')">
                  <span class="i-mdi-minus" />
                </el-button>
              </el-tooltip>
            </div>
          </header>

          <el-progress
            :percentage="normalizedPercentage"
            :stroke-width="8"
            :show-text="false"
            :indeterminate="indeterminate"
            color="var(--app-primary)"
          />

          <footer class="update-progress-footer">
            <el-tag v-if="!indeterminate" size="small" type="primary" effect="light">{{ normalizedPercentage }}%</el-tag>
          </footer>
        </el-card>
      </section>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';

const props = defineProps<{
  percentage: number;
  indeterminate?: boolean;
  phase?: 'downloading' | 'verifying' | 'installing';
}>();

defineEmits<{
  (e: 'background'): void;
}>();

const { t } = useI18n();
const normalizedPercentage = computed(() => Math.max(0, Math.min(100, Math.round(props.percentage))));
const phaseLabel = computed(() => t(`update.${props.phase || 'downloading'}`));
</script>

<style scoped>
.update-progress-panel {
  position: fixed;
  right: 16px;
  bottom: 16px;
  z-index: 3000;
  width: min(360px, calc(100vw - 32px));
}

.update-progress-panel :deep(.el-card) {
  border-color: var(--app-border);
  border-radius: 8px;
  background: var(--app-surface);
}

.update-progress-header,
.update-progress-title,
.update-progress-actions,
.update-progress-footer {
  display: flex;
  align-items: center;
}

.update-progress-header {
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 12px;
}

.update-progress-title {
  min-width: 0;
  gap: 8px;
  color: var(--app-text);
  font-size: var(--app-font-control);
  font-weight: 600;
}

.update-progress-icon {
  display: inline-flex;
  flex: 0 0 auto;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  color: var(--app-primary);
  background: var(--app-surface-soft);
  border-radius: 6px;
  font-size: 16px;
}

.update-progress-actions {
  flex: 0 0 auto;
  gap: 2px;
}

.update-progress-actions :deep(.el-button) {
  width: 28px;
  height: 28px;
  margin: 0;
}

.update-progress-panel :deep(.el-progress-bar__outer) {
  background: var(--app-surface-soft);
}

.update-progress-footer {
  justify-content: flex-end;
  margin-top: 10px;
  color: var(--app-text-muted);
  font-size: var(--app-font-meta);
  line-height: var(--app-line-height-caption);
}

.update-progress-fade-enter-active,
.update-progress-fade-leave-active {
  transition: opacity 160ms ease, transform 160ms ease;
}

.update-progress-fade-enter-from,
.update-progress-fade-leave-to {
  opacity: 0;
  transform: translateY(8px);
}
</style>
