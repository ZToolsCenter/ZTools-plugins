<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from "vue";
import { listByPrefix } from "../api";
import {
  cancelRun,
  copyFailedList,
  counts,
  DANGEROUS_RE,
  getLatestByTask,
  getRun,
  retryFailed,
  startRun,
  type RunItem,
  type RunState,
} from "../execStore";
import type { Command, Server, Task } from "../types";

/** 与 App.vue 的 View 类型对应（这里用宽松结构，由 App push） */
const emit = defineEmits<{ (e: "nav", view: Record<string, unknown>): void }>();

const servers = ref<Server[]>([]);
const commands = ref<Command[]>([]);
const tasks = ref<Task[]>([]);

/** 下方临时命令的目标服务器（栏1 点击切换） */
const pickedServerIds = ref<string[]>([]);
const tempCommand = ref("");
const concurrency = ref(4);

/** 栏3 结果区当前展示的一轮执行（快捷指令/临时命令都汇聚于此） */
const activeRunId = ref("");
const activeRun = computed(() =>
  activeRunId.value ? getRun(activeRunId.value) : undefined,
);
const activeCounts = computed(() =>
  activeRun.value ? counts(activeRun.value) : null,
);

async function load() {
  servers.value = (await listByPrefix<Server>("server:")).sort(
    (a, b) => a.createdAt - b.createdAt,
  );
  commands.value = (await listByPrefix<Command>("cmd:")).sort(
    (a, b) => a.createdAt - b.createdAt,
  );
  tasks.value = (await listByPrefix<Task>("task:")).sort(
    (a, b) => a.createdAt - b.createdAt,
  );
  // 清理已删除服务器的残留选择
  pickedServerIds.value = pickedServerIds.value.filter((id) =>
    servers.value.some((s) => s._id === id),
  );
}
onMounted(load);

function toggleServer(id: string) {
  pickedServerIds.value = pickedServerIds.value.includes(id)
    ? pickedServerIds.value.filter((x) => x !== id)
    : [...pickedServerIds.value, id];
}

/** 全选 / 取消全选 */
const allSelected = computed(
  () =>
    servers.value.length > 0 &&
    pickedServerIds.value.length === servers.value.length,
);
function toggleAllServers() {
  pickedServerIds.value = allSelected.value
    ? []
    : servers.value.map((s) => s._id);
}

/** 点击命令库条目：填入临时命令输入框 */
function useCommand(c: Command) {
  tempCommand.value = c.content;
}

function commandOf(t: Task): string {
  if (t.commandId)
    return (
      commands.value.find((c) => c._id === t.commandId)?.content ||
      "(命令已删除)"
    );
  return t.commandText || "";
}

function serverNames(t: Task): string {
  return t.serverIds
    .map((id) => servers.value.find((s) => s._id === id)?.name)
    .filter(Boolean)
    .join("、");
}

/** 卡片关联的最近一轮执行（响应式：进度会实时刷新到卡片上） */
function runState(t: Task): RunState | undefined {
  return getLatestByTask(t._id);
}

function targetsOf(t: Task): Server[] {
  return t.serverIds
    .map((id) => servers.value.find((s) => s._id === id))
    .filter((s): s is Server => !!s);
}

/** 点击卡片「执行」：后台直接开跑，状态与进度实时显示在栏3 结果区 */
function runTask(t: Task) {
  const cmd = commandOf(t);
  if (cmd === "(命令已删除)" || !cmd) {
    alert("该快捷指令的命令不存在，请编辑后重新选择");
    return;
  }
  const targets = targetsOf(t);
  if (!targets.length) {
    alert("该快捷指令没有可用的目标服务器");
    return;
  }
  if (
    DANGEROUS_RE.test(cmd) &&
    !window.confirm(
      `命令包含高危操作关键字：\n\n${cmd}\n\n确认在 ${targets.length} 台服务器上执行？`,
    )
  ) {
    return;
  }
  const id = startRun({
    command: cmd,
    targets,
    timeout: t.timeout || 300,
    concurrency: 4,
    taskId: t._id,
    taskName: t.name,
    source: "task",
  });
  activeRunId.value = id;
}

