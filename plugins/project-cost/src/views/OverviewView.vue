<script setup>
import { computed } from 'vue';
import { book, stats } from '../lib/store';
import {
  cashflow, buildAlerts, statOf, fmt, fmtNum, fmtAbs, percentText, costPerArea,
  catCoverage, overCatGroups,
} from '../lib/core';
import { ui, openDrawer, go } from '../lib/ui';
import Donut from '../components/Donut.vue';
import MiniBars from '../components/MiniBars.vue';
import ItemRow from '../components/ItemRow.vue';

const s = stats;
const cf = computed(() => cashflow(book.value));
/** A4 单方造价：未填面积返回 null，界面不显示该行（绝不显示 ¥0/㎡） */
const cpa = computed(() => costPerArea(book.value));
const alerts = computed(() => buildAlerts(book.value));

/** A2：品类覆盖文案的唯一来源（概览/预算页/分析页三处同源） */
const cov = computed(() => catCoverage(book.value));

/**
 * K10（v1.8.2）精度：概览 4 张 KPI 主数字一律 `fmt`（元 + 千分位 + 2 位小数，到分）。
 *
 * 历史与反转：v1.6 顶栏 KPI 走万位紧凑出口，显示 `¥24.6 万`，与同屏「¥246,055.97」的小字对不上；
 * v1.7 的处理是「万位收窄到白名单（环形图中心 / mini 柱图窄位）」，KPI 主数字走 `fmt`。
 * v1.8.2 起**结论反转**：白名单一并取消，全站只剩 `fmt / fmtNum / fmtAbs` 一个精度，
 * 那个万位出口已从 `src/lib/core.js` 删除（不再导出，连注释里都不再留它的名字）。
 * 原因：同一笔金额在不同视图里必须是同一串字符——挑剔客户看到「同一笔 8,000 在两张图里长得
 * 不一样」会直接怀疑算错；窄位宁可缩字号 / 溢出，也不换单位。
 */
const kpis = computed(() => {
  const c = s.value;
  return [
    { key: 'budget', k: '项目总预算', v: c.totalBudget > 0 ? fmt(c.totalBudget) : '未设置', s: cov.value.text, cls: '' },
    { key: 'payable', k: '累计应付', v: fmt(c.payable), s: `${c.count} 个费用项`, cls: 'sky' },
    { key: 'paid', k: '已支付', v: fmt(c.paid), s: `付款率 ${Math.round(c.payRate)}%`, cls: 'ok' },
    { key: 'due', k: '待支付', v: fmt(c.remain), s: c.remain > 0 ? '需安排资金' : '已结清', cls: c.remain > 0 ? 'warn' : 'ok' },
  ];
});

const budgetSegs = computed(() => {
  const c = s.value;
  if (c.totalBudget <= 0) return [{ label: '总费用', value: c.payable, color: 'var(--accent)' }];
  return [
    { label: '已用', value: c.payable, color: 'var(--accent)' },
    { label: c.balance >= 0 ? '结余' : '超支', value: Math.abs(c.balance), color: c.balance >= 0 ? 'var(--sky)' : 'var(--danger)' },
  ];
});

const paySegs = computed(() => [
  { label: '已付', value: s.value.paid, color: 'var(--ok)' },
  { label: '待付', value: Math.max(s.value.remain, 0), color: 'var(--ochre)' },
]);

/**
 * A2：需关注的品类。
 *
 * 口径：占用率按「确定应付」（B1）计，与 `buildAlerts` 同口径 —— 若这里仍用全口径 `amount`，
 * 会出现「预警 0 项但列表里有行」的自相矛盾。
 *
 * 分组口径一律来自 `core.overCatGroups`（超预算 / 未设预算），行列表保持「超支 + 临界」按占用率降序取前 5：
 * 临界（≥ 阈值未超）不删 —— 它仍是横幅「临界 N 项」的下钻入口，概览里给一行并列计数即可。
 */
