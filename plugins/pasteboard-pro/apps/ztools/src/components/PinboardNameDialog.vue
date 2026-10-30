<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";

import { useImeSubmitGuard } from "../use-ime-submit-guard";

const props = defineProps<{
  open: boolean;
  mode: "create" | "rename";
  initialName: string;
}>();

const emit = defineEmits<{
  close: [];
  submit: [name: string];
}>();

const dialog = ref<HTMLElement | null>(null);
const nameInput = ref<HTMLInputElement | null>(null);
const name = ref("");
const imeSubmitGuard = useImeSubmitGuard();
const title = computed(() => props.mode === "create" ? "新建分组" : "重命名分组");
const submitLabel = computed(() => props.mode === "create" ? "创建" : "保存");
const canSubmit = computed(() => name.value.trim().length > 0);

watch(() => props.open, async (open) => {
  if (!open) return;
  name.value = props.initialName;
  await nextTick();
  nameInput.value?.focus({ preventScroll: true });
  if (props.mode === "rename") nameInput.value?.select();
});

function submit(): void {
  if (imeSubmitGuard.shouldSuppressSubmit()) return;
  const normalizedName = name.value.trim();
  if (normalizedName.length > 0) emit("submit", normalizedName);
}

function containDialogTab(event: KeyboardEvent): void {
  if (event.key !== "Tab") return;
  const focusable = [...(dialog.value?.querySelectorAll<HTMLElement>(
    'input:not([disabled]), button:not([disabled]), [tabindex]:not([tabindex="-1"])',
  ) ?? [])].filter((element) => element.tabIndex >= 0 && element.getClientRects().length > 0);
  const first = focusable[0];
  const last = focusable.at(-1);
  if (first === undefined || last === undefined) {
    event.preventDefault();
    dialog.value?.focus({ preventScroll: true });
  } else if (document.activeElement === dialog.value || !dialog.value?.contains(document.activeElement)) {
    event.preventDefault();
    (event.shiftKey ? last : first).focus({ preventScroll: true });
  } else if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus({ preventScroll: true });
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus({ preventScroll: true });
  }
}
</script>

<template>
  <Teleport to="body">
    <div
      v-if="open"
      class="pinboard-name-dialog__backdrop"
      @click.self="emit('close')"
    >
      <section
        ref="dialog"
        class="pinboard-name-dialog popover-surface"
        role="dialog"
        aria-modal="true"
        aria-labelledby="pinboard-name-dialog-title"
        tabindex="-1"
        @keydown.stop
        @keydown.esc.stop.prevent="emit('close')"
        @keydown.tab="containDialogTab"
      >
        <header class="pinboard-name-dialog__header">
          <div>
            <h2 id="pinboard-name-dialog-title">{{ title }}</h2>
            <p>为常用内容整理一个分组</p>
          </div>
          <button type="button" class="pinboard-name-dialog__close" aria-label="关闭" @click="emit('close')">×</button>
        </header>
        <form class="pinboard-name-dialog__form" @submit.prevent="submit">
          <label for="pinboard-name-input">分组名称</label>
          <input
            id="pinboard-name-input"
            ref="nameInput"
            v-model="name"
            type="text"
            autocomplete="off"
            :aria-label="title"
            placeholder="例如：工作、灵感"
            @keydown="imeSubmitGuard.noteKeydown"
          />
          <footer>
            <button type="button" class="pinboard-name-dialog__cancel" @click="emit('close')">取消</button>
            <button type="submit" class="popover-primary" :disabled="!canSubmit">{{ submitLabel }}</button>
          </footer>
        </form>
      </section>
    </div>
  </Teleport>
</template>

<style scoped src="../styles/pinboard-name-dialog.css"></style>