function cancelTask(t: Task) {
  const st = runState(t);
  if (st) cancelRun(st.id);
}

/** 按钮点击：执行中则取消，否则开跑 */
function onTaskClick(t: Task) {
  const st = runState(t);
  if (st?.running) {
    cancelRun(st.id);
  } else {
    runTask(t);
  }
}

/** 快捷指令按钮的语义配色（用于状态点/按钮边） */
function toneOfTask(t: Task): "running" | "ok" | "bad" | "cancel" | "" {
  const st = runState(t);
  if (!st) return "";
  return tone(st);
}

/* ---------------- 自定义 tooltip（fixed 定位，即时显示，不受容器 overflow 裁切） ---------------- */
const tooltipEl = ref<HTMLElement | null>(null);
let tipShowTimer: number | undefined;

/** 悬停显示：以触发元素为锚点定位，水平居中、默认下方，边缘自动翻转 */
function showTip(e: MouseEvent, text: string) {
  if (!text) return;
  const el = tooltipEl.value;
  const target = e.currentTarget as HTMLElement;
  if (!el || !target) return;
  window.clearTimeout(tipShowTimer);
  el.textContent = text;
  el.style.visibility = "hidden";
  el.style.display = "block";
  const r = target.getBoundingClientRect();
  const tw = el.offsetWidth;
  const th = el.offsetHeight;
  let left = r.left + r.width / 2 - tw / 2;
  let top = r.bottom + 6;
  if (left + tw > window.innerWidth - 8) left = window.innerWidth - 8 - tw;
  if (left < 8) left = 8;
  if (top + th > window.innerHeight - 8) top = r.top - th - 6;
  el.style.left = left + "px";
  el.style.top = top + "px";
  el.style.visibility = "visible";
}

/** 悬停移动时跟随锚点重算位置（按钮换行宽度变化时仍居中） */
function moveTip(e: MouseEvent) {
  const el = tooltipEl.value;
  const target = e.currentTarget as HTMLElement;
  if (!el || !target || el.style.display === "none") return;
  const r = target.getBoundingClientRect();
  const tw = el.offsetWidth;
  const th = el.offsetHeight;
  let left = r.left + r.width / 2 - tw / 2;
  let top = r.bottom + 6;
  if (left + tw > window.innerWidth - 8) left = window.innerWidth - 8 - tw;
  if (left < 8) left = 8;
  if (top + th > window.innerHeight - 8) top = r.top - th - 6;
  el.style.left = left + "px";
  el.style.top = top + "px";
}

function hideTip() {
  window.clearTimeout(tipShowTimer);
  const el = tooltipEl.value;
  if (el) el.style.display = "none";
}

/** 临时命令：开跑后结果直接显示在栏3，不跳页 */
function runCustom() {
  const cmd = tempCommand.value.trim();
  if (!cmd) {
    alert("请输入命令，或点击命令库条目快速填充");
    return;
  }
  if (!pickedServerIds.value.length) {
    alert("请在栏1 选择至少一台服务器");
    return;
  }
  const targets = servers.value.filter((s) =>
    pickedServerIds.value.includes(s._id),
  );
  if (
    DANGEROUS_RE.test(cmd) &&
    !window.confirm(
      `命令包含高危操作关键字：\n\n${cmd}\n\n确认在 ${targets.length} 台服务器上执行？`,
    )
  ) {
    return;
  }
  activeRunId.value = startRun({
    command: cmd,
    targets,
    timeout: 300,
    concurrency: concurrency.value,
    taskName: "临时命令",
    source: "custom",
  });
}

/* ---------------- 栏3 结果区 ---------------- */

const STATUS_LABEL: Record<string, string> = {
  pending: "待执行",
  connecting: "连接中",
  running: "运行中",
  success: "成功",
  failed: "失败",
  timeout: "超时",
  cancelled: "已取消",
};

/** preload 回报的连接阶段 → 操作提示文案，用于定位"连接中"卡点 */
const STAGE_TEXT: Record<string, string> = {
  connecting: "正在建立连接…",
  handshake: "服务器已响应，正在 SSH 握手…",
  ready: "登录成功，正在提交命令…",
  exec: "命令执行中，等待返回…",
};

