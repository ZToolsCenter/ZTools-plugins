<script setup lang="ts">
import { onMounted, ref } from "vue";
import { clearAllLogs, getLogRetention, getLogs, setLogRetention } from "../execStore";
import { zt } from "../api";
import type { ExecLog } from "../types";

const logs = ref<ExecLog[]>([]);
const loading = ref(true);
/** 展开的记录 _id（null 表示全部折叠） */
const expandedId = ref<string | null>(null);
/** 保留条数配置 */
const retention = ref(10);
const retentionInput = ref(10);
const savingRetention = ref(false);

const STATUS_LABEL: Record<string, string> = {
  success: "成功",
  failed: "失败",
  timeout: "超时",
  cancelled: "已取消",
};

onMounted(async () => {
  retention.value = await getLogRetention();
  retentionInput.value = retention.value;
  await loadLogs();
});

async function loadLogs() {
  loading.value = true;
  logs.value = await getLogs();
  // 默认展开最近一条
  expandedId.value = logs.value.length ? logs.value[0]._id : null;
  loading.value = false;
}

function fmtTime(ts: number): string {
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

function fmtDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

/** 摘要：成功 x / 失败 y / 超时 z / 取消 w */
function summary(l: ExecLog): string {
  const parts: string[] = [`成功 ${l.success}`];
  if (l.failed) parts.push(`失败 ${l.failed}`);
  if (l.timeoutCount) parts.push(`超时 ${l.timeoutCount}`);
  if (l.cancelledCount) parts.push(`取消 ${l.cancelledCount}`);
  return parts.join(" · ") + ` / 共 ${l.total} 台`;
}

function toggleExpand(id: string) {
  expandedId.value = expandedId.value === id ? null : id;
}

async function saveRetention() {
  savingRetention.value = true;
  const n = Math.max(1, Math.min(100, Math.floor(retentionInput.value) || 10));
  retentionInput.value = n;
  await setLogRetention(n);
  retention.value = n;
  await loadLogs();
  savingRetention.value = false;
}

async function clearAll() {
  if (!window.confirm(`确认清空全部 ${logs.value.length} 条执行记录？`)) return;
  await clearAllLogs();
  await loadLogs();
}

/** 复制单条记录全文，用于排错时贴出上下文 */
function copyOne(l: ExecLog) {
  const text = [
    `[${fmtTime(l.startedAt)}] ${l.taskName}（${l.source === "task" ? "快捷指令" : "临时命令"}）`,
    `$ ${l.command}`,
    `结果：${summary(l)}，耗时 ${fmtDuration(l.duration)}`,
    "",
    ...l.items.flatMap((it) => {
      const head = `===== ${it.serverName} (${it.host}) [${STATUS_LABEL[it.status]}] exit=${it.exitCode ?? "-"} ${fmtDuration(it.duration)} =====`;
      const blocks = [head];
      if (it.error) blocks.push(`[error] ${it.error}`);
      if (it.stdout) blocks.push(`[stdout]\n${it.stdout}`);
      if (it.stderr) blocks.push(`[stderr]\n${it.stderr}`);
      if (it.trace?.length) blocks.push(`[trace]\n${it.trace.join("\n")}`);
      if (!it.error && !it.stdout && !it.stderr) blocks.push("（无返回输出）");
      return [blocks.join("\n")];
    }),
  ].join("\n");
  zt.copyText?.(text);
}
</script>

<template>
  <div>
    <!-- 顶部：保留条数配置 + 刷新 + 清空 -->
    <div class="card toolbar">
      <label class="ret">
        保留
        <input v-model.number="retentionInput" type="number" min="1" max="100" :disabled="savingRetention" />
        条
      </label>
      <button class="btn btn-ghost btn-sm" :disabled="savingRetention || retentionInput === retention" @click="saveRetention">
        {{ savingRetention ? "保存中" : "保存" }}
      </button>
      <span class="spacer"></span>
      <button class="btn btn-ghost btn-sm" @click="loadLogs">刷新</button>
      <button v-if="logs.length" class="btn btn-danger-ghost btn-sm" @click="clearAll">清空全部</button>
    </div>

    <div v-if="loading" class="card empty muted">加载中…</div>
    <div v-else-if="!logs.length" class="card empty">
      暂无执行记录。<br />
      每次执行后的命令行返回会保存在这里（默认保留最近 10 条，可上方自定义），方便排错。
    </div>

    <template v-else>
      <div
        v-for="l in logs"
        :key="l._id"
        class="card log-card"
        :class="{ expanded: expandedId === l._id }"
      >
        <!-- 摘要行（点击展开/折叠） -->
        <div class="log-summary" @click="toggleExpand(l._id)">
          <span class="chevron">{{ expandedId === l._id ? "▾" : "▸" }}</span>
          <b>{{ l.taskName }}</b>
          <span class="tag">{{ l.source === "task" ? "快捷指令" : "临时命令" }}</span>
          <span class="badge" :class="l.failed + l.timeoutCount > 0 ? 'failed' : 'success'">
            {{ summary(l) }}
          </span>
          <span class="muted small">{{ fmtTime(l.startedAt) }}</span>
          <span class="muted small">{{ fmtDuration(l.duration) }}</span>
          <span class="spacer"></span>
          <button v-if="expandedId === l._id" class="btn btn-ghost btn-sm" @click.stop="copyOne(l)">复制</button>
        </div>

        <!-- 展开的详情 -->
        <template v-if="expandedId === l._id">
          <pre class="mono cmd">$ {{ l.command }}</pre>
          <div class="stat-line">
            <span class="badge success">成功 {{ l.success }}</span>
            <span v-if="l.failed" class="badge failed">失败 {{ l.failed }}</span>
            <span v-if="l.timeoutCount" class="badge timeout">超时 {{ l.timeoutCount }}</span>
            <span v-if="l.cancelledCount" class="badge cancelled">取消 {{ l.cancelledCount }}</span>
            <span class="muted">/ 共 {{ l.total }} 台 · 耗时 {{ fmtDuration(l.duration) }}</span>
          </div>

          <div v-for="(it, i) in l.items" :key="i" class="run">
            <div class="head">
              <span class="badge" :class="it.status">{{ STATUS_LABEL[it.status] }}</span>
              <b>{{ it.serverName }}</b>
              <span class="muted mono">{{ it.host }}</span>
              <span class="muted">{{ fmtDuration(it.duration) }}</span>
              <span v-if="it.exitCode !== null" class="muted mono">exit={{ it.exitCode }}</span>
            </div>
            <div v-if="it.error" class="err-box mono">{{ it.error }}</div>
            <details v-if="it.trace && it.trace.length" class="trace-box" :open="it.status !== 'success'">
              <summary class="muted">连接/执行阶段轨迹（{{ it.trace.length }}）</summary>
              <pre class="mono trace-pre">{{ it.trace.join("\n") }}</pre>
            </details>
            <div v-if="it.stdout" class="out-block">
              <div class="out-label">stdout</div>
              <pre class="mono out">{{ it.stdout }}</pre>
            </div>
            <div v-if="it.stderr" class="out-block">
              <div class="out-label err-text">stderr</div>
              <pre class="mono out err-out">{{ it.stderr }}</pre>
            </div>
            <div v-if="!it.error && !it.stdout && !it.stderr" class="muted out-empty">（无返回输出）</div>
          </div>
        </template>
      </div>
    </template>
  </div>
</template>

<style scoped>
.toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 10px;
  padding: 8px 12px;
}
.ret {
  display: flex;
  align-items: center;
  gap: 5px;
  color: var(--text-secondary);
  font-size: 12px;
}
.ret input {
  width: 50px;
  padding: 4px 6px;
}
.spacer {
  flex: 1;
}

