<script setup lang="ts">
import { onMounted, ref } from "vue";
import { listByPrefix, putDoc, removeDoc, uid, svc, zt } from "../api";
import type { Server } from "../types";

const servers = ref<Server[]>([]);
const editing = ref<Partial<Server> | null>(null);
const testingId = ref("");
const testMsg = ref<{ id: string; ok: boolean; message: string } | null>(null);

async function load() {
  servers.value = (await listByPrefix<Server>("server:")).sort((a, b) => a.createdAt - b.createdAt);
}
onMounted(load);

function blank(): Partial<Server> {
  return { name: "", host: "", port: 22, username: "root", authType: "password", password: "", privateKey: "", passphrase: "" };
}

function add() {
  editing.value = blank();
}

function edit(s: Server) {
  editing.value = { ...s };
}

async function save() {
  const e = editing.value;
  if (!e) return;
  if (!e.name?.trim() || !e.host?.trim() || !e.username?.trim()) {
    alert("请填写名称、主机、用户名");
    return;
  }
  if (e.authType === "password" && !e.password) {
    alert("请填写密码");
    return;
  }
  if (e.authType === "privateKey" && !e.privateKey?.trim()) {
    alert("请填写私钥内容或从文件导入");
    return;
  }
  const doc: Server = {
    _id: e._id || uid("server:"),
    createdAt: e.createdAt || Date.now(),
    name: e.name.trim(),
    host: e.host.trim(),
    port: Number(e.port) || 22,
    username: e.username.trim(),
    authType: (e.authType === "privateKey" ? "privateKey" : "password") as Server["authType"],
    password: e.password || "",
    privateKey: e.privateKey || "",
    passphrase: e.passphrase || "",
  };
  try {
    await putDoc(doc);
    editing.value = null;
    await load();
  } catch (err: any) {
    alert("保存失败: " + (err?.message || err));
  }
}

async function del(s: Server) {
  if (!window.confirm(`确认删除服务器「${s.name}」？使用它的快捷指令将无法定位到该服务器。`)) return;
  await removeDoc(s._id);
  await load();
}

async function test(s: Server) {
  testingId.value = s._id;
  try {
    const r = await svc.testConnection(s);
    testMsg.value = { id: s._id, ok: r.ok, message: r.message };
  } catch (err: any) {
    testMsg.value = { id: s._id, ok: false, message: err?.message || String(err) };
  }
  testingId.value = "";
}

async function pickKeyFile() {
  const files = zt.showOpenDialog({ properties: ["openFile"] });
  const p = Array.isArray(files) ? files[0] : files;
  if (!p) return;
  const r = await svc.readPrivateKey(p);
  if (r.ok && editing.value) {
    editing.value.privateKey = r.content || "";
  } else {
    alert(r.message || "读取失败");
  }
}
</script>

<template>
  <div>
    <div class="toolbar">
      <span class="muted">共 {{ servers.length }} 台服务器</span>
      <button class="btn btn-primary" @click="add">新增服务器</button>
    </div>

    <div v-if="!servers.length" class="card empty">还没有服务器，点击「新增服务器」添加第一台。</div>

    <div v-for="s in servers" :key="s._id" class="card row">
      <div class="info">
        <div class="name">
          <b>{{ s.name }}</b>
          <span class="badge">{{ s.authType === "privateKey" ? "私钥" : "密码" }}</span>
        </div>
        <div class="muted mono">{{ s.username }}@{{ s.host }}:{{ s.port }}</div>
        <div v-if="testMsg && testMsg.id === s._id" :class="testMsg.ok ? 'ok' : 'err'">{{ testMsg.message }}</div>
      </div>
      <div class="ops">
        <button class="btn btn-ghost btn-sm" :disabled="testingId === s._id" @click="test(s)">
          {{ testingId === s._id ? "测试中…" : "测试连接" }}
        </button>
        <button class="btn btn-ghost btn-sm" @click="edit(s)">编辑</button>
        <button class="btn btn-danger-ghost btn-sm" @click="del(s)">删除</button>
      </div>
    </div>

    <div v-if="editing" class="card form">
      <h3>{{ editing._id ? "编辑服务器" : "新增服务器" }}</h3>
      <div class="grid">
        <label>
          名称
          <input v-model="editing.name" placeholder="生产环境-1" />
        </label>
        <label>
          主机
          <input v-model="editing.host" class="mono" placeholder="192.168.1.10 或 example.com" />
        </label>
        <label>
          端口
          <input v-model.number="editing.port" type="number" min="1" max="65535" />
        </label>
        <label>
          用户名
          <input v-model="editing.username" placeholder="root" />
        </label>
        <label>
          认证方式
          <select v-model="editing.authType">
            <option value="password">密码</option>
            <option value="privateKey">私钥</option>
          </select>
        </label>
        <label v-if="editing.authType === 'password'">
          密码
          <input v-model="editing.password" type="password" placeholder="登录密码" />
        </label>
        <template v-else>
          <label class="full">
            私钥内容（PEM / OpenSSH 格式）
            <textarea v-model="editing.privateKey" rows="4" class="mono" placeholder="-----BEGIN OPENSSH PRIVATE KEY-----"></textarea>
          </label>
          <label>
            私钥密码
            <input v-model="editing.passphrase" type="password" placeholder="无则留空" />
          </label>
          <label class="filebtn">
            <span>&nbsp;</span>
            <button class="btn btn-ghost" @click="pickKeyFile">从文件导入私钥</button>
          </label>
        </template>
      </div>
      <p class="muted tip">凭据仅保存在 ZTools 本地数据库；生产环境建议优先使用私钥认证。</p>
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
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 2px;
}
.ops {
  display: flex;
  gap: 6px;
  flex-shrink: 0;
}
.ok {
  color: var(--success);
}
.err {
  color: var(--danger);
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
.tip {
  margin: 4px 0 10px;
}
.ops {
  display: flex;
  gap: 8px;
}
</style>