function stageText(stage?: string): string {
  return (stage && STAGE_TEXT[stage]) || "正在建立连接…";
}

/** 终端里每台服务器条目前缀标记（纯文本符号，不用 emoji） */
function markText(status: RunItem["status"]): string {
  switch (status) {
    case "success":
      return "✔";
    case "failed":
      return "✘";
    case "timeout":
      return "!";
    case "cancelled":
      return "○";
    default:
      return "·";
  }
}

/** 结果区顶部操作提示（一句话说明本轮执行状态） */
function tipText(st: RunState): string {
  const c = counts(st);
  if (st.running) {
    return `正在执行：已完成 ${c.done}/${c.total}，${c.active} 台连接或执行中…`;
  }
  const fail = c.failed + c.timeout;
  if (st.cancelled) {
    return `任务已取消：成功 ${c.success} 台${fail ? `，失败 ${fail} 台` : ""}，取消 ${c.cancelled} 台。`;
  }
  if (fail > 0) {
    return `执行结束：成功 ${c.success} 台，失败 ${fail} 台，请查看下方各服务器命令行返回。`;
  }
  return `全部执行成功：${c.total} 台服务器均已完成，命令行输出如下。`;
}

function doCancelActive() {
  if (activeRunId.value) cancelRun(activeRunId.value);
}

function doRetryActive() {
  if (!activeRunId.value) return;
  const nid = retryFailed(activeRunId.value);
  if (nid) activeRunId.value = nid;
}

function doCopyFailed() {
  if (activeRunId.value) copyFailedList(activeRunId.value);
}

function clearResult() {
  activeRunId.value = "";
}

/** 终端容器：执行中输出增长时，若用户停留在底部则自动滚到底 */
const termEl = ref<HTMLElement | null>(null);
watch(
  () =>
    activeRun.value?.items
      .map((it) => `${it.status}:${it.output.length}`)
      .join("|"),
  async () => {
    await nextTick();
    const el = termEl.value;
    if (!el || !activeRun.value?.running) return;
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 80) {
      el.scrollTop = el.scrollHeight;
    }
  },
);

/** 卡片进度文案 */
function progressText(st: RunState): string {
  const c = counts(st);
  if (st.running) return `执行中 ${c.done}/${c.total}`;
  if (c.failed + c.timeout === 0 && c.cancelled === 0)
    return `成功 ${c.success}/${c.total}`;
  if (c.success === 0 && c.cancelled === c.total)
    return `已取消 ${c.cancelled}/${c.total}`;
  const fail = c.failed + c.timeout;
  return `成功 ${c.success} · 失败 ${fail}${c.cancelled ? ` · 取消 ${c.cancelled}` : ""}`;
}

/** 进度条/徽标的语义配色 */
function tone(st: RunState): "running" | "ok" | "bad" | "cancel" {
  if (st.running) return "running";
  const c = counts(st);
  if (c.failed + c.timeout > 0) return "bad";
  if (c.cancelled > 0 && c.success === 0) return "cancel";
  return "ok";
}
</script>

