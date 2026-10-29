<script setup>
import { computed, ref } from 'vue';
import { book, stats } from '../lib/store';
import {
  PALETTE, fmt, fmtNum, fmtAbs, catCoverage, monthlyPayments, SUB_COLOR, agingRows, todayLocal,
  materialRows, monthCompare, costPerArea,
} from '../lib/core';
import { openDrawer } from '../lib/ui';
import Donut from '../components/Donut.vue';
import MiniBars from '../components/MiniBars.vue';

const tab = ref('cat');
/** A2：品类覆盖文案的唯一来源（与分析页标题右侧、概览、预算页同源） */
const cov = computed(() => catCoverage(book.value));
const s = stats;

/* ---------------- A1 账龄（v1.4） ---------------- */
const agePayee = ref('');
const ageBucket = ref('');   // 展开中的桶（点第二次收起）
const age = computed(() => agingRows(book.value, todayLocal(), agePayee.value));
const ageTotal = computed(() => age.value.total || 0);
const bucketPct = (v) => (ageTotal.value > 0 ? Math.round((v / ageTotal.value) * 100) : 0);
const BUCKET_TONE = ['var(--ok)', 'var(--ochre)', '#C8873F', 'var(--danger)'];
const bucketLabel = computed(() => (age.value.buckets.find((b) => b.key === ageBucket.value) || {}).label || '');
const ageItems = computed(() => age.value.items.filter((it) => it.bucket === ageBucket.value));

function toggleBucket(key) {
  ageBucket.value = ageBucket.value === key ? '' : key;
}

/* ---------------- A2 材料排行（v1.5） ---------------- */
const mats = computed(() => materialRows(book.value, 10));
const matPct = (v) => (mats.value.max > 0 ? Math.round((v / mats.value.max) * 100) : 0);

/* ---------------- A3 月度环比（v1.5） ---------------- */
const cmp = computed(() => monthCompare(book.value));
const cmpRows = computed(() => {
  const c = cmp.value;
  return [
    { k: '应付', o: c.payable, unit: '' },
    { k: '已付', o: c.paid, unit: '' },
    { k: '新增费用项', o: c.count, unit: '条' },
  ];
});
const arrow = (d) => (d > 0 ? '↑' : d < 0 ? '↓' : '→');
const diffTone = (k, d) => {
  if (!d) return 'var(--muted)';
  // 应付/新增上升=花钱变多（warn），已付上升=进度推进（ok）
  if (k === '已付') return d > 0 ? 'var(--ok)' : 'var(--muted)';
  return d > 0 ? 'var(--danger)' : 'var(--ok)';
};

/* ---------------- A4 单方造价（v1.5） ---------------- */
const cpa = computed(() => costPerArea(book.value));

const catColor = (name) => (book.value?.categories || []).find((c) => c.name === name)?.color || '#B0A08C';

const catSegs = computed(() => Object.keys(s.value.byCat)
  .filter((k) => s.value.byCat[k].amount > 0)
  .sort((a, b) => s.value.byCat[b].amount - s.value.byCat[a].amount)
  .map((k) => ({ label: k, value: s.value.byCat[k].amount, color: catColor(k) })));

const budgetRows = computed(() => {
  const c = s.value;
  return Object.keys(c.byCat)
    .map((k) => ({ name: k, budget: c.byCat[k].budget || 0, amount: c.byCat[k].amount || 0 }))
    .filter((x) => x.budget > 0 || x.amount > 0)
    .sort((a, b) => Math.max(b.budget, b.amount) - Math.max(a.budget, a.amount))
    .slice(0, 8)
    .map((x) => ({ ...x, max: Math.max(x.budget, x.amount, 1) }));
});

