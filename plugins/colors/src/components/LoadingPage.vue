<script setup lang="ts">
/**
 * 加载页
 * useDatabases() 检查状态：
 *   - 需要处理 → goto migration
 *   - 不需要 → build + goto ready
 */
import { onMounted } from "vue";
import { useDatabaseManager } from "@/utils/databases";

const emit = defineEmits<{
  goto: [phase: "migration" | "ready"];
}>();

// setup 顶层调用 use 函数
const manager = useDatabaseManager();

onMounted(() => {
  try {
    if (manager.needsAction) {
      emit("goto", "migration");
    } else {
      manager.buildAndRegister();
      emit("goto", "ready");
    }
  } catch (error) {
    console.error("[loading] 数据库初始化失败:", error);
    throw error;
  }
});
</script>

<template>
  <div
    class="fixed inset-0 z-50 flex flex-col items-center justify-center bg-gradient-to-br from-slate-100 to-slate-200"
  >
    <div class="mb-6">
      <div
        class="h-12 w-12 animate-spin rounded-full border-4 border-indigo-200 border-t-indigo-600"
      ></div>
    </div>
    <p class="text-lg text-slate-600">正在初始化...</p>
  </div>
</template>
