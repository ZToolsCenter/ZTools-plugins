<script setup>
import { computed, nextTick, onMounted, reactive, ref, watch } from 'vue';
import {
  book, stats, state, switchBook, upsertProject, removeProject, cloneProject, upsertDetail, removeDetail,
  upsertPayment, removePayment, voidPayment, availOf, nextColor, copyProject, namePriceIndex, pushUndo,
  canUndo, undo, undoDepth, canRedo, redo, redoDepth, undoVersion,
} from '../lib/store';
import {
  statOf, fmt, fmtNum, fmtAbs, projectTotal, detailSum, nextNo, todayLocal, percentText, SUBS, round2,
  catBudgetHint, estAmountOf, bookNoPrefix, nextPid, TOTAL_DRIFT_TOL,
} from '../lib/core';
import { parseDelimited } from '../lib/parse';
import { closeDrawer, openDrawer, toast, run, ui } from '../lib/ui';
import Drawer from '../components/Drawer.vue';
import Icon from '../components/Icon.vue';

const props = defineProps({ drawer: { type: Object, required: true } });

const mode = ref(props.drawer.mode || 'view');
const editIndex = ref(-1);
const errors = reactive({});
const confirmDel = ref(false);

const project = computed(() => (book.value?.projects || []).find((p) => p.id === props.drawer.id) || null);
const st = computed(() => (project.value ? statOf(project.value) : null));
const details = computed(() => project.value?.details || []);
const payments = computed(() => project.value?.payments || []);
/** C5：作废笔数（灰显在流水里，不计入已付） */
const voidCount = computed(() => payments.value.filter((x) => x.void).length);
const dSum = computed(() => round2(detailSum(project.value || {})));

const catColor = computed(() => {
  const c = (book.value?.categories || []).find((x) => x.name === project.value?.cat);
  return c?.color || 'var(--muted)';
});

/* ---------------- K21（v1.9.x）：抽屉内的撤销 / 重做入口 ----------------
 * 评审⑥：撤销入口原来只有列表页工具条一处（toast 上的「撤销」只在刚做完动作的几秒内可见），
 * 抽屉里看完一条想退一步得先关抽屉。这里在 view 态底栏补一对入口；
 * 只有 mode==='view' 渲染 —— 编辑 / 明细 / 付款表单正在等提交，此时弹撤销语义混乱。 */
/* ⚠️ K18-UI：必须借全局信号 undoVersion —— 只靠 `void book.value` 在改备注这类
 * 原地修改下不会失效（book 的依赖没变），抽屉里的按钮会停在旧值。见 store.js。 */
const canUndoNow = computed(() => { void undoVersion.value; void book.value; return canUndo(); });
const canRedoNow = computed(() => { void undoVersion.value; void book.value; return canRedo(); });
const undoSteps = computed(() => { void undoVersion.value; void book.value; return undoDepth(); });
const redoSteps = computed(() => { void undoVersion.value; void book.value; return redoDepth(); });
function doUndo() {
  const r = undo();
  toast(r.ok ? '已撤销上一步' : '没有可撤销的操作');
}
function doRedo() {
  const r = redo();
  toast(r.ok ? '已重做上一步' : '没有可重做的操作');
}

/* ---------------- 费用项表单 ---------------- */
const form = reactive({ no: '', date: '', due: '', cat: '', sub: '材料费', remark: '', total: '', discount: '', object: '' });

function resetForm() {
  Object.keys(errors).forEach((k) => delete errors[k]);
  const p = project.value;
  const cats = book.value?.categories || [];
  if (p) {
    Object.assign(form, {
      no: p.no || '',
      date: p.date || '',
      due: p.due || '',
      cat: p.cat || cats[0]?.name || '',
      sub: p.sub || '材料费',
      remark: p.remark || '',
      total: p.total ?? '',
      discount: p.discount ?? '',
      object: p.object || '',
    });
  } else {
    const pre = props.drawer.prefill || {};
    Object.assign(form, {
      no: pre.no || nextNo(book.value?.projects || [], bookNoPrefix(book.value)),
      date: pre.date || todayLocal(),
      due: pre.due || '',
      cat: pre.cat || cats[0]?.name || '',
      sub: pre.sub || '材料费',
      remark: pre.remark || '',
      total: pre.total ?? '',
      discount: pre.discount ?? '',
      object: pre.object || '',
    });
  }
}

const totalLocked = computed(() => !!(project.value && details.value.length));

/* ---------------- 抽屉内实时预算剩余（B2 + B1 双口径） ---------------- */
/**
 * 本笔「确定应付」= (总计 − 优惠) − 本项预估合计。
 * ★ 口径陷阱：若传 `form.total`，用户填了优惠后抽屉里的"剩余"会和预算页差一个优惠额；
 * ★ B1：减去本项预估合计，使抽屉内"剩余"与预算页（按确定应付）口径一致。
 */
