<script setup>
import { computed, ref } from 'vue';
import { book, stats, setBudget, syncFromProjects } from '../lib/store';
import { fmt, fmtNum, fmtAbs, catRows, payeeRows, catCoverage, overCatGroups } from '../lib/core';
import { ui, openDrawer, toast } from '../lib/ui';
import Icon from '../components/Icon.vue';

const view = ref('cat'); // cat | payee

const cats = computed(() => catRows(book.value));
const payees = computed(() => payeeRows(book.value));
const s = stats;
/**
 * A2：「N 个品类 · M 个已设预算」的唯一来源是 `core.catCoverage`。
 * v1.6 这里直接数预算键的个数（13），把「其他费用」这个没设预算的品类漏掉了 —— 数出来是 13 个品类。
 */
const cov = computed(() => catCoverage(book.value));

/** A2：超支两组（超预算 / 未设预算），口径见 `core.overCatGroups` */
const groups = computed(() => overCatGroups(book.value));
const LIMIT = 5;
const overRows = computed(() => groups.value.over.rows.slice(0, LIMIT));
const overRest = computed(() => Math.max(0, groups.value.over.count - LIMIT));
const noRows = computed(() => groups.value.noBudget.rows.slice(0, LIMIT));
const noRest = computed(() => Math.max(0, groups.value.noBudget.count - LIMIT));

function onBudget(name, e) {
  const v = e.target.value;
  setBudget(name, v);
  // 输入框清空后保持空态，不弹提示，避免连续输入时噪音
  if (+v > 0) {
    const row = cats.value.find((x) => x.name === name);
    // B1 双口径：超支提示按「确定应付」计，与占用率 / buildAlerts 同口径
    if (row && row.confirmed > +v) toast(`「${name}」已超支 ${fmtNum(row.confirmed - +v)}`);
  }
}

/** C3：打开该收款方的对账单抽屉（只读聚合，不写数据） */
function openStatement(name) {
  openDrawer({ type: 'statement', payee: name });
}

function doSync() {
  const before = (book.value?.categories || []).length;
  syncFromProjects();
  const after = (book.value?.categories || []).length;
  toast(after > before ? `已补全 ${after - before} 个品类` : '品类与收款方已是最新');
}
</script>

