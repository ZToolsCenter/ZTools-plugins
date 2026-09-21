/**
 * 多标签自动草稿的纯数据模型：结构版本、编码 / 解码 / 旧结构升级与配额降级链。
 *
 * 结构取舍说明：
 * - 旧版草稿（无 tabs 字段）只保存激活标签的单个 project，刷新后其他标签全部丢失；
 *   新版（draftVersion = 2）保存标签列表、顺序、标题、激活态与每个标签的工程数据，
 *   另带 dirty / 保存路径 / 视口等轻量元数据；撤销栈与选区等会话级状态体积大且可重建，
 *   依旧不进草稿，恢复时每个标签以「仅含初始快照」的历史栈重新起步。
 * - 兼容策略：读取时按 tabs 字段探测新旧结构，旧结构升级为单标签新结构；新写入一律新结构。
 * - 配额降级链：写入超出 localStorage 配额时按「信息价值从高到低」逐级裁剪重试，
 *   决策收敛在本模块纯函数中，便于单测验证裁剪顺序。
 * - 本模块只做纯数据转换，不触 localStorage / fabric；所有裁剪沿修改路径浅拷贝，
 *   绝不改动传入对象（标签内存工程与草稿共享引用）。
 */

import { DRAFT_SCHEMA_VERSION, PROJECT_SCHEMA_VERSION } from './constants'
import { parseProjectFileValue } from './projectFile'
import type { IconCreatorDraftFile, IconCreatorProjectFile, IconCreatorProjectSvgPreviewMode, IconCreatorProjectViewMode } from './types'

/** 旧版单标签草稿升级后的固定标签 id：单标签场景无切换歧义，id 只需稳定可重复解码。 */
export const LEGACY_DRAFT_TAB_ID = 'project-tab-legacy-1'

/** 草稿中的单个标签条目：project 为 JSON-ready 工程对象，其余为恢复用的轻量元数据。 */
export type ProjectDraftTab = {
  tabId: string
  title: string
  project: IconCreatorProjectFile
  /** 关闭时是否有未保存修改，恢复后保留未保存圆点提示。 */
  dirty?: boolean
  /** 该标签首次保存选择的绝对路径，重启后仍可直接覆盖保存。 */
  savedFilePath?: string
  /** 以下为视口 / 视图次要元数据，仅提升恢复体验，配额不足时最后一级裁剪。 */
  viewMode?: IconCreatorProjectViewMode
  svgPreviewMode?: IconCreatorProjectSvgPreviewMode
  zoom?: number
  panX?: number
  panY?: number
}

/** 多标签草稿在 localStorage 中的完整信封结构。 */
export type ProjectDraftFile = {
  app: 'icon-creator'
  /** 应用 schema 版本沿用工程文件版本，保证工程解析通道的兼容校验语义不变。 */
  schemaVersion: number
  /** 草稿结构版本：2 = 多标签；旧草稿无该字段，按单标签结构升级处理。 */
  draftVersion: number
  updatedAt: string
  activeTabId: string
  /** 标签列表，数组顺序即标签栏顺序。 */
  tabs: ProjectDraftTab[]
}

/** 解码后的草稿内容：供页面层重建标签运行时使用。 */
export type DecodedProjectDraft = {
  activeTabId: string
  tabs: ProjectDraftTab[]
  updatedAt: string
}

/** 编码多标签草稿信封：tabs 顺序即标签栏顺序，activeTabId 指向激活标签。 */
export function encodeProjectDraft(input: { activeTabId: string; tabs: ProjectDraftTab[]; updatedAt: string }): ProjectDraftFile {
  return {
    app: 'icon-creator',
    schemaVersion: PROJECT_SCHEMA_VERSION,
    draftVersion: DRAFT_SCHEMA_VERSION,
    updatedAt: input.updatedAt,
    activeTabId: input.activeTabId,
    tabs: input.tabs
  }
}

// 归一化草稿里的单个标签条目：project 走工程解析通道做结构校验与字段补全，非法条目返回 null 由上层跳过。
function normalizeDraftTabEntry(value: unknown, index: number): ProjectDraftTab | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const source = value as Record<string, unknown>
  let project: IconCreatorProjectFile
  try {
    project = parseProjectFileValue(source.project).project
  } catch {
    return null
  }
  const tab: ProjectDraftTab = {
    tabId: typeof source.tabId === 'string' && source.tabId.trim() ? source.tabId : `project-tab-restored-${index + 1}`,
    title: typeof source.title === 'string' && source.title.trim() ? source.title : '未命名项目',
    project
  }
  if (source.dirty === true) tab.dirty = true
  if (typeof source.savedFilePath === 'string' && source.savedFilePath) tab.savedFilePath = source.savedFilePath
  if (source.viewMode === 'canvas' || source.viewMode === 'svg') tab.viewMode = source.viewMode
  if (source.svgPreviewMode === 'graphic' || source.svgPreviewMode === 'code') tab.svgPreviewMode = source.svgPreviewMode
  if (Number.isFinite(source.zoom) && (source.zoom as number) > 0) tab.zoom = source.zoom as number
  if (Number.isFinite(source.panX)) tab.panX = source.panX as number
  if (Number.isFinite(source.panY)) tab.panY = source.panY as number
  return tab
}

