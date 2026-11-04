<script setup>
import { computed, reactive, ref } from 'vue';
import { book, upsertPayee, removePayee, usageOfPayee, renamePayee, renamePayeeImpact } from '../lib/store';
import { fmt, fmtNum, fmtAbs, payeeRows } from '../lib/core';
import { closeDrawer, toast, run } from '../lib/ui';
import Drawer from '../components/Drawer.vue';
import Icon from '../components/Icon.vue';

const props = defineProps({ drawer: { type: Object, required: true } });

const prev = props.drawer.name || '';
const editing = !!prev;
const form = reactive({ name: '', contact: '', note: '' });
/** K9（v1.8）：合并目标（把当前收款方并入另一个已存在的收款方） */
const mergeTarget = ref('');

const row = computed(() => payeeRows(book.value).find((p) => p.name === prev));
const usage = computed(() => (editing ? usageOfPayee(prev) : 0));
/** K9：可合并到的其它收款方（排除自己） */
const otherPayees = computed(() => (book.value?.payees || [])
  .map((p) => p.name)
  .filter((n) => n && n !== prev));

if (editing && row.value) {
  Object.assign(form, { name: row.value.name, contact: row.value.contact, note: row.value.note });
}

function save() {
  const name = (form.name || '').trim();
  if (!name) { toast('请填写名称'); return; }
  // K9：改名走 renamePayee（全局迁移所有引用 + 维护注册表，0 孤儿）；再补联系方式/备注
  if (editing && name !== prev) {
    // K23：改名前把影响预览讲清（与落库同一套口径 renamePayeeImpact），用户确认的不是盲盒
    // eslint-disable-next-line no-alert
    if (!window.confirm(renamePreviewConfirm(name))) return;
    const r = renamePayee(prev, name);
    if (!r.ok) { toast(r.msg); return; }
    if (form.contact || form.note) {
      upsertPayee(name, { name, contact: form.contact, note: form.note });
    }
    closeDrawer();
    toast('已保存');
    return;
  }
  run(upsertPayee(editing ? prev : '', { ...form }));
  closeDrawer();
}
function del() {
  if (usage.value > 0) { toast(`该收款方名下还有 ${usage.value} 个费用项，请先改收款方`); return; }
  // eslint-disable-next-line no-alert
  if (!window.confirm(`删除收款方「${prev}」？`)) return;
  removePayee(prev);
  closeDrawer();
  toast('收款方已删除', { undo: true });
}
/** K9：合并 —— 把当前收款方名下的所有费用项/付款归到目标收款方，删掉自身注册表项 */
function doMerge() {
  const target = (mergeTarget.value || '').trim();
  if (!target) { toast('请选择要合并到的收款方'); return; }
  if (target === prev) { toast('不能合并到自己'); return; }
  // K23：合并前同样给影响预览（合并 = renamePayee 的另一分支，口径相同）
  // eslint-disable-next-line no-alert
  if (!window.confirm(renamePreviewConfirm(target))) return;
  const r = renamePayee(prev, target);
  if (!r.ok) { toast(r.msg); return; }
  closeDrawer();
  toast(r.msg);
}

/* ---------------- K23（v1.9.x）改名 / 合并影响预览 ----------------
 * 预览与落库**共用同一份纯函数** `store.renamePayeeImpact()`（口径与 renamePayee 逐字段一致），
 * 保证「预览说迁 3 条、实际就迁 3 条」。预览行常驻显示在表单里（不等保存才见分晓），
 * 确认弹窗里再复述一次带数字的摘要 —— 两处都拒绝「无影响的盲确认」。 */
const newName = computed(() => (form.name || '').trim());
/** 改名预览：编辑态且新名 ≠ 原名时才有效 */
const renamePreview = computed(() => (editing && newName.value && newName.value !== prev
  ? renamePayeeImpact(prev, newName.value) : null));
/** 合并预览：选了目标（且 ≠ 自己）即生效 */
const mergePreview = computed(() => {
  const t = (mergeTarget.value || '').trim();
  return (t && t !== prev) ? renamePayeeImpact(prev, t) : null;
});