const groups = computed(() => overCatGroups(book.value));
const LIMIT = 5;
/** 临界只数个数：占用率 ≥ 阈值且未超（与 `buildAlerts().near` 同一份判定，不再自算一遍） */
const nearCount = computed(() => alerts.value.near.length);
const watchCats = computed(() => {
  const c = s.value;
  return Object.keys(c.byCat)
    .map((k) => {
      const x = c.byCat[k];
      return { name: k, ...x, rate: x.budget > 0 ? (x.confirmed || 0) / x.budget : 0 };
    })
    .filter((x) => x.budget > 0 && x.rate >= 0.8)
    .sort((a, b) => b.rate - a.rate)
    .slice(0, LIMIT);
});
/** 三组都空（且没有逾期/临期）时才显示空态 */
const noGroups = computed(() => !groups.value.over.count && !groups.value.noBudget.count);

const recent = computed(() => [...(book.value?.projects || [])]
  .sort((a, b) => (b.date || '').localeCompare(a.date || '') || (b.no || '').localeCompare(a.no || ''))
  .slice(0, 4)
  .map((p) => ({ p, st: statOf(p) })));

function openItem(p) {
  openDrawer({ type: 'item', id: p.id });
}
</script>

<template>
  <div class="content" data-view="overview">
    <div class="kpi-strip">
      <div v-for="k in kpis" :key="k.k" class="kpi" :class="k.cls" :data-kpi="k.key">
        <div class="k">{{ k.k }}</div>
        <div class="v">{{ k.v }}</div>
        <div class="s" :data-coverage="k.key === 'budget' ? '' : null">{{ k.s }}</div>
      </div>
    </div>

    <div class="ov2">
      <div class="card">
        <div class="sec-head"><span class="bar" />付款进度</div>
        <Donut :segments="paySegs" :size="96" center-label="完成" :center-value="percentText(s.paid, s.payable)" />
        <div class="divider" />
        <div class="kv"><span>累计应付</span><b>{{ fmt(s.payable) }}</b></div>
        <div class="kv"><span>已支付</span><b>{{ fmt(s.paid) }}</b></div>
        <div class="kv"><span>待支付</span><b :style="{ color: s.remain > 0 ? 'var(--accent)' : 'var(--ok)' }">{{ fmt(s.remain) }}</b></div>
        <!-- B1 双口径：真源「应付」不动，下面两行只是派生展示（确认口径） -->
        <div class="kv sub2"><span>确定应付（不含预估）</span><b>{{ fmt(s.confirmedPayable) }}</b></div>
        <div class="kv sub2"><span>其中预估</span><b style="color: var(--warn)">{{ fmt(s.estTotal) }}</b></div>
      </div>

      <div class="card">
        <div class="sec-head"><span class="bar" />预算执行</div>
        <Donut :segments="budgetSegs" :size="96" center-label="占用" :center-value="s.totalBudget > 0 ? percentText(s.payable, s.totalBudget) : '—'" />
        <div class="divider" />
        <div class="kv"><span>预算总额</span><b>{{ s.totalBudget > 0 ? fmt(s.totalBudget) : '未设置' }}</b></div>
        <div class="kv">
          <span>结余 / 超支</span>
          <b :style="{ color: s.totalBudget <= 0 ? 'var(--muted)' : s.balance >= 0 ? 'var(--ok)' : 'var(--danger)' }">
            {{ s.totalBudget > 0 ? fmt(s.balance) : '—' }}
          </b>
        </div>
        <div class="kv"><span>超支品类</span><b :style="{ color: s.overCount ? 'var(--danger)' : 'var(--ok)' }">{{ s.overCount ? s.overCount + ' 个' : '无' }}</b></div>
        <div v-if="cpa" class="kv">
          <span>单方造价</span>
          <b class="num" :title="`应付 ${fmt(cpa.payable)} ÷ ${cpa.area} ㎡`">
            ¥{{ cpa.perArea.toLocaleString('zh-CN') }}/㎡
          </b>
        </div>
      </div>
    </div>

    <div class="card">
      <div class="sec-head">
        <span class="bar" />需关注
        <span class="spacer" />
        <span class="hint">{{ alerts.total }} 项</span>
        <button class="link" @click="go('budget')">看预算</button>
      </div>
      <div v-if="noGroups && !alerts.total" class="mini">🎉 预算未超支，也没有逾期或临期付款。</div>
      <div v-else class="rate-list">
        <!-- A2：三组计数并列一行小字（主理人拍板：不新增卡片、不删临界、不单列未设预算卡） -->
        <div class="grp-line" data-grp-line>
          <span style="color: var(--danger)">超预算 {{ groups.over.count }}</span>
          <span class="dotsep"> · </span>
          <span style="color: var(--warn)">未设预算 {{ groups.noBudget.count }}</span>
          <span class="dotsep"> · </span>
          <span style="color: var(--ink-2)">临界 {{ nearCount }}</span>
        </div>

        <div v-for="r in watchCats" :key="r.name" class="rate-row">
          <div class="row" style="gap: 6px">
            <span class="ellipsis" style="font-weight: 600">{{ r.name }}</span>
            <span class="grow" />
            <!-- A1：「超 / 余」二字已表达方向 → fmtAbs，避免 `超 -800`、`余 -1,234` -->
            <span class="mini num" :style="{ color: r.rate >= 1 ? 'var(--danger)' : 'var(--warn)' }">
              已用 {{ Math.round(r.rate * 100) }}% · {{ r.rate >= 1 ? '超 ' + fmtAbs(r.confirmed - r.budget) : '余 ' + fmtAbs(r.budget - r.confirmed) }}
            </span>
          </div>
          <div class="prog"><i :style="{ width: Math.min(r.rate / 1.5 * 100, 100) + '%', background: r.rate >= 1 ? 'var(--danger)' : 'var(--warn)' }" /></div>
        </div>

        <div v-if="alerts.overdue.length" class="overdue-note">
          <b>{{ alerts.overdue.length }}</b> 笔已逾期待付，合计
          <b>{{ fmt(alerts.overdue.reduce((x, o) => x + o.amount, 0)) }}</b>
          <button class="link" style="margin-left: 4px" @click="go('pay')">去付款</button>
        </div>
        <div v-if="alerts.soon.length" class="mini" style="margin-top: 4px">
          另有 {{ alerts.soon.length }} 笔 7 天内到期，合计 {{ fmt(alerts.soon.reduce((x, o) => x + o.amount, 0)) }}
        </div>
      </div>
    </div>

    <div class="card">
      <div class="sec-head">
        <span class="bar" />未来 6 个月待付
        <span class="spacer" />
        <span v-if="cf.overdue > 0" class="hint" style="color: var(--danger)">逾期 {{ fmt(cf.overdue) }}</span>
        <span v-else-if="cf.peakMonth" class="hint">峰值 {{ cf.peakMonth }} · {{ fmt(cf.peak) }}</span>
      </div>
      <MiniBars v-if="cf.total > 0" :labels="cf.months" :values="cf.values" />
      <div v-else class="mini">暂无未付费用项，无需预测现金流。</div>
      <div v-if="cf.total > 0" class="mini" style="margin-top: 6px">
        按「到期日」归集，未填到期日的按「下单后 30 天」推算；逾期部分不计入柱状图。
      </div>
    </div>

    <div class="card" style="padding-bottom: 4px">
      <div class="sec-head">
        <span class="bar" />最近费用项
        <span class="spacer" />
        <button class="link" @click="go('items')">全部 {{ s.count }} 条</button>
      </div>
      <div class="list" style="margin: 0 -13px">
        <ItemRow
          v-for="x in recent"
          :key="x.p.id"
          :item="x.p"
          :stat="x.st"
          :selected="ui.selId === x.p.id"
          @open="openItem(x.p)"
        />
        <div v-if="!recent.length" class="empty">
          <b>还没有费用项记录</b>
          点右上角「新增」开始登记第一笔
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.ov2 { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-top: 10px; }
.rate-list { display: flex; flex-direction: column; gap: 7px; }
.rate-row { display: flex; flex-direction: column; gap: 3px; }
/* A2：三组计数并列一行小字（超预算 / 未设预算 / 临界） */
.grp-line {
  display: flex;
  align-items: baseline;
  gap: 4px;
  font-size: 10.5px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  padding-bottom: 4px;
  border-bottom: 1px solid var(--line);
}
.grp-line .dotsep { color: var(--line-strong); font-weight: 400; }
.overdue-note {
  margin-top: 6px;
  padding: 6px 8px;
  border-radius: 7px;
  background: var(--danger-soft);
  color: var(--danger);
  font-size: 11px;
}
.overdue-note b { font-variant-numeric: tabular-nums; }
/* B1 派生二级读数：比主行小一号、弱一档，避免和真源「应付」抢视线 */
.kv.sub2 { padding-top: 0; font-size: 10.5px; }
.kv.sub2 span { color: var(--muted); }
:deep(.item) { padding-left: 13px; padding-right: 13px; }
</style>
