<script setup lang="ts">
import { onMounted, ref } from "vue";
import { listByPrefix, putDoc, removeDoc, uid } from "../api";
import type { Command, Server, Task } from "../types";

const servers = ref<Server[]>([]);
const commands = ref<Command[]>([]);
const tasks = ref<Task[]>([]);
const editing = ref<Partial<Task> | null>(null);
const source = ref<"pick" | "custom">("pick");

async function load() {
  servers.value = (await listByPrefix<Server>("server:")).sort((a, b) => a.createdAt - b.createdAt);
  commands.value = (await listByPrefix<Command>("cmd:")).sort((a, b) => a.createdAt - b.createdAt);
  tasks.value = (await listByPrefix<Task>("task:")).sort((a, b) => a.createdAt - b.createdAt);
}
onMounted(load);

function blank(): Partial<Task> {
  return { name: "", commandId: "", commandText: "", serverIds: [], timeout: 300 };
}

function add() {
  editing.value = blank();
  source.value = "pick";
}

function edit(t: Task) {
  editing.value = { ...t, serverIds: [...t.serverIds] };
  source.value = t.commandId ? "pick" : "custom";
}

function toggleServer(id: string) {
  const ids = editing.value?.serverIds || [];
  if (editing.value) {
    editing.value.serverIds = ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id];
  }
}

function commandTextOf(t: Task): string {
  if (t.commandId) return commands.value.find((c) => c._id === t.commandId)?.content || "(命令已删除)";
  return t.commandText || "";
}

function serverNamesOf(t: Task): string {
  return t.serverIds
    .map((id) => servers.value.find((s) => s._id === id)?.name)
    .filter(Boolean)
    .join("、");
}

async function save() {
  const e = editing.value;
  if (!e) return;
  if (!e.name?.trim()) return alert("请填写指令名称");
  if (source.value === "pick" && !e.commandId) return alert("请选择命令，或切换为手动输入");
  if (source.value === "custom" && !e.commandText?.trim()) return alert("请输入命令内容");
  if (!e.serverIds?.length) return alert("请至少选择一台服务器");
  const doc: Task = {
    _id: e._id || uid("task:"),
    createdAt: e.createdAt || Date.now(),
    name: e.name.trim(),
    commandId: source.value === "pick" ? e.commandId : "",
    commandText: source.value === "custom" ? e.commandText?.trim() : "",
    serverIds: e.serverIds,
    timeout: Number(e.timeout) > 0 ? Number(e.timeout) : 300,
  };
  try {
    await putDoc(doc);
    editing.value = null;
    await load();
  } catch (err: any) {
    alert("保存失败: " + (err?.message || err));
  }
}

async function del(t: Task) {
  if (!window.confirm(`确认删除快捷指令「${t.name}」？`)) return;
  await removeDoc(t._id);
  if (editing.value?._id === t._id) editing.value = null;
  await load();
}
</script>

<template>
  <div>
    <div class="toolbar">
      <span class="muted">共 {{ tasks.length }} 条快捷指令</span>
      <button class="btn btn-primary" @click="add">新增指令</button>
    </div>

    <div v-if="!tasks.length && !editing" class="card empty">
      还没有快捷指令，点击「新增指令」添加第一条。快捷指令 = 一条命令 + 一组服务器，可一键批量执行。
    </div>

    <div v-for="t in tasks" :key="t._id" class="card row">
      <div class="info">
        <div class="name"><b>{{ t.name }}</b></div>
        <div class="muted mono small">{{ commandTextOf(t) }}</div>
        <div class="muted small">→ {{ serverNamesOf(t) || "(服务器已删除)" }}</div>
      </div>
      <div class="ops">
        <button class="btn btn-ghost btn-sm" @click="edit(t)">编辑</button>
        <button class="btn btn-danger-ghost btn-sm" @click="del(t)">删除</button>
      </div>
    </div>

    <div v-if="editing" class="card form">
      <h3>{{ editing._id ? "编辑快捷指令" : "新增快捷指令" }}</h3>
      <div class="grid">
        <label>
          指令名称
          <input v-model="editing.name" placeholder="批量拉取代码" />
        </label>
        <label>
          单台超时（秒）
          <input v-model.number="editing.timeout" type="number" min="5" />
        </label>
        <label class="full">
          命令来源
          <span class="src">
            <label class="radio"><input v-model="source" type="radio" value="pick" /> 从命令库选择</label>
            <label class="radio"><input v-model="source" type="radio" value="custom" /> 手动输入</label>
          </span>
        </label>
        <label v-if="source === 'pick'" class="full">
          选择命令
          <select v-model="editing.commandId">
            <option value="" disabled>-- 选择命令 --</option>
            <option v-for="c in commands" :key="c._id" :value="c._id">{{ c.name }}（{{ c.content }}）</option>
          </select>
        </label>
        <label v-else class="full">
          命令内容
          <textarea v-model="editing.commandText" rows="3" class="mono" placeholder="git pull --rebase"></textarea>
        </label>
        <div class="full">
          <span class="muted">目标服务器（已选 {{ editing.serverIds?.length || 0 }}/{{ servers.length }}）</span>
          <div v-if="!servers.length" class="muted">请先在服务器管理中添加服务器。</div>
          <div class="serverpick">
            <label v-for="s in servers" :key="s._id" class="radio">
              <input type="checkbox" :checked="editing.serverIds?.includes(s._id)" @change="toggleServer(s._id)" />
              {{ s.name }}
              <span class="muted mono">({{ s.host }})</span>
            </label>
          </div>
        </div>
      </div>
      <div class="ops">
        <button class="btn btn-primary" @click="save">保存</button>
        <button class="btn btn-ghost" @click="editing = null">取消</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}
.info {
  min-width: 0;
}
.name {
  margin-bottom: 2px;
}
.ops {
  display: flex;
  gap: 6px;
  flex-shrink: 0;
}
.small {
  font-size: 11px;
}
.grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
  margin: 10px 0;
}
.grid > label {
  display: flex;
  flex-direction: column;
  gap: 4px;
  color: var(--text-secondary);
}
.grid .full {
  grid-column: 1 / -1;
}
.src {
  display: flex;
  gap: 16px;
  align-items: center;
}
.radio {
  display: flex;
  align-items: center;
  gap: 5px;
  color: var(--text-primary);
  cursor: pointer;
}
.serverpick {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 16px;
  margin-top: 6px;
}
.ops {
  display: flex;
  gap: 8px;
}
</style>
