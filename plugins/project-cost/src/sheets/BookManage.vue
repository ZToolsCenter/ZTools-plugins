<script setup>
import { computed, ref } from 'vue';
import { state, book, switchBook, createBook, renameBook, deleteBook, saveTemplate, applyTemplate, deleteTemplate, persistNow, setBookMeta } from '../lib/store';
import { statOf, fmt, catCoverage, bookNoPrefix } from '../lib/core';
import { closeDrawer, toast, run } from '../lib/ui';
import Drawer from '../components/Drawer.vue';
import Icon from '../components/Icon.vue';

const newName = ref('');
const tplName = ref('');
const confirmId = ref('');

/** A2：模板卡片的「N 项预算 · M 品类」也统一走 `catCoverage`（视图内不再自数预算键） */
const covOf = (b) => catCoverage(b);

const books = computed(() => state.books.map((b) => {
  const payable = (b.projects || []).reduce((s, p) => s + statOf(p).payable, 0);
  return { ...b, count: (b.projects || []).length, payable };
}));

function toggleSwitch(id) {
  switchBook(id);
  toast(`已切换到「${state.books.find((b) => b.id === id)?.name}」`);
}

function onRename(b, e) {
  renameBook(b.id, e.target.value);
  persistNow();
}

/* A4：面积写进项目档案（仅影响该项目的单方造价指标，不参与任何金额计算） */
function onArea(b, e) {
  setBookMeta({ area: e.target.value }, b.id);
  persistNow();
}

/**
 * C6：编号前缀（1–4 位大写字母，缺省 `ZX`）。
 * 只影响**之后新建**费用项的号，绝不重排已有编号 —— 编号是与外部对账单对齐的业务身份。
 * 用户输小写 / 非法字符时由 `setBookMeta` → `normNoPrefix` 归一，这里再把归一后的值写回输入框，
 * 避免「输入 ws、显示 ws、实际存 ZX」的错位观感。
 */
function onPrefix(b, e) {
  const r = setBookMeta({ noPrefix: e.target.value }, b.id);
  if (e.target) e.target.value = bookNoPrefix(state.books.find((x) => x.id === b.id) || b);
  persistNow();
  if (r.ok) toast(`编号前缀已设为 ${bookNoPrefix(state.books.find((x) => x.id === b.id) || b)}（仅影响新建）`);
}

function addBook() {
  const b = createBook(newName.value.trim() || '新项目');
  newName.value = '';
  toast(`已新建「${b.name}」`);
}

function del(id) {
  if (confirmId.value !== id) { confirmId.value = id; return; }
  const r = deleteBook(id);
  confirmId.value = '';
  toast(r.msg);
}

function doSaveTpl() {
  const r = saveTemplate(tplName.value);
  if (run(r)) tplName.value = '';
}
function doApply(t) {
  const r = applyTemplate(t.id);
  if (run(r)) closeDrawer();
}
</script>