/**
 * 将旧版单标签草稿（{ app, schemaVersion, updatedAt, project }）升级为新结构：
 * 包装成唯一标签，id / 标题使用固定值，保证同一份旧草稿可重复解码出相同结果。
 * project 非法（解析失败）时返回 null，调用方按无草稿处理。
 */
export function upgradeLegacyProjectDraft(project: unknown, updatedAt = ''): DecodedProjectDraft | null {
  const tab = normalizeDraftTabEntry({ tabId: LEGACY_DRAFT_TAB_ID, title: '项目 1', project }, 0)
  if (!tab) return null
  return { activeTabId: tab.tabId, tabs: [tab], updatedAt }
}

/**
 * 解码草稿信封：优先按多标签结构读取，否则按旧版单标签结构升级。
 * 非法标签条目跳过、重复 tabId 去重（保留先出现者）、激活 id 失效时回退第一个标签；
 * 无法得到任何有效标签时返回 null，调用方按无草稿处理。
 */
export function decodeProjectDraft(value: unknown): DecodedProjectDraft | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const source = value as Record<string, unknown>
  const updatedAt = typeof source.updatedAt === 'string' ? source.updatedAt : ''
  if (Array.isArray(source.tabs)) {
    const tabs: ProjectDraftTab[] = []
    const seenTabIds = new Set<string>()
    source.tabs.forEach((entry, index) => {
      const tab = normalizeDraftTabEntry(entry, index)
      if (!tab || seenTabIds.has(tab.tabId)) return
      seenTabIds.add(tab.tabId)
      tabs.push(tab)
    })
    if (!tabs.length) return null
    const activeTabId = typeof source.activeTabId === 'string' && seenTabIds.has(source.activeTabId)
      ? source.activeTabId
      : tabs[0].tabId
    return { activeTabId, tabs, updatedAt }
  }
  // 旧版单标签草稿没有 tabs 字段，只有 project，升级为单标签新结构。
  if (source.project && typeof source.project === 'object') {
    return upgradeLegacyProjectDraft(source.project, updatedAt)
  }
  return null
}

// 返回去掉命名画布快照的工程浅拷贝；无快照时原样返回，避免多余拷贝。快照是草稿中体积最大的可选数据。
export function stripProjectCanvasSnapshots(project: IconCreatorProjectFile): IconCreatorProjectFile {
  if (!project.meta?.snapshots?.length) return project
  return { ...project, meta: { ...project.meta, snapshots: undefined } }
}

// 返回去掉画板缩略图的工程浅拷贝；缩略图为 dataURL 图片，是草稿中仅次于命名快照的体积来源，恢复画板后会重新生成。
export function stripProjectArtboardThumbnails(project: IconCreatorProjectFile): IconCreatorProjectFile {
  if (!project.artboards?.some((artboard) => artboard.thumbnail !== undefined)) return project
  return {
    ...project,
    artboards: project.artboards.map((artboard) => (
      artboard.thumbnail === undefined ? artboard : { ...artboard, thumbnail: undefined }
    ))
  }
}

// 去掉单个标签的视口 / 视图次要元数据（降级链最后一级），恢复时回退默认视图；无该类字段时原样返回。
function stripTabViewMetadata(tab: ProjectDraftTab): ProjectDraftTab {
  if (
    tab.viewMode === undefined &&
    tab.svgPreviewMode === undefined &&
    tab.zoom === undefined &&
    tab.panX === undefined &&
    tab.panY === undefined
  ) return tab
  const { viewMode, svgPreviewMode, zoom, panX, panY, ...core } = tab
  return core
}

/**
 * 配额降级链（多标签结构）：返回按尝试顺序排列的候选草稿。
 * 顺序：全量 → 去命名画布快照 → 去画板缩略图 → 去视口 / 视图次要元数据。
 * 每一级累计前一级的裁剪；全部裁剪后仍写不进去时由调用方放弃本次写入并节流提示。
 * 所有候选只读使用，裁剪沿修改路径浅拷贝，不改动传入草稿与共享的标签内存工程。
 */
export function buildDraftWriteCandidates(draft: ProjectDraftFile): ProjectDraftFile[] {
  const withoutSnapshots: ProjectDraftFile = {
    ...draft,
    tabs: draft.tabs.map((tab) => ({ ...tab, project: stripProjectCanvasSnapshots(tab.project) }))
  }
  const withoutThumbnails: ProjectDraftFile = {
    ...withoutSnapshots,
    tabs: withoutSnapshots.tabs.map((tab) => ({ ...tab, project: stripProjectArtboardThumbnails(tab.project) }))
  }
  const minimal: ProjectDraftFile = {
    ...withoutThumbnails,
    tabs: withoutThumbnails.tabs.map(stripTabViewMetadata)
  }
  return [draft, withoutSnapshots, withoutThumbnails, minimal]
}

/**
 * 配额降级链（旧版单标签结构）：草稿没有标签次要元数据可裁，
 * 依次去命名画布快照、去画板缩略图，仍失败则由调用方放弃本次写入。
 */
export function buildLegacyDraftWriteCandidates(draft: IconCreatorDraftFile): IconCreatorDraftFile[] {
  const withoutSnapshots = { ...draft, project: stripProjectCanvasSnapshots(draft.project) }
  const withoutThumbnails = { ...withoutSnapshots, project: stripProjectArtboardThumbnails(withoutSnapshots.project) }
  return [draft, withoutSnapshots, withoutThumbnails]
}
