<script setup lang="ts">
import { onMounted, ref } from "vue";
import { listByPrefix, putDoc, removeDoc, uid } from "../api";
import type { Command } from "../types";

const commands = ref<Command[]>([]);
const editing = ref<Partial<Command> | null>(null);

async function load() {
  commands.value = (await listByPrefix<Command>("cmd:")).sort((a, b) => a.createdAt - b.createdAt);
}
onMounted(load);

function blank(): Partial<Command> {
  return { name: "", content: "", desc: "" };
}

function add() {
  editing.value = blank();
}

function edit(c: Command) {
  editing.value = { ...c };
}

async function save() {
  const e = editing.value;
  if (!e) return;
  if (!e.name?.trim()) {
    alert("请填写命令名称");
    return;
  }
  if (!e.content?.trim()) {
    alert("请填写命令内容");
    return;
  }
  const doc: Command = {
    _id: e._id || uid("cmd:"),
    createdAt: e.createdAt || Date.now(),
    name: e.name.trim(),
    content: e.content.trim(),
    desc: e.desc?.trim() || "",
  };
  try {
    await putDoc(doc);
    editing.value = null;
    await load();
  } catch (err: any) {
    alert("保存失败: " + (err?.message || err));
  }
}

async function del(c: Command) {
  if (!window.confirm(`确认删除命令「${c.name}」？引用它的快捷指令将改用内联内容。`)) return;
  await removeDoc(c._id);
  await load();
}
</script>

<template>
  <div>
    <div class="toolbar">
      <span class="muted">共 {{ commands.length }} 条命令</span>
      <button class="btn btn-primary" @click="add">新增命令</button>
    </div>

    <div v-if="!commands.length" class="card empty">命令库为空，例如可添加：git pull、docker compose up -d、systemctl restart nginx。</div>

    <div v-for="c in commands" :key="c._id" class="card row">
      <div class="info">
        <b>{{ c.name }}</b>
        <div class="muted mono content-line">{{ c.content }}</div>
        <div v-if="c.desc" class="muted">{{ c.desc }}</div>
      </div>
      <div class="ops">
        <button class="btn btn-ghost btn-sm" @click="edit(c)">编辑</button>
        <button class="btn btn-danger-ghost btn-sm" @click="del(c)">删除</button>
      </div>
    </div>

    <div v-if="editing" class="card form">
      <h3>{{ editing._id ? "编辑命令" : "新增命令" }}</h3>
      <div class="grid">
        <label>
          名称
          <input v-model="editing.name" placeholder="拉取代码" />
        </label>
        <label>
          备注（可选）
          <input v-model="editing.desc" placeholder="在各应用目录执行 git pull" />
        </label>
        <label class="full">
          命令内容
          <textarea v-model="editing.content" rows="3" class="mono" placeholder="git pull --rebase"></textarea>
        </label>
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
.content-line {
  word-break: break-all;
  margin: 2px 0;
}
.ops {
  display: flex;
  gap: 6px;
  flex-shrink: 0;
}
.grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
  margin: 10px 0;
}
.grid label {
  display: flex;
  flex-direction: column;
  gap: 4px;
  color: var(--text-secondary);
}
.grid label.full {
  grid-column: 1 / -1;
}
.ops {
  display: flex;
  gap: 8px;
}
</style>