const payeeSegs = computed(() => {
  const c = s.value.byPayee || {};
  const all = Object.keys(c).filter((n) => c[n].amount > 0).sort((a, b) => c[b].amount - c[a].amount);
  const top = all.slice(0, 7).map((n, i) => ({ label: n, value: c[n].amount, color: PALETTE[i % PALETTE.length] }));
  const rest = all.slice(7).reduce((t, n) => t + c[n].amount, 0);
  if (rest > 0) top.push({ label: `其他 ${all.length - 7} 家`, value: rest, color: '#C9BCA9' });
  return top;
});

const debtRows = computed(() => {
  const c = s.value.byPayee || {};
  return Object.keys(c)
    .map((n) => ({ name: n, owe: Math.round((c[n].amount - c[n].paid) * 100) / 100, amount: c[n].amount, paid: c[n].paid }))
    .filter((o) => o.owe > 0.5)
    .sort((a, b) => b.owe - a.owe)
    .slice(0, 8);
});
const maxDebt = computed(() => Math.max(...debtRows.value.map((d) => d.owe), 1));

const trend = computed(() => monthlyPayments(book.value));

const subSegs = computed(() => Object.keys(s.value.bySub)
  .filter((k) => s.value.bySub[k] > 0)
  .map((k) => ({ label: k, value: s.value.bySub[k], color: SUB_COLOR[k] || '#8A6FB0' })));

</script>

