<script setup lang="ts">
import { ref } from "vue";
import HomeView from "./views/HomeView.vue";
import ServerManager from "./components/ServerManager.vue";
import CommandManager from "./components/CommandManager.vue";
import TaskManager from "./components/TaskManager.vue";
import LogView from "./views/LogView.vue";
import { dismissToast, resolveConfirm, uiState } from "./ui";

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

    <div class="toast-stack">
      <div
        v-for="item in uiState.toasts"
        :key="item.id"
        class="toast"
        :class="item.kind"
        @click="dismissToast(item.id)"
      >
        {{ item.text }}
      </div>
    </div>

    <div v-if="uiState.confirm.visible" class="dialog-mask" @click.self="resolveConfirm(false)">
      <div class="dialog">
        <h3>{{ uiState.confirm.title }}</h3>
        <div class="dialog-message">{{ uiState.confirm.message }}</div>
        <div class="dialog-ops">
          <button class="btn btn-ghost" @click="resolveConfirm(false)">{{ uiState.confirm.cancelText }}</button>
          <button class="btn btn-primary" @click="resolveConfirm(true)">{{ uiState.confirm.confirmText }}</button>
        </div>
      </div>
    </div>
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
.toast-stack {
  position: fixed;
  right: 16px;
  bottom: 16px;
  z-index: 1000;
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-width: min(420px, calc(100vw - 32px));
}
.toast {
  padding: 9px 12px;
  border-radius: 8px;
  border: 1px solid var(--border-color);
  background: var(--bg-hover);
  color: var(--text-primary);
  font-size: 12px;
  line-height: 1.5;
  cursor: pointer;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.18);
}
.toast.success {
  border-color: rgba(34, 197, 94, 0.45);
}
.toast.error {
  border-color: rgba(229, 72, 77, 0.45);
  color: var(--danger);
}
.dialog-mask {
  position: fixed;
  inset: 0;
  z-index: 1100;
  background: rgba(0, 0, 0, 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
}
.dialog {
  width: min(420px, 100%);
  padding: 16px;
  border-radius: 10px;
  border: 1px solid var(--border-color);
  background: var(--bg-primary, #fff);
  color: var(--text-primary);
  box-shadow: 0 16px 48px rgba(0, 0, 0, 0.25);
}
.dialog h3 {
  margin: 0 0 8px;
  font-size: 15px;
}
.dialog-message {
  font-size: 13px;
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-word;
}
.dialog-ops {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 16px;
}
</style>
