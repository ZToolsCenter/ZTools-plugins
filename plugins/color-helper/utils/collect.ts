import chroma from 'chroma-js';
import { db, dbStorage } from './platform';
import { isDarkColor } from './color';

/**
 * 收藏颜色的文档形状与写入
 *
 * 收藏页按 `color/` 前缀从 db 里捞文档、按 collectsort 里的顺序排,
 * 换入口收藏必须写出完全一致的形状, 否则收藏页认不出来 ——
 * 所以 _id 生成与字段拼装集中在这里, 供两个入口共用。
 */

/** 收藏页排序索引的 dbStorage key, 存收藏文档 _id 的数组 */
export const COLLECT_SORT_KEY = "collectsort";

export interface CollectColor {
  _id: string;
  _rev?: string;
  name: string;
  color: string;
  dark?: boolean;
}

/** 文档 id: 色值小写、不带 "#"。同一个颜色只可能有一条文档 */
export function collectDocId(hex: string): string {
  return "color/" + hex.replace(/^#/, "").toLowerCase();
}

/** 归一化成 "#RRGGBB" / "#RRGGBBAA"(大写, chroma 3 对半透明色返回 8 位), 非法色值返回 null */
export function normalizeHex(color: string): string | null {
  if (typeof color !== "string") return null;
  const text = color.trim();
  if (!text || !chroma.valid(text)) return null;
  const hex = chroma(text).hex().toUpperCase();
  return /^#[0-9A-F]{6}([0-9A-F]{2})?$/.test(hex) ? hex : null;
}

/**
 * 收藏一个颜色, 返回是否**新**收藏成功
 *
 * 色值非法、已经收藏过、db 写入失败都返回 false —— 调用方只关心"这次有没有新增"。
 *
 * collectsort 一并同步: 收藏页用 indexOf 排序, 索引里没有的 id 会被排到最后,
 * 不追加的话新收藏的颜色看上去就是"收藏了但不见了"。
 */
export function saveCollectedColor(color: string): boolean {
  const hex = normalizeHex(color);
  if (!hex) return false;

  const _id = collectDocId(hex);
  if (db.get(_id)) return false;

  const result = db.put({ _id, name: "", color: hex, dark: isDarkColor(hex) });
  if (!result?.ok) return false;

  const saved = dbStorage.getItem(COLLECT_SORT_KEY);
  const order: string[] = Array.isArray(saved)
    ? saved.filter((id: unknown): id is string => typeof id === "string")
    : [];
  // db 里已有、索引里没有的文档一并补上, 否则它们永远排在末尾
  db.allDocs("color/").forEach((doc: any) => {
    if (typeof doc?._id === "string" && !order.includes(doc._id)) order.push(doc._id);
  });
  dbStorage.setItem(COLLECT_SORT_KEY, order);
  return true;
}
