<script setup>
import { computed, onMounted, onBeforeUnmount, ref, watch } from 'vue';
import { state, book, stats, boot, undo, redo, switchBook, persistNow, saveErr, takeSaveErr, maybeAutoBackup } from './lib/store';
import { fmt } from './lib/core';
import { ui, TABS, go, openDrawer, closeDrawer, toasts, dismissToast, toast, clearListFilters } from './lib/ui';
import { buildAlerts } from './lib/core';
import { refreshIgnore, isIgnored, ignoreTypes } from './lib/alertIgnore';
import Icon from './components/Icon.vue';
import OverviewView from './views/OverviewView.vue';
import ItemsView from './views/ItemsView.vue';
import PayView from './views/PayView.vue';
import BudgetView from './views/BudgetView.vue';
import AnalysisView from './views/AnalysisView.vue';
import SettingsView from './views/SettingsView.vue';
import ItemSheet from './sheets/ItemSheet.vue';
import CatForm from './sheets/CatForm.vue';
import PayeeForm from './sheets/PayeeForm.vue';
import StatementSheet from './sheets/StatementSheet.vue';
import BookManage from './sheets/BookManage.vue';

const VIEWS = {
  overview: OverviewView,
  items: ItemsView,
  pay: PayView,
  budget: BudgetView,
  analysis: AnalysisView,
  settings: SettingsView,
};

const bootState = boot();
if (bootState.corrupt) setTimeout(() => toast('本地数据解析失败，已重置为默认台账'), 300);

const currentView = computed(() => VIEWS[ui.tab] || OverviewView);
const s = stats;
const alerts = computed(() => buildAlerts(book.value));
/**
 * M1：横幅只显示「今天没被忽略」的类。角标（rail-dot）仍用 alerts.total，
 * 忽略只是「今天不打扰」，不是「清零」，避免有人靠忽略制造无预警假象。
 */
const visibleAlerts = computed(() => alerts.value.items.filter((a) => !isIgnored(a.type)));
const theme = ref('light');

function onIgnoreAlerts() {
  const types = [...new Set(visibleAlerts.value.map((a) => a.type))];
  const n = ignoreTypes(types);
  toast(n ? `今天不再提醒这 ${n} 类（明细随时可查）` : '今天已无提醒');
}

/* ---------------- 主题：跟随 ZTools ---------------- */
function applyTheme(t) {
  theme.value = t;
  document.documentElement.dataset.theme = t;
  try { localStorage.setItem('ztools_rc_theme', t); } catch (_) { /* 忽略 */ }
}
function detectTheme() {
  const saved = localStorage.getItem('ztools_rc_theme');
  if (saved === 'dark' || saved === 'light') return saved;
  try {
    const z = window.ztools;
    if (z?.isDarkColors) return z.isDarkColors() ? 'dark' : 'light';
    if (z?.getThemeInfo) {
      const info = z.getThemeInfo();
      if (info && typeof info.isDark === 'boolean') return info.isDark ? 'dark' : 'light';
    }
  } catch (_) { /* 忽略 */ }
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}
function toggleTheme() { applyTheme(theme.value === 'dark' ? 'light' : 'dark'); }

/* ---------------- 账套菜单 ---------------- */
const menuOpen = ref(false);
function pickBook(id) {
  switchBook(id);
  menuOpen.value = false;
}

/* ---------------- 新增 ---------------- */
function newItem() {
  openDrawer({ type: 'item', mode: 'edit', id: null });
}

/* ---------------- 快捷键 ---------------- */
function focusSearch() {
  if (ui.tab !== 'items') go('items');
  requestAnimationFrame(() => {
    const el = document.querySelector('[data-search]');
    if (el) { el.focus(); el.select?.(); }
  });
}