<template>
  <div class="pane" data-view="budget">
    <div class="content">
      <div class="card">
        <div class="row" style="gap: 10px">
          <div class="grow">
            <div class="mini">项目总预算（Σ 各品类预算，自动汇总）</div>
            <div style="font-size: 18px; font-weight: 800; font-variant-numeric: tabular-nums; margin-top: 2px">
              {{ s.totalBudget > 0 ? fmt(s.totalBudget) : '未设置' }}
            </div>
          </div>
          <div class="right">
            <div class="mini">应付 {{ fmt(s.payable) }}</div>
            <div class="mini">确定 {{ fmt(s.confirmedPayable) }}<span v-if="s.estTotal > 0"> · 预估 {{ fmt(s.estTotal) }}</span></div>
            <div class="mini" :style="{ color: s.balance >= 0 ? 'var(--ok)' : 'var(--danger)' }">
              {{ s.totalBudget > 0 ? (s.balance >= 0 ? '结余 ' : '超支 ') + fmt(Math.abs(s.balance)) : '—' }}
            </div>
          </div>
        </div>
        <div class="divider" />
        <div class="row mini">
          <span data-coverage>{{ cov.text }}</span>
          <span class="grow" />
          <span>修改即时保存</span>
        </div>

        <!-- A2：超支两组概要。组头给「个数 + 合计」，每组最多 5 行，其余收成「还有 N 个」。
             「未设预算」组不显示占用率 —— 没有分母，显示 0% 或 ¥0.00 都是假精确。 -->
        <template v-if="groups.over.count || groups.noBudget.count">
          <div v-if="groups.over.count" class="ogrp" data-over-group="over">
            <div class="ogrp-head">
              超预算 {{ groups.over.count }} 个 · 合计 <b class="num">+{{ fmtAbs(groups.over.sum) }}</b>
            </div>
            <div v-for="r in overRows" :key="r.name" class="ogrp-row" @click="openDrawer({ type: 'cat', name: r.name })">
              <span class="ellipsis">{{ r.name }}</span>
              <span class="grow" />
              <span class="mini num" style="color: var(--danger)">已用 {{ Math.round(r.rate) }}% · 超 {{ fmtAbs(r.over) }}</span>
            </div>
            <div v-if="overRest" class="mini ogrp-more">还有 {{ overRest }} 个</div>
          </div>
          <div v-if="groups.noBudget.count" class="ogrp" data-over-group="nobudget">
            <div class="ogrp-head">
              未设预算 {{ groups.noBudget.count }} 个 · 合计 <b class="num">{{ fmtAbs(groups.noBudget.sum) }}</b>
            </div>
            <div v-for="r in noRows" :key="r.name" class="ogrp-row" @click="openDrawer({ type: 'cat', name: r.name })">
              <span class="ellipsis">{{ r.name }}</span>
              <span class="grow" />
              <span class="mini num" style="color: var(--warn)">未设预算 · 已花 {{ fmtAbs(r.confirmed) }}</span>
            </div>
            <div v-if="noRest" class="mini ogrp-more">还有 {{ noRest }} 个</div>
          </div>
        </template>
      </div>

      <div class="bar-row">
        <div class="seg">
          <button :class="{ on: view === 'cat' }" @click="view = 'cat'">品类预算 {{ cats.length }}</button>
          <button :class="{ on: view === 'payee' }" @click="view = 'payee'">收款方 {{ payees.length }}</button>
        </div>
        <span class="grow" />
        <button class="btn sm" @click="doSync">补全档案</button>
        <button
          class="btn sm primary"
          @click="openDrawer({ type: view === 'cat' ? 'cat' : 'payee' })"
        >
          <Icon name="plus" :size="12" />{{ view === 'cat' ? '品类' : '对象' }}
        </button>
      </div>

      <!-- 品类 -->
      <div v-if="view === 'cat'" class="card" style="padding: 2px 0">
        <div v-for="c in cats" :key="c.name" class="bud-row" @click="openDrawer({ type: 'cat', name: c.name })">
          <div class="l1">
            <span class="dot" :style="{ background: c.color }" />
            <span class="nm ellipsis">{{ c.name }}</span>
            <span v-if="c.note" class="note ellipsis">{{ c.note }}</span>
            <span class="grow" />
            <span class="num amt">{{ fmtNum(c.amount) }}</span>
          </div>
          <!-- B1 双口径：上排是含预估的真源「应付」，这里补确定应付与预估（占用率/差额已按确定应付） -->
          <div class="l1c mini">
            <span>确定 <b class="num">{{ fmtNum(c.confirmed) }}</b></span>
            <span class="dotsep">·</span>
            <span>预估 <b class="num">{{ fmtNum(c.est) }}</b></span>
            <span class="grow" />
            <span>{{ c.count }} 个费用项</span>
          </div>
          <div class="l2" @click.stop>
            <label class="bwrap">
              <span>预算</span>
              <input
                class="binput num"
                type="number"
                min="0"
                step="1000"
                :value="c.budget || ''"
                placeholder="未设预算"
                @change="onBudget(c.name, $event)"
              />
            </label>
            <div class="prog bw">
              <i
                :style="{
                  width: (c.rate == null ? 0 : Math.min(c.rate, 100)) + '%',
                  background: c.rate == null ? 'var(--line-strong)' : c.rate >= 100 ? 'var(--danger)' : c.rate >= 80 ? 'var(--warn)' : 'var(--ok)',
                }"
              />
            </div>
            <span class="rate num" :style="{ color: c.rate == null ? 'var(--muted)' : c.rate >= 100 ? 'var(--danger)' : 'var(--ink-2)' }">
              {{ c.rate == null ? '未设预算' : Math.round(c.rate) + '%' }}
            </span>
            <span
              class="diff num"
              :style="{ color: c.diff == null ? 'var(--muted)' : c.diff >= 0 ? 'var(--ok)' : 'var(--danger)' }"
            >
              {{ c.diff == null ? '—' : (c.diff >= 0 ? '+' : '-') + fmtAbs(c.diff) }}
            </span>
          </div>
        </div>
        <div v-if="!cats.length" class="empty"><b>还没有品类</b>点右上角「+ 品类」添加</div>
      </div>

      <!-- 收款方 -->
      <div v-else class="card" style="padding: 2px 0">
        <div v-for="p in payees" :key="p.name" class="bud-row" data-payee-row @click="openDrawer({ type: 'payee', name: p.name })">
          <div class="l1">
            <span class="nm ellipsis">{{ p.name }}</span>
            <span v-if="p.contact" class="note ellipsis">{{ p.contact }}</span>
            <span class="grow" />
            <span class="num amt" :style="{ color: p.owe > 0 ? 'var(--danger)' : p.owe < 0 ? 'var(--ok)' : 'var(--muted)' }">
              {{ p.owe > 0 ? '欠 ' + fmtNum(p.owe) : p.owe < 0 ? '多付 ' + fmtAbs(p.owe) : '已结清' }}
            </span>
          </div>
          <div class="l2">
            <span class="mini">账目 <b class="num">{{ fmtNum(p.amount) }}</b></span>
            <span class="mini">已付 <b class="num">{{ fmtNum(p.paid) }}</b></span>
            <span class="grow" />
            <button class="link" @click.stop="openStatement(p.name)">对账单</button>
            <span class="mini">{{ p.count }} 个费用项</span>
          </div>
        </div>
        <div v-if="!payees.length" class="empty"><b>还没有收款方</b>登记费用项时会自动建档</div>
      </div>

      <div class="mini foot-note">
        品类预算与「费用项」双向联动：应付 = 该品类下所有项目应付合计；差额为正表示结余，为负表示超支。
      </div>
    </div>
  </div>
