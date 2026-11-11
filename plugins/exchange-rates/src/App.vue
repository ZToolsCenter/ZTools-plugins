<script setup lang="ts">
import { computed, onMounted, onUnmounted, reactive, ref, watch } from "vue";
import {
  MAX_FRACTION_DIGITS,
  appendMissing,
  commitRowAmount,
  canonicalAmount,
  convertAmount,
  formatAmount,
  formatGrouped,
  formatPercent,
  moveItem,
  reselectCurrency,
  sortCodes,
} from "./convert";
import { flagRegion } from "./flags-map";
import { messages, resolveLocale, type Messages } from "./i18n";
import type { CurrencyInfo, RateBook, SeriesPoint, Settings } from "./types";

const locale = resolveLocale(navigator.language || "en");
const t: Messages = messages(locale);
const names = new Intl.DisplayNames([locale], { type: "currency" });
const baseUrl = import.meta.env.BASE_URL;

const DEFAULT_SETTINGS: Settings = {
  base: "USD",
  amount: "0",
  digits: 2,
  dark: false,
  darkLocked: false,
  showDeprecated: false,
  codes: ["CNY", "USD", "EUR", "JPY", "HKD", "TWD"],
};

function systemDark(): boolean {
  try {
    if (window.ztools?.isDarkColors) return window.ztools.isDarkColors();
  } catch {
    // Browser preview has no host theme.
  }
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false;
}

function readSettings(): Settings {
  const saved = window.fx?.getItem("fx:settings");
  const next = { ...DEFAULT_SETTINGS, codes: DEFAULT_SETTINGS.codes.slice() };
  if (!saved || typeof saved !== "object") {
    next.dark = systemDark();
    return next;
  }
  const record = saved as Partial<Settings>;
  if (typeof record.base === "string" && record.base) next.base = record.base;
  if (typeof record.amount === "string") next.amount = record.amount;
  if (typeof record.digits === "number" && Number.isInteger(record.digits)) {
    next.digits = Math.min(MAX_FRACTION_DIGITS, Math.max(0, record.digits));
  }
  if (typeof record.dark === "boolean") next.dark = record.dark;
  if (typeof record.darkLocked === "boolean") next.darkLocked = record.darkLocked;
  if (typeof record.showDeprecated === "boolean") next.showDeprecated = record.showDeprecated;
  if (Array.isArray(record.codes) && record.codes.every((code) => typeof code === "string")) {
    next.codes = record.codes;
  }
  if (!next.darkLocked) next.dark = systemDark();
  if (!next.codes.includes(next.base)) next.codes = next.codes.concat(next.base);
  return next;
}

function readCurrencies(): CurrencyInfo[] {
  const saved = window.fx?.getItem("fx:currencies");
  if (!Array.isArray(saved)) return [];
  return saved.filter((item): item is CurrencyInfo => {
    return !!item && typeof item === "object" && typeof (item as CurrencyInfo).code === "string" && typeof (item as CurrencyInfo).deprecated === "boolean";
  });
}

function readBook(): RateBook | null {
  const saved = window.fx?.getItem("fx:rates");
  if (!saved || typeof saved !== "object") return null;
  const record = saved as Partial<RateBook>;
  if (typeof record.date !== "string" || !record.rates || typeof record.rates !== "object") return null;
  const rates: Record<string, string> = {};
  for (const [code, rate] of Object.entries(record.rates)) {
    if (typeof rate === "string") rates[code] = rate;
  }
  if (!Object.keys(rates).length) return null;
  return { date: record.date, fetchedAt: Number(record.fetchedAt) || 0, rates };
}

const settings = reactive<Settings>(readSettings());
const book = ref<RateBook | null>(readBook());
const currencies = ref<CurrencyInfo[]>(readCurrencies());
const query = ref("");
const pickerOpen = ref(false);
const editing = ref<{ source: "base" | "row"; code: string; draft: string } | null>(null);
const toast = ref("");
const blockTip = ref<{ code: string; text: string } | null>(null);
const trendOpen = ref(false);
const series = ref<SeriesPoint[] | null>(null);
const drag = ref<{ from: number; over: number; dy: number; height: number } | null>(null);
const brokenFlags = reactive<Record<string, boolean>>({});
let toastTimer = 0;
let blockTimer = 0;
let ready = true;

watch(settings, () => {
  if (ready) window.fx?.setItem("fx:settings", { ...settings, codes: settings.codes.slice() });
}, { deep: true });

