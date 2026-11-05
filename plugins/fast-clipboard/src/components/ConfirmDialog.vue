<script setup lang="ts">
/**
 * 插件内确认弹窗。
 *
 * 存在的理由：Electron 里的 window.confirm 弹的是**系统原生窗口** ——
 * 跑到插件窗口外面、跟主题无关、还盖住整个屏幕。在 500px 的面板里
 * 冒出一个系统弹窗非常突兀，所以确认一律在窗口内问。
 *
 * 最多三个按钮（取消 / 次操作 / 主操作）：清理失效既有"全清"也有
 * "只清完全失效的"这一档退路，两个选项摆出来比逼用户二选一更稳妥。
 * 键盘由 App 统一接管（Esc 取消、Enter 主操作），这里不抢焦点 ——
 * 焦点一直在宿主子输入框上，弹窗关掉后键盘流才不会断。
 */
import type { ConfirmRequest, ConfirmChoice } from '../composables/useStore'

defineProps<{
  req: ConfirmRequest
}>()

const emit = defineEmits<{
  pick: [choice: ConfirmChoice]
}>()
</script>

<template>
  <div class="mask" @click.self="emit('pick', 'cancel')">
    <div class="dlg" role="dialog" aria-modal="true">
      <p class="dlg-title">{{ req.title }}</p>

      <div class="dlg-lines">
        <p v-for="(line, i) in req.lines" :key="i" class="dlg-line">{{ line }}</p>
      </div>

      <div class="dlg-acts">
        <button class="btn" @click="emit('pick', 'cancel')">取消</button>
        <button v-if="req.altText" class="btn" @click="emit('pick', 'alt')">
          {{ req.altText }}
        </button>
        <!--
          主操作是最右侧那个：视觉终点，也是 Enter 的默认落点。
          danger 时整块红色 —— 删除/清空不可撤销，别做成看起来人畜无害的蓝按钮。
        -->
        <button
          class="btn primary"
          :class="{ danger: req.danger }"
          @click="emit('pick', 'ok')"
        >
          {{ req.okText }}
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
/*
 * 遮罩用 position:fixed 铺满整个窗口。
 * 不能用 absolute + height:100%：侧栏/列表是 flex 子项，层叠上下文里
 * absolute 会跟行内 transform 打架，fixed 直接贴视口最稳。
 */
.mask {
  position: fixed;
  inset: 0;
  z-index: 40;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.34);
  /*
   * 关键帧只允许动 opacity（硬规矩 1：带 transform 的关键帧会覆盖
   * 虚拟列表行内 transform）。这里没有 transform 元素也照守，省得以后加。
   */
  animation: fade-in 0.12s ease-out;
}

.dlg {
  width: 320px;
  padding: 16px;
  border-radius: 12px;
  background: var(--panel);
  border: 1px solid var(--border-strong);
  box-shadow: 0 12px 30px rgba(0, 0, 0, 0.18);
}

.dlg-title {
  font-size: 13.5px;
  font-weight: 600;
  color: var(--text);
  line-height: 1.45;
}

.dlg-lines {
  margin-top: 8px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.dlg-line {
  font-size: 12px;
  color: var(--text-2);
  line-height: 1.5;
}

.dlg-acts {
  margin-top: 14px;
  display: flex;
  justify-content: flex-end;
  gap: 6px;
}

.btn {
  height: 30px;
  padding: 0 12px;
  border-radius: 7px;
  font-size: 12.5px;
  color: var(--text-2);
  background: var(--hover);
  transition: background 0.12s, color 0.12s;
}

.btn:hover { background: var(--active); color: var(--text); }

.btn.primary {
  background: var(--accent);
  color: #fff;
}

.btn.primary:hover { background: var(--accent); filter: brightness(1.06); }

.btn.primary.danger { background: var(--danger); color: #fff; }
.btn.primary.danger:hover { background: var(--danger); filter: brightness(1.06); }
</style>
