/**
 * ============================================================================
 * 大文本防护：输入上限校验（roadmap 任务 ENG-011）
 * ============================================================================
 *
 * 在 diff 计算开始【之前】对输入做体量校验：超过上限（默认 5MB / 10 万行）时
 * 返回结构化的 `DiffError`（`kind: 'too-large'`），让调用方拿到明确错误对象
 * 而不是卡死在 O(ND) 的 diff 计算上（UI-013 据此给出「文本过大」确认提示）。
 *
 * 三个出口：
 * 1. `DIFF_LIMITS`：默认阈值常量（5MB / 10 万行），UI 可复用做输入前提示；
 * 2. `checkInputLimits(text)`：单侧校验，超限返回 too-large 错误、否则 null；
 * 3. `checkPairLimits(left, right)`：双侧校验（先左后右），返回第一个命中的
 *    错误 —— `compareFull` / `compareIncremental`（./diff.ts）在【规则编译与
 *    任何 diff 计算之前】调用它，超限即短路返回。
 *
 * 判定口径：基于 `./normalize.ts` 的 `analyzeInput`（ENG-010 元数据出口）——
 * `byteLength` 为原文 UTF-8 字节数（含 BOM 的 3 字节，若有），`lines.length`
 * 为剥 BOM 后按行切分的行数（尾部换行不产生额外空行）。两维任一
 * 【严格大于】上限即超限（恰好等于阈值不超限）。
 *
 * 侧别定位说明：`DiffError` 的 `too-large` 分支形状固定（无 message / side
 * 字段），本模块不在错误对象里区分左右侧 —— 调用方需要知道是哪一侧超限时，
 * 用 `analyzeInputPair(left, right)`（./normalize.ts）对两侧各做一次元数据
 * 分析，比对 `actualBytes` / `actualLines` 与 `left` / `right` 侧的
 * `byteLength` / `lines.length` 即可定位（引擎入口超限即返回，不做 diff，
 * 多一次 O(n) 元数据分析成本可忽略）。
 *
 * 硬性约束（对齐其他引擎模块）：
 * - 零 UI 依赖、零 DOM、零 store 依赖、零第三方依赖（仅用全局 `TextEncoder`，
 *   经 `analyzeInput` 间接使用）；
 * - 纯函数：不修改入参、不持有可变状态；
 * - 本文件是引擎层的【近叶子模块】：只 import `./normalize.ts`（叶子）与
 *   `./types.ts`（type-only），不 import `./diff.ts` —— 依赖方向为
 *   `diff.ts → guards.ts → normalize.ts`，无循环依赖。
 * ============================================================================
 */

import { analyzeInput } from './normalize'
import type { DiffError } from './types'

/**
 * 输入上限集合（ENG-011 校验维度的形状）。
 *
 * 字段均可独立生效：设为 `Infinity` 可关闭对应维度（`analyzeInput` 的
 * 计数与 `Infinity` 比较恒为「未超限」）。
 */
export interface DiffLimits {
  /** 单侧输入的 UTF-8 字节数上限（默认 5MB = 5 * 1024 * 1024）。 */
  maxBytes: number
  /** 单侧输入的行数上限（默认 10 万行）。 */
  maxLines: number
}

/**
 * 默认输入上限（ENG-011 定稿阈值）：5MB / 10 万行。
 *
 * 导出供 UI（输入框字数提示、提交前预检）与测试复用；`checkInputLimits` /
 * `checkPairLimits` 的 limits 参数缺省取本常量。
 */
export const DIFF_LIMITS: DiffLimits = {
  maxBytes: 5 * 1024 * 1024,
  maxLines: 100_000,
}

/**
 * 单侧输入的大文本校验（ENG-011 核心）。
 *
 * 实现方式：复用 `analyzeInput`（./normalize.ts）取 `byteLength` 与
 * `lines.length`，与上限做【严格大于】比较（恰好等于阈值不超限）；两维
 * 都未超限返回 `null`，任一超限返回完整的 too-large 错误对象：
 * - `limitBytes` / `limitLines`：恒带上（取本次校验生效的上限，两个维度
 *   都填，便于 UI 展示完整阈值信息）；
 * - `actualBytes` / `actualLines`：恒带上（`analyzeInput` 一次算出两维，
 *   无需为省一个字段做条件填充）。
 *
 * 性能约定：`analyzeInput` 对原文做 O(n) 的字节计数 + 行切分 + 行尾风格
 * 扫描，5MB 量级输入为毫秒级 —— 相比被拦下的 O(ND) diff 计算（大文本下
 * 秒级到卡死）可忽略；超限即短路，不进入任何 diff 计算。
 *
 * @param text 原始文本（原样输入；BOM / 行尾符原样保留，由 analyzeInput
 *             按既定口径统计）
 * @param limits 上限集合（缺省 `DIFF_LIMITS`：5MB / 10 万行）
 * @returns 超限 → `{ kind: 'too-large', ... }`；未超限 → `null`
 */
export function checkInputLimits(text: string, limits: DiffLimits = DIFF_LIMITS): DiffError | null {
  const input = analyzeInput(text)
  const overBytes = input.byteLength > limits.maxBytes
  const overLines = input.lines.length > limits.maxLines
  if (!overBytes && !overLines) return null
  return {
    kind: 'too-large',
    limitBytes: limits.maxBytes,
    limitLines: limits.maxLines,
    actualBytes: input.byteLength,
    actualLines: input.lines.length,
  }
}

/**
 * 双侧输入的大文本校验（ENG-011 引擎入口用）：先左后右逐侧
 * `checkInputLimits`，返回【第一个】命中的错误（左侧超限时不检查右侧，
 * fail-fast）。
 *
 * 侧别定位：返回的 `DiffError` 形状固定、不含侧别字段（见模块头「侧别
 * 定位说明」）—— 需要区分左右侧的调用方用 `analyzeInputPair(left, right)`
 * 比对 actual* 字段自行定位；引擎入口（`compareFull` /
 * `compareIncremental`）不区分，统一按「输入超限」提示。
 *
 * @param left 左侧（旧文本）原始输入
 * @param right 右侧（新文本）原始输入
 * @param limits 上限集合（缺省 `DIFF_LIMITS`）
 * @returns 任一侧超限 → 第一个命中的 too-large 错误（先左后右）；
 *          两侧都未超限 → `null`
 */
export function checkPairLimits(
  left: string,
  right: string,
  limits: DiffLimits = DIFF_LIMITS,
): DiffError | null {
  return checkInputLimits(left, limits) ?? checkInputLimits(right, limits)
}
