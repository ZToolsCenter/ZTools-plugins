<script setup lang="ts">
// 作者：木子
import { onMounted, ref } from "vue";
import { listByPrefix, putDoc, removeDoc, testConnection, uid } from "../api";
import { confirmDialog, toast } from "../ui";
import type { Server } from "../types";

const servers = ref<Server[]>([]);
const editing = ref<Partial<Server> | null>(null);
const testingId = ref("");
const testMsg = ref<{ id: string; ok: boolean; message: string } | null>(null);
const keyFileInput = ref<HTMLInputElement | null>(null);
const serverFileInput = ref<HTMLInputElement | null>(null);
const importing = ref(false);

async function load() {
  servers.value = (await listByPrefix<Server>("server:")).sort(
    (a, b) => a.createdAt - b.createdAt,
  );
}
onMounted(load);

function blank(): Partial<Server> {
  return {
    name: "",
    host: "",
    port: 22,
    username: "root",
    authType: "password",
    password: "",
    privateKey: "",
    passphrase: "",
  };
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
    toast("请填写名称、主机、用户名", "error");
    return;
  }
  if (e.authType === "password" && !e.password) {
    toast("请填写密码", "error");
    return;
  }
  if (e.authType === "privateKey" && !e.privateKey?.trim()) {
    toast("请填写私钥内容或从文件导入", "error");
    return;
  }
  const doc: Server = {
    _id: e._id || uid("server:"),
    createdAt: e.createdAt || Date.now(),
    name: e.name.trim(),
    host: e.host.trim(),
    port: Number(e.port) || 22,
    username: e.username.trim(),
    authType: e.authType === "privateKey" ? "privateKey" : "password",
    password: e.password || "",
    privateKey: e.privateKey || "",
    passphrase: e.passphrase || "",
  };
  try {
    await putDoc(doc);
    editing.value = null;
    await load();
    toast("服务器已保存", "success");
  } catch (err: any) {
    toast("保存失败: " + (err?.message || err), "error");
  }
}

async function del(s: Server) {
  const ok = await confirmDialog(
    `确认删除服务器「${s.name}」？使用它的快捷指令将无法定位到该服务器。`,
    "删除服务器",
    { confirmText: "删除" },
  );
  if (!ok) return;
  await removeDoc(s._id);
  await load();
}

async function test(s: Server) {
  testingId.value = s._id;
  try {
    const r = await testConnection(s);
    testMsg.value = { id: s._id, ok: r.ok, message: r.message };
  } catch (err: any) {
    testMsg.value = { id: s._id, ok: false, message: err?.message || String(err) };
  }
  testingId.value = "";
}

function pickKeyFile() {
  keyFileInput.value?.click();
}

async function onKeyFileChange(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file || !editing.value) return;
  if (file.size > 64 * 1024) {
    toast("文件过大（超过 64KB），不像私钥文件", "error");
    input.value = "";
    return;
  }
  const content = await file.text();
  if (!content.includes("PRIVATE KEY")) {
    toast("文件内容不包含私钥标记（PRIVATE KEY）", "error");
    input.value = "";
    return;
  }
  editing.value.privateKey = content;
  input.value = "";
  toast("私钥内容已导入", "success");
}

function pickServerFile() {
  serverFileInput.value?.click();
}

function normalizeImportedServer(raw: unknown): Server | null {
  if (!raw || typeof raw !== "object") return null;
  const item = raw as Record<string, unknown>;
  if (typeof item._id !== "string" || !item._id.startsWith("server:")) return null;
  if (typeof item.name !== "string" || !item.name.trim()) return null;
  if (typeof item.host !== "string" || !item.host.trim()) return null;
  if (typeof item.username !== "string" || !item.username.trim()) return null;
  return {
    _id: item._id,
    name: item.name.trim(),
    host: item.host.trim(),
    port: Number(item.port) || 22,
    username: item.username.trim(),
    authType: item.authType === "privateKey" ? "privateKey" : "password",
    password: typeof item.password === "string" ? item.password : "",
    privateKey: typeof item.privateKey === "string" ? item.privateKey : "",
    passphrase: typeof item.passphrase === "string" ? item.passphrase : "",
    createdAt: Number(item.createdAt) || Date.now(),
  };
}