<template>
  <Drawer title="项目管理" subtitle="每个项目是独立账本：预算 / 档案 / 费用项 / 付款彼此隔离" :width="404" @close="closeDrawer">
    <div class="books">
      <div
        v-for="b in books" :key="b.id"
        class="book"
        :class="{ on: b.id === state.activeBookId }"
      >
        <span class="dt" :style="{ background: b.color }" />
        <div class="grow" style="min-width: 0">
          <input
            class="name-input"
            :value="b.name"
            maxlength="20"
            placeholder="项目名称"
            @change="onRename(b, $event)"
            @keydown.enter="$event.target.blur()"
          />
          <div class="meta">{{ b.count }} 个费用项 · 应付 {{ fmt(b.payable) }}</div>
          <div class="meta area-row">
            <span>面积</span>
            <input
              class="area-input num"
              type="number" min="0" step="1"
              :value="b.area || ''"
              placeholder="未填"
              title="建筑面积，填了才显示 ¥/㎡ 单方造价"
              @change="onArea(b, $event)"
              @keydown.enter="$event.target.blur()"
            />
            <span>㎡</span>
          </div>
          <!-- C6：编号前缀。placeholder 明说「仅影响新建」—— 改前缀不会重排已有编号 -->
          <div class="meta area-row" data-no-prefix>
            <span>编号前缀</span>
            <input
              class="area-input num"
              type="text"
              maxlength="4"
              :value="bookNoPrefix(b)"
              placeholder="ZX"
              title="1–4 位大写字母，如 ZX / WX。仅影响之后新建的费用项编号，已有编号不变"
              @change="onPrefix(b, $event)"
              @keydown.enter="$event.target.blur()"
            />
            <span>仅影响新建</span>
          </div>
        </div>
        <button v-if="b.id !== state.activeBookId" class="btn sm" @click="toggleSwitch(b.id)">切换</button>
        <span v-else class="badge" :style="{ background: 'var(--accent-soft)', color: 'var(--accent)' }">当前</span>
        <button class="btn sm ghost" :disabled="state.books.length <= 1" @click="del(b.id)">
          {{ confirmId === b.id ? '确认' : '删' }}
        </button>
      </div>
    </div>

    <div class="add-row">
      <input v-model="newName" class="input" placeholder="新项目名称，如 自宅装修 / 门店改造" @keydown.enter="addBook" />
      <button class="btn primary" @click="addBook"><Icon name="plus" :size="12" />新建</button>
    </div>

    <div class="divider" />

    <div class="sec-head"><span class="bar" />项目模板</div>
    <div class="mini" style="margin-bottom: 6px">把当前项目的预算 / 品类 / 收款方存为模板，新建同类项目时一键复用。</div>
    <div class="add-row">
      <input v-model="tplName" class="input" placeholder="模板名称" @keydown.enter="doSaveTpl" />
      <button class="btn" @click="doSaveTpl">存为模板</button>
    </div>
    <div v-if="state.templates.length" class="tpls">
      <div v-for="t in state.templates" :key="t.id" class="tpl">
        <div class="grow" style="min-width: 0">
          <div class="ellipsis" style="font-weight: 600; font-size: 12px">{{ t.name }}</div>
          <!-- A2：模板的品类/预算口径也统一走 `catCoverage`，视图内不再自数预算键 -->
          <div class="meta">{{ covOf(t).withBudget }} 项预算 · {{ covOf(t).total }} 品类</div>
        </div>
        <button class="btn sm" @click="doApply(t)">应用</button>
        <button class="btn sm ghost" @click="deleteTemplate(t.id)">删</button>
      </div>
    </div>
    <div v-else class="mini">暂无模板。</div>
  </Drawer>
</template>

<style scoped>
.books { display: flex; flex-direction: column; gap: 6px; }
.book {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 8px;
  border: 1px solid var(--line);
  border-radius: var(--radius);
  background: var(--surface-2);
}
.book.on { border-color: var(--accent); background: var(--accent-soft); }
.book .dt { width: 9px; height: 9px; border-radius: 50%; flex: none; }
.name-input {
  width: 100%;
  border: none;
  background: transparent;
  color: var(--ink);
  font-size: 12.5px;
  font-weight: 700;
  font-family: inherit;
  padding: 0;
  outline: none;
  border-bottom: 1px dashed transparent;
}
.name-input:hover { border-bottom-color: var(--line-strong); }
.name-input:focus { border-bottom-color: var(--accent); }
.meta { font-size: 10px; color: var(--muted); }
/* A4 面积：与 meta 同一行高，输入框只有 48px 宽，不撑高项目卡片 */
.area-row { display: flex; align-items: center; gap: 4px; margin-top: 2px; }
.area-input {
  width: 48px;
  font-family: inherit;
  font-size: 10.5px;
  text-align: right;
  color: var(--ink-2);
  background: transparent;
  border: none;
  border-bottom: 1px dashed var(--line-strong);
  padding: 0;
  outline: none;
}
.area-input:focus { border-bottom-color: var(--accent); }
.area-input::-webkit-outer-spin-button,
.area-input::-webkit-inner-spin-button { -webkit-appearance: none; margin: 0; }
.add-row { display: flex; gap: 6px; margin-top: 8px; }
.add-row .input { flex: 1; }
.tpls { display: flex; flex-direction: column; gap: 5px; margin-top: 8px; }
.tpl {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 8px;
  border: 1px solid var(--line);
  border-radius: 8px;
}
</style>