function onKey(e) {
  const tag = (e.target.tagName || '').toLowerCase();
  const inField = tag === 'input' || tag === 'textarea' || tag === 'select';

  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
    e.preventDefault();
    focusSearch();
    return;
  }
  /**
   * A3：Ctrl/Cmd+Z 连撤。
   * 必须放在第 109 行那句 `if (inField || e.metaKey || e.ctrlKey ...) return` **之前** ——
   * 否则所有带 Ctrl/Cmd 的键都会被那行拦掉。输入框内不抢（浏览器原生的输入框撤销更好用），
   * 也不 preventDefault，把事件让回给浏览器。
   */
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z' && !e.shiftKey) {
    if (inField) return;
    e.preventDefault();
    doUndo();
    return;
  }
  // K18：⇧⌘Z 重做（与 ⌘Z 同一款输入框内不抢的纪律；必须同样放在 inField 拦截之前）
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z' && e.shiftKey) {
    if (inField) return;
    e.preventDefault();
    doRedo();
    return;
  }
  if (e.key === 'Escape') {
    if (ui.drawer) { closeDrawer(); return; }
    if (menuOpen.value) { menuOpen.value = false; return; }
    if (inField && e.target.blur) { e.target.blur(); return; }
    // R5：Esc 先清多选，再清筛选（多选是更"近"的一层状态）
    if (ui.selectedIds.length) { ui.selectedIds = []; return; }
    clearListFilters();
    return;
  }
  if (inField || e.metaKey || e.ctrlKey || e.altKey) return;

  if (e.key === '/') { e.preventDefault(); focusSearch(); return; }
  if (e.key.toLowerCase() === 'n') { e.preventDefault(); newItem(); return; }
  if (/^[1-6]$/.test(e.key)) {
    go(TABS[+e.key - 1].key);
    return;
  }
  if (e.key.toLowerCase() === 'b') { openDrawer({ type: 'books' }); }
}

/**
 * A3：执行一步撤销并给出分级文案。
 * `left` 是撤完之后**还能再撤几步**，用来说清「我是不是已经退到底了」——
 * 只说「已撤销」时，用户连按三次不知道何时停，会一直按到误触别的快捷键。
 */
function doUndo() {
  const r = undo();
  if (!r.ok) { toast('没有可撤销的操作'); return; }
  toast(r.left > 0 ? `已撤销（还可退 ${r.left} 步）` : '已撤销（没有更早的记录了）');
}

/** K18：执行一步重做（⇧⌘Z / 「重做」按钮 / toast 同款文案分级） */
function doRedo() {
  const r = redo();
  if (!r.ok) { toast('没有可重做的操作'); return; }
  toast(r.left > 0 ? `已重做（还可重做 ${r.left} 步）` : '已重做（没有更近的记录了）');
}

function onAlertClick(a) {
  const t = a.target || { kind: 'pay' };
  if (t.kind === 'item' && t.id) { openDrawer({ type: 'item', id: t.id }); return; }
  go(t.kind === 'budget' ? 'budget' : 'pay');
}

watch(() => ui.tab, () => { refreshIgnore(); });

/* Q3：保存降级/失败一律让用户看见（原先 lastError 只写不读，配额满时静默删图） */
watch(saveErr, (msg) => {
  if (!msg) return;
  toast(takeSaveErr(), { duration: 4600 });
});

/* ---------------- K1（v1.8）为什么**不拦**刷新 ----------------
 * 需求原文是「撤销栈落盘（**或**刷新警告）」—— 两者取其一即可。
 * 我们选了更强的「落盘」：栈已进 localStorage，刷新 / 关插件后都能恢复，
 * 于是「刷新会丢掉撤销」这个前提本身就不成立了。
 *
 * 曾尝试再加一层 beforeunload 拦截，实测有两个代价：
 *   ① headless 回归里 `Page.reload` 会被原生「离开站点」对话框卡死，
 *      v13/v14/v15/v16/v17 五个 UI 套件全部在第一步就超时失败；
 *   ② 真实使用中，只要栈里还有一步可撤销，每次刷新 / 关页都会被浏览器拦一下，
 *      对需要反复开关的记账工具来说，骚扰远大于收益。
 * 因此最终方案 = **落盘**（保住撤销）+ **界面常驻撤销入口**（列表工具条「撤销」按钮，K14），
 * 不劫持浏览器刷新。 */

onMounted(() => {
  refreshIgnore();      // M1：启动时复位跨天忽略
  applyTheme(detectTheme());
  window.addEventListener('keydown', onKey);
  try { window.ztools?.setExpendHeight?.(618); } catch (_) { /* 忽略 */ }
  try {
    window.ztools?.onThemeChange?.((isDark) => {
      if (!localStorage.getItem('ztools_rc_theme')) applyTheme(isDark ? 'dark' : 'light');
    });
  } catch (_) { /* 忽略 */ }
  // ZTools 入口分发：按 feature code 直达对应动作
  try {
    window.ztools?.onPluginEnter?.((action) => {
      const code = action && action.code;
      if (code === 'project-add' || code === 'cost-add') newItem();
      else if (code === 'project-pay' || code === 'cost-pay') go('pay');
    });
  } catch (_) { /* 浏览器预览时忽略 */ }
  persistNow();
  // K2：启动时检查是否跨过自动备份周期边界，是则自动导出一份 JSON（失败静默）
  try {
    const r = maybeAutoBackup();
    if (r && r.ok) setTimeout(() => toast(`已自动备份数据（${r.name}）`), 400);
  } catch (_) { /* 浏览器预览时忽略 */ }
});
onBeforeUnmount(() => window.removeEventListener('keydown', onKey));
</script>

