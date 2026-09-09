<!--
  SettingsDialog（UI-005）：设置弹窗 —— 侧边栏「设置」按钮触发，四组设置
  即改即生效（无显式保存按钮，「应用」时刻 = 每次修改时刻）：

  ① 上下文行数：数字输入 0-10，写 viewStore.contextLines（hunk 上下文唯一
     真源，diffStore.run() 执行时读取）；若已有对比结果，由 App.vue 的选项
     watch 立即自动重跑，本组件不重复接线。
  ② 自定义忽略规则管理：启用开关 / pattern 输入 / flags 输入（默认 'g'）/
     删除按钮 + 「添加规则」+ 空态文案。pattern / flags 变更实时校验
     （viewStore.getRuleError 复用引擎 compileIgnoreRules 的同款归一化），
     非法则输入框标红（陶土红描边）+ 逐条错误文案；校验失败的启用规则
     被 viewStore.diffOptions 拦截（不进引擎，运行时不会出现 invalid-regex），
     顶部提示条说明该语义 —— 「编辑期拦截 + 提示」，不阻塞编辑与保存。
  ③ 自动保存历史（INT-007）：写 historyStore.autoSave（该开关的唯一真源，
     保存出口在 App.vue 的 result watch → historyStore.saveFromResult），
     其持久化归 stores/settings.ts（载入回写 + 变更即时写 dbStorage）。

  弹窗容器用本地 UiModal（reka-ui Dialog：遮罩 / Esc 关闭 / 焦点圈定 /
  teleport / 进出场内建）—— 面板为纸面卡（白面 + 发丝边 + 大圆角 + 分层
  轻阴影），内容根节点定宽；颜色全部消费 main.css 令牌，随深浅主题切换。
-->
<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import UiButton from './ui/UiButton.vue'
import UiIcon from './ui/UiIcon.vue'
import UiInput from './ui/UiInput.vue'
import UiModal from './ui/UiModal.vue'
import UiSwitch from './ui/UiSwitch.vue'
import { historyStore } from '../stores/history'
import { CONTEXT_LINES_MAX, CONTEXT_LINES_MIN, viewStore } from '../stores/view'

/** 组件 props：弹窗显隐（v-model:show 由 App.vue 绑定） */
const props = defineProps<{ show: boolean }>()

/** 组件 emits：显隐双向绑定（遮罩点击 / Esc / 关闭按钮统一走 update:show） */
const emit = defineEmits<{ 'update:show': [value: boolean] }>()

/** 关闭弹窗：底部「完成」与右上角 × 共用 */
function close(): void {
  emit('update:show', false)
}

/*
 * ① 上下文行数（0-10）：本地保留一份字符串镜像 contextInput 作为输入框
 * 回显源：钳制结果回写镜像，保证输入框显示值恒等于 store 生效值；清空 /
 * 非法输入时回退到 store 当前值（不误跳 0）。变更只写 viewStore.contextLines，
 * 自动重跑由 App.vue 的选项 watch 承担。
 */
const contextInput = ref(String(viewStore.contextLines))

// store 值被外部改动（如未来其他入口）时同步回显
watch(
  () => viewStore.contextLines,
  (value) => {
    contextInput.value = String(value)
  },
)

/** 上下文行数输入回调：解析 + 钳制到 [0, 10] + 回写 store 与回显镜像 */
function handleContextInput(value: string): void {
  // 清空输入：回退显示当前生效值，不改变 store（空串 ≠ 想要 0）
  if (value === '') {
    contextInput.value = String(viewStore.contextLines)
    return
  }
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) {
    contextInput.value = String(viewStore.contextLines)
    return
  }
  const clamped = Math.min(CONTEXT_LINES_MAX, Math.max(CONTEXT_LINES_MIN, Math.floor(parsed)))
  viewStore.contextLines = clamped
  contextInput.value = String(clamped)
}

/*
 * ② 规则列表渲染模型：规则 + 逐条校验结果成对产出（模板无需重复调用校验）。
 * computed 依赖 rule.pattern / rule.flags（getRuleError 内读取），
 * 输入过程中实时重算 —— 错误消失的瞬间标红即解除。
 */
const ruleRows = computed(() =>
  viewStore.ignoreRules.map((rule) => ({ rule, error: viewStore.getRuleError(rule) })),
)

/** 启用中且校验失败的规则条数（> 0 时显示「非法规则不参与对比」提示条） */
const invalidEnabledCount = computed(
  () =>
    viewStore.ignoreRules.filter((rule) => rule.enabled && viewStore.getRuleError(rule) !== null)
      .length,
)
</script>