<template>
  <div class="pane" data-view="analysis">
    <div class="command">
      <div class="seg" data-tab>
        <button :class="{ on: tab === 'cat' }" @click="tab = 'cat'">品类结构</button>
        <button :class="{ on: tab === 'payee' }" @click="tab = 'payee'">收款方</button>
        <button :class="{ on: tab === 'age' }" @click="tab = 'age'">账龄</button>
        <button :class="{ on: tab === 'mat' }" @click="tab = 'mat'">材料</button>
        <button :class="{ on: tab === 'trend' }" @click="tab = 'trend'">费用构成</button>
      </div>
      <span class="grow" />
      <select v-if="tab === 'age'" v-model="agePayee" class="select age-sel" title="按收款方下钻">
        <option value="">全部收款方</option>
        <option v-for="p in age.payees" :key="p.name" :value="p.name">{{ p.name }} · {{ fmtNum(p.owe) }}</option>
      </select>
      <span v-if="cpa" class="mini cost-area" title="应付合计 ÷ 建筑面积">¥{{ cpa.perArea.toLocaleString('zh-CN') }}/㎡</span>
      <span class="mini">应付合计 <b class="num" style="color: var(--ink)">{{ fmt(s.payable) }}</b></span>
    </div>

    <div class="content">
      <template v-if="tab === 'cat'">
        <div class="card">
          <div class="sec-head"><span class="bar" />各品类应付占比</div>
          <Donut :segments="catSegs" :size="112" center-label="应付合计" :center-value="fmt(s.payable)" />
        </div>
        <div class="card">
          <div class="sec-head" data-card-head="budget-vs-actual"><span class="bar" />预算 vs 实际<span class="spacer" /><span class="hint" data-coverage>{{ cov.text }} · 前 8 项</span></div>
          <div class="bv">
            <div v-for="r in budgetRows" :key="r.name" class="bv-row">
              <div class="row" style="gap: 6px">
                <span class="nm ellipsis">{{ r.name }}</span>
                <span class="grow" />
                <span class="mini num" :style="{ color: r.budget > 0 && r.amount > r.budget ? 'var(--danger)' : 'var(--muted)' }">
                  {{ r.budget > 0 ? Math.round((r.amount / r.budget) * 100) + '%' : '未设预算' }}
                </span>
              </div>
              <div class="tracks">
                <div class="tk"><i :style="{ width: (r.budget / r.max * 100) + '%', background: 'var(--ochre)', opacity: .55 }" /></div>
                <div class="tk"><i :style="{ width: (r.amount / r.max * 100) + '%', background: catColor(r.name) }" /></div>
              </div>
              <div class="row" style="gap: 8px">
                <span class="mini num">预算 {{ r.budget > 0 ? fmtNum(r.budget) : '—' }}</span>
                <span class="grow" />
                <span class="mini num" style="color: var(--ink-2)">应付 {{ fmtNum(r.amount) }}</span>
              </div>
            </div>
          </div>
        </div>
      </template>

      <template v-else-if="tab === 'payee'">
        <div class="card">
          <div class="sec-head"><span class="bar" />收款方账目占比</div>
          <Donut :segments="payeeSegs" :size="112" center-label="账目合计" :center-value="fmt(s.payable)" />
        </div>
        <div class="card">
          <div class="sec-head"><span class="bar" />欠款排行<span class="spacer" /><span class="hint">账目 − 已付</span></div>
          <div v-if="!debtRows.length" class="mini">🎉 所有收款方均已结清。</div>
          <div v-else class="rank">
            <div v-for="d in debtRows" :key="d.name" class="rank-row">
              <span class="nm" :title="d.name">{{ d.name }}</span>
              <div class="prog"><i :style="{ width: (d.owe / maxDebt * 100) + '%', background: 'var(--danger)' }" /></div>
              <span class="vb" style="color: var(--danger)">{{ fmtNum(d.owe) }}</span>
            </div>
          </div>
        </div>
      </template>

      <template v-else-if="tab === 'age'">
        <div class="card">
          <div class="sec-head">
            <span class="bar" />账龄分布
            <span class="spacer" />
            <span class="hint">按到期日 · 四桶合计 = 待付</span>
          </div>
          <div v-if="!age.items.length" class="mini">🎉 没有待付费用项，无账龄可算。</div>
          <template v-else>
            <div class="age-list">
              <div
                v-for="(b, i) in age.buckets" :key="b.key"
                class="age-row" :class="{ on: ageBucket === b.key, zero: !b.count }"
                @click="toggleBucket(b.key)"
              >
                <span class="age-lb">{{ b.label }}</span>
                <div class="prog"><i :style="{ width: bucketPct(b.amount) + '%', background: BUCKET_TONE[i] }" /></div>
                <span class="age-amt num" :style="{ color: b.amount > 0 ? 'var(--ink)' : 'var(--muted)' }">{{ fmtNum(b.amount) }}</span>
                <span class="age-cnt num">{{ b.count }} 项</span>
              </div>
            </div>
            <div class="divider" />
            <div class="row" style="gap: 8px">
              <span class="mini">待付合计 <b class="num" style="color: var(--ink)">{{ fmtNum(age.total) }}</b> · {{ age.items.length }} 项</span>
              <span class="grow" />
              <span class="mini" :style="{ color: age.maxDays > 90 ? 'var(--danger)' : 'var(--muted)' }">
                最久逾期 {{ age.maxDays }} 天<template v-if="age.worst">（{{ age.worst.name }}）</template>
              </span>
            </div>
          </template>
        </div>

        <div v-if="ageBucket && ageItems.length" class="card">
          <div class="sec-head">
            <span class="bar" />{{ bucketLabel }} · 明细
            <span class="spacer" />
            <span class="hint">点击行打开费用项</span>
          </div>
          <div class="age-items">
            <div v-for="it in ageItems" :key="it.id" class="age-item" @click="openDrawer({ type: 'item', id: it.id })">
              <span class="ai-nm ellipsis" :title="it.name">{{ it.name }}</span>
              <span class="ai-payee ellipsis" :title="it.payee">{{ it.payee || '—' }}</span>
              <span class="ai-days num" :style="{ color: it.overdue > 90 ? 'var(--danger)' : 'var(--muted)' }">
                {{ it.overdue > 0 ? `逾期 ${it.overdue} 天` : '未到期' }}
              </span>
              <span class="ai-amt num">{{ fmtNum(it.amount) }}</span>
            </div>
          </div>
        </div>

        <div class="card">
          <div class="sec-head"><span class="bar" />收款方账龄下钻</div>
          <div v-if="!age.payees.length" class="mini">暂无欠款对象。</div>
          <div v-else class="rank">
            <div
              v-for="p in age.payees" :key="p.name" class="rank-row with-act"
              :class="{ on: agePayee === p.name }"
            >
              <span class="nm" :title="p.name">{{ p.name }}</span>
              <div class="prog"><i :style="{ width: (p.owe / (age.payees[0].owe || 1) * 100) + '%', background: p.maxDays > 90 ? 'var(--danger)' : 'var(--ochre)' }" /></div>
              <span class="vb" :style="{ color: p.maxDays > 90 ? 'var(--danger)' : 'var(--ink-2)' }">{{ fmtNum(p.owe) }}</span>
              <button class="link" @click="agePayee = agePayee === p.name ? '' : p.name">
                {{ agePayee === p.name ? '取消' : '只看' }}
              </button>
            </div>
          </div>
          <div class="mini" style="margin-top: 6px; line-height: 1.7">
            账龄 = 今天 − 到期日（未填到期日按下单日 + 30 天）。未到期的欠款计入 0–30 天桶，<br />
            因此四桶金额之和恒等于待付合计；多付（负数待付）的费用项不参与分桶。
          </div>
        </div>
      </template>

      <template v-else-if="tab === 'mat'">
        <div class="card">
          <div class="sec-head" data-card-head="materials">
            <span class="bar" />明细品名排行
            <span class="spacer" />
            <span class="hint">Top {{ mats.rows.length }} / 共 {{ mats.names }} 种</span>
          </div>
          <div v-if="!mats.rows.length" class="mini">暂无明细，先在费用项里录入明细。</div>
          <template v-else>
            <div class="mat-list">
              <div
                v-for="(m, i) in mats.rows" :key="m.key"
                class="mat-row" :title="`${m.cat || '未分类'} · ${m.count} 条 · 点开对应费用项`"
                @click="openDrawer({ type: 'item', id: m.itemId })"
              >
                <span class="mat-idx num">{{ i + 1 }}</span>
                <span class="mat-nm ellipsis">{{ m.name }}</span>
                <div class="prog"><i :style="{ width: matPct(m.amount) + '%', background: catColor(m.cat) }" /></div>
                <span class="mat-amt num">{{ fmtNum(m.amount) }}</span>
                <span class="mat-cnt num">{{ m.count }} 条</span>
              </div>
            </div>
            <div class="divider" />
            <div class="row" style="gap: 8px">
              <span class="mini">明细合计 <b class="num" style="color: var(--ink)">{{ fmtNum(mats.total) }}</b></span>
              <span class="grow" />
              <span v-if="mats.othersCount" class="mini">其他 {{ mats.othersCount }} 种 {{ fmtNum(mats.others) }}</span>
            </div>
            <div class="mini" style="margin-top: 6px; line-height: 1.7">
              同名品名已合并（忽略空格与大小写）；Top {{ mats.rows.length }} 合计
              <b class="num">{{ fmtNum(mats.topTotal) }}</b>
              <template v-if="mats.othersCount"> ＋ 其他 <b class="num">{{ fmtNum(mats.others) }}</b></template>
              ＝ 明细合计 <b class="num">{{ fmtNum(mats.total) }}</b>，与费用项明细逐分对得上。
            </div>
          </template>
        </div>
        <div class="card">
          <div class="sec-head"><span class="bar" />材料 vs 品类</div>
          <div class="mini" style="line-height: 1.8">
            · 排行按<b>明细品名</b>合并，看的是"钱花在哪种料上"，与按品类看的角度互补。<br />
            · 占比条以 Top1 为满格，便于看出头部集中度（前 3 名占了多少）。<br />
            · 点任一行直接打开该品名金额最大的费用项。
          </div>
        </div>
      </template>

      <template v-else>
        <div class="card">
          <div class="sec-head">
            <span class="bar" />本月 vs 上月
            <span class="spacer" />
            <span class="hint">{{ cmp.cur }} 对比 {{ cmp.prev }}</span>
          </div>
          <div v-if="!cmp.hasData" class="mini">这两个月都没有新增费用项或付款。</div>
          <template v-else>
            <div class="cmp-grid">
              <div v-for="r in cmpRows" :key="r.k" class="cmp-cell">
                <div class="cmp-k">{{ r.k }}</div>
                <div class="cmp-v num">{{ r.unit === '条' ? r.o.cur + ' 条' : fmt(r.o.cur) }}</div>
                <!-- C2/A1 + K10（v1.8.2）：差额方向由 ↑↓ 箭头表达 → fmtAbs；
                     整块口径统一为元 + 千分位到分，全站不再有第二种精度（万位出口已删除） -->
                <div class="cmp-d num" :style="{ color: diffTone(r.k, r.o.diff) }">
                  {{ arrow(r.o.diff) }} {{ r.unit === '条' ? Math.abs(r.o.diff) + ' 条' : fmtAbs(r.o.diff) }}
                  <em v-if="r.o.prev">{{ r.o.pct > 0 ? '+' : '' }}{{ Math.round(r.o.pct) }}%</em>
                </div>
              </div>
            </div>
            <div class="divider" />
            <div class="row" style="gap: 8px">
              <span class="mini">上月基准</span>
              <span class="grow" />
              <span class="mini num">应付 {{ fmtNum(cmp.payable.prev) }} · 已付 {{ fmtNum(cmp.paid.prev) }}</span>
            </div>
            <div v-if="cmp.topCat" class="mini" style="margin-top: 6px">
              变化最大的品类：<b>{{ cmp.topCat.name }}</b>
              <!-- A1：显式 `+` / `-` 前缀 + 颜色已表方向 → fmtAbs，避免 `+-800.00` 双信号 -->
              <b class="num" :style="{ color: cmp.topCat.diff >= 0 ? 'var(--danger)' : 'var(--ok)' }">
                {{ cmp.topCat.diff >= 0 ? '+' : '-' }}{{ fmtAbs(cmp.topCat.diff) }}
              </b>
            </div>
          </template>
        </div>
        <div class="card">
          <div class="sec-head">
            <span class="bar" />付款月度趋势
            <span class="spacer" />
            <span class="hint">{{ trend.months.length }} 个月</span>
          </div>
          <MiniBars v-if="trend.months.length" :labels="trend.months" :values="trend.values" :height="88" />
          <div v-else class="mini">暂无付款记录</div>
          <div v-if="trend.noDate" class="mini" style="margin-top: 6px">
            另有 {{ trend.noDate }} 笔付款未填日期，未计入趋势。
          </div>
        </div>
        <div class="card">
          <div class="sec-head"><span class="bar" />费用类型构成</div>
          <Donut v-if="subSegs.length" :segments="subSegs" :size="112" center-label="应付" :center-value="fmt(s.payable)" />
          <div v-else class="mini">暂无数据</div>
        </div>
        <div class="card">
          <div class="sec-head"><span class="bar" />口径说明</div>
          <div class="mini" style="line-height: 1.8">
            · <b>应付</b> = 项目总计 − 优惠；项目有明细时，总计恒等于明细合计。<br />
            · <b>费用类型</b> 按费用项归类：材料费 / 人工费 / 包工包料，其他兜底。<br />
            · <b>趋势</b> 按付款流水日期归集，退款（负数）会冲减当月。
          </div>
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
.pane { display: flex; flex-direction: column; height: 100%; min-height: 0; }
.bv { display: flex; flex-direction: column; gap: 9px; }
.bv-row { display: flex; flex-direction: column; gap: 2px; }
.bv-row .nm { font-size: 11.5px; font-weight: 600; color: var(--ink-2); }
.tracks { display: flex; flex-direction: column; gap: 2px; }
.tk { height: 5px; border-radius: 3px; background: var(--surface-3); overflow: hidden; }
.tk > i { display: block; height: 100%; border-radius: 3px; }

