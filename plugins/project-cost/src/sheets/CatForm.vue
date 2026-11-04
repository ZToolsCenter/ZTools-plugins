<script setup>
import { computed, reactive } from 'vue';
import { book, upsertCategory, removeCategory, usageOfCategory, nextColor } from '../lib/store';
import { fmt, fmtNum, fmtAbs, catRows } from '../lib/core';
import { closeDrawer, toast, run } from '../lib/ui';
import Drawer from '../components/Drawer.vue';
import Icon from '../components/Icon.vue';

const props = defineProps({ drawer: { type: Object, required: true } });

const prev = props.drawer.name || '';
const editing = !!prev;
const form = reactive({ name: '', color: '#A8624C', note: '', budget: '' });

const row = computed(() => catRows(book.value).find((c) => c.name === prev));
const usage = computed(() => (editing ? usageOfCategory(prev) : 0));

if (editing && row.value) {
  Object.assign(form, {
    name: row.value.name,
    color: row.value.color,
    note: row.value.note,
    budget: row.value.budget || '',
  });
} else {
  form.color = nextColor();
}

function save() {
  /**
   * A3：品类表单里「改名 + 改预算」是**一个用户动作**。
   * 以前是 upsertCategory + setBudget 两次调用 → 占 2 格撤销栈，用户按一次 Ctrl+Z 只撤回一半
   * （品类名回来了、预算还留在新值上）。现在预算随品类一次落库，只入栈一次。
   */
  const r = upsertCategory(editing ? prev : '', {
    name: form.name,
    color: form.color,
    note: form.note,
    // 空串 = 用户没填/清空了预算，交给 store 决定是写键还是删键（绝不写 0）
    budget: form.budget === '' ? undefined : form.budget,
  });
  if (!run(r)) return;
  closeDrawer();
}

function del() {
  if (usage.value > 0) {
    toast(`该品类下还有 ${usage.value} 个费用项，请先改分类`);
    return;
  }
  // eslint-disable-next-line no-alert
  if (!window.confirm(`删除品类「${prev}」？预算设置一并移除。`)) return;
  removeCategory(prev);
  closeDrawer();
  toast('品类已删除', { undo: true });
}
</script>

<template>
  <Drawer :title="editing ? '编辑品类' : '新增品类'" :subtitle="editing ? prev : '用于费用项归类与预算核算'" :width="360" @close="closeDrawer">
    <div class="form">
      <div class="field">
        <label>品类名称<span class="req">*</span></label>
        <input v-model="form.name" class="input" placeholder="如 全屋定制工程" data-autofocus />
      </div>
      <div class="grid2">
        <div class="field">
          <label>色标</label>
          <input v-model="form.color" class="input" type="color" style="height: 30px; padding: 2px" />
        </div>
        <div class="field">
          <label>预算(元)</label>
          <input v-model="form.budget" class="input num" type="number" min="0" step="1000" placeholder="可不填" />
        </div>
      </div>
      <div class="field">
        <label>备注</label>
        <input v-model="form.note" class="input" placeholder="选填，如 拆墙/楼板/楼梯新建" />
      </div>

      <template v-if="editing && row">
        <div class="divider" />
        <div class="kv"><span>关联费用项</span><b>{{ usage }} 条</b></div>
        <div class="kv"><span>应付合计</span><b>{{ fmt(row.amount) }}</b></div>
        <div class="kv"><span>已付合计</span><b>{{ fmt(row.paid) }}</b></div>
        <div class="kv">
          <span>预算差额</span>
          <b :style="{ color: row.diff == null ? 'var(--muted)' : row.diff >= 0 ? 'var(--ok)' : 'var(--danger)' }">
            <!-- A1：差额列的颜色（ok 结余 / danger 超支）已表达方向 → fmtAbs，避免出现 `余 -1,234` -->
            {{ row.diff == null ? '未设预算' : fmtAbs(row.diff) }}
          </b>
        </div>
        <div v-if="row.rate != null" class="prog" style="margin-top: 4px">
          <i :style="{ width: Math.min(row.rate, 100) + '%', background: row.rate >= 100 ? 'var(--danger)' : row.rate >= 80 ? 'var(--warn)' : 'var(--ok)' }" />
        </div>
        <div class="mini">已用 {{ row.rate == null ? '—' : Math.round(row.rate) + '%' }} · 预算 {{ row.budget > 0 ? fmt(row.budget) : '未设' }}</div>
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