/** 把影响预览转成一句带数字的确认语（改名 / 合并共用，空值字段自动略过） */
function renamePreviewConfirm(target) {
  const pv = renamePayeeImpact(prev, target);
  if (!pv) return `确认把「${prev}」改名为「${target}」？`;
  const bits = [];
  if (pv.projects) bits.push(`迁移 ${pv.projects} 个费用项（应付 ${fmt(pv.payable)}）`);
  if (pv.payCount) bits.push(`改写 ${pv.payCount} 笔付款的收款方（合计 ${fmt(pv.payAmount)}）`);
  const tail = pv.merged ? `「${target}」档案已存在，两者将合并为一份` : '将按新名建档（无孤儿引用）';
  return `确认${pv.merged ? '合并' : '改名'}：${bits.length ? bits.join('，') + '；' : ''}${tail}。可在提示条中撤销。`;
}
</script>

<template>
  <Drawer :title="editing ? '编辑收款方' : '新增收款方'" :subtitle="editing ? prev : '供应商 / 商家档案'" :width="360" @close="closeDrawer">
    <div class="form">
      <div class="field">
        <label>名称<span class="req">*</span></label>
        <input v-model="form.name" class="input" placeholder="如 瓷砖-金豪" data-autofocus />
      </div>
      <!-- K23：改名影响预览 —— 边输入边可见，不等保存 -->
      <div v-if="renamePreview" class="mini k23-preview" data-rename-preview>
        将迁移 <b class="num">{{ renamePreview.projects }}</b> 个费用项（应付 {{ fmt(renamePreview.payable) }}）
        · 改写 <b class="num">{{ renamePreview.payCount }}</b> 笔付款的收款方
        · {{ renamePreview.merged ? `「${newName}」档案已存在，将合并为一份` : '新名尚未登记，将自动建档（无孤儿引用）' }}
      </div>
      <div class="field">
        <label>联系方式</label>
        <input v-model="form.contact" class="input" placeholder="电话 / 微信，选填" />
      </div>
      <div class="field">
        <label>备注</label>
        <input v-model="form.note" class="input" placeholder="选填" />
      </div>

      <template v-if="editing && row">
        <div class="divider" />
        <div class="kv"><span>关联费用项</span><b>{{ usage }} 条</b></div>
        <div class="kv"><span>账目总额</span><b>{{ fmt(row.amount) }}</b></div>
        <div class="kv"><span>已付总额</span><b>{{ fmt(row.paid) }}</b></div>
        <div class="kv">
          <span>欠款</span>
          <b :style="{ color: row.owe > 0 ? 'var(--danger)' : row.owe < 0 ? 'var(--ok)' : 'var(--muted)' }">
            {{ row.owe > 0 ? fmtNum(row.owe) : row.owe < 0 ? '多付 ' + fmtAbs(row.owe) : '已结清' }}
          </b>
        </div>

        <!-- K9（v1.8）：合并收款方 —— 把当前名下的引用全部并入另一个已存在的收款方 -->
        <template v-if="otherPayees.length">
          <div class="divider" />
          <div class="field">
            <label>合并到</label>
            <select v-model="mergeTarget" class="input">
              <option value="">选择一个收款方…</option>
              <option v-for="n in otherPayees" :key="n" :value="n">{{ n }}</option>
            </select>
          </div>
          <!-- K23：合并影响预览随所选目标实时刷新（替换原先无数字的静态说明） -->
          <div class="mini" style="margin-top: 2px" data-merge-preview>
            <template v-if="mergePreview">
              把「{{ prev }}」名下 <b class="num">{{ mergePreview.projects }}</b> 个费用项（应付 {{ fmt(mergePreview.payable) }}）
              与 <b class="num">{{ mergePreview.payCount }}</b> 笔付款并入「{{ mergeTarget }}」，自身档案将被移除（无孤儿引用）。
            </template>
            <template v-else>把「{{ prev }}」名下的 {{ usage }} 个费用项并入所选收款方，自身档案将被移除（无孤儿引用）。</template>
          </div>
          <button class="btn ghost" style="margin-top: 6px" :disabled="!mergeTarget" @click="doMerge">
            <Icon name="merge" :size="12" />合并
          </button>
        </template>
      </template>
    </div>

    <template #footer>
      <button v-if="editing" class="btn danger" @click="del"><Icon name="trash" :size="12" />删除</button>
      <span class="grow" />
      <button class="btn ghost" @click="closeDrawer">取消</button>
      <button class="btn primary" @click="save">保存</button>
    </template>
  </Drawer>
</template>

<style scoped>
/* K23：改名影响预览行 —— 比普通提示更醒目一点，但不动表单栅格 */
.k23-preview {
  margin-top: 4px;
  padding: 5px 8px;
  border-radius: 7px;
  background: var(--accent-soft);
  color: var(--ink-2);
  line-height: 1.45;
}
</style>