/* A1 账龄：4 个桶一行一个，行内不新增列宽 */
.age-sel { max-width: 172px; padding: 2px 6px; font-size: 11px; height: 24px; }
.age-list { display: flex; flex-direction: column; gap: 6px; }
.age-row {
  display: grid; grid-template-columns: 74px minmax(0, 1fr) 80px 44px;
  gap: 7px; align-items: center; font-size: 11.5px;
  padding: 3px 5px; margin: 0 -5px; border-radius: 6px; cursor: pointer;
}
.age-row:hover { background: var(--surface-3); }
.age-row.on { background: var(--accent-soft, var(--surface-3)); box-shadow: inset 0 0 0 1px var(--line-strong); }
.age-row.zero { opacity: .55; }
.age-lb { color: var(--ink-2); white-space: nowrap; }
.age-amt { text-align: right; font-variant-numeric: tabular-nums; font-weight: 700; }
.age-cnt { text-align: right; color: var(--muted); }

/* 展开的明细行：品名 / 收款方 / 逾期 / 金额 */
.age-items { display: flex; flex-direction: column; gap: 2px; }
.age-item {
  display: grid; grid-template-columns: minmax(0, 1fr) 96px 82px 78px;
  gap: 7px; align-items: center; font-size: 11.5px;
  padding: 4px 5px; margin: 0 -5px; border-radius: 6px; cursor: pointer;
}
.age-item:hover { background: var(--surface-3); }
.ai-nm { color: var(--ink); font-weight: 600; }
.ai-payee { color: var(--ink-2); font-size: 11px; }
.ai-days { text-align: right; font-size: 10.5px; }
.ai-amt { text-align: right; font-variant-numeric: tabular-nums; font-weight: 700; color: var(--ink); }
/* `.rank-row.with-act` 在 PayView 里是 scoped，这里必须重声明一次 */
.rank-row.with-act { grid-template-columns: 92px minmax(0, 1fr) 78px auto; }
.rank-row.on .nm { color: var(--ink); font-weight: 700; }