/* 记录卡片 */
.log-card {
  padding: 0;
  overflow: hidden;
}
.log-card.expanded {
  padding-bottom: 10px;
}
.log-summary {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  cursor: pointer;
  flex-wrap: wrap;
}
.log-summary:hover {
  background: var(--bg-hover);
}
.chevron {
  font-size: 10px;
  color: var(--text-secondary);
  flex-shrink: 0;
}
.tag {
  font-size: 10px;
  color: var(--text-secondary);
  border: 1px solid var(--border-color);
  border-radius: 8px;
  padding: 0 7px;
  line-height: 16px;
}
.small {
  font-size: 11px;
}

/* 展开的详情 */
.cmd {
  margin: 8px 12px 0;
  padding: 8px 10px;
  background: var(--bg-hover);
  border: 1px solid var(--border-color);
  border-radius: 6px;
  font-size: 12px;
  white-space: pre-wrap;
  word-break: break-all;
}
.stat-line {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 8px 12px 0;
}
.run {
  margin: 8px 12px 0;
  padding: 8px 10px;
  border: 1px solid var(--border-color);
  border-radius: 6px;
}
.run .head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;
  flex-wrap: wrap;
}
.out-block + .out-block {
  margin-top: 6px;
}
.out-label {
  font-size: 10px;
  color: var(--text-secondary);
  margin-bottom: 2px;
}
.err-text {
  color: var(--danger);
}
.out {
  margin: 0;
  padding: 8px 10px;
  background: var(--bg-hover);
  border: 1px solid var(--border-color);
  border-radius: 6px;
  max-height: 220px;
  overflow: auto;
  font-size: 12px;
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-all;
}
.err-out {
  border-color: rgba(229, 72, 77, 0.35);
}
.err-box {
  padding: 6px 10px;
  margin-bottom: 6px;
  border-radius: 6px;
  background: rgba(229, 72, 77, 0.1);
  color: var(--danger);
  font-size: 12px;
  white-space: pre-wrap;
  word-break: break-all;
}
.out-empty {
  font-size: 12px;
  padding: 2px 0;
}
.trace-box {
  margin-bottom: 6px;
}
.trace-box summary {
  font-size: 11px;
  cursor: pointer;
  padding: 2px 0;
}
.trace-pre {
  margin: 4px 0 0;
  padding: 6px 10px;
  background: var(--bg-hover);
  border: 1px solid var(--border-color);
  border-radius: 6px;
  font-size: 11px;
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-all;
  color: var(--text-secondary);
}
</style>
