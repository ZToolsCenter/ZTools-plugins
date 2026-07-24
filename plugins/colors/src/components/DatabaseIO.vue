<script setup lang="ts">
/**
 * 数据库导入导出组件
 *
 * 直接使用 zToolsApi.db 原始 API 操作数据库，
 * 不依赖 DatabaseApi 注册流程，迁移页也能正常使用。
 *
 * Props：
 *   - dbNames: 需要管理的数据库名称列表
 *
 * Emits：
 *   - imported: 导入完成后触发，父组件可据此检查迁移状态
 */
import { ref } from "vue";
import { useMessage } from "@/utils/message";
import zToolsApi from "@/utils/ztoolsapi";

const props = defineProps<{
  dbNames: string[];
}>();

const emit = defineEmits<{
  imported: [];
}>();

const message = useMessage();
const db = zToolsApi.db;

/** 从原始文档获取数据库版本号 */
function getDbVersion(name: string): number {
  const doc = db.get(name);
  return (doc?.["__version"] as number) ?? 0;
}

/** 导入文件 input 引用 */
const fileInput = ref<HTMLInputElement>();
/** 导入中状态 */
const importing = ref(false);
/** 粘贴导入的文本 */
const pasteText = ref("");
/** 展开/收起粘贴区域 */
const showPaste = ref(false);

// ── 构造导出数据 ──

function buildExportPayload(dbName?: string) {
  const databases: Record<string, any> = {};
  const names = dbName ? [dbName] : props.dbNames;
  for (const name of names) {
    const doc = db.get(name);
    if (doc) databases[name] = doc;
  }
  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    databases,
  };
}

// ── 导出 ──

function exportDb(name: string) {
  downloadJson(buildExportPayload(name), `database-${name}.json`);
  message.success(`已导出 ${name}`);
}

function exportAll() {
  const payload = buildExportPayload();
  if (Object.keys(payload.databases).length === 0) {
    message.error("没有可导出的数据库");
    return;
  }
  downloadJson(payload, "database-all.json");
  message.success("已导出全部数据库");
}

async function copyDb(name: string) {
  await copyToClipboard(buildExportPayload(name));
}

async function copyAll() {
  const payload = buildExportPayload();
  if (Object.keys(payload.databases).length === 0) {
    message.error("没有可导出的数据库");
    return;
  }
  await copyToClipboard(payload);
}

