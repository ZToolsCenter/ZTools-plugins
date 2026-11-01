<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref } from "vue";
import BackgroundImageEditor from "./BackgroundImageEditor.vue";

const props = defineProps<{ modelValue: string; disabled?: boolean }>();
const emit = defineEmits<{
  "update:modelValue": [value: string];
  "update:editing": [value: boolean];
  chosen: [];
  remove: [];
}>();
const fileInput = ref<HTMLInputElement | null>(null);
const chooseButton = ref<HTMLButtonElement | null>(null);
const editButton = ref<HTMLButtonElement | null>(null);
const editingImage = ref<string>();
const reading = ref(false);
const error = ref("");
let reader: FileReader | undefined;
let readGeneration = 0;

function choose(): void {
  if (props.disabled || reading.value) return;
  error.value = "";
  // Chromium attaches this chooser to the current settings window.
  if (fileInput.value !== null) {
    fileInput.value.value = "";
    fileInput.value.click();
  }
}

function edit(image: string): void {
  editingImage.value = image;
  emit("update:editing", true);
}

async function selected(event: Event): Promise<void> {
  const file = (event.target as HTMLInputElement).files?.[0];
  if (file === undefined) return;
  const generation = ++readGeneration;
  error.value = "";
  if (file.size === 0 || file.size > 8 * 1024 * 1024) {
    error.value = "请选择不超过 8 MB 的有效图片。";
    return;
  }
  if (!/^image\/(png|jpeg|webp)$/.test(file.type)) {
    error.value = "仅支持 PNG、JPEG 和 WebP 图片。";
    return;
  }
  reading.value = true;
  try {
    const result = await new Promise<string>((resolve, reject) => {
      const nextReader = new FileReader();
      reader = nextReader;
      nextReader.onload = () => typeof nextReader.result === "string"
        ? resolve(nextReader.result)
        : reject(new Error("无法读取这张图片。"));
      nextReader.onerror = () => reject(new Error("图片读取失败，请重新选择。"));
      nextReader.onabort = () => reject(new Error("图片读取已取消。"));
      nextReader.readAsDataURL(file);
    });
    if (generation === readGeneration) edit(result);
  } catch (cause) {
    if (generation === readGeneration) {
      error.value = cause instanceof Error ? cause.message : "图片读取失败。";
    }
  } finally {
    if (generation === readGeneration) {
      reading.value = false;
      reader = undefined;
    }
  }
}

async function closeEditor(): Promise<void> {
  editingImage.value = undefined;
  emit("update:editing", false);
  await nextTick();
  (editButton.value ?? chooseButton.value)?.focus({ preventScroll: true });
}

function applyImage(dataUrl: string): void {
  emit("update:modelValue", dataUrl);
  emit("chosen");
  void closeEditor();
}

onBeforeUnmount(() => {
  ++readGeneration;
  reader?.abort();
});
</script>

<template>
  <div class="background-image-control">
    <span><strong>背景图片</strong><small>支持 PNG、JPEG、WebP，最大 8 MB；可裁切、旋转和调整尺寸，选择时不会上传。</small></span>
    <div>
      <input ref="fileInput" type="file" accept="image/png,image/jpeg,image/webp" aria-label="选择背景图片文件" hidden :disabled="disabled || reading" @change="selected" />
      <button ref="chooseButton" type="button" class="quiet-action" :disabled="disabled || reading" @click="choose">{{ reading ? "正在读取…" : modelValue ? "更换图片" : "选择图片" }}</button>
      <button v-if="modelValue" ref="editButton" type="button" class="quiet-action" :disabled="disabled || reading" @click="edit(modelValue)">编辑图片</button>
      <button v-if="modelValue" type="button" class="quiet-action quiet-action--danger" :disabled="disabled || reading" @click="emit('remove')">移除</button>
    </div>
  </div>
  <p v-if="error" class="settings-error" role="alert">{{ error }}</p>
  <BackgroundImageEditor v-if="editingImage !== undefined" :image-data-url="editingImage" @apply="applyImage" @close="closeEditor" />
</template>