const budgetAmount = computed(() => round2(round2((+form.total || 0) - (+form.discount || 0)) - estAmountOf(project.value)));
const budgetHint = computed(() => catBudgetHint(
  book.value,
  form.cat,
  budgetAmount.value,
  // 编辑既有费用项时排除自身，否则「本笔后剩」会把自己原来的金额算两遍
  project.value?.id || '',
));
const hintText = computed(() => {
  const h = budgetHint.value;
  const cat = form.cat || '未选品类';
  if (h.state === 'no-cat') return '未选品类，不计入品类预算';
  if (h.state === 'no-budget') return `「${cat}」未设预算 · 该品类已用 ${fmt(h.used)}`;
  if (h.state === 'over') return `「${cat}」本笔后将超支 ${fmt(h.over)}`;
  if (h.state === 'near') {
    const rate = h.budget > 0 ? Math.round((h.after / h.budget) * 100) : 0;
    return `「${cat}」本笔后剩 ${fmt(h.after)}（占用 ${rate}%）`;
  }
  return `「${cat}」预算剩余 ${fmt(h.remain)}，本笔后剩 ${fmt(h.after)}`;
});
const hintClass = computed(() => {
  if (budgetHint.value.state === 'over') return 'danger';
  if (budgetHint.value.state === 'near') return 'warn';
  return '';
});

watch(mode, (m) => {
  if (m === 'edit') resetForm();
  if (m === 'detail') resetDetail();
  if (m === 'pay') resetPay();
}, { immediate: true });

function saveProject() {
  Object.keys(errors).forEach((k) => delete errors[k]);
  if (!form.no.trim()) { errors.no = true; return toast('请填写项目号'); }
  if (!form.remark.trim()) { errors.remark = true; return toast('请填写费用备注'); }
  if (form.total === '' && !totalLocked.value) { errors.total = true; return toast('请填写总计金额'); }
  const payload = {
    id: project.value?.id,
    no: form.no.trim(),
    date: form.date,
    due: form.due,
    cat: form.cat,
    sub: form.sub,
    remark: form.remark.trim(),
    total: form.total === '' ? 0 : +form.total,
    discount: form.discount === '' ? 0 : +form.discount,
    object: form.object.trim(),
    img: project.value?.img || '',
  };
  let r = upsertProject(payload);
  // C2：疑似重复费用项 → 二次确认（取消则不写）
  if (r && r.dup) {
    // eslint-disable-next-line no-alert
    if (!window.confirm(r.msg)) return;
    r = upsertProject(payload, { force: true });
  }
  if (!run(r)) {
    if (/项目号/.test(r.msg || '')) errors.no = true;
    return;
  }
  if (props.drawer.id) mode.value = 'view';
  else closeDrawer();
}

/* ---------------- 明细表单 ---------------- */
const dForm = reactive({ name: '', unit: '', est: '否', qty: '', price: '', amount: '', craft: '', note: '' });
const amountLocked = computed(() => dForm.qty !== '' && dForm.price !== '');
/** 品名框：连续录入时把焦点送回来 */
const nameInput = ref(null);

function focusName() {
  nextTick(() => {
    nameInput.value?.focus?.();
    nameInput.value?.select?.();
  });
}

/**
 * 为"下一条"清空表单：清品名/数量/单价/金额/工艺/备注，**保留单位与预估标记**
 * （同一费用项内连续录入的明细往往同单位，能省两次输入）。
 * ★ `editIndex` 必须归 -1，否则下一次「保存并继续」会用旧 index 覆盖刚存的那条。
 * 语义独立于 `resetDetail()`（后者按 editIndex 填充），故不调用它。
 */
function clearDetailForNext() {
  Object.keys(errors).forEach((k) => delete errors[k]);
  editIndex.value = -1;
  Object.assign(dForm, {
    name: '',
    qty: '',
    price: '',
    amount: '',
    craft: '',
    note: '',
    unit: dForm.unit, // 保留上次单位
    est: dForm.est, // 保留预估标记
  });
}

function resetDetail() {
  Object.keys(errors).forEach((k) => delete errors[k]);
  const list = details.value;
  const d = editIndex.value >= 0 ? list[editIndex.value] : null;
  Object.assign(dForm, {
    name: d?.name || '',
    unit: d?.unit || '',
    est: d?.est || '否',
    qty: d?.qty ?? '',
    price: d?.price ?? '',
    amount: d?.amount ?? '',
    craft: d?.craft || '',
    note: d?.note || '',
  });
}
watch(() => [dForm.qty, dForm.price], () => {
  if (dForm.qty !== '' && dForm.price !== '') {
    dForm.amount = round2((+dForm.qty || 0) * (+dForm.price || 0));
  }
});

/* ---------------- R3 品名历史单价联想 ---------------- */
/** 全局品名 → 最近单位/单价索引（内存态，惰性构建）。datalist 用其条目。 */
const namePriceList = computed(() => {
  const idx = namePriceIndex();
  return Array.from(idx.entries()).map(([name, v]) => ({ name, unit: v.unit, price: v.price }));
});
/** 当前已输入品名若命中索引，给出「方 / 210.00」式联想提示 */
const nameHint = computed(() => {
  const nm = (dForm.name || '').trim();
  if (!nm) return null;
  return namePriceIndex().get(nm) || null;
});
/** @change（失焦/回车采纳）才填，不打断输入过程 */
function applyNameHint() {
  const nm = (dForm.name || '').trim();
  if (!nm) return;
  const hint = namePriceIndex().get(nm);
  if (hint) {
    dForm.unit = hint.unit;
    dForm.price = hint.price;
  }
}

/**
 * 保存明细。
 * @param {boolean} next true = 「保存并继续」：清空表单、焦点回品名、不退出录入态
 * ⚠️ 模板里必须显式写 `saveDetail(false)` / `saveDetail(true)`：
 *    裸 `@click="saveDetail"` 会把 MouseEvent 当成 next（truthy），普通保存也会变成连续录入。
 */