if (import.meta.env.DEV) {
  watch(() => settings.dark, (dark) => {
    document.documentElement.classList.toggle("dev-dark", dark);
  }, { immediate: true });
}

function currencyName(code: string): string {
  try {
    return names.of(code) || code;
  } catch {
    return code;
  }
}

function currencySymbol(code: string): string {
  try {
    const part = new Intl.NumberFormat(locale, { style: "currency", currency: code })
      .formatToParts(0)
      .find((item) => item.type === "currency");
    return part?.value || code;
  } catch {
    return code;
  }
}

const selectable = computed(() => {
  const rows = currencies.value.filter((item) => settings.showDeprecated || !item.deprecated);
  return sortCodes(rows.map((item) => item.code));
});

const filtered = computed(() => {
  const needle = query.value.trim().toLowerCase();
  if (!needle) return selectable.value;
  return selectable.value.filter((code) => {
    return code.toLowerCase().includes(needle) || currencyName(code).toLowerCase().includes(needle);
  });
});

const dateLabel = computed(() => (book.value?.date ? book.value.date.replaceAll("-", "/") : "—"));

function shownAmount(code: string): string {
  if (!book.value) return "—";
  if (code === settings.base) return formatGrouped(settings.amount, settings.digits) || t.noRate;
  const value = convertAmount(settings.amount, settings.base, code, book.value.rates);
  if (value == null) return t.noRate;
  return formatGrouped(value, settings.digits) || t.noRate;
}

function draftFor(code: string): string {
  if (code === settings.base) return settings.amount;
  if (!book.value) return "";
  const value = convertAmount(settings.amount, settings.base, code, book.value.rates);
  if (!value) return "";
  const rounded = formatAmount(value, MAX_FRACTION_DIGITS);
  return (rounded && canonicalAmount(rounded)) || "";
}

function isEditing(source: "base" | "row", code: string): boolean {
  return editing.value?.source === source && editing.value.code === code;
}

function beginEdit(source: "base" | "row", code: string) {
  pickerOpen.value = false;
  if (editing.value && (editing.value.source !== source || editing.value.code !== code)) commitEditing();
  if (isEditing(source, code)) return;
  editing.value = { source, code, draft: draftFor(code) };
}

function onDraft(event: Event) {
  if (!editing.value) return;
  editing.value.draft = (event.target as HTMLInputElement).value;
}

function onAmountBlur(event: FocusEvent) {
  const next = event.relatedTarget as HTMLElement | null;
  if (next?.closest("[data-amount]")) return;
  commitEditing();
}

function commitEditing() {
  const current = editing.value;
  if (!current) return;
  const next = commitRowAmount(settings, current.code, current.draft);
  editing.value = null;
  if (!next) return;
  settings.base = next.base;
  settings.amount = next.amount;
  settings.codes = next.codes;
}

function onPointerDown(event: PointerEvent) {
  const target = event.target as HTMLElement | null;
  if (!target?.closest("[data-amount]")) commitEditing();
  if (!target?.closest("[data-picker]")) {
    pickerOpen.value = false;
    query.value = "";
  }
}

function onKey(event: KeyboardEvent) {
  if (event.key === "Escape") {
    if (trendOpen.value) trendOpen.value = false;
    else if (pickerOpen.value) {
      pickerOpen.value = false;
      query.value = "";
    }
    return;
  }
  if (event.key === "Enter" && (event.target as HTMLElement | null)?.closest("[data-amount]")) {
    commitEditing();
  }
}

function onDigits(event: Event) {
  const input = event.target as HTMLInputElement;
  if (!/^\d+$/.test(input.value)) {
    input.value = String(settings.digits);
    return;
  }
  settings.digits = Math.min(MAX_FRACTION_DIGITS, Math.max(0, Number(input.value)));
  input.value = String(settings.digits);
}

function onDark(event: Event) {
  settings.dark = (event.target as HTMLInputElement).checked;
  settings.darkLocked = true;
}

function showToast(text: string) {
  toast.value = text;
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    toast.value = "";
  }, 1500);
}

function fail(error: unknown) {
  console.error(error);
  const text = t.ratesFailed;
  if (window.ztools?.showToast) window.ztools.showToast(text);
  else showToast(text);
}

