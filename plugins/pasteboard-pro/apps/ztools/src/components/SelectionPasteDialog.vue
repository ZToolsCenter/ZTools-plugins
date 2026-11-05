<script setup lang="ts">
import { computed, onMounted, onBeforeUnmount, ref } from "vue";
import type { SelectionPasteNotice } from "../selection-paste-controller";

const props = defineProps<{
  notice: SelectionPasteNotice;
  supportsQueue: boolean;
  busy: boolean;
  pasteShortcut: string;
}>();
const emit = defineEmits<{ close: []; queue: [] }>();
const dialog = ref<HTMLElement>();
let previousFocus: HTMLElement | null = null;
const canQueue = computed(() => props.supportsQueue && props.notice.kind !== "error");
const title = computed(() => props.busy ? `正在保存 ${props.notice.itemIds.length} 项队列` : props.notice.kind === "mixed"
  ? `${props.notice.itemIds.length} 项内容需要逐项粘贴`
  : "暂未完成粘贴");

function close(): void { if (!props.busy) emit("close"); }
function onKeydown(event: KeyboardEvent): void {
  event.stopPropagation();
  if (event.key === "Escape") { event.preventDefault(); close(); }
  if (event.key !== "Tab") return;
  const buttons = [...(dialog.value?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? [])];
  if (buttons.length === 0) { event.preventDefault(); return; }
  const first = buttons[0]!;
  const last = buttons[buttons.length - 1]!;
  if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
}
onMounted(() => {
  previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  (dialog.value?.querySelector<HTMLButtonElement>("button:not(:disabled)") ?? dialog.value)?.focus();
});
onBeforeUnmount(() => { previousFocus?.focus(); });
</script>

<template>
  <div class="selection-paste-backdrop" @click.self="close" @keydown="onKeydown">
    <section ref="dialog" tabindex="-1" class="selection-paste-dialog" role="dialog" aria-modal="true"
      aria-labelledby="selection-paste-title" aria-describedby="selection-paste-description" :aria-busy="busy">
      <span class="selection-paste-dialog__eyebrow">多选粘贴</span>
      <h2 id="selection-paste-title">{{ title }}</h2>
      <p id="selection-paste-description" v-if="notice.kind === 'mixed'">
        一次性粘贴支持合并文本。图片、文件等内容请放入逐项队列，回到目标应用后，每按一次 {{ pasteShortcut }} 粘贴下一项。
      </p>
      <p v-else id="selection-paste-description">{{ busy ? "正在准备全部内容，保存完成后即可回到目标应用逐项粘贴。" : "选择已保留，可以返回检查或重试。" }}</p>
      <p v-if="!supportsQueue && notice.kind !== 'error'" class="selection-paste-dialog__error" role="alert">
        当前平台暂不支持逐项粘贴队列，请分次选择粘贴。
      </p>
      <p v-if="notice.message && (supportsQueue || notice.kind === 'error')" class="selection-paste-dialog__error" role="alert">{{ notice.message }}</p>
      <div class="selection-paste-dialog__actions">
        <button type="button" :disabled="busy" @click="close">返回选择</button>
        <button v-if="canQueue" type="button" class="selection-paste-dialog__primary" :disabled="busy" @click="emit('queue')">
          {{ busy ? '正在保存队列…' : `创建 ${notice.itemIds.length} 项队列` }}
        </button>
      </div>
    </section>
  </div>
</template>

<style scoped>
.selection-paste-backdrop {
  position: fixed; inset: 0; z-index: 1200; display: grid; place-items: center;
  padding: 16px; background: rgb(10 12 17 / 56%); backdrop-filter: blur(12px);
}
.selection-paste-dialog {
  width: min(460px, 100%); max-height: 100%; overflow: auto; padding: 24px;
  border: 1px solid var(--pb-line); border-radius: 18px; background: var(--pb-glass-strong);
  box-shadow: 0 24px 64px rgb(0 0 0 / 32%); color: var(--pb-ink);
}
.selection-paste-dialog__eyebrow { color: var(--pb-muted); font-size: 11px; letter-spacing: .08em; }
h2 { margin: 10px 0 12px; font-size: 19px; line-height: 1.35; }
p { margin: 0 0 14px; font-size: 13px; line-height: 1.7; color: var(--pb-muted); }
.selection-paste-dialog__error { color: var(--pb-ink); }
.selection-paste-dialog__actions { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 8px; margin-top: 20px; }
button { padding: 9px 14px; border: 1px solid var(--pb-line); border-radius: 9px; background: transparent; color: var(--pb-ink); cursor: pointer; }
button:focus-visible { outline: 2px solid var(--pb-violet); outline-offset: 3px; }
button:disabled { opacity: .55; cursor: wait; }
.selection-paste-dialog__primary { background: var(--pb-violet); border-color: transparent; color: white; }
</style>