function saveDetail(next = false) {
  Object.keys(errors).forEach((k) => delete errors[k]);
  if (!dForm.name.trim()) { errors.name = true; return toast('请填写品名'); }
  let amount = dForm.amount;
  if (amount === '' && dForm.qty !== '' && dForm.price !== '') amount = round2((+dForm.qty) * (+dForm.price));
  if (amount === '' || amount === null || Number.isNaN(+amount)) { errors.amount = true; return toast('请填写金额，或数量与单价'); }
  const r = upsertDetail(project.value.id, {
    name: dForm.name.trim(),
    unit: dForm.unit.trim(),
    est: dForm.est,
    qty: dForm.qty === '' ? null : +dForm.qty,
    price: dForm.price === '' ? null : +dForm.price,
    amount: +amount,
    craft: dForm.craft.trim(),
    note: dForm.note.trim(),
  }, editIndex.value);
  run(r);
  if (!r || r.ok === false) return; // 校验/落库失败时不清表单
  if (next) {
    clearDetailForNext();
    focusName();
    return;
  }
  mode.value = 'view';
}

function editDetail(i) { editIndex.value = i; mode.value = 'detail'; resetDetail(); }
function delDetail(i) {
  // eslint-disable-next-line no-alert
  if (!window.confirm('删除这条明细？')) return;
  removeDetail(project.value.id, i);
  toast('明细已删除', { undo: true });
}

/* ---------------- R1 明细批量粘贴 ---------------- */
const batchText = ref('');
/** 解析预览：取每行前 4 列 [name, unit, qty, price]，金额 = 数量 × 单价（与逐条录入口径一致） */
const batchRows = computed(() => parseDelimited(batchText.value).map((cols) => {
  const name = (cols[0] || '').trim();
  const unit = (cols[1] || '').trim();
  const qty = +((cols[2] ?? '').trim() || 0);
  const price = +((cols[3] ?? '').trim() || 0);
  const amount = round2(qty * price);
  const ok = !!name && qty > 0 && price > 0;
  return {
    name, unit, qty, price, amount, ok,
    err: ok ? '' : (name ? '数量与单价须为正' : '缺少品名'),
  };
}));
const batchGood = computed(() => batchRows.value.filter((r) => r.ok));
const batchErrors = computed(() => batchRows.value.filter((r) => !r.ok));
const batchSum = computed(() => round2(batchGood.value.reduce((s, r) => s + r.amount, 0)));

function openBatch() { batchText.value = ''; mode.value = 'batch'; }
function cancelBatch() { mode.value = 'detail'; }
function confirmBatch() {
  if (!project.value || !batchGood.value.length) return;
  // K7：每行独立入栈。原先整批只占 1 格，想撤掉最后 3 行会连同前 7 行一起没了。
  // 20 步环形上限不变：超长粘贴会挤掉更早的几格，与单项编辑同一规则。
  batchGood.value.forEach((r) => {
    pushUndo();
    upsertDetail(project.value.id, {
      name: r.name, unit: r.unit, est: '否',
      qty: r.qty, price: r.price, amount: r.amount, craft: '', note: '',
    }, -1, { noUndo: true }); // 上面已逐条入栈，这里不再重复占格
  });
  toast(`已导入 ${batchGood.value.length} 条明细`);
  mode.value = 'view';
}

/* ---------------- B1 命中定位 ---------------- */
/**
 * 从列表页点「命中：砂子 ×2」进来时，`drawer.focusName` 带着要定位的品名。
 * 这里做两件事：① 找到第一条品名包含它的明细并高亮；② 滚到可视区（长明细表里不滚等于没定位）。
 * 找不到就静默降级为「普通详情」，不弹错 —— 用户刚才是点了个提示，不该看到报错。
 */
const locateName = computed(() => String(props.drawer.focusName || '').trim());
const locateIdx = computed(() => {
  const q = locateName.value.toLowerCase();
  if (!q) return -1;
  return details.value.findIndex((d) => String(d.name || '').trim().toLowerCase().includes(q));
});

onMounted(async () => {
  if (locateIdx.value < 0) return;
  await nextTick();
  const el = document.querySelector('.drawer .mrow[data-focus]');
  if (el && typeof el.scrollIntoView === 'function') el.scrollIntoView({ block: 'center', behavior: 'smooth' });
});

/* ---------------- 付款表单 ---------------- */
const payForm = reactive({ date: '', amount: '', method: '微信', note: '', ref: '' });
const payEditing = ref(-1);
const METHODS = ['微信', '支付宝', '银行卡', '信用卡', '现金', '其他'];

/**
 * 编辑一条「历史就没有日期」的付款时允许日期留空。
 * 绝不自动填今日 —— 那会伪造对账事实，并让 monthlyPayments() 凭空多出本月付款。
 */
const allowEmptyDate = computed(() => payEditing.value >= 0 && !payments.value[payEditing.value]?.date);

/**
 * C6：付款表单顶部的「编号」。
 * 编辑态取原号（编号是身份，编辑不改）；新增态展示**即将分配**的号，避免保存完才发现号不连号。
 * 注意这里只显示纯净 pid（`P0001`），全号（`ZX0024-P0001`）只出现在导出文件里。
 */