<template>
  <!--
    UiModal：遮罩 / Esc关闭 / 焦点圈定 / teleport 走 reka Dialog 默认；
    update:show 统一回写 v-model:show。内容根节点定宽 + 限高（长规则列表时
    弹窗内滚动，不撑破视口）。
  -->
  <UiModal :show="props.show" title="设置" @update:show="emit('update:show', $event)">
    <div class="settings-dialog">
      <!-- 头部：图标 + 标题 + 关闭 -->
      <div class="settings-header">
        <UiIcon name="settings" :size="15" class="settings-header-icon" />
        <h2 class="settings-title">设置</h2>
        <button type="button" class="settings-close" aria-label="关闭设置" @click="close">
          <UiIcon name="x" :size="14" />
        </button>
      </div>

      <div class="settings-body">
        <!-- ① 上下文行数 -->
        <section class="settings-section">
          <div class="settings-row">
            <div class="settings-row-text">
              <div class="settings-row-title">上下文行数</div>
              <div class="settings-row-desc">每个差异块上下方保留的未变更行数（0-10 行）</div>
            </div>
            <div class="context-input">
              <UiInput
                :model-value="contextInput"
                type="number"
                :min="CONTEXT_LINES_MIN"
                :max="CONTEXT_LINES_MAX"
                :step="1"
                aria-label="上下文行数"
                @update:model-value="handleContextInput"
              />
            </div>
          </div>
        </section>

        <!-- ② 自定义忽略规则 -->
        <section class="settings-section">
          <div class="settings-row settings-row-top">
            <div class="settings-row-text">
              <div class="settings-row-title">自定义忽略规则</div>
              <div class="settings-row-desc">
                对比前删除匹配命中的内容（只影响比较，原文展示不变），如版本号 \d+\.\d+
              </div>
            </div>
            <UiButton variant="secondary" @click="viewStore.addIgnoreRule()">
              添加规则
            </UiButton>
          </div>

          <!-- 空态文案 -->
          <div v-if="ruleRows.length === 0" class="rules-empty">
            暂无自定义忽略规则 —— 点击「添加规则」创建，例如忽略时间戳、日志前缀等噪声。
          </div>

          <!-- 非法规则提示条（校验失败不阻塞编辑，但不参与对比） -->
          <div v-if="invalidEnabledCount > 0" class="rules-warning" role="alert">
            {{ invalidEnabledCount }} 条启用中的规则未通过校验：非法规则不会参与本次对比，修正后自动生效。
          </div>

          <div class="rule-list">
            <div v-for="row in ruleRows" :key="row.rule.id" class="rule-row">
              <UiSwitch
                :model-value="row.rule.enabled"
                :aria-label="`启用规则 ${row.rule.pattern || '(空)'}`"
                @update:model-value="row.rule.enabled = $event"
              />
              <div class="rule-pattern">
                <UiInput
                  v-model="row.rule.pattern"
                  type="text"
                  placeholder="正则表达式，如 \d+\.\d+\.\d+"
                  :status="row.error !== null ? 'error' : undefined"
                />
              </div>
              <div class="rule-flags">
                <UiInput
                  v-model="row.rule.flags"
                  type="text"
                  placeholder="g"
                  :status="row.error !== null ? 'error' : undefined"
                />
              </div>
              <UiButton
                variant="ghost"
                aria-label="删除规则"
                title="删除规则"
                @click="viewStore.removeIgnoreRule(row.rule.id)"
              >
                <UiIcon name="trash" :size="14" />
              </UiButton>
              <!-- 逐条错误文案：跨整行展示 -->
              <div v-if="row.error !== null" class="rule-error">{{ row.error }}</div>
            </div>
          </div>
        </section>

        <!--
          ③ 自动保存历史（INT-007）：直写 historyStore.autoSave（getter/setter
          转发到内部 ref，读写均具响应性）。该开关只在下次对比成功时才被
          App.vue 的保存出口消费，改后无需其他接线。
        -->
        <section class="settings-section">
          <div class="settings-row">
            <div class="settings-row-text">
              <div class="settings-row-title">自动保存历史</div>
              <div class="settings-row-desc">
                对比成功后自动存入本地历史；关闭后不再自动记录，已保存的历史仍可在历史面板查看、恢复与删除
              </div>
            </div>
            <UiSwitch
              :model-value="historyStore.autoSave"
              aria-label="自动保存历史"
              @update:model-value="historyStore.autoSave = $event"
            />
          </div>
        </section>
      </div>

      <!-- 底部：即改即生效，仅提供关闭 -->
      <div class="settings-footer">
        <UiButton variant="primary" @click="close">完成</UiButton>
      </div>
    </div>
  </UiModal>
