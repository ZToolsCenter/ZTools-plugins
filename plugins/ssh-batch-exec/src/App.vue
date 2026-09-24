<script setup lang="ts">
import { onMounted, ref } from "vue";
import HomeView from "./views/HomeView.vue";
import ServerManager from "./components/ServerManager.vue";
import CommandManager from "./components/CommandManager.vue";
import TaskManager from "./components/TaskManager.vue";
import LogView from "./views/LogView.vue";

/** 视图定义：首页 / 服务器管理 / 命令管理 / 快捷指令管理 / 执行记录 */
type View =
  | { name: "home" }
  | { name: "servers" }
  | { name: "commands" }
  | { name: "task-manage" }
  | { name: "logs" };

const TITLES: Record<string, string> = {
  home: "批量命令执行",
  servers: "服务器管理",
  commands: "命令管理",
  "task-manage": "快捷指令管理",
  logs: "执行记录",
};

const stack = ref<View[]>([{ name: "home" }]);
const top = () => stack.value[stack.value.length - 1];

function push(v: View) {
  stack.value.push(v);
}
function pop() {
  if (stack.value.length > 1) stack.value.pop();
}

onMounted(() => {
  const z = (window as any).ztools;
  try {
    z.setExpendHeight(680);
    z.onPluginEnter(() => {
      stack.value = [{ name: "home" }];
    });
  } catch (_) {
    /* 浏览器调试环境下忽略 */
  }
});
</script>

<template>
  <div class="app">
    <header class="bar">
      <button v-if="stack.length > 1" class="back" @click="pop">‹ 返回</button>
      <span v-else class="brand">批量命令执行</span>
      <span v-if="stack.length > 1" class="title">{{ TITLES[top().name] }}</span>
      <span class="spacer"></span>
      <button v-if="top().name === 'home'" class="back" @click="push({ name: 'logs' })">执行记录</button>
    </header>

    <main class="content">
      <HomeView v-if="top().name === 'home'" @nav="push" />
      <ServerManager v-else-if="top().name === 'servers'" />
      <CommandManager v-else-if="top().name === 'commands'" />
      <TaskManager v-else-if="top().name === 'task-manage'" />
      <LogView v-else-if="top().name === 'logs'" />
    </main>
  </div>
</template>

<style scoped>
.bar {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 14px 0;
}
.back {
  background: transparent;
  border: 1px solid var(--border-color);
  color: var(--text-primary);
  border-radius: 6px;
  padding: 4px 12px;
  cursor: pointer;
  font-size: 12px;
}
.brand {
  font-weight: 700;
  font-size: 14px;
}
.title {
  color: var(--text-secondary);
  font-size: 13px;
}
.spacer {
  flex: 1;
}
.content {
  padding: 10px 12px 12px;
}
</style>