const payNoText = computed(() => {
  const editing = payEditing.value >= 0 ? payments.value[payEditing.value] : null;
  const pid = editing?.pid || nextPid(payments.value);
  return pid ? `编号 ${pid}` : '';
});

function resetPay() {
  Object.keys(errors).forEach((k) => delete errors[k]);
  payEditing.value = props.drawer.payIndex ?? -1;
  if (payEditing.value >= 0) {
    const py = payments.value[payEditing.value];
    Object.assign(payForm, {
      // 原本无日期就保持空（不预填今日），配合 allowEmptyDate 允许原样保存
      date: py?.date || '',
      amount: py?.amount ?? '',
      method: py?.method || '微信',
      note: py?.note || '',
      ref: py?.ref || '',
    });
  } else {
    const due = st.value?.due || 0;
    Object.assign(payForm, { date: todayLocal(), amount: due > 0 ? due : '', method: '微信', note: '', ref: '' });
  }
}

function savePay() {
  Object.keys(errors).forEach((k) => delete errors[k]);
  const amt = payForm.amount === '' ? 0 : +payForm.amount;
  if (!amt) { errors.amount = true; return toast('请输入付款金额（退款填负数）'); }
  if (!payForm.date && !allowEmptyDate.value) { errors.date = true; return toast('请选择付款日期'); }
  const avail = availOf(project.value.id, payEditing.value);
  if (amt > 0 && amt > avail + 0.005) {
    // eslint-disable-next-line no-alert
    if (!window.confirm(`本次付款 ${fmt(amt)} 超过可付余额 ${fmt(avail)}，超付 ${fmt(amt - avail)}。是否继续记录？`)) return;
  }
  const payRec = {
    date: payForm.date,
    method: payForm.method,
    amount: amt,
    note: payForm.note,
    ref: payForm.ref,
  };
  let r = upsertPayment(project.value.id, payRec, payEditing.value);
  // C2：疑似重复付款 → 二次确认（取消则不写）
  if (r && r.dup) {
    // eslint-disable-next-line no-alert
    if (!window.confirm(r.msg)) return;
    r = upsertPayment(project.value.id, payRec, payEditing.value, { force: true });
  }
  if (!run(r)) return;
  mode.value = 'view';
}
function editPay(i) { props.drawer.payIndex = i; payEditing.value = i; mode.value = 'pay'; resetPay(); }
/**
 * C5：作废 / 恢复。作废保留记录与编号（对账时能回答「那笔是记错还是没付」），只是不再计入已付。
 */
function toggleVoid(i) {
  const py = payments.value[i];
  if (!py) return;
  const r = voidPayment(project.value.id, i, !py.void);
  if (!r.ok) return toast(r.msg);
  if (r.msg) toast(r.msg, { undo: true });
}
/** 彻底删除：连痕迹一起删掉，只给「刚记错、还没对过账」的场景用 */
function delPay(i) {
  // eslint-disable-next-line no-alert
  if (!window.confirm('彻底删除这笔付款？删除后不保留痕迹，已付金额会立即减少。\n（若只是记错了想留档，请用「作废」）')) return;
  removePayment(project.value.id, i);
  toast('付款已彻底删除', { undo: true });
}

/* ---------------- 其它操作 ---------------- */
function startClone() {
  const pre = cloneProject(project.value.id);
  if (!pre) return;
  openDrawer({ type: 'item', mode: 'edit', id: null, prefill: pre });
  toast('已带入源费用项信息，确认后保存');
}

/* ---------------- R4 复制到…（含明细 / 跨项目） ---------------- */
const copyPanel = ref(false);
const copyTargetId = ref('');
const copyIncludeDetails = ref(true);
/** 除当前项目外的其他账套（下拉项）；为空时仅允许"复制到当前项目" */
const otherBooks = computed(() => (state.books || []).filter((b) => b.id !== book.value?.id));
function openCopyPanel() {
  copyTargetId.value = book.value?.id || '';
  copyIncludeDetails.value = true;
  copyPanel.value = true;
}
function doCopy() {
  // 跨项目复制落到目标 book；源恒为当前打开项目（project.value）
  const r = copyProject(copyTargetId.value, project.value.id, { includeDetails: copyIncludeDetails.value });
  if (!run(r)) return;
  copyPanel.value = false;
  // 跨项目复制后切换并关闭抽屉（源仍在源 book，停留会指向已不存在的 id）
  if (r.targetBookId && r.targetBookId !== book.value?.id) {
    switchBook(r.targetBookId);
    closeDrawer();
  }
}
function doDelete() {
  if (!confirmDel.value) { confirmDel.value = true; return; }
  removeProject(project.value.id);
  closeDrawer();
  toast('费用项已删除，可在提示中撤销', { undo: true });
}
function startPay() { props.drawer.payIndex = -1; resetPay(); mode.value = 'pay'; }
function startAddDetail() { editIndex.value = -1; resetDetail(); mode.value = 'detail'; }

const title = computed(() => {
  if (mode.value === 'edit') return project.value ? '编辑费用项' : '新增费用项';
  if (mode.value === 'detail') return editIndex.value >= 0 ? '编辑明细' : '添加明细';
  if (mode.value === 'pay') return payForm.amount < 0 || payEditing.value >= 0 ? '编辑付款' : '记录付款';
  return project.value?.remark || '费用项详情';
});

const subtitle = computed(() => {
  if (mode.value !== 'view' || !project.value) return '';
  return `${project.value.no} · ${project.value.date || '无日期'}`;
});
</script>