<template>
  <div class="home">
    <!-- 栏1：选目标服务器 -->
    <section class="col col-servers card">
      <div class="panel-head">
        <b>服务器</b>
        <span class="muted"
          >{{ pickedServerIds.length }}/{{ servers.length }}</span
        >
        <span class="spacer"></span>
        <button
          class="btn btn-ghost btn-sm"
          :disabled="!servers.length"
          @click="toggleAllServers"
        >
          {{ allSelected ? "取消全选" : "全选" }}
        </button>
        <button
          class="btn btn-ghost btn-sm"
          @click="emit('nav', { name: 'servers' })"
        >
          管理
        </button>
      </div>
      <div v-if="!servers.length" class="empty">
        暂无服务器，点击「管理」添加
      </div>
      <ul v-else class="list scroll-area">
        <li
          v-for="s in servers"
          :key="s._id"
          class="item selectable"
          :class="{ on: pickedServerIds.includes(s._id) }"
          @click="toggleServer(s._id)"
        >
          <span class="dot"></span>
          <span class="ellipsis"
            ><b>{{ s.name }}</b></span
          >
          <span class="muted mono ellipsis host">{{ s.host }}</span>
        </li>
      </ul>
    </section>

    <!-- 栏2：配快捷指令、执行 -->
    <section class="col col-cmds">
      <!-- 快捷指令 -->
      <div class="card sub-panel sub-flex">
        <div class="panel-head">
          <b>快捷指令</b>
          <span class="spacer"></span>
          <button
            class="btn btn-ghost btn-sm"
            @click="emit('nav', { name: 'task-manage' })"
          >
            管理
          </button>
        </div>
        <div v-if="!tasks.length" class="empty mini-empty">
          暂无快捷指令，点击「管理」新增
        </div>
        <div v-else class="chip-btns scroll-area">
          <button
            v-for="t in tasks"
            :key="t._id"
            class="chip-btn"
            :class="toneOfTask(t)"
            @mouseenter="
              showTip(
                $event,
                `${commandOf(t)}\n→ ${serverNames(t) || '(服务器已删除)'}`,
              )
            "
            @mousemove="moveTip"
            @mouseleave="hideTip"
            @click="onTaskClick(t)"
          >
            <span v-if="runState(t)?.running" class="spin-dot"></span>
            <span
              v-else-if="runState(t)"
              class="status-dot"
              :class="toneOfTask(t)"
            ></span>
            <span class="chip-btn-name">{{ t.name }}</span>
          </button>
        </div>
      </div>

      <!-- 命令库 -->
      <div class="card sub-panel sub-flex">
        <div class="panel-head">
          <b>命令库</b>
          <span class="spacer"></span>
          <button
            class="btn btn-ghost btn-sm"
            @click="emit('nav', { name: 'commands' })"
          >
            管理
          </button>
        </div>
        <div v-if="!commands.length" class="empty mini-empty">
          暂无命令，点击「管理」新增
        </div>
        <div v-else class="chip-btns scroll-area">
          <button
            v-for="c in commands"
            :key="c._id"
            class="chip-btn"
            @mouseenter="showTip($event, c.content)"
            @mousemove="moveTip"
            @mouseleave="hideTip"
            @click="useCommand(c)"
          >
            <span class="chip-btn-name">{{ c.name }}</span>
          </button>
        </div>
      </div>
    </section>

    <!-- 临时命令：占用栏1-2 底部 -->
    <section class="card col-temp">
      <div class="panel-head">
        <b>临时命令</b>
        <span class="muted">目标：{{ pickedServerIds.length }} 台服务器</span>
        <span class="spacer"></span>
        <label class="conc">
          并发
          <input v-model.number="concurrency" type="number" min="1" max="10" />
        </label>
        <button
          class="btn btn-primary"
          :disabled="!tempCommand.trim() || !pickedServerIds.length"
          @click="runCustom"
        >
          立即执行
        </button>
      </div>
      <textarea
        v-model="tempCommand"
        rows="2"
        class="mono"
        placeholder="输入临时命令，或点击上方命令库条目快速填充"
      ></textarea>
    </section>

    <!-- 栏3：执行结果 -->
    <section class="col col-result card">
      <div class="panel-head">
        <b>执行结果</b>
        <span v-if="activeRun" class="badge" :class="tone(activeRun)">
          <span v-if="activeRun.running" class="spin"></span>
          {{ progressText(activeRun) }}
        </span>
        <span
          v-if="activeRun && !activeRun.running && activeRun.finishedAt"
          class="muted small"
        >
          耗时
          {{
            ((activeRun.finishedAt - activeRun.startedAt) / 1000).toFixed(1)
          }}s
        </span>
        <span class="spacer"></span>
        <button
          v-if="activeRun?.running"
          class="btn btn-danger btn-sm"
          @click="doCancelActive"
        >
          取消执行
        </button>
        <button
          v-if="
            activeRun &&
            !activeRun.running &&
            activeCounts &&
            activeCounts.failed + activeCounts.timeout > 0
          "
          class="btn btn-ghost btn-sm"
          @click="doRetryActive"
        >
          重试失败
        </button>
        <button
          v-if="
            activeRun &&
            !activeRun.running &&
            activeCounts &&
            activeCounts.failed + activeCounts.timeout > 0
          "
          class="btn btn-ghost btn-sm"
          @click="doCopyFailed"
        >
          复制失败列表
        </button>
        <button
          v-if="activeRun"
          class="btn btn-ghost btn-sm"
          @click="clearResult"
        >
          清空
        </button>
      </div>

      <div v-if="!activeRun" class="empty result-empty">
        执行快捷指令或临时命令后，此处显示操作提示与各服务器命令行的实际输出内容。
      </div>

      <template v-else>
        <!-- 进度条 -->
        <div class="prog-bar">
          <div class="track">
            <div
              class="fill"
              :class="tone(activeRun)"
              :style="{ width: activeCounts!.percent + '%' }"
            ></div>
          </div>
          <span class="muted pct">{{ activeCounts!.percent }}%</span>
        </div>

        <!-- 操作提示 -->
        <div class="tip" :class="tone(activeRun)">
          <span v-if="activeRun.running" class="spin"></span>
          {{ tipText(activeRun) }}
        </div>

        <!-- 终端式输出 -->
        <div ref="termEl" class="term mono scroll-area">
          <div class="t-cmd">
            <span class="t-prompt">$</span> {{ activeRun.command }}
          </div>

          <div v-for="(r, i) in activeRun.items" :key="i" class="t-block">
            <div class="t-head">
              <span class="t-mark" :class="r.status">
                <span
                  v-if="r.status === 'connecting' || r.status === 'running'"
                  class="spin-inline"
                ></span>
                <template v-else>{{ markText(r.status) }}</template>
              </span>
              <b>{{ r.server.name }}</b>
              <span class="t-who"
                >{{ r.server.username }}@{{ r.server.host }}:{{
                  r.server.port
                }}</span
              >
              <span class="t-state" :class="r.status">{{
                STATUS_LABEL[r.status]
              }}</span>
              <span v-if="r.result" class="t-meta">
                exit={{ r.result.exitCode ?? "-" }} ·
                {{ (r.result.duration / 1000).toFixed(1) }}s
              </span>
            </div>

            <!-- 执行中：stdout/stderr 混合的实时输出 -->
            <pre v-if="activeRun.running && r.output" class="t-out">{{
              r.output
            }}</pre>
            <div
              v-else-if="
                activeRun.running &&
                (r.status === 'connecting' || r.status === 'running')
              "
              class="t-dim"
            >
              {{ stageText(r.stage) }}
            </div>
            <div
              v-else-if="activeRun.running && r.status === 'pending'"
              class="t-dim"
            >
              等待调度…
            </div>

            <!-- 完成后：stdout / stderr 分区着色，排错信息完整展示 -->
            <template v-else-if="r.result">
              <pre v-if="r.result.stdout" class="t-out">{{
                r.result.stdout
              }}</pre>
              <pre v-if="r.result.stderr" class="t-errout">