</template>

<style scoped>
/* 同上：.content 需要 flex 父级才能成为唯一纵向滚动层（14 行品类约 1000px） */
.pane { display: flex; flex-direction: column; height: 100%; min-height: 0; }
.bar-row { display: flex; align-items: center; gap: 6px; margin: 10px 0 8px; }
.bud-row {
  padding: 8px 12px;
  border-bottom: 1px solid var(--line);
  cursor: pointer;
  transition: background 0.12s;
}
.bud-row:last-child { border-bottom: none; }
.bud-row:hover { background: var(--surface-2); }
.l1 { display: flex; align-items: center; gap: 6px; min-width: 0; }
.l1 .dot { width: 7px; height: 7px; border-radius: 50%; flex: none; }
.l1 .nm { font-weight: 700; font-size: 12.5px; max-width: 210px; }
.l1 .note { font-size: 10.5px; color: var(--muted); max-width: 150px; }
.l1 .amt { font-size: 12.5px; font-weight: 700; }
/* B1 二级读数行：确定应付 / 预估（10px，不抢 l1 的金额主线） */
.l1c { display: flex; align-items: center; gap: 5px; font-size: 10px; margin-top: 1px; }
.l1c b { color: var(--ink-2); font-weight: 700; }
.l1c .dotsep { opacity: 0.5; }
.l2 { display: flex; align-items: center; gap: 8px; margin-top: 4px; }
.bwrap { display: flex; align-items: center; gap: 4px; font-size: 10px; color: var(--muted); flex: none; }
.binput {
  width: 82px;
  border: 1px solid var(--line);
  border-radius: 6px;
  background: var(--surface-2);
  color: var(--ink);
  font-size: 11.5px;
  font-family: inherit;
  padding: 2px 5px;
  text-align: right;
}
.binput:focus { outline: none; border-color: var(--accent); background: var(--surface); }
.prog.bw { flex: 1; min-width: 40px; }
/* A2：4 个字「未设预算」需要 52px（10px × 4 ≈ 40px + 余量）；行总宽仍 ≈ 270px < 可用 738px */
.rate { font-size: 10px; width: 52px; text-align: right; flex: none; }
/* A2：超支两组概要（不新增卡片，挂在汇总卡内） */
.ogrp { margin-top: 7px; }
.ogrp-head {
  display: flex;
  align-items: baseline;
  gap: 3px;
  font-size: 10.5px;
  font-weight: 700;
  color: var(--ink-2);
  padding-bottom: 3px;
  border-bottom: 1px solid var(--line);
}
.ogrp-row {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  padding: 2px 0;
  cursor: pointer;
}
.ogrp-row:hover { background: var(--surface-2); }
.ogrp-more { color: var(--muted); padding: 1px 0 0 2px; }
.diff { font-size: 10.5px; width: 64px; text-align: right; font-weight: 700; flex: none; }
.foot-note { margin-top: 9px; line-height: 1.7; }
</style>