<template>
  <Drawer :title="title" :subtitle="subtitle" :width="mode === 'view' ? 400 : 392" @close="closeDrawer">
    <!-- ========== 详情 ========== -->
    <template v-if="mode === 'view' && project">
      <div class="amt-card">
        <div class="row" style="align-items: flex-end">
          <div class="grow">
            <div class="mini">应付</div>
            <div class="big num">{{ fmt(st.payable) }}</div>
          </div>
          <span class="badge" :class="st.status">{{ st.statusText }}</span>
        </div>
        <div class="divider" />
        <div class="amt-grid">
          <div><span>总计</span><b class="num">{{ fmtNum(st.total) }}</b></div>
          <div><span>优惠</span><b class="num">{{ project.discount ? fmtNum(project.discount) : '—' }}</b></div>
          <div><span>已付</span><b class="num" style="color: var(--ok)">{{ fmtNum(st.paid) }}</b></div>
          <!-- A1：待付三态取色（欠款 accent / 多付 danger / 结清 muted），金额本身带符号，不靠文字表方向 -->
          <div><span>待付</span><b class="num" :style="{ color: st.due > 0 ? 'var(--accent)' : st.due < 0 ? 'var(--danger)' : 'var(--muted)' }">{{ fmtNum(st.due) }}</b></div>
        </div>
        <div class="divider" />
        <div class="row" style="gap: 6px; flex-wrap: wrap">
          <span class="tag" :style="{ background: catColor + '22', color: catColor }">{{ project.cat }}</span>
          <span class="tag" style="background: var(--surface-3); color: var(--ink-2)">{{ project.sub }}</span>
          <span v-if="project.object" class="mini">{{ project.object }}</span>
          <span class="grow" />
          <span v-if="project.due" class="mini">到期 {{ project.due }}</span>
        </div>
      </div>

      <div class="sec-head" style="margin-top: 12px">
        <span class="bar" />明细
        <span class="spacer" />
        <span class="hint">{{ details.length }} 条 ·
          <span v-if="dSum < 0" style="color: var(--danger)">合计 {{ fmtNum(dSum) }}</span>
          <span v-else>合计 {{ fmtNum(dSum) }}</span>
        </span>
        <button class="btn sm" @click="startAddDetail"><Icon name="plus" :size="11" />添加</button>
      </div>
      <div v-if="details.length" class="mrow-wrap">
        <div
          v-for="(d, i) in details" :key="i"
          class="mrow" :class="{ hl: i === locateIdx }"
          data-detail-row :data-focus="i === locateIdx ? '' : null"
        >
          <div style="min-width: 0" @click="editDetail(i)">
            <div class="nm">{{ d.name }}</div>
            <div class="meta">
              <span v-if="d.qty != null">{{ d.qty }} {{ d.unit || '' }} × {{ d.price ?? '—' }}</span>
              <span v-else>—</span>
              <span v-if="d.est === '是'" style="color: var(--warn)"> · 预估</span>
              <span v-if="d.craft"> · {{ d.craft }}</span>
            </div>
          </div>
          <div class="amt num" :class="{ neg: +d.amount < 0 }" @click="editDetail(i)">{{ fmtNum(d.amount) }}</div>
          <button class="del" title="删除" @click="delDetail(i)">×</button>
        </div>
        <!-- S05：一致时**不渲染**这块提示 —— 上方「N 条 · 合计 X」已经表达了同一件事，
             两句并排会让用户以为「合计」与「总计」是两个不同的数（这就是 v1.6 的可信度问题之一）。
             只有真的不一致（> 1 分）才需要提示，且带 data-link-hint 供测试定位。 -->
        <div v-if="Math.abs(dSum - st.total) >= TOTAL_DRIFT_TOL" class="mini" style="margin-top: 5px" data-link-hint>
          <span style="color: var(--warn)">明细合计与总计相差 {{ fmt(dSum - st.total) }}，保存时会自动对齐</span>
        </div>
      </div>
      <div v-else class="mini" style="padding: 4px 0 2px">
        该项目没有明细，总计按手填金额计。添加明细后，总计将自动等于明细合计。
      </div>

      <div class="sec-head" style="margin-top: 14px">
        <span class="bar" />付款记录
        <span class="spacer" />
        <span class="hint">{{ payments.length }} 笔<template v-if="voidCount">（作废 {{ voidCount }}）</template></span>
        <button class="btn sm" @click="startPay"><Icon name="plus" :size="11" />记录</button>
      </div>
      <div v-if="payments.length" class="mrow-wrap">
        <div v-for="(py, i) in payments" :key="py.pid || i" class="mrow payrow" :class="{ voided: py.void }" data-pay-row>
          <div style="min-width: 0" @click="editPay(i)">
            <div class="nm" :style="{ color: py.date ? '' : 'var(--warn)' }">
              {{ py.date || '未填日期' }}
              <span v-if="py.void" class="void-tag">作废</span>
            </div>
            <div class="meta">
              {{ py.method || '—' }}
              <span v-if="py.note"> · {{ py.note }}</span>
              <span v-if="py.ref"> · 凭证 {{ py.ref }}</span>
            </div>
          </div>
          <!-- A1：付款行负数是「退款」（资金回流），文案「退款 N」已表方向 → fmtAbs + --ok；
               与明细行负数的 --danger 语义刻意不同：退款不是超支 -->
          <div class="amt num" :style="{ color: py.void ? 'var(--muted)' : py.amount < 0 ? 'var(--ok)' : 'var(--ink)' }" @click="editPay(i)">
            {{ py.amount < 0 ? '退款 ' + fmtAbs(py.amount) : fmtNum(py.amount) }}
          </div>
          <button class="void-btn" :title="py.void ? '恢复这笔付款' : '作废（保留记录，不计入已付）'" @click="toggleVoid(i)">
            {{ py.void ? '恢复' : '作废' }}
          </button>
          <button class="del" title="彻底删除" @click="delPay(i)">×</button>
        </div>
      </div>
      <div v-else class="mini" style="padding: 4px 0 2px">还没有付款记录。</div>

      <div v-if="project.img" class="mini" style="margin-top: 10px">📎 已附凭证图片</div>

      <!-- R4 复制到…（含明细 / 跨项目） -->
      <div v-if="copyPanel" class="copy-panel">
        <div class="sec-head" style="margin: 4px 0 6px"><span class="bar" />复制到</div>
        <div class="row" style="gap: 6px; margin-bottom: 6px">
          <select v-model="copyTargetId" class="select" style="flex: 1">
            <option :value="book.id">{{ book.name }}（当前）</option>
            <option v-for="b in otherBooks" :key="b.id" :value="b.id">{{ b.name }}</option>
          </select>
        </div>
        <label class="row mini" style="gap: 6px; margin-bottom: 8px; cursor: pointer">
          <input type="checkbox" v-model="copyIncludeDetails" /> 包含明细（取消则只复制费用项字段）
        </label>
        <div class="row">
          <button class="btn ghost" @click="copyPanel = false">取消</button>
          <span class="grow" />
          <button class="btn primary" @click="doCopy">确认复制</button>
        </div>
      </div>
    </template>

    <!-- ========== 费用项表单 ========== -->
    <div v-else-if="mode === 'edit'" class="form">
      <div class="grid2">
        <div class="field">
          <label>项目号<span class="req">*</span></label>
          <input v-model="form.no" class="input" :class="{ invalid: errors.no }" data-autofocus />
        </div>
        <div class="field">
          <label>日期</label>
          <input v-model="form.date" class="input" type="date" />
        </div>
      </div>
      <div class="grid2">
        <div class="field">
          <label>品类</label>
          <select v-model="form.cat" class="select">
            <option v-for="c in book.categories" :key="c.name" :value="c.name">{{ c.name }}</option>
          </select>
        </div>
        <div class="field">
          <label>费用类型</label>
          <select v-model="form.sub" class="select">
            <option v-for="s in SUBS" :key="s" :value="s">{{ s }}</option>
          </select>
        </div>
      </div>
      <div class="field">
        <label>费用备注<span class="req">*</span></label>
        <input v-model="form.remark" class="input" :class="{ invalid: errors.remark }" placeholder="如 客厅瓷砖" />
      </div>
      <div class="grid2">
        <div class="field">
          <label>总计（元）{{ totalLocked ? '' : '*' }}</label>
          <input
            v-model="form.total" class="input num" :class="{ invalid: errors.total }"
            type="number" step="0.01" :readonly="totalLocked" placeholder="0"
          />
          <span v-if="totalLocked" class="hint ok">由明细自动汇总</span>
        </div>
        <div class="field">
          <label>优惠（元）</label>
          <input v-model="form.discount" class="input num" type="number" step="0.01" placeholder="0" />
        </div>
      </div>
      <!-- B2 抽屉内实时预算剩余：口径 应付 = 总计 − 优惠，与预算页一致 -->
      <div
        v-if="!totalLocked || form.total !== ''"
        class="mini hint"
        :class="hintClass"
        style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis"
      >{{ hintText }}</div>
      <div class="grid2">
        <div class="field">
          <label>到期日（付款提醒）</label>
          <input v-model="form.due" class="input" type="date" />
        </div>
        <!-- C1：界面叫「收款方」（PRD 术语表），底层字段仍是 `object`，导出列名也仍叫「支付对象」 -->
        <div class="field" data-field="object">
          <label>收款方</label>
          <input v-model="form.object" class="input" list="payee-list" placeholder="选择或输入" />
          <datalist id="payee-list">
            <option v-for="p in book.payees" :key="p.name" :value="p.name" />
          </datalist>
        </div>
      </div>
      <div class="mini">
        留空到期日则按「下单后 30 天」判断逾期；应付 = 总计 − 优惠（优惠填负数表示加价）。
      </div>
    </div>

    <!-- ========== 明细表单 ========== -->
    <div v-else-if="mode === 'detail'" class="form">
      <!-- 连续录入时用户看不到累计金额 → 固定一行只读提示，便于发现录错 -->
      <div class="mini" style="margin-bottom: 6px">
        本项已有 {{ details.length }} 条 · 合计 {{ fmtNum(dSum) }}
        <span class="grow" />
        <button class="link" style="font-size: 10.5px; padding: 0" @click="openBatch">批量粘贴</button>
        项目总计 {{ fmtNum(st.total) }}
      </div>
      <div class="field">
        <label>品名<span class="req">*</span></label>
        <input
          ref="nameInput" v-model="dForm.name" class="input" :class="{ invalid: errors.name }"
          placeholder="如 砂子" data-autofocus list="name-price-list"
          @change="applyNameHint"
        />
        <!-- R3：品名历史单价联想（内存索引，不落库） -->
        <datalist id="name-price-list">
          <option v-for="h in namePriceList" :key="h.name" :value="h.name" />
        </datalist>
        <span v-if="nameHint" class="hint ok">上次记账：{{ nameHint.unit || '—' }} · {{ fmtNum(nameHint.price) }}</span>
      </div>
      <div class="grid3">
        <div class="field">
          <label>单位</label>
          <input v-model="dForm.unit" class="input" placeholder="方/块/米" />
        </div>
        <div class="field">
          <label>数量</label>
          <input v-model="dForm.qty" class="input num" type="number" min="0" step="0.01" placeholder="0" />
        </div>
        <div class="field">
          <label>单价(元)</label>
          <input v-model="dForm.price" class="input num" type="number" min="0" step="0.01" placeholder="0" />
        </div>
      </div>
      <div class="grid2">
        <div class="field">
          <label>金额(元){{ amountLocked ? '（自动）' : '' }}</label>
          <input
            v-model="dForm.amount" class="input num" :class="{ invalid: errors.amount }"
            type="number" min="0" step="0.01" :readonly="amountLocked" placeholder="0"
          />
          <span v-if="amountLocked" class="hint ok">= 数量 × 单价</span>
        </div>
        <div class="field">
          <label>是否预估</label>
          <select v-model="dForm.est" class="select">
            <option value="否">否</option>
            <option value="是">是</option>
          </select>
        </div>
      </div>
      <div class="field">
        <label>工艺说明</label>
        <input v-model="dForm.craft" class="input" placeholder="选填" />
      </div>
      <div class="field">
        <label>备注</label>
        <input v-model="dForm.note" class="input" placeholder="选填" />
      </div>
    </div>

    <!-- ========== 批量粘贴（R1） ========== -->
    <div v-else-if="mode === 'batch'" class="form">
      <div class="mini" style="margin-bottom: 6px">
        粘贴报价单（TSV / CSV，每行：<b>品名 单位 数量 单价</b>）
        <span class="grow" />
        <button class="link" style="font-size: 10.5px; padding: 0" @click="cancelBatch">返回</button>
      </div>
      <textarea
        v-model="batchText" class="batch-area" rows="8" placeholder="砂子\t方\t10\t210&#10;红砖\t块\t200\t0.8"
        data-autofocus
      />
      <div v-if="batchRows.length" class="batch-prev">
        <div class="bp-head">
          <span>品名</span><span>单位</span><span>数量</span><span>单价</span><span>金额</span><span></span>
        </div>
        <div class="bp-list">
          <div v-for="(r, i) in batchRows" :key="i" class="bp-row" :class="{ bad: !r.ok }">
            <span class="nm">{{ r.name || '—' }}</span>
            <span>{{ r.unit }}</span>
            <span class="num">{{ r.qty }}</span>
            <span class="num">{{ r.price }}</span>
            <span class="num" :style="{ color: r.ok ? 'var(--ink)' : 'var(--danger)' }">{{ r.amount ? fmtNum(r.amount) : '—' }}</span>
            <span class="mini" style="color: r.ok ? 'var(--ok)' : 'var(--danger)'">{{ r.ok ? '✓' : '✕' }}</span>
          </div>
        </div>
        <div class="mini" style="margin-top: 4px">
          <template v-if="batchErrors.length">有 {{ batchErrors.length }} 行无效（不导入）：{{ batchErrors[0].err }}</template>
          <template v-else>全部 {{ batchRows.length }} 行有效</template>
          <span class="grow" />
          有效合计 <b class="num">{{ fmtNum(batchSum) }}</b>
        </div>
      </div>
    </div>

    <!-- ========== 付款表单 ========== -->
    <div v-else-if="mode === 'pay'" class="form">
      <div class="pay-info">
        <div class="row">
          <span class="grow mini">{{ project?.remark || '—' }}</span>
          <span class="badge" :class="st.status">{{ st.statusText }}</span>
        </div>
        <div class="row" style="gap: 12px; margin-top: 4px">
          <span class="mini">应付 <b class="num">{{ fmtNum(st.payable) }}</b></span>
          <span class="mini">已付 <b class="num">{{ fmtNum(st.paid) }}</b></span>
          <span class="mini">待付 <b class="num" style="color: var(--accent)">{{ fmtNum(st.due) }}</b></span>
        </div>
        <div v-if="payNoText" class="mini" data-pay-no style="margin-top: 3px; color: var(--muted)">{{ payNoText }}</div>
      </div>
      <div class="grid2">
        <div class="field">
          <label>付款日期<span v-if="!allowEmptyDate" class="req">*</span></label>
          <input v-model="payForm.date" class="input" :class="{ invalid: errors.date }" type="date" />
          <span v-if="allowEmptyDate" class="hint warn">历史记录无日期，可补填；留空不计入月度趋势</span>
        </div>
        <div class="field">
          <label>付款方式</label>
          <select v-model="payForm.method" class="select">
            <option v-for="m in METHODS" :key="m" :value="m">{{ m }}</option>
          </select>
        </div>
      </div>
      <div class="field">
        <label>本次金额（元，负数表示退款）<span class="req">*</span></label>
        <input
          v-model="payForm.amount" class="input num" :class="{ invalid: errors.amount }"
          type="number" step="0.01" placeholder="0.00" data-autofocus
        />
      </div>
      <div class="row" style="gap: 5px; flex-wrap: wrap">
        <button
          v-for="v in [st.due, st.payable, 1000, 5000].filter((x, i, a) => x > 0 && a.indexOf(x) === i)"
          :key="v" class="chip" @click="payForm.amount = v"
        >{{ v === st.due ? '待付' : v === st.payable ? '全额' : '¥' + v }}</button>
        <span class="grow" />
        <button class="link" @click="payForm.amount = -Math.abs(+payForm.amount || 0 || st.paid)">记为退款</button>
      </div>
      <div v-if="payForm.amount < 0" class="hint warn">负数金额将作为退款冲减已付，不涉及超付校验。</div>
      <div class="grid2">
        <div class="field">
          <label>备注</label>
          <input v-model="payForm.note" class="input" placeholder="如 定金 / 补差" />
        </div>
        <div class="field">
          <label>凭证号</label>
          <input v-model="payForm.ref" class="input" placeholder="转账单号，选填" />
        </div>
      </div>
    </div>

    <!-- ========== 底部操作 ========== -->
    <template #footer>
      <template v-if="mode === 'view'">
        <button class="btn ghost" data-undo-btn :disabled="!canUndoNow" :title="canUndoNow ? `撤销上一步（⌘Z）· 可撤销 ${undoSteps} 步` : '没有可撤销的操作'" @click="doUndo">撤销</button>
        <button class="btn ghost" data-redo-btn :disabled="!canRedoNow" :title="canRedoNow ? `重做上一步（⇧⌘Z）· 可重做 ${redoSteps} 步` : '没有可重做的操作'" @click="doRedo">重做</button>
        <button class="btn" @click="mode = 'edit'"><Icon name="edit" :size="12" />编辑</button>
        <button class="btn" @click="openCopyPanel"><Icon name="copy" :size="12" />复制到…</button>
        <span class="grow" />
        <button class="btn danger" @click="doDelete">{{ confirmDel ? '确认删除' : '删除' }}</button>
        <button class="btn primary" @click="startPay">记录付款</button>
      </template>
      <template v-else-if="mode === 'edit'">
        <button class="btn ghost" @click="project ? (mode = 'view') : closeDrawer()">取消</button>
        <span class="grow" />
        <button class="btn primary" @click="saveProject">保存</button>
      </template>
      <template v-else-if="mode === 'detail'">
        <button class="btn ghost" @click="mode = 'view'">取消</button>
        <span class="grow" />
        <button class="btn" @click="saveDetail(true)">保存并继续</button>
        <button class="btn primary" @click="saveDetail(false)">保存明细</button>
      </template>
      <template v-else-if="mode === 'batch'">
        <button class="btn ghost" @click="cancelBatch">取消</button>
        <span class="grow" />
        <button class="btn primary" :disabled="!batchGood.length" @click="confirmBatch">
          确认导入 {{ batchGood.length }} 行
        </button>
      </template>
      <template v-else-if="mode === 'pay'">
        <button class="btn ghost" @click="mode = 'view'">取消</button>
        <span class="grow" />
        <button class="btn primary" @click="savePay">确认付款</button>
      </template>
    </template>
  </Drawer>