[stderr]{{ "\n" }}{{ r.result.stderr }}</pre
              >
              <div v-if="r.result.error" class="t-errline">
                ✗ {{ r.result.error }}
              </div>
              <div
                v-if="
                  r.status === 'success' && !r.result.stdout && !r.result.stderr
                "
                class="t-dim"
              >
                （无输出，退出码 0）
              </div>
            </template>
            <div v-else class="t-dim">未执行（任务已取消）</div>
          </div>
        </div>
      </template>
    </section>
  </div>

  <!-- 自定义 tooltip：fixed 定位，脱离容器流，不受任何 overflow 裁切 -->
  <div ref="tooltipEl" class="tooltip"></div>
</template>

<style scoped>
/* 自定义 tooltip：fixed 定位，即时显示，不受容器 overflow 裁切 */
.tooltip {
  position: fixed;
  display: none;
  z-index: 9999;
  max-width: 80vw;
  padding: 5px 9px;
  border-radius: 6px;
  background: rgba(18, 20, 24, 0.95);
  color: #e6edf3;
  font-size: 12px;
  line-height: 1.5;
  font-family: "SF Mono", Menlo, Consolas, monospace;
  white-space: pre-wrap;
  word-break: break-all;
  pointer-events: none;
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.25);
}

/* 三栏布局：填满视口高度，各栏内部滚动
   servers / cmds 占上行，temp 跨栏1-2 占下行，result 跨两行 */