async function refresh() {
  if (!window.fx) return;
  try {
    const [nextBook, nextCurrencies] = await Promise.all([
      window.fx.fetchRates(),
      window.fx.fetchCurrencies(),
    ]);
    book.value = nextBook;
    currencies.value = nextCurrencies;
    window.fx.setItem("fx:rates", nextBook);
    window.fx.setItem("fx:currencies", nextCurrencies);
  } catch (error) {
    fail(error);
  }
}

async function loadMissing() {
  if (!window.fx) return;
  try {
    if (!book.value) {
      const next = await window.fx.fetchRates();
      book.value = next;
      window.fx.setItem("fx:rates", next);
    }
    if (!currencies.value.length) {
      const next = await window.fx.fetchCurrencies();
      currencies.value = next;
      window.fx.setItem("fx:currencies", next);
    }
  } catch (error) {
    fail(error);
  }
}

function pick(code: string) {
  if (settings.codes.includes(code)) {
    const next = book.value
      ? reselectCurrency(settings, code, book.value.rates)
      : null;
    if (next) {
      settings.base = next.base;
      settings.amount = next.amount;
      showToast(t.already);
    } else if (code === settings.base) {
      showToast(t.already);
    } else {
      showToast(t.noRate);
    }
  } else {
    settings.codes = settings.codes.concat(code);
  }
  pickerOpen.value = false;
  query.value = "";
}

function addAll() {
  settings.codes = appendMissing(settings.codes, selectable.value);
  pickerOpen.value = false;
  query.value = "";
}

function removeCode(code: string) {
  if (code === settings.base) {
    const text = t.blocks[Math.floor(Math.random() * t.blocks.length)];
    blockTip.value = { code, text };
    window.clearTimeout(blockTimer);
    blockTimer = window.setTimeout(() => {
      blockTip.value = null;
    }, 1500);
    return;
  }
  settings.codes = settings.codes.filter((item) => item !== code);
}

function rowShift(index: number): Record<string, string> | undefined {
  const current = drag.value;
  if (!current) return undefined;
  let shift = "translateY(0)";
  if (index === current.from) shift = `translateY(${current.dy}px)`;
  else if (current.from < current.over && index > current.from && index <= current.over) {
    shift = `translateY(${-current.height}px)`;
  } else if (current.over < current.from && index >= current.over && index < current.from) {
    shift = `translateY(${current.height}px)`;
  }
  return { "--shift": shift };
}

function onDragPointerDown(event: PointerEvent, index: number) {
  if (event.button !== 0) return;
  const row = (event.currentTarget as HTMLElement).closest("tr");
  if (!row) return;
  event.preventDefault();
  const startX = event.clientX;
  const startY = event.clientY;
  const height = row.getBoundingClientRect().height;
  let active = false;
  const timer = window.setTimeout(() => {
    active = true;
    drag.value = { from: index, over: index, dy: 0, height };
  }, 400);
  const move = (ev: PointerEvent) => {
    if (!active || !drag.value) {
      if (Math.hypot(ev.clientX - startX, ev.clientY - startY) > 6) cleanup();
      return;
    }
    const body = row.parentElement;
    if (!body) return;
    const rows = [...body.querySelectorAll<HTMLElement>("[data-row]")];
    let over = 0;
    for (const item of rows) {
      const top = Number(item.dataset.top);
      if (ev.clientY > top + height / 2) over = Number(item.dataset.row);
    }
    drag.value = { from: drag.value.from, over, dy: ev.clientY - startY, height };
  };
  const cleanup = () => {
    window.clearTimeout(timer);
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", cleanup);
    const current = drag.value;
    drag.value = null;
    if (current && current.from !== current.over) {
      settings.codes = moveItem(settings.codes, current.from, current.over);
    }
  };
  const body = row.parentElement;
  if (body) {
    for (const item of body.querySelectorAll<HTMLElement>("[data-row]")) {
      item.dataset.top = String(item.getBoundingClientRect().top);
    }
  }
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", cleanup);
}

async function openTrend() {
  trendOpen.value = true;
  if (!window.fx) return;
  const from = new Date(Date.now() - 60 * 86400000).toISOString().slice(0, 10);
  const today = new Date().toISOString().slice(0, 10);
  const quotes = settings.codes.slice();
  const key = `fx:series:${from}:${today}:${quotes.slice().sort().join(",")}`;
  const cached = window.fx.getItem(key);
  if (Array.isArray(cached)) {
    series.value = cached as SeriesPoint[];
    return;
  }
  try {
    const rows = await window.fx.fetchSeries(from, quotes);
    series.value = rows;
    try {
      window.fx.setItem(key, rows);
    } catch (error) {
      console.error(error);
    }
  } catch (error) {
    fail(error);
  }
}

