<script setup>
/**
 * 收款方对账单（C3）。
 *
 * 定位：抽屉内只读聚合视图，**不持久化、不改任何金额**。
 * 数字全部回源 `payableOf / paidOf / dueOf`，与费用项列表、付款页逐分一致（设计 §1.7 边界）。
 * 打印：优先 `window.print()` + 打印 CSS；webview 不支持时降级为「导出 CSV / A4 HTML」（PRD #7）。
 */
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { book } from '../lib/store';
import { fmt, fmtNum, fmtAbs, payableOf, paidOf, dueOf, effectiveDue, round2, todayLocal, bookDueDays } from '../lib/core';
import { closeDrawer, toast } from '../lib/ui';
import { download, exportStatementCsv } from '../lib/export';
import Drawer from '../components/Drawer.vue';
import Icon from '../components/Icon.vue';

const props = defineProps({ drawer: { type: Object, required: true } });

const payee = computed(() => props.drawer.payee || '未指定');

/**
 * 付款金额文案的**唯一来源**（屏幕付款流水与 A4 HTML 降级共用同一份，避免两处口径分叉）。
 * A1：负数表示「退款」（资金回流），方向已由「退款」二字表达 → 用 `fmtAbs`（无符号），
 * 否则会渲染成 `退款 -394.88` 的双信号。
 */
const payAmtText = (n) => (+n < 0 ? `退款 ${fmtAbs(n)}` : fmtNum(n));

/** 归属该收款方的费用项（按项目号降序，新的在前） */
const items = computed(() => (book.value?.projects || [])
  .filter((p) => (p.object || '') === payee.value)
  .slice()
  .sort((a, b) => (b.no || '').localeCompare(a.no || ''))
  .map((p) => ({
    id: p.id,
    no: p.no || '',
    remark: p.remark || p.no || '未命名',
    cat: p.cat || '',
    payable: payableOf(p),
    paid: paidOf(p),
    due: dueOf(p),
    dueDate: effectiveDue(p, bookDueDays(book.value)) || '',
  })));

/** 上述项目的全部**有效**付款流水（按日期升序，无日期的排最后；作废款不给收款方看） */
const pays = computed(() => {
  const out = [];
  items.value.forEach((it) => {
    const p = (book.value?.projects || []).find((x) => x.id === it.id);
    (p?.payments || []).filter((py) => !py.void).forEach((py) => out.push({
      no: it.no,
      remark: it.remark,
      date: py.date || '',
      method: py.method || '—',
      amount: round2(py.amount),
      note: py.note || '',
      ref: py.ref || '',
    }));
  });
  return out.sort((a, b) => (a.date || '9999-99-99').localeCompare(b.date || '9999-99-99'));
});

const total = computed(() => ({
  payable: round2(items.value.reduce((s, x) => s + x.payable, 0)),
  paid: round2(items.value.reduce((s, x) => s + x.paid, 0)),
  due: round2(items.value.reduce((s, x) => s + x.due, 0)),
}));

const today = todayLocal();
const printTime = computed(() => new Date().toLocaleString('zh-CN', { hour12: false }));

/**
 * 打印样式只在「对账单开着」时生效：给 <body> 挂一个开关类，
 * 退出抽屉立刻摘掉 —— 否则全局打印规则会连带影响其他抽屉的打印行为。
 */
const PRINT_CLASS = 'statement-open';
onMounted(() => { document.body.classList.add(PRINT_CLASS); });
onBeforeUnmount(() => { document.body.classList.remove(PRINT_CLASS); });

/* ---------------- 打印 / 导出 ---------------- */
/** 环境是否具备打印能力（webview 里 window.print 可能不存在或是空实现） */
const printMissing = ref(false);

function doPrint() {
  try {
    if (typeof window === 'undefined' || typeof window.print !== 'function') {
      throw new Error('no-print');
    }
    window.print();
  } catch (_) {
    printMissing.value = true;
    toast('当前环境不支持直接打印，请用「导出 CSV」或「A4 网页」');
  }
}

function doExportCsv() {
  const r = exportStatementCsv(payee.value, items.value, pays.value, today);
  toast(`已导出对账单（${r.items} 项 / ${r.pays} 笔）`);
}