.home {
  display: grid;
  grid-template-columns: 1.2fr 1.2fr 1.6fr;
  grid-template-rows: 1fr auto;
  grid-template-areas:
    "servers cmds   result"
    "temp    temp   result";
  gap: 10px;
  height: calc(100vh - 54px);
  min-height: 360px;
}

/* 通用栏容器 */
.col {
  display: flex;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
  margin-bottom: 0;
  padding: 8px 10px;
}
.col-servers {
  grid-area: servers;
}
.col-cmds {
  grid-area: cmds;
}
.col-result {
  grid-area: result;
}
.col-temp {
  grid-area: temp;
}

/* 栏2 内部纵向堆叠 */
.col-cmds {
  gap: 8px;
  background: none;
  border: none;
  padding: 0;
}
/* 快捷指令 / 命令库：弹性分摊高度，内部列表滚动 */
.sub-flex {
  flex: 1 1 0;
  min-height: 0;
}
/* 卡片默认带 margin-bottom，栏2 内部间距交给 flex gap，避免最后一张卡片底部多出一截 */
.sub-panel {
  margin-bottom: 0;
}

/* 临时命令区：自适应内容高度 */
.col-temp {
  margin-bottom: 0;
  padding: 8px 10px;
}

.panel-head {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 6px;
  font-size: 12px;
  flex-shrink: 0;
}
/* 标题/计数/按钮不换行、不被压缩，避免栏1 窄时文字竖排 */
.panel-head b,
.panel-head .muted {
  white-space: nowrap;
}
.panel-head .btn {
  white-space: nowrap;
  flex-shrink: 0;
}
.spacer {
  flex: 1;
}

/* 可滚动列表区域 */
.scroll-area {
  flex: 1;
  overflow-y: auto;
  min-height: 0;
}

/* 通用列表条目 */
.list {
  list-style: none;
  margin: 0;
  padding: 0;
}
.item {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 4px 8px;
  border-radius: 6px;
  cursor: pointer;
}
.item:hover {
  background: var(--bg-hover);
}
.item.on {
  background: rgba(47, 111, 237, 0.14);
}
.dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--border-color);
  flex-shrink: 0;
}
.item.on .dot {
  background: var(--accent);
}
.cmd-dot {
  border-radius: 2px;
}
.ellipsis {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.host {
  font-size: 11px;
  flex: 1;
  min-width: 0;
}

/* 快捷指令按钮网格 */
.chip-btns {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-content: flex-start;
}
.chip-btn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 5px 12px;
  border-radius: 6px;
  border: 1px solid var(--border-color);
  background: var(--bg-input);
  color: var(--text-primary);
  font-size: 12px;
  cursor: pointer;
  max-width: 100%;
  transition:
    border-color 0.15s,
    background 0.15s;
}
.chip-btn:hover {
  border-color: var(--accent);
}
.chip-btn.running {
  border-color: var(--accent);
  background: rgba(47, 111, 237, 0.12);
  color: var(--accent);
}
.chip-btn.ok {
  border-color: var(--success);
}
.chip-btn.bad {
  border-color: var(--danger);
}
.chip-btn.cancel {
  border-color: var(--text-secondary);
}
.chip-btn-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.status-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  flex-shrink: 0;
}
.status-dot.ok {
  background: var(--success);
}
.status-dot.bad {
  background: var(--danger);
}
.status-dot.cancel {
  background: var(--text-secondary);
}
.spin-dot {
  width: 8px;
  height: 8px;
  border: 2px solid currentColor;
  border-top-color: transparent;
  border-radius: 50%;
  flex-shrink: 0;
  animation: spin 0.8s linear infinite;
}
.mini-empty {
  padding: 14px 8px;
  font-size: 12px;
}

/* 临时命令 */
.col-temp textarea {
  width: 100%;
  resize: vertical;
}
.conc {
  display: flex;
  align-items: center;
  gap: 4px;
  color: var(--text-secondary);
  font-size: 12px;
}
.conc input {
  width: 48px;
  padding: 3px 5px;
}