<template>
  <div class="app">
    <aside class="rail">
      <div class="rail-brand" title="项目费用管理">费</div>
      <button
        v-for="(t, i) in TABS" :key="t.key"
        class="rail-item" :class="{ active: ui.tab === t.key }"
        :title="`${t.label}（${i + 1}）`"
        @click="go(t.key)"
      >
        <Icon :name="t.key" :size="17" />
        <span>{{ t.label }}</span>
        <em v-if="t.key === 'overview' && alerts.total" class="rail-dot" />
      </button>
      <span class="rail-spacer" />
      <button class="rail-item" title="项目管理（B）" @click="openDrawer({ type: 'books' })">
        <Icon name="dots" :size="17" />
        <span>项目</span>
      </button>
      <button class="rail-mini" :title="theme === 'dark' ? '切换浅色主题' : '切换深色主题'" @click="toggleTheme">
        {{ theme === 'dark' ? '浅色' : '深色' }}
      </button>
    </aside>

    <div class="main">
      <header class="topbar">
        <button class="book-chip" @click="menuOpen = !menuOpen">
          <span class="dot" :style="{ background: book?.color || 'var(--accent)' }" />
          <span class="nm">{{ book?.name || '未命名项目' }}</span>
          <span class="caret">▼</span>
        </button>
        <div class="topbar-spacer" />
        <div class="topstat">
          <div class="it"><em>应付</em><b>{{ fmt(s.payable) }}</b></div>
          <div class="it due"><em>待付</em><b>{{ fmt(s.remain) }}</b></div>
        </div>
        <button class="btn primary sm" title="新增费用项（N）" @click="newItem">
          <Icon name="plus" :size="13" />新增
        </button>
      </header>

      <div v-if="menuOpen" class="pop book-pop">
        <div
          v-for="b in state.books" :key="b.id"
          class="pop-row" :class="{ on: b.id === state.activeBookId }"
          @click="pickBook(b.id)"
        >
          <span class="dot" :style="{ background: b.color }" />
          <span class="nm">{{ b.name }}</span>
          <span class="cnt">{{ (b.projects || []).length }}</span>
        </div>
        <div class="pop-sep" />
        <div class="pop-row" @click="menuOpen = false; openDrawer({ type: 'books' })">
          <span class="nm">管理项目与模板…</span>
          <span class="cnt">B</span>
        </div>
      </div>

      <div v-if="alerts.total && visibleAlerts.length && ui.tab !== 'settings'" class="alerts">
        <span
          v-for="(a, i) in visibleAlerts" :key="i"
          class="alert-chip" :class="[a.type, { severe: a.severe }]"
          @click="onAlertClick(a)"
        >{{ a.text }}</span>
        <button class="link" style="margin-left: auto; flex: none" title="今天不再显示这类提醒（角标仍保留）" @click="onIgnoreAlerts">忽略</button>
      </div>

      <component :is="currentView" />

      <!-- 抽屉宿主 -->
      <template v-if="ui.drawer">
        <ItemSheet v-if="ui.drawer.type === 'item' && ui.drawer.id" :key="ui.drawer.id" :drawer="ui.drawer" />
        <ItemSheet v-else-if="ui.drawer.type === 'item'" :drawer="ui.drawer" />
        <CatForm v-else-if="ui.drawer.type === 'cat'" :drawer="ui.drawer" />
        <PayeeForm v-else-if="ui.drawer.type === 'payee'" :drawer="ui.drawer" />
        <StatementSheet v-else-if="ui.drawer.type === 'statement'" :drawer="ui.drawer" />
        <BookManage v-else-if="ui.drawer.type === 'books'" />
      </template>

      <div class="toast-layer">
        <div v-for="t in toasts" :key="t.id" class="toast">
          <span>{{ t.msg }}</span>
          <button
            v-if="t.undo" class="undo"
            @click="doUndo(); dismissToast(t.id)"
          >撤销</button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.book-pop {
  top: 42px;
  left: 70px;
}
</style>
