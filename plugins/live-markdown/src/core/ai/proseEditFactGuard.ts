import { proseEditProtectedRanges } from "./proseEditProtectedRanges";
import { validateProseRequestActionFacts } from "./proseRequestActionFacts";
import { normalizeProseRequestMarkerAnchorSource, type ProseRequestMarkerProof } from "./proseRequestMarkerProof";
import { extractApprovalStateMarkers } from "./proseApprovalStates";

/** Conservative lexical safeguards, not a general semantic-entailment proof. */
function reject(reason: string): never {
  throw new Error(`正文事实或结构锚点发生变化（${reason}），原文未修改。`);
}

function syntaxMarkers(text: string): string[] {
  // Conservative prose cannot add even escaped delimiters: escape parity can
  // otherwise turn a seemingly literal dollar into a new formula at assembly.
  return [...text.matchAll(/\$|\\[()[\]]|\[\^[^\]\r\n]+\]/gu)].map(([value]) => value);
}

function polarity(text: string): string[] {
  // Retain the explicit source wording. Changes that may preserve meaning still
  // require a less conservative task rather than silently weakening this gate.
  return [...text.matchAll(/暂未|尚未|还未|并未|未曾|未能|没有|不能|不可|不得|不应|不允许|不支持|不外发|不发送|禁止|严禁|无需|并非|不是|未|(?:不|没)(?=\p{Script=Han})|\b(?:not|never|no|without|cannot)\b/giu)]
    .map(([value]) => value.toLowerCase());
}