</template>

<style scoped>
/*
 * 内容根节点定宽：UiModal 面板宽度由内容撑定，flex column 的面板取最宽
 * 子元素 → 头/体/脚与 600px 对齐。max-width 兜底窄窗（容器自带留白）。
 */
.settings-dialog {
  display: flex;
  flex-direction: column;
  width: 600px;
  max-width: calc(100vw - 48px);
}

/* 头部：图标 + 标题 + 关闭按钮 */
.settings-header {
  flex: none;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 14px 16px 10px;
  border-bottom: 1px solid var(--divider-color, #edeae3);
}

.settings-header-icon {
  color: var(--text-secondary, #8a8377);
}

.settings-title {
  flex: 1;
  margin: 0;
  font-size: 14px;
  font-weight: 600;
}

/* 关闭按钮：ghost 图标钮，hover 轻底色 */
.settings-close {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  padding: 0;
  border: none;
  border-radius: var(--radius-s, 6px);
  background: transparent;
  color: var(--text-secondary, #8a8377);
  cursor: pointer;
  transition: background-color 0.12s var(--ease-quiet), color 0.12s var(--ease-quiet);
}

.settings-close:hover {
  background: var(--hover-bg, #f2f0ea);
  color: var(--text-color, #2e2c28);
}

/* 自绘关闭钮的键盘焦点环（主色描边口径） */
.settings-close:focus-visible {
  outline: 1.5px solid var(--primary-color, #4e7a60);
  outline-offset: 1px;
}

/* 主体：限高滚动（规则列表可能很长），滚动条继承全局样式 */
.settings-body {
  flex: none;
  display: flex;
  flex-direction: column;
  gap: 18px;
  max-height: 52vh;
  overflow-y: auto;
  padding: 14px 16px;
}

.settings-section {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-width: 0;
}

/* 「标题/描述 + 控件」行：top 变体用于控件是按钮的分组（顶部对齐） */
.settings-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.settings-row-top {
  align-items: flex-start;
}

.settings-row-top .settings-row-text {
  flex: 1;
  min-width: 0;
}

.settings-row-title {
  font-size: 13px;
  font-weight: 600;
}

.settings-row-desc {
  margin-top: 2px;
  font-size: 12px;
  line-height: 1.5;
  color: var(--text-secondary, #8a8377);
}

/* 上下文行数输入：外层限宽（UiInput 自身 width:100% 填满外层） */
.context-input {
  flex: none;
  width: 96px;
}

/* 规则空态：弱化文案 + 虚线框提示可添加 */
.rules-empty {
  padding: 14px;
  border: 1px dashed var(--control-border, #ddd7cb);
  border-radius: var(--radius-m, 8px);
  font-size: 12px;
  line-height: 1.6;
  color: var(--text-secondary, #8a8377);
}

/* 非法规则提示条：陶土红轻底色 */
.rules-warning {
  padding: 6px 10px;
  border-radius: var(--radius-s, 6px);
  font-size: 12px;
  line-height: 1.5;
  color: var(--danger-color, #b3563e);
  background-color: color-mix(in srgb, var(--danger-color, #b3563e) 9%, var(--surface, #ffffff));
}

/* 规则列表：纵向排布 */
.rule-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

/*
 * 单条规则：启用开关 | pattern（自适应） | flags（固定窄） | 删除。
 * 错误文案占满第二行（grid-column: 1 / -1）。
 */
.rule-row {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) 72px auto;
  align-items: center;
  gap: 8px;
}

/* pattern / flags 输入：外层单元格限宽，内部输入框 100% 填满 */
.rule-pattern {
  min-width: 0;
}

.rule-flags {
  min-width: 0;
}

.rule-error {
  grid-column: 1 / -1;
  font-size: 12px;
  line-height: 1.4;
  color: var(--danger-color, #b3563e);
}

/* 底部：完成按钮靠右 */
.settings-footer {
  flex: none;
  display: flex;
  justify-content: flex-end;
  padding: 10px 16px 14px;
  border-top: 1px solid var(--divider-color, #edeae3);
}
</style>