async function onServerFileChange(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = "";
  if (!file) return;
  if (file.size > 5 * 1024 * 1024) {
    toast("文件过大（超过 5MB），不像服务器配置文件", "error");
    return;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(await file.text());
  } catch {
    toast("JSON 解析失败，请选择 ZTools 导出的服务器配置文件", "error");
    return;
  }
  const container = parsed && typeof parsed === "object" ? (parsed as { docs?: unknown }) : null;
  const rawDocs: unknown[] | null = Array.isArray(parsed)
    ? parsed
    : container && Array.isArray(container.docs)
      ? container.docs
      : null;
  if (!rawDocs) {
    toast("未找到服务器列表（需要数组或 { docs: [] }）", "error");
    return;
  }
  const docs = rawDocs.map(normalizeImportedServer).filter((doc): doc is Server => doc !== null);
  if (!docs.length) {
    toast("文件中没有可导入的服务器配置", "error");
    return;
  }
  importing.value = true;
  try {
    for (const doc of docs) await putDoc(doc);
    await load();
    const skipped = rawDocs.length - docs.length;
    toast(`已导入 ${docs.length} 台服务器${skipped ? `，跳过 ${skipped} 条无效记录` : ""}`, "success");
  } catch (err: any) {
    toast("导入失败: " + (err?.message || err), "error");
  } finally {
    importing.value = false;
  }
}
</script>

<template>
  <div>
    <div class="toolbar">
      <span class="muted">共 {{ servers.length }} 台服务器</span>
      <button class="btn btn-ghost" :disabled="importing" @click="pickServerFile">
        {{ importing ? "导入中…" : "导入 ZTools 服务器" }}
      </button>
      <input
        ref="serverFileInput"
        class="hidden-file"
        type="file"
        accept=".json,application/json"
        @change="onServerFileChange"
      />
      <button class="btn btn-primary" @click="add">新增服务器</button>
    </div>
    <p class="muted tip">支持 ZTools 导出的 ztools-servers.json；相同 ID 会覆盖更新。导入文件含明文凭据，请妥善保管并及时删除。</p>

    <div v-if="!servers.length" class="card empty">
      还没有服务器，点击「新增服务器」添加第一台。
    </div>

    <div v-for="s in servers" :key="s._id" class="card row">
      <div class="info">
        <div class="name">
          <b>{{ s.name }}</b>
          <span class="badge">{{ s.authType === "privateKey" ? "私钥" : "密码" }}</span>
        </div>
        <div class="muted mono">{{ s.username }}@{{ s.host }}:{{ s.port }}</div>
        <div v-if="testMsg && testMsg.id === s._id" :class="testMsg.ok ? 'ok' : 'err'">
          {{ testMsg.message }}
        </div>
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
            <textarea
              v-model="editing.privateKey"
              rows="4"
              class="mono"
              placeholder="-----BEGIN OPENSSH PRIVATE KEY-----"
            ></textarea>
          </label>
          <label>
            私钥密码
            <input v-model="editing.passphrase" type="password" placeholder="无则留空" />
          </label>
          <label class="filebtn">
            <span>&nbsp;</span>
            <button class="btn btn-ghost" @click="pickKeyFile">从文件导入私钥</button>
            <input
              ref="keyFileInput"
              class="hidden-file"
              type="file"
              accept=".pem,.key,text/plain"
              @change="onKeyFileChange"
            />
          </label>
        </template>
      </div>
      <p class="muted tip">凭据仅保存在 DBX Sidecar 本地数据中；生产环境建议优先使用私钥认证。</p>
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
.hidden-file {
  display: none;
}
.tip {
  margin: 4px 0 10px;
}
</style>