function downloadJson(data: any, filename: string) {
  const blob = new Blob([JSON.stringify(data, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

async function copyToClipboard(data: any) {
  try {
    await navigator.clipboard.writeText(JSON.stringify(data, null, 2));
    message.success("已复制到剪贴板");
  } catch {
    message.error("复制失败");
  }
}

// ── 导入 ──

/** 执行导入逻辑（接收 JSON 字符串） */
async function doImport(text: string) {
  const data = JSON.parse(text);
  if (!data.databases || typeof data.databases !== "object") {
    message.error("格式错误：缺少 databases 字段");
    return;
  }
  let imported = 0;
  for (const [name, doc] of Object.entries(data.databases as Record<string, any>)) {
    if (!props.dbNames.includes(name)) {
      console.warn(`跳过未知数据库: ${name}`);
      continue;
    }
    // 读取当前文档的 _rev，覆盖导入数据中的旧 _rev，否则 CouchDB 返回 409 冲突
    const current = db.get(name);
    const toPut = { ...doc };
    if (current) {
      toPut._rev = current._rev;
    } else {
      delete toPut._rev;
    }
    const result = db.put(toPut);
    if (!result || result.error || ("ok" in result && !result.ok)) {
      console.error(`导入 ${name} 失败:`, result);
      continue;
    }
    imported++;
  }
  message.success(`已导入 ${imported} 个数据库`);
  emit("imported");
  location.reload();
}

function triggerImport() {
  fileInput.value?.click();
}

async function handleFileChange(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  importing.value = true;
  try {
    await doImport(await file.text());
  } catch (e) {
    message.error("导入失败：" + (e instanceof Error ? e.message : String(e)));
  } finally {
    importing.value = false;
    input.value = "";
  }
}

async function handlePasteImport() {
  if (!pasteText.value.trim()) {
    message.error("请先粘贴 JSON 数据");
    return;
  }
  importing.value = true;
  try {
    await doImport(pasteText.value);
    pasteText.value = "";
    showPaste.value = false;
  } catch (e) {
    message.error("导入失败：" + (e instanceof Error ? e.message : String(e)));
  } finally {
    importing.value = false;
  }
}
</script>

<template>
  <div class="space-y-4">
    <!-- 数据库列表 -->
    <div class="space-y-2">
      <div
        v-for="name in dbNames"
        :key="name"
        class="flex items-center justify-between rounded-lg border border-gray-100 bg-gray-50 px-4 py-3"
      >
        <div class="flex items-center gap-2">
          <span class="font-medium text-gray-700">{{ name }}</span>
          <span class="rounded bg-gray-200 px-1.5 py-0.5 font-mono text-xs text-gray-500"
            >v{{ getDbVersion(name) }}</span
          >
        </div>
        <div class="flex gap-2">
          <button
            @click="copyDb(name)"
            class="rounded-lg bg-gray-100 px-3 py-1.5 text-sm font-medium text-gray-600 transition-colors hover:bg-gray-200"
            title="复制到剪贴板"
          >
            📋 复制
          </button>
          <button
            @click="exportDb(name)"
            class="rounded-lg bg-blue-50 px-3 py-1.5 text-sm font-medium text-blue-600 transition-colors hover:bg-blue-100"
          >
            💾 导出
          </button>
        </div>
      </div>
    </div>

    <!-- 导出按钮 -->
    <div class="flex gap-3">
      <button
        @click="copyAll"
        class="flex-1 rounded-lg border border-gray-200 bg-white px-4 py-2.5 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50"
      >
        📋 复制全部
      </button>
      <button
        @click="exportAll"
        class="flex-1 rounded-lg border border-gray-200 bg-white px-4 py-2.5 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50"
      >
        💾 导出全部
      </button>
    </div>

    <!-- 导入按钮 -->
    <div class="flex gap-3">
      <button
        @click="triggerImport"
        :disabled="importing"
        class="flex-1 rounded-lg border border-gray-200 bg-white px-4 py-2.5 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {{ importing ? "导入中..." : "📂 从文件导入" }}
      </button>
      <button
        @click="showPaste = !showPaste"
        class="flex-1 rounded-lg border border-gray-200 bg-white px-4 py-2.5 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50"
      >
        📝 粘贴导入
      </button>
    </div>

    <input ref="fileInput" type="file" accept=".json" class="hidden" @change="handleFileChange" />

    <!-- 粘贴导入区域 -->
    <div v-if="showPaste" class="space-y-3">
      <textarea
        v-model="pasteText"
        placeholder='粘贴 JSON 数据，格式：\n{ "version": 1, "databases": { "color-favorites": { ... } } }'
        class="h-40 w-full resize-none rounded-lg border border-gray-200 p-3 font-mono text-xs text-gray-700 focus:border-blue-400 focus:ring-1 focus:ring-blue-400 focus:outline-none"
        spellcheck="false"
      />
      <div class="flex gap-3">
        <button
          @click="handlePasteImport"
          :disabled="importing || !pasteText.trim()"
          class="rounded-lg bg-blue-500 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-600 disabled:cursor-not-allowed disabled:opacity-50"
        >
          确认导入
        </button>
        <button
          @click="
            showPaste = false;
            pasteText = '';
          "
          class="rounded-lg bg-gray-100 px-4 py-2 text-sm font-medium text-gray-600 transition-colors hover:bg-gray-200"
        >
          取消
        </button>
      </div>
    </div>

    <p class="text-xs text-gray-400">导出为 JSON，可用于备份或跨设备迁移。导入会覆盖当前数据。</p>
  </div>
</template>
