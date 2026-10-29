<script setup>
import { computed } from 'vue';
import { book } from '../lib/store';
import { fmtNum } from '../lib/core';

const props = defineProps({
  item: { type: Object, required: true },
  stat: { type: Object, required: true },
  selected: { type: Boolean, default: false },
  mode: { type: String, default: 'items' }, // items | pay
  showActions: { type: Boolean, default: true },
  selectable: { type: Boolean, default: false }, // R5 多选
  checked: { type: Boolean, default: false }, // R5 当前是否选中
  /** B1 搜索命中提示 `{ text, name }`；无提示时为 null（只命中单位/工艺/备注的行没有提示） */
  hit: { type: Object, default: null },
  /** K8：字段级命中 `{ [字段]: true, detail: bool }`，无命中为 null —— 供整行高亮用 */
  hitFields: { type: Object, default: null },
  /** K8：当前「上/下一条」定位到的行（.nav），与「选中 sel」解耦 */
  nav: { type: Boolean, default: false },
});

const emit = defineEmits(['open', 'pay', 'edit', 'toggle', 'hit']);

const catColor = computed(() => {
  const c = (book.value?.categories || []).find((x) => x.name === props.item.cat);
  return c?.color || 'var(--muted)';
});
const detailCount = computed(() => (props.item.details || []).length);
// C5：只数有效付款 —— 作废的仍在抽屉里灰显可恢复，但不该在列表上显示成「已付 2 笔」
const payCount = computed(() => (props.item.payments || []).filter((x) => !x.void).length);
</script>

<template>
  <div
    class="item"
    data-item-row
    :class="{ sel: selected, 'has-sel': selectable, hitrow: !!hitFields, nav }"
    tabindex="0"
    @click="emit('open')"
    @keydown.enter.prevent="emit('open')"
  >
    <!-- R5：Shift 连选必须读 click 事件的 shiftKey（change 是普通 Event，没有修饰键信息，
         用它做 shift 判断会让连选永久失效）。因此 emit 挂在 click 上，且不再监听 change，
         否则一次点击会 toggle 两次。 -->
    <label v-if="selectable" class="sel-box" @click.stop @keydown.stop>
      <input
        type="checkbox"
        :checked="checked"
        @click="emit('toggle', item.id, $event.shiftKey)"
      />
    </label>
    <div class="l1">
      <span class="title">{{ item.remark || item.no }}</span>
      <span class="no">{{ item.no }}</span>
    </div>
    <div class="amt-col">
      <!-- A1：`payable !== 0` 才显示金额（原 `> 0` 会把 ZX0018 的 −580.00 显示成「—」）；
           负应付（退款/红冲）走 .neg → var(--danger)，方向与颜色一致，不再需要额外文字 -->
      <span class="amount" :class="{ due: stat.due > 0, neg: stat.payable < 0 }">
        {{ stat.payable !== 0 ? fmtNum(stat.payable) : '—' }}
      </span>
      <span v-if="stat.status === 'part'" class="subline">待付 {{ fmtNum(stat.due) }}</span>
    </div>
    <div class="l2">
      <span class="tag" :style="{ background: catColor + '22', color: catColor }">{{ item.cat }}</span>
      <span v-if="item.object" class="ellipsis">{{ item.object }}</span>
      <span class="sep">·</span>
      <span>{{ item.date || '无日期' }}</span>
      <template v-if="mode === 'items'">
        <span class="sep">·</span>
        <span>{{ detailCount }} 明细</span>
      </template>
      <template v-else>
        <span class="sep">·</span>
        <span>{{ payCount }} 笔付款</span>
      </template>
      <span v-if="hit" class="hit" data-hit @click.stop="emit('hit', hit)">{{ hit.text }}</span>
      <span class="grow" />
      <span class="badge" :class="stat.status">{{ stat.statusText }}</span>
    </div>

    <div v-if="showActions" class="item-actions" @click.stop>
      <button v-if="mode === 'items'" class="btn sm" @click="emit('edit')">编辑</button>
      <button class="btn sm primary" @click="emit('pay')">
        {{ stat.due <= 0 ? '补记付款' : '记录付款' }}
      </button>
    </div>
  </div>
</template>

<style scoped>
/* R5 多选复选框：绝对定位在行左侧空白处，不新增网格列（.item 仍是 1fr + auto 两列，
   列宽与滚动位置完全不变；仅多出一段 30px 左内边距给复选框）。 */
.item.has-sel { padding-left: 32px; }
.sel-box {
  position: absolute;
  left: 5px;
  top: 0;
  bottom: 0;
  z-index: 2;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  cursor: pointer;
}
.sel-box input {
  width: 15px;
  height: 15px;
  margin: 0;
  cursor: pointer;
  accent-color: var(--accent);
}
</style>