function namedAnchors(text: string): string[] {
  text = text.replace(/[*_~]/gu, "").replace(/(\p{N})[ \t]+(?=[A-Za-zµμ°])/gu, "$1");
  const found: Array<{ at: number; value: string }> = [];
  const add = (pattern: RegExp, group = 0) => {
    for (const match of text.matchAll(pattern)) {
      found.push({ at: match.index ?? 0, value: match[group].trim() });
    }
  };
  const addOwner = (pattern: RegExp, relation: "owner" | "handoff") => {
    for (const match of text.matchAll(pattern)) {
      found.push({ at: match.index ?? 0, value: `${relation}:${match[1].trim()}:${match[2]}` });
    }
  };
  // Explicit identities and ownership relationships, including Chinese names.
  add(/(?:项目(?:代号|名称)?|品牌|型号|模型名称|负责人)\s*(?:为|是|[:：])\s*([\p{L}\p{N}_+.-]{1,32})/gu, 1);
  addOwner(/由\s*([\p{Script=Han}]{2,4}|[A-Za-z][A-Za-z .'-]{0,31})\s*(负责|担任)/gu, "owner");
  addOwner(/交给\s*([\p{Script=Han}]{2,4}|[A-Za-z][A-Za-z .'-]{0,31})\s*(负责|担任)/gu, "handoff");
  // Also recognize a direct owner-subject predicate, but only at a sentence or
  // clear clause boundary so embedded requests/delegations do not normalize.
  addOwner(/(?:^|[\r\n。！？；，、：:])[ \t]*(?!(?:由|交给))(?!(?:并且|且|并)(?:由|交给))([\p{Script=Han}]{2,4}|[A-Za-z][A-Za-z .'-]{0,31})[ \t]*(负责|担任)/gu, "owner");
  add(/(?:^|[\s，。；：、])([\p{Script=Han}]{2,12}|[A-Za-z][A-Za-z0-9_.+-]{1,31})\s*(?:项目|团队|公司|模型|品牌)(?!名称)/gu, 1);
  // Acronyms and mixed-case proper names. Ordinary English spelling is editable.
  add(/\b(?:[A-Z]{2,}[A-Za-z0-9_.+-]*|[A-Z][a-z]+(?:[A-Z][A-Za-z0-9]*)+)\b/gu);
  return found.sort((a, b) => a.at - b.at || a.value.localeCompare(b.value)).map(({ value }) => value);
}

function same(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function literalAtoms(text: string): string[] {
  return proseEditProtectedRanges(text, 0).map(({ from, to }) => text.slice(from, to).replace(/\s+/gu, ""));
}

export interface ProseFactContext {
  contextBefore?: string;
  contextAfter?: string;
  requestMarkerProofs?: readonly ProseRequestMarkerProof[];
  requestMarkerProofStage?: "slot" | "full-document";
}

const statusWords = /完成|做完|通过|失败|成功|待定|取消|确定|批准|上线|离线|外发|\b(?:pending|failed|completed|approved|cancelled)\b/giu;
const routeVerbs = "打开|访问|进入|调用|连接|切换|获取|下载|安装|编辑|设置|运行|执行|启动|管理|查看|提交|添加|控制|操作|部署|导出|导入|跳转|显隐|显示|隐藏|展开|折叠";
const routeObjectAndAction = new RegExp(`^\\s*[\\p{Script=Han}\\p{L}\\p{N}_+.#-]{1,24}\\s*(?:快速|直接|一键|立即)?(?:${routeVerbs})`, "u");
const capabilityVerb = new RegExp(`^\\s*(?:通过|使用|用|${routeVerbs})`, "u");

function isRouteThrough(text: string, index: number, length: number): boolean {
  const before = text.slice(Math.max(0, index - 8), index);
  // Inline code often contains the route object, such as the shortcut in
  // “可通过 `Ctrl+K` 打开面板”. Grammar uses a display-text copy; AST owns formatting.
  const after = text.slice(index + length, index + length + 64).replace(/`([^`\r\n]+)`/gu, "CODE").replace(/[*_]/gu, "");
  const hasAbility = /(?:可以|能够|可能|可|能)\s*$/u.test(before);
  const hasObjectAndAction = routeObjectAndAction.test(after.slice(0, 64));
  return hasAbility && hasObjectAndAction;
}

function actionIntents(text: string): Array<{ at: number; value: string }> {
  // Accept only a bounded request shape. Recipient/light-verb wording is
  // optional, while the action class and its full target remain part of the
  // comparison so a request cannot turn into a different action or outcome.
  return [...text.matchAll(/(?:(?:请|需要|应该|应当|必须|要|先|再|尝试|计划|准备|安排|继续)[ \t]*)+(?:(?:大家|各位|你们|您们|诸位|所有人|全体|你|您)[ \t]*)?(?:(?:进行|作出|予以)[ \t]*)?(确定|明确|确认|完成|做完)([^，。；！？\r\n]*)/gu)]
    .map((match) => {
      const word = match[1];
      const target = match[2].trim();
      const at = (match.index ?? 0) + match[0].length - match[2].length - word.length;
      return { at, value: `${["确定", "明确", "确认"].includes(word) ? "determine" : "complete"}:${target}` };
    });
}

function statuses(text: string): string[] {
  const actionIndexes = new Set(actionIntents(text).map(({ at }) => at));
  const approvalMarkers = extractApprovalStateMarkers(text);
  const events = approvalMarkers.map(({ from, state, raw }) => ({
    at: from,
    value: state === "opaque" ? `approval:opaque:${raw ?? ""}` : `approval:${state}`
  }));
  let approvalMarkerIndex = 0;
  for (const match of text.matchAll(statusWords)) {
    const word = match[0];
    const index = match.index ?? 0;
    while (approvalMarkerIndex < approvalMarkers.length && approvalMarkers[approvalMarkerIndex]!.to <= index) {
      approvalMarkerIndex += 1;
    }
    const owner = approvalMarkers[approvalMarkerIndex];
    if (owner?.state !== "opaque" && owner && index >= owner.from && index < owner.to) continue;
    if (word === "通过" && isRouteThrough(text, index, word.length)) continue;
    if (["完成", "做完", "确定"].includes(word) && actionIndexes.has(index)) continue;
    events.push({ at: index, value: word === "做完" ? "完成" : word.toLowerCase() });
  }
  return events.sort((left, right) => left.at - right.at).map(({ value }) => value);
}

function commandedActions(text: string): string[] {
  return actionIntents(text).map(({ value }) => value);
}

function completionConditions(text: string): string[] {
  return [...text.matchAll(/(完成|做完)([\p{Script=Han}\p{L}\p{N}_ -]{0,16}?)(之后|后|以前|之前)/gu)]
    .map(([, , target, condition]) => `完成${target}${condition === "后" || condition === "之后" ? "after" : "before"}`);
}

function capabilityMarkers(text: string): string[] {
  return [...text.matchAll(/可以|能够|可能|可|能/gu)].filter((match) => {
    const after = text.slice((match.index ?? 0) + match[0].length, (match.index ?? 0) + match[0].length + 64);
    return capabilityVerb.test(after);
  }).map(([word]) => word === "可" || word === "可以" || word === "能" || word === "能够" ? "capable" : word);
}

/** Called per owned slot, so a negation cannot be moved into a different slot. */
export function validateProseReplacementFacts(source: string, replacement: string, context: ProseFactContext = {}): void {
  if (source === replacement) return;
  if (!same(syntaxMarkers(source), syntaxMarkers(replacement))) reject("新增或改动了公式、脚注标记");
  if (!same(source.match(/\p{N}+/gu) ?? [], replacement.match(/\p{N}+/gu) ?? [])) reject("新增或改动了数字");
  if (!same(literalAtoms(source), literalAtoms(replacement))) reject("数字单位、上下标或图标原子");
  if (!same(polarity(source), polarity(replacement))) reject("否定、限制或状态词");
  const before = context.contextBefore ?? "";
  const after = context.contextAfter ?? "";
  const originalInContext = `${before}${source}${after}`;
  const replacementInContext = `${before}${replacement}${after}`;
  if (!same(statuses(originalInContext), statuses(replacementInContext)) ||
    !same(commandedActions(originalInContext), commandedActions(replacementInContext))) reject("原有结论或状态词");
  if (!same(completionConditions(originalInContext), completionConditions(replacementInContext))) reject("原有完成条件");
  if (!same(capabilityMarkers(originalInContext), capabilityMarkers(replacementInContext))) reject("原有可执行能力或状态词");
  const anchorSource = normalizeProseRequestMarkerAnchorSource(source, replacement, context.requestMarkerProofs,
    context.requestMarkerProofStage) ?? source;
  if (!same(namedAnchors(anchorSource), namedAnchors(replacement))) reject("显式名称或负责人");
  validateProseRequestActionFacts(originalInContext, replacementInContext);
}