</template>

<style scoped>
.amt-card {
  background: var(--surface-2);
  border: 1px solid var(--line);
  border-radius: var(--radius);
  padding: 10px 11px;
}
.big { font-size: 21px; font-weight: 800; letter-spacing: 0.3px; line-height: 1.25; }
.amt-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 4px 10px; }
.amt-grid > div { display: flex; justify-content: space-between; gap: 8px; font-size: 11.5px; }
.amt-grid span { color: var(--muted); }
.amt-grid b { font-weight: 700; }
.mrow-wrap { display: flex; flex-direction: column; }
.pay-info {
  background: var(--surface-2);
  border: 1px solid var(--line);
  border-radius: var(--radius);
  padding: 8px 10px;
}
.hint.danger { color: var(--danger); }

/* R1 批量粘贴 */
.batch-area {
  width: 100%;
  border: 1px solid var(--line);
  border-radius: var(--radius);
  background: var(--surface-2);
  color: var(--ink);
  font-family: ui-monospace, Menlo, Consolas, monospace;
  font-size: 11.5px;
  line-height: 1.5;
  padding: 8px;
  resize: vertical;
  box-sizing: border-box;
}
.batch-area:focus { outline: none; border-color: var(--accent); background: var(--surface); }
.batch-prev { margin-top: 8px; border: 1px solid var(--line); border-radius: var(--radius); overflow: hidden; }
.bp-head, .bp-row {
  display: grid;
  grid-template-columns: 1.4fr 0.8fr 0.7fr 0.7fr 0.9fr 0.5fr;
  gap: 4px;
  padding: 3px 8px;
  font-size: 11px;
  align-items: center;
}
.bp-head { background: var(--surface-2); color: var(--muted); font-size: 10px; }
.bp-list { max-height: 190px; overflow-y: auto; }
.bp-row { border-top: 1px solid var(--line); }
.bp-row:first-child { border-top: none; }
.bp-row .nm { font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.bp-row.bad { background: var(--danger-soft); }

/* R4 复制到面板 */
.copy-panel {
  margin-top: 12px;
  padding: 10px;
  border: 1px solid var(--line);
  border-radius: var(--radius);
  background: var(--surface-2);
}
</style>
