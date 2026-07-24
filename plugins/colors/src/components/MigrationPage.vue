<script setup lang="ts">
/**
 * 数据库迁移页
 * useDatabaseManager() 获取 pending 列表
 * 用户确认 → migrate → buildAndRegister → goto ready
 * 失败 → 留在当前页，显示错误，可重试
 * 导入数据库后自动重新检测迁移状态
 */
import { ref } from "vue";
import DatabaseIO from "@/components/DatabaseIO.vue";
import { useDatabaseManager, databaseNames } from "@/utils/databases";

const emit = defineEmits<{
  goto: [phase: "ready"];
}>();

// setup 顶层调用 use 函数
const manager = useDatabaseManager();
const migrating = ref(false);
const error = ref<string | null>(null);

const dbNames = databaseNames();

function statusLabel(status: string): string {
  switch (status) {
    case "interrupted":
      return "上次迁移中断，需要回滚";
    case "needs_migration":
      return "需要迁移";
    case "corrupted":
      return "数据损坏，需要手动处理";
    default:
      return "";
  }
}

async function handleConfirm() {
  migrating.value = true;
  error.value = null;
  try {
    await manager.migrate();
    manager.buildAndRegister();
    emit("goto", "ready");
  } catch (e) {
    migrating.value = false;
    error.value = e instanceof Error ? e.message : String(e);
  }
}

/** 导入后重新检测迁移状态 */
function handleImported() {
  manager.refresh();
}
</script>

<template>
  <div class="fixed inset-0 z-50 overflow-auto bg-gradient-to-br from-slate-100 to-slate-200 p-5">
    <div class="flex min-h-full flex-col items-center pt-16 pb-8">
      <svg
        xmlns="http://www.w3.org/2000/svg"
        class="mb-6 h-16 w-16 text-indigo-500"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        stroke-width="1.5"
      >
        <path
          stroke-linecap="round"
          stroke-linejoin="round"
          d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
        />
      </svg>
      <h1 class="mb-2 text-2xl font-bold text-slate-800">数据库需要更新</h1>
      <p class="mb-8 text-slate-500">检测到以下数据库需要处理，请确认后继续</p>

      <div class="mb-8 w-full max-w-md space-y-3">
        <div
          v-for="entry in manager.pending"
          :key="entry.name"
          class="rounded-lg border px-4 py-3"
          :class="
            entry.status.status === 'corrupted'
              ? 'border-red-200 bg-red-50'
              : 'border-amber-200 bg-amber-50'
          "
        >
          <div class="flex items-center justify-between">
            <span class="font-medium text-slate-700">{{ entry.name }}</span>
            <span class="text-sm text-slate-500">
              v{{ entry.currentVersion }} → v{{ entry.targetVersion }}
            </span>
          </div>
          <div class="text-sm text-slate-500">
            {{ statusLabel(entry.status.status) }}
          </div>
        </div>
      </div>

      <div
        v-if="error"
        class="mb-4 w-full max-w-md rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-red-700"
      >
        处理失败: {{ error }}
      </div>

      <button
        :disabled="migrating || !!error"
        class="mb-8 rounded-lg bg-indigo-600 px-8 py-3 text-white shadow-md transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
        @click="handleConfirm"
      >
        <span v-if="migrating" class="flex items-center gap-2">
          <div
            class="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent"
          ></div>
          处理中...
        </span>
        <span v-else>确认处理</span>
      </button>

      <!-- 数据库导入导出 -->
      <div class="w-full max-w-md rounded-xl border border-gray-200 bg-white p-5 shadow-md">
        <h3 class="mb-3 text-sm font-semibold text-gray-500">数据库备份与恢复</h3>
        <p class="mb-4 text-xs text-gray-400">
          如果迁移失败，可以导出当前数据库备份，或将正常设备的备份导入此处。
        </p>
        <DatabaseIO :db-names="dbNames" @imported="handleImported" />
      </div>
    </div>
  </div>
</template>