/* A4 单方造价：命令栏右侧一个小胶囊，不占列表宽度 */
.cost-area {
  padding: 2px 7px;
  border-radius: 20px;
  background: var(--surface-3);
  color: var(--ink-2);
  font-weight: 700;
  white-space: nowrap;
}

/* A2 材料排行：序号 / 品名 / 占比条 / 金额 / 条数 */
.mat-list { display: flex; flex-direction: column; gap: 2px; }
.mat-row {
  display: grid; grid-template-columns: 18px minmax(0, 1fr) 96px 78px 46px;
  gap: 7px; align-items: center; font-size: 11.5px;
  padding: 4px 5px; margin: 0 -5px; border-radius: 6px; cursor: pointer;
}
.mat-row:hover { background: var(--surface-3); }
.mat-idx { color: var(--muted); font-size: 10px; text-align: right; }
.mat-nm { color: var(--ink); font-weight: 600; }
.mat-amt { text-align: right; font-variant-numeric: tabular-nums; font-weight: 700; }
.mat-cnt { text-align: right; color: var(--muted); font-size: 10.5px; }

/* A3 月度环比：三格等宽 */
.cmp-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; }
.cmp-cell { background: var(--surface-2); border-radius: 7px; padding: 6px 8px; }
.cmp-k { font-size: 10px; color: var(--muted); }
.cmp-v { font-size: 13px; font-weight: 800; color: var(--ink); margin-top: 2px; }
.cmp-d { font-size: 10.5px; font-weight: 700; margin-top: 2px; }
.cmp-d em { font-style: normal; opacity: .8; margin-left: 2px; }
</style>