/* 结果区进度条 */
.prog-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 4px;
  flex-shrink: 0;
}
.prog-bar .track {
  flex: 1;
  height: 8px;
  border-radius: 4px;
  background: var(--border-color);
  overflow: hidden;
}
.prog-bar .fill {
  height: 100%;
  border-radius: 4px;
  transition: width 0.3s ease;
}
.prog-bar .fill.running {
  background: var(--accent);
}
.prog-bar .fill.ok {
  background: var(--success);
}
.prog-bar .fill.bad {
  background: var(--danger);
}
.prog-bar .fill.cancel {
  background: var(--text-secondary);
}
.prog-bar .pct {
  font-size: 12px;
  width: 34px;
  text-align: right;
  flex-shrink: 0;
}

.badge {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  flex-shrink: 0;
}
.badge.running {
  background: rgba(47, 111, 237, 0.15);
  color: var(--accent);
}
.badge.ok {
  background: rgba(47, 158, 110, 0.15);
  color: var(--success);
}
.badge.bad {
  background: rgba(229, 72, 77, 0.15);
  color: var(--danger);
}
.badge.cancel {
  background: var(--bg-hover);
  color: var(--text-secondary);
}
/* 执行中徽标里的旋转指示 */
.spin {
  width: 8px;
  height: 8px;
  border: 2px solid currentColor;
  border-top-color: transparent;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

/* 结果区提示 */
.tip {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 6px;
  padding: 5px 10px;
  border-radius: 6px;
  font-size: 12px;
  flex-shrink: 0;
}
.tip.running {
  background: rgba(47, 111, 237, 0.12);
  color: var(--accent);
}
.tip.ok {
  background: rgba(47, 158, 110, 0.12);
  color: var(--success);
}
.tip.bad {
  background: rgba(229, 72, 77, 0.12);
  color: var(--danger);
}
.tip.cancel {
  background: var(--bg-hover);
  color: var(--text-secondary);
}

/* 结果区空状态 */
.result-empty {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  text-align: center;
}

/* 终端风格输出：刻意使用深色控制台底色，浅色/深色系统下都保持命令行观感 */
.term {
  margin-top: 6px;
  padding: 10px 12px;
  border-radius: 8px;
  border: 1px solid var(--border-color);
  background: rgba(18, 20, 24, 0.92);
  color: #c9d1d9;
  font-size: 12px;
  line-height: 1.55;
}
.t-cmd {
  color: #e6edf3;
  white-space: pre-wrap;
  word-break: break-all;
  padding-bottom: 6px;
  border-bottom: 1px dashed rgba(201, 209, 217, 0.25);
}
.t-prompt {
  color: #4ec988;
}
.t-block {
  margin-top: 8px;
}
.t-head {
  display: flex;
  align-items: center;
  gap: 7px;
  flex-wrap: wrap;
}
.t-head b {
  color: #e6edf3;
}
.t-who {
  color: #6cb2ff;
}
.t-meta {
  color: #7d8590;
}
.t-mark,
.t-state {
  font-size: 11px;
  display: inline-flex;
  align-items: center;
}
.t-mark {
  width: 12px;
  justify-content: center;
}
.t-mark.success,
.t-state.success {
  color: #4ec988;
}
.t-mark.failed,
.t-state.failed {
  color: #ff7b72;
}
.t-mark.timeout,
.t-state.timeout {
  color: #e3b341;
}
.t-mark.cancelled,
.t-state.cancelled,
.t-mark.pending {
  color: #7d8590;
}
.t-mark.connecting,
.t-mark.running,
.t-state.connecting,
.t-state.running {
  color: #58a6ff;
}
.t-out,
.t-errout {
  margin: 4px 0 0;
  white-space: pre-wrap;
  word-break: break-all;
}
.t-out {
  color: #c9d1d9;
}
.t-errout {
  color: #ff7b72;
}
.t-errline {
  margin-top: 4px;
  color: #ff7b72;
}
.t-dim {
  margin-top: 4px;
  color: #7d8590;
}
.spin-inline {
  width: 9px;
  height: 9px;
  border: 2px solid currentColor;
  border-top-color: transparent;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}
</style>