/** A4 友好 HTML 降级：单文件、无外部依赖，浏览器里可直接 ⌘P 打印成 PDF */
function doExportHtml() {
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const itemRows = items.value.map((x) => `<tr><td>${esc(x.no)}</td><td>${esc(x.remark)}</td><td class="n">${fmtNum(x.payable)}</td><td class="n">${fmtNum(x.paid)}</td><td class="n">${fmtNum(x.due)}</td><td>${esc(x.dueDate)}</td></tr>`).join('');
  const payRows = pays.value.map((x) => `<tr><td>${esc(x.no)}</td><td>${esc(x.date || '未填日期')}</td><td>${esc(x.method)}</td><td class="n">${payAmtText(x.amount)}</td><td>${esc(x.note)}</td><td>${esc(x.ref)}</td></tr>`).join('');
  const html = `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"><title>对账单 ${esc(payee.value)}</title>
<style>
  @page { size: A4; margin: 14mm 12mm; }
  body { font-family: -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif; color: #2e2a26; font-size: 12px; margin: 0; padding: 16px; }
  h1 { font-size: 18px; margin: 0 0 2px; }
  .sub { color: #6b6156; font-size: 11px; margin-bottom: 14px; }
  h2 { font-size: 13px; margin: 16px 0 6px; border-left: 3px solid #a8624c; padding-left: 6px; }
  table { width: 100%; border-collapse: collapse; font-variant-numeric: tabular-nums; }
  th, td { border-bottom: 1px solid #eae1d4; padding: 4px 6px; text-align: left; }
  th { background: #fbf8f3; font-size: 11px; color: #6b6156; }
  td.n, th.n { text-align: right; }
  .sum { margin-top: 14px; display: flex; gap: 18px; font-size: 12.5px; font-weight: 700; }
  .sum span { color: #6b6156; font-weight: 500; }
</style></head><body>
<h1>对账单 · ${esc(payee.value)}</h1>
<div class="sub">项目：${esc(book.value?.name || '')} · 生成时间 ${esc(printTime.value)}</div>
<h2>费用项（${items.value.length}）</h2>
<table><thead><tr><th>项目号</th><th>费用备注</th><th class="n">应付</th><th class="n">已付</th><th class="n">待付</th><th>到期日</th></tr></thead><tbody>${itemRows || '<tr><td colspan="6">无</td></tr>'}</tbody></table>
<h2>付款流水（${pays.value.length}）</h2>
<table><thead><tr><th>项目号</th><th>付款日期</th><th>付款方式</th><th class="n">金额</th><th>备注</th><th>凭证号</th></tr></thead><tbody>${payRows || '<tr><td colspan="6">无</td></tr>'}</tbody></table>
<div class="sum"><div><span>应付合计</span> ${fmt(total.value.payable)}</div><div><span>已付合计</span> ${fmt(total.value.paid)}</div><div><span>待付合计</span> ${fmt(total.value.due)}</div></div>
</body></html>`;
  const safe = String(payee.value || '收款方').replace(/[\\/:*?"<>|\s]/g, '_');
  download(new Blob([html], { type: 'text/html;charset=utf-8' }), `对账单_${safe}_${today}.html`);
  toast('已导出 A4 网页，可在浏览器中打印为 PDF');
}
</script>

<template>
  <Drawer :title="`对账单 · ${payee}`" :subtitle="`${items.length} 项费用 · ${pays.length} 笔付款`" :width="400" @close="closeDrawer">
    <div class="statement">
      <!-- 打印专用抬头（屏幕上隐藏，抽屉头在打印时被隐藏） -->
      <div class="statement-print-head">
        <div class="ph-ttl">对账单 · {{ payee }}</div>
        <div class="ph-sub">项目：{{ book?.name || '' }} · 生成时间 {{ printTime }}</div>
      </div>

      <div class="sum-card">
        <div class="mini">待付合计</div>
        <div class="big num" :style="{ color: total.due > 0 ? 'var(--accent)' : 'var(--ok)' }">{{ fmt(total.due) }}</div>
        <div class="divider" />
        <div class="kv"><span>应付合计</span><b>{{ fmt(total.payable) }}</b></div>
        <div class="kv"><span>已付合计</span><b style="color: var(--ok)">{{ fmt(total.paid) }}</b></div>
      </div>

      <div class="sec-head" style="margin-top: 12px">
        <span class="bar" />费用项
        <span class="spacer" />
        <span class="hint">{{ items.length }} 项</span>
      </div>
      <div v-if="items.length" class="st-list">
        <div v-for="it in items" :key="it.id" class="st-row">
          <div class="st-main">
            <div class="nm ellipsis">{{ it.remark }}</div>
            <div class="meta">
              <span>{{ it.no || '无编号' }}</span>
              <span v-if="it.cat"> · {{ it.cat }}</span>
              <span v-if="it.dueDate"> · 到期 {{ it.dueDate }}</span>
            </div>
          </div>
          <div class="st-num">
            <div class="num">{{ fmtNum(it.payable) }}</div>
            <div class="sub num">已付 {{ fmtNum(it.paid) }}</div>
          </div>
          <div class="st-due num" :style="{ color: it.due > 0 ? 'var(--accent)' : 'var(--muted)' }">
            {{ it.due > 0 ? fmtNum(it.due) : '结清' }}
          </div>
        </div>
      </div>
      <div v-else class="mini">该收款方名下没有费用项。</div>

      <div class="sec-head" style="margin-top: 14px">
        <span class="bar" data-stmt-head />付款流水
        <span class="spacer" />
        <span class="hint">{{ pays.length }} 笔</span>
      </div>
      <div v-if="pays.length" class="st-list">
        <div v-for="(py, i) in pays" :key="i" class="st-row pay">
          <div class="st-main">
            <div class="nm" :style="{ color: py.date ? '' : 'var(--warn)' }">{{ py.date || '未填日期' }}</div>
            <div class="meta">
              <span>{{ py.no }}</span>
              <span> · {{ py.method }}</span>
              <span v-if="py.note"> · {{ py.note }}</span>
              <span v-if="py.ref"> · 凭证 {{ py.ref }}</span>
            </div>
          </div>
          <!-- A1：退款行保持 ok 色（资金回流不是超支），方向由「退款」二字 + fmtAbs 表达 -->
          <div class="st-due num" style="color: var(--ok)">
            {{ payAmtText(py.amount) }}
          </div>
        </div>
      </div>
      <div v-else class="mini">还没有付款记录。</div>

      <div class="divider" />
      <div class="kv"><span>应付合计</span><b>{{ fmt(total.payable) }}</b></div>
      <div class="kv"><span>已付合计</span><b style="color: var(--ok)">{{ fmt(total.paid) }}</b></div>
      <div class="kv"><span>待付合计</span><b :style="{ color: total.due > 0 ? 'var(--accent)' : 'var(--ok)' }">{{ fmt(total.due) }}</b></div>

      <div class="mini" style="margin-top: 8px">
        数字与费用项列表、付款页同源（应付 = 明细合计 − 优惠；待付 = 应付 − 已付，含预估明细）。
      </div>
      <div v-if="printMissing" class="mini" style="margin-top: 6px; color: var(--warn)">
        当前环境未提供打印能力，已改用「导出 CSV / A4 网页」。
      </div>
    </div>

    <template #footer>
      <button class="btn" @click="doPrint"><Icon name="download" :size="12" />打印</button>
      <button class="btn" @click="doExportCsv"><Icon name="download" :size="12" />导出 CSV</button>
      <button class="btn ghost" @click="doExportHtml">A4 网页</button>
      <span class="grow" />
      <button class="btn primary" @click="closeDrawer">关闭</button>
    </template>
  </Drawer>
</template>

<style scoped>
.sum-card {
  background: var(--surface-2);
  border: 1px solid var(--line);
  border-radius: var(--radius);
  padding: 10px 11px;
}
.big { font-size: 21px; font-weight: 800; letter-spacing: 0.3px; line-height: 1.25; }
.statement-print-head { display: none; }
.st-list { display: flex; flex-direction: column; }
.st-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 84px 62px;
  gap: 6px;
  align-items: center;
  padding: 6px 2px;
  border-bottom: 1px dashed var(--line);
  font-size: 11.5px;
}
.st-row:last-child { border-bottom: none; }
.st-main { min-width: 0; }
.st-main .nm { font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.st-main .meta { font-size: 10px; color: var(--muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.st-num { text-align: right; font-variant-numeric: tabular-nums; }
.st-num > div:first-child { font-weight: 700; }
.st-num .sub { font-size: 10px; color: var(--muted); }
.st-due { text-align: right; font-variant-numeric: tabular-nums; font-weight: 700; }
</style>

<!-- 非 scoped：打印时必须能命中抽屉外壳与页面骨架（这些节点不在本组件模板内）。
     所有规则都挂在 `body.statement-open` 下 —— 该开关类由本组件挂载/卸载时增删，
     因此不会影响其他抽屉或页面的打印行为。 -->
<style>
@media print {
  @page { size: A4; margin: 12mm 10mm; }
  body.statement-open { overflow: visible !important; background: #fff !important; height: auto !important; }
  body.statement-open { -webkit-print-color-adjust: exact; print-color-adjust: exact; }

  /* 隐藏一切非对账单元素 */
  body.statement-open .rail,
  body.statement-open .topbar,
  body.statement-open .alerts,
  body.statement-open .toast-layer,
  body.statement-open .drawer-mask,
  body.statement-open .drawer-head,
  body.statement-open .drawer-foot,
  body.statement-open .main > .pane,
  body.statement-open .main > .content { display: none !important; }

  /* 页面骨架改为自然流，让长对账单可以翻页 */
  body.statement-open .app { display: block !important; grid-template-columns: none !important; height: auto !important; overflow: visible !important; background: #fff !important; }
  body.statement-open .main { display: block !important; height: auto !important; min-height: 0 !important; overflow: visible !important; }
  body.statement-open .drawer {
    position: static !important;
    width: auto !important;
    max-width: none !important;
    height: auto !important;
    border: none !important;
    box-shadow: none !important;
    background: #fff !important;
    animation: none !important;
    display: block !important;
  }
  body.statement-open .drawer-body { overflow: visible !important; height: auto !important; padding: 0 !important; }

  /* 打印观感：去掉卡片底色与阴影，压紧行高省纸 */
  body.statement-open .sum-card { background: #fff !important; border: 1px solid #ded2c1 !important; }
  body.statement-open .st-row { border-bottom: 1px solid #eae1d4 !important; padding: 4px 0 !important; }
  body.statement-open .divider { background: #ded2c1 !important; }
}
/* 打印抬头：屏幕隐藏，仅打印时出现（抽屉头被隐藏，标题由这里补上） */
@media print {
  body.statement-open .statement-print-head { display: block !important; margin-bottom: 10px; }
  body.statement-open .ph-ttl { font-size: 16px; font-weight: 800; }
  body.statement-open .ph-sub { font-size: 10.5px; color: #6b6156; margin-top: 2px; }
}
</style>