const trendRows = computed(() => {
  const byDate = new Map<string, Record<string, string>>();
  for (const point of series.value || []) {
    const bag = byDate.get(point.date) || {};
    bag[point.quote] = point.rate;
    if (!bag.EUR) bag.EUR = "1";
    byDate.set(point.date, bag);
  }
  const dates = [...byDate.keys()].sort();
  return settings.codes.map((code) => {
    const points: string[] = [];
    for (const date of dates) {
      const bag = byDate.get(date) || {};
      const value = code === settings.base ? "1" : convertAmount("1", settings.base, code, bag);
      if (value != null) points.push(value);
    }
    const last = points.slice(-30);
    const prev = last.length >= 2 ? last[last.length - 2] : null;
    const latest = last.length ? last[last.length - 1] : null;
    return {
      code,
      points: last,
      percent: prev && latest ? formatPercent(prev, latest) : null,
      amount: code === settings.base ? "1" : latest ? formatGrouped(latest, 6) : "—",
    };
  });
});

function sparkPoints(points: string[]): string {
  if (!points.length) return "";
  const nums = points.map((point) => Number(point));
  const min = Math.min(...nums);
  const max = Math.max(...nums);
  const span = max - min || 1;
  return nums
    .map((value, index) => {
      const x = nums.length === 1 ? 60 : (index / (nums.length - 1)) * 120;
      const y = 34 - ((value - min) / span) * 28;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
}

function flagSrc(code: string): string | null {
  const region = flagRegion(code);
  if (!region || brokenFlags[code]) return null;
  return `${baseUrl}flags/${region}.svg`;
}

onMounted(() => {
  try {
    window.ztools?.setExpendHeight(720);
    window.ztools?.onPluginEnter?.(() => window.ztools?.setExpendHeight(720));
    window.ztools?.onThemeChange?.((info) => {
      if (!settings.darkLocked) settings.dark = !!info?.isDark;
    });
  } catch (error) {
    console.error(error);
  }
  window.addEventListener("keydown", onKey);
  void loadMissing();
});

onUnmounted(() => {
  window.removeEventListener("keydown", onKey);
  window.clearTimeout(toastTimer);
  window.clearTimeout(blockTimer);
});
</script>

<template>
  <div class="app" :class="settings.dark ? 'dark' : 'light'" @pointerdown="onPointerDown">
    <header class="toolbar">
      <label class="digits">
        <span>{{ t.digits }}</span>
        <input type="number" :min="0" :max="MAX_FRACTION_DIGITS" step="1" :value="settings.digits" @change="onDigits" />
      </label>
      <div class="picker" data-picker>
        <input
          :placeholder="t.select"
          :value="query"
          @input="query = ($event.target as HTMLInputElement).value; pickerOpen = true"
          @focus="pickerOpen = true"
        />
        <ul v-if="pickerOpen" class="menu">
          <li @click="pickerOpen = false; query = ''">{{ t.select }}</li>
          <li @click="addAll">{{ t.addAll }}</li>
          <li v-for="code in filtered" :key="code" @click="pick(code)">{{ currencyName(code) }} ({{ code }})</li>
        </ul>
      </div>
      <label class="check">
        <input v-model="settings.showDeprecated" type="checkbox" />
        <span>{{ t.deprecated }}</span>
      </label>
      <label class="check">
        <input type="checkbox" :checked="settings.dark" @change="onDark" />
        <span>{{ t.dark }}</span>
      </label>
      <div class="updated">
        <span>{{ t.updated }}</span>
        <button class="icon-button" type="button" @click="refresh">↻</button>
        <span>{{ dateLabel }}</span>
      </div>
    </header>

    <table class="board">
      <colgroup>
        <col class="col-index" />
        <col class="col-flag" />
        <col class="col-name" />
        <col class="col-code" />
        <col class="col-symbol" />
        <col class="col-amount" />
        <col class="col-action" />
      </colgroup>
      <thead>
        <tr>
          <th>{{ t.index }}</th>
          <th>{{ t.flag }}</th>
          <th>{{ t.name }}</th>
          <th>{{ t.code }}</th>
          <th>{{ t.symbol }}</th>
          <th class="num">{{ t.amount }}</th>
          <th>{{ t.action }}</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>1</td>
          <td>
            <img v-if="flagSrc(settings.base)" class="flag" :src="flagSrc(settings.base) || ''" alt="" @error="brokenFlags[settings.base] = true" />
            <span v-else class="flag-fallback">{{ settings.base }}</span>
          </td>
          <td>{{ currencyName(settings.base) }}</td>
          <td><span class="badge">{{ settings.base }}</span></td>
          <td>{{ currencySymbol(settings.base) }}</td>
          <td class="amount">
            <input
              data-amount
              :value="isEditing('base', settings.base) ? editing?.draft : shownAmount(settings.base)"
              @pointerdown.stop="beginEdit('base', settings.base)"
              @focus="beginEdit('base', settings.base)"
              @blur="onAmountBlur"
              @input="onDraft"
            />
          </td>
          <td><button class="trend-button" type="button" @click="openTrend">{{ t.trend }}</button></td>
        </tr>
      </tbody>
    </table>

    <table class="board">
      <colgroup>
        <col class="col-index" />
        <col class="col-flag" />
        <col class="col-name" />
        <col class="col-code" />
        <col class="col-symbol" />
        <col class="col-amount" />
        <col class="col-action" />
      </colgroup>
      <thead>
        <tr>
          <th>{{ t.index }}</th>
          <th>{{ t.flag }}</th>
          <th>{{ t.name }}</th>
          <th>{{ t.code }}</th>
          <th>{{ t.symbol }}</th>
          <th class="num">{{ t.amount }}</th>
          <th>{{ t.action }}</th>
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="(code, index) in settings.codes"
          :key="code"
          :data-row="index"
          class="currency-row"
          :class="{ dragging: drag?.from === index }"
          :style="rowShift(index)"
        >
          <td class="drag-source" @pointerdown="onDragPointerDown($event, index)">{{ index + 1 }}</td>
          <td class="drag-source" @pointerdown="onDragPointerDown($event, index)">
            <img v-if="flagSrc(code)" class="flag" :src="flagSrc(code) || ''" alt="" @error="brokenFlags[code] = true" />
            <span v-else class="flag-fallback">{{ code }}</span>
          </td>
          <td class="drag-source" @pointerdown="onDragPointerDown($event, index)">{{ currencyName(code) }}</td>
          <td class="drag-source" @pointerdown="onDragPointerDown($event, index)"><span class="badge">{{ code }}</span></td>
          <td class="drag-source" @pointerdown="onDragPointerDown($event, index)">{{ currencySymbol(code) }}</td>
          <td class="amount">
            <input
              data-amount
              :value="isEditing('row', code) ? editing?.draft : shownAmount(code)"
              @pointerdown.stop="beginEdit('row', code)"
              @focus="beginEdit('row', code)"
              @blur="onAmountBlur"
              @input="onDraft"
            />
          </td>
          <td>
            <div class="remove-wrap">
              <span v-if="blockTip?.code === code" class="block-tip">{{ blockTip.text }}</span>
              <button class="remove-button" type="button" @click="removeCode(code)">{{ t.remove }}</button>
            </div>
          </td>
        </tr>
      </tbody>
    </table>

    <div v-if="toast" class="toast">{{ toast }}</div>

    <div v-if="trendOpen" class="mask" @click.self="trendOpen = false">
      <div class="trend-panel">
        <table>
          <thead>
            <tr>
              <th>{{ t.name }}</th>
              <th class="num">{{ t.amount }}</th>
              <th>{{ t.change }}</th>
              <th>{{ t.chart }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in trendRows" :key="row.code" :class="{ 'base-row': row.code === settings.base }">
              <td>
                <img v-if="flagSrc(row.code)" class="flag" :src="flagSrc(row.code) || ''" alt="" @error="brokenFlags[row.code] = true" />
                {{ currencyName(row.code) }}
              </td>
              <td class="num">{{ row.amount }}</td>
              <td>
                <span v-if="row.percent" class="pill" :class="row.percent.startsWith('-') ? 'down' : 'up'">{{ row.percent }}</span>
                <span v-else>—</span>
              </td>
              <td>
                <svg v-if="row.points.length" class="spark" viewBox="0 0 120 40" width="140" height="42">
                  <polyline fill="none" stroke="var(--line-chart)" stroke-width="1.6" :points="sparkPoints(row.points)" />
                </svg>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>
</template>
