import { reactive } from 'vue';
import { todayLocal } from './core';

/**
 * M1：预警「忽略」状态的按天持久化。
 *
 * 为什么单独一个键：主键 `ztools_project_cost_v1` 走的是台账序列化，把「今天不想看哪类提醒」
 * 这种界面偏好塞进去，会让快照 / 导出 / 体检都平白多一个字段。独立键 + 只存 `{date, types}`
 * 体积可忽略，写失败也不影响账目。
 *
 * 语义（对齐需求池 M1）：
 * - 点「忽略」→ 当天的**同类**提醒不再出现在横幅里
 * - **角标计数仍保留**（左轨小红点照旧显示 `alerts.total`），避免"眼不见为净"式遗忘
 * - 跨天自动失效：日期不是今天就当没忽略过
 * - 设置页可「恢复今日提醒」
 */
export const IGNORE_KEY = 'ztools_alert_ignore_v1';

export const ignoreState = reactive({ date: '', types: [] });

function load() {
  try {
    const raw = localStorage.getItem(IGNORE_KEY);
    if (!raw) return;
    const d = JSON.parse(raw);
    if (d && typeof d.date === 'string' && Array.isArray(d.types)) {
      ignoreState.date = d.date;
      ignoreState.types = d.types.filter((t) => typeof t === 'string');
    }
  } catch (_) {
    /* 坏数据 / 无 localStorage（node 测试）→ 当作没忽略 */
  }
}

function save() {
  try {
    localStorage.setItem(IGNORE_KEY, JSON.stringify({ date: ignoreState.date, types: ignoreState.types }));
  } catch (_) {
    /* 配额满：忽略状态存不下不算错误，本次会话内仍生效 */
  }
}

load();

/** 重新读一遍存储（测试 / 外部重置后用；坏数据同样不抛错） */
export function reloadIgnore(today = todayLocal()) {
  ignoreState.date = '';
  ignoreState.types = [];
  load();
  return refreshIgnore(today);
}

/** 跨天复位（每次切分区 / 打开设置页调用，成本可忽略） */
export function refreshIgnore(today = todayLocal()) {
  if (ignoreState.date !== today) {
    ignoreState.date = today;
    ignoreState.types = [];
    save();
  }
  return ignoreState;
}

/** 某一类预警今天是否已被忽略 */
export function isIgnored(type, today = todayLocal()) {
  if (!type) return false;
  if (ignoreState.date !== today) return false;
  return ignoreState.types.includes(type);
}

/** 忽略若干类（去重、只留字符串），返回本次新增的类数 */
export function ignoreTypes(types, today = todayLocal()) {
  if (ignoreState.date !== today) {
    ignoreState.date = today;
    ignoreState.types = [];
  }
  let added = 0;
  (types || []).forEach((t) => {
    if (typeof t !== 'string' || !t) return;
    if (!ignoreState.types.includes(t)) {
      ignoreState.types.push(t);
      added += 1;
    }
  });
  if (added) save();
  return added;
}

/** 恢复今天的全部提醒 */
export function clearIgnore() {
  ignoreState.types = [];
  save();
}

/** 今天被忽略的类数（设置页展示「今日已忽略 N 类」） */
export function ignoredCount(today = todayLocal()) {
  return ignoreState.date === today ? ignoreState.types.length : 0;
}
