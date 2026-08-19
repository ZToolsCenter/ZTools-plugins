import { match } from "pinyin-pro";

const PINYIN_QUERY_RE = /^[a-zA-Z]+$/;
const HAS_CJK_RE = /[一-鿿]/;

/** query 是否可能是拼音输入（纯英文字母） */
export function isPinyinQuery(query: string): boolean {
  return PINYIN_QUERY_RE.test(query);
}

/**
 * 拼音模糊匹配：返回 text 中被命中的字符下标数组，未命中返回 null。
 * 仅当 query 为纯字母且 text 含汉字时尝试，避免对英文标题误判。
 * continuous: true 要求命中字符连续，结果更符合搜索直觉。
 */
export function pinyinMatchIndices(text: string, query: string): number[] | null {
  if (!query || !text) return null;
  if (!isPinyinQuery(query) || !HAS_CJK_RE.test(text)) return null;
  return match(text, query, { continuous: true, precision: "start" }) ?? null;
}
