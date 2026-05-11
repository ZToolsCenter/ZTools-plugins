<script setup lang="ts">
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import ZBadge from '@/components/ui/ZBadge.vue'
import ZButton from '@/components/ui/ZButton.vue'
import ZTooltip from '@/components/ui/ZTooltip.vue'
import ZSelect from '@/components/ui/ZSelect.vue'
import ZIcon from '@/components/ui/ZIcon.vue'
import FileDropzone from '@/components/shared/FileDropzone.vue'
import DiffLegend from '@/components/shared/DiffLegend.vue'
import { useExcelDiff } from '@/composables/useExcel'
import { useScrollSync } from '@/composables/useScrollSync'

const { t } = useI18n()

type ViewMode = 'split' | 'unified'
const viewMode = ref<ViewMode>('split')

const {
    sourceWorkbook,
    targetWorkbook,
    selectedSheetName,
    diffResult,
    loading,
    activeCell,
    showDiffPanel,
    bothLoaded,
    sheetOptions,
    currentSheetDiff,
    handleFile,
    clearItems,
    getCellClass,
    getColumnName,
    getSheetDiffCount,
    getRowDiff,
} = useExcelDiff()

const { sourceTableRef, targetTableRef, diffBarRef, syncScroll } = useScrollSync(viewMode)

const scrollToCell = (row: number, col: number) => {
    activeCell.value = { row, col }

    requestAnimationFrame(() => {
        if (viewMode.value === 'split') {
            const sourceEl = document.getElementById(`cell-source-${row}-${col}`)
            const targetEl = document.getElementById(`cell-target-${row}-${col}`)
            const diffRowEl = document.getElementById(`diff-row-${row}`)

            sourceEl?.scrollIntoView({ behavior: 'smooth', block: 'center' })
            targetEl?.scrollIntoView({ behavior: 'smooth', block: 'center' })
            diffRowEl?.scrollIntoView({ behavior: 'smooth', block: 'center' })
        } else {
            const unifiedEl = document.getElementById(`cell-unified-${row}-${col}`)
            unifiedEl?.scrollIntoView({ behavior: 'smooth', block: 'center' })
        }
    })
}

const goToNextDiff = () => {
    if (!currentSheetDiff.value || !currentSheetDiff.value.diffs.length) return
    const diffs = currentSheetDiff.value.diffs
    const currentIndex = activeCell.value ? diffs.findIndex(d => d.row === activeCell.value?.row && d.col === activeCell.value?.col) : -1
    const nextIndex = (currentIndex + 1) % diffs.length
    const nextDiff = diffs[nextIndex]
    scrollToCell(nextDiff.row, nextDiff.col)
}
</script>

<template>
    <div class="excel-root flex flex-col h-full overflow-hidden">
        <!-- ── Top Toolbar ─────────────────────────────────────── -->
        <div
            class="h-14 border-b border-[var(--color-border)] bg-[var(--color-background)] flex items-center justify-between px-5 flex-shrink-0 z-30 shadow-sm relative w-full">
            <div class="flex items-center gap-3">
                <div class="flex items-center gap-2 transition-opacity"
                    :class="{ 'opacity-50 pointer-events-none': !bothLoaded }">
                    <ZBadge variant="surface" size="lg">{{ t('sheet') }}</ZBadge>
                    <ZSelect v-model="selectedSheetName" :options="sheetOptions" class="min-w-[140px]"
                        :disabled="!bothLoaded" />
                </div>

                <div class="h-4 w-px bg-[var(--color-border)] mx-1"></div>

                <div class="flex items-center gap-2">
                    <div class="flex bg-[var(--color-surface)] rounded-md border border-[var(--color-border)] p-1 shadow-sm transition-opacity"
                        :class="{ 'opacity-50 pointer-events-none': !bothLoaded }">
                        <ZButton :variant="viewMode === 'split' ? 'primary' : 'surface'" size="sm"
                            @click="viewMode = 'split'" class="!rounded-md mx-1">
                            <ZIcon name="split" :size="14" />
                            {{ t('viewSplit') }}
                        </ZButton>
                        <ZButton :variant="viewMode === 'unified' ? 'primary' : 'surface'" size="sm"
                            @click="viewMode = 'unified'" class="!rounded-md mx-1">
                            <ZIcon name="unified" :size="14" />
                            {{ t('viewUnified') }}
                        </ZButton>
                    </div>
                </div>

                <div class="h-4 w-px bg-[var(--color-border)] mx-1"
                    v-if="currentSheetDiff && currentSheetDiff.diffs.length"></div>

                <div class="flex items-center gap-1" v-if="currentSheetDiff && currentSheetDiff.diffs.length">
                    <ZBadge variant="primary" size="lg"
                        class="cursor-pointer hover:brightness-110 active:scale-95 transition-all select-none"
                        @click="goToNextDiff(); showDiffPanel = true">
                        {{ currentSheetDiff.diffs.length }} {{ t('cellDiff') }}
                    </ZBadge>
                </div>
            </div>

            <div class="flex items-center gap-2">
                <ZTooltip :content="t('clearItems')">
                    <ZButton variant="danger" size="sm" @click="clearItems"
                        :disabled="!sourceWorkbook && !targetWorkbook">
                        <ZIcon name="trash" :size="14" />
                        {{ t('clearItems') }}
                    </ZButton>
                </ZTooltip>
            </div>
        </div>

        <!-- ── Main Workspace ──────────────────────────────────── -->
        <div class="flex-1 overflow-hidden relative bg-[var(--color-surface)]">

            <!-- DROPZONES -->
            <div v-if="!bothLoaded" class="h-full flex gap-4 p-5">
                <FileDropzone side="source" :title="t('excelSource')" :hint="t('uploadExcel')"
                    :is-ready="!!sourceWorkbook" accept=".xlsx,.xls,.csv" @change="handleFile($event, 'source')">
                    <template #icon>
                        <ZIcon name="excel" :size="28" />
                    </template>
                </FileDropzone>
                <FileDropzone side="target" :title="t('excelTarget')" :hint="t('uploadExcel')"
                    :is-ready="!!targetWorkbook" accept=".xlsx,.xls,.csv" @change="handleFile($event, 'target')">
                    <template #icon>
                        <ZIcon name="excel" :size="28" />
                    </template>
                </FileDropzone>
            </div>

            <!-- NATIVE GRID VIEW -->
            <div v-else-if="currentSheetDiff" class="h-full flex flex-col overflow-hidden">
                <div class="flex-1 flex overflow-hidden bg-[var(--color-background)]">

                    <!-- UNIFIED VIEW -->
                    <div v-if="viewMode === 'unified'" ref="unifiedTableRef"
                        class="flex-1 overflow-auto native-grid custom-scrollbar">
                        <table class="excel-table">
                            <thead>
                                <tr>
                                    <th class="corner-header"></th>
                                    <th v-for="c in currentSheetDiff.colCount" :key="'h-' + c" class="col-header"
                                        :class="{ 'col-header--active': activeCell?.col === (c - 1) }">
                                        <div class="flex items-center justify-center gap-1.5 px-2 h-full">
                                            <span>{{ getColumnName(c - 1) }}</span>
                                            <ZIcon name="chevron-down" :size="8" class="opacity-20" />
                                        </div>
                                    </th>
                                </tr>
                            </thead>
                            <tbody>
                                <tr v-for="r in currentSheetDiff.rowCount" :key="'r-' + r">
                                    <td class="row-header"
                                        :class="{ 'row-header--active': activeCell?.row === (r - 1) }">
                                        {{ r }}
                                    </td>
                                    <td v-for="c in currentSheetDiff.colCount" :key="'c-' + r + '-' + c"
                                        :id="`cell-unified-${r - 1}-${c - 1}`" class="cell-wrapper"
                                        :class="getCellClass(r - 1, c - 1)">
                                        <div class="cell-content">
                                            <template v-if="getCellClass(r - 1, c - 1).includes('cell-modified')">
                                                <div class="val-old">{{ currentSheetDiff.sourceData[r - 1]?.[c - 1] }}
                                                </div>
                                                <div class="val-new">{{ currentSheetDiff.targetData[r - 1]?.[c - 1] }}
                                                </div>
                                            </template>
                                            <template v-else-if="getCellClass(r - 1, c - 1).includes('cell-added')">
                                                <div class="val-new">{{ currentSheetDiff.targetData[r - 1]?.[c - 1] }}
                                                </div>
                                            </template>
                                            <template v-else-if="getCellClass(r - 1, c - 1).includes('cell-removed')">
                                                <div class="val-old">{{ currentSheetDiff.sourceData[r - 1]?.[c - 1] }}
                                                </div>
                                            </template>
                                            <template v-else>
                                                <span class="val-plain">{{ currentSheetDiff.targetData[r - 1]?.[c - 1]
                                                    || currentSheetDiff.sourceData[r - 1]?.[c - 1] }}</span>
                                            </template>
                                        </div>
                                    </td>
                                </tr>
                            </tbody>
                        </table>
                    </div>

                    <!-- SPLIT VIEW -->
                    <template v-else>
                        <div ref="sourceTableRef"
                            class="flex-1 overflow-auto border-r border-[var(--color-border)] native-grid custom-scrollbar"
                            @scroll="syncScroll">
                            <table class="excel-table">
                                <thead>
                                    <tr>
                                        <th class="corner-header"></th>
                                        <th v-for="c in currentSheetDiff.colCount" :key="'shl-' + c" class="col-header"
                                            :class="{ 'col-header--active': activeCell?.col === (c - 1) }">
                                            <div class="flex items-center justify-center gap-1.5 px-2 h-full">
                                                <span>{{ getColumnName(c - 1) }}</span>
                                                <ZIcon name="chevron-down" :size="8" class="opacity-20" />
                                            </div>
                                        </th>
                                    </tr>
                                </thead>
                                <tbody>
                                    <tr v-for="r in currentSheetDiff.rowCount" :key="'srl-' + r">
                                        <td class="row-header"
                                            :class="{ 'row-header--active': activeCell?.row === (r - 1) }">
                                            {{ r }}
                                        </td>
                                        <td v-for="c in currentSheetDiff.colCount" :key="'sc-' + r + '-' + c"
                                            :id="`cell-source-${r - 1}-${c - 1}`" class="cell-wrapper"
                                            :class="getCellClass(r - 1, c - 1, 'source')">
                                            <div class="cell-content">
                                                <span class="val-plain">{{ currentSheetDiff.sourceData[r - 1]?.[c - 1]
                                                    }}</span>
                                            </div>
                                        </td>
                                    </tr>
                                </tbody>
                            </table>
                        </div>

                        <!-- ── CENTRAL DIFF BAR ─────────────────── -->
                        <div ref="diffBarRef"
                            class="w-16 bg-[var(--color-surface)] border-x border-[var(--color-border)] overflow-hidden flex flex-col no-scrollbar shadow-[0_0_15px_-3px_rgba(0,0,0,0.05)] z-10"
                            @scroll="syncScroll">
                            <div
                                class="h-8 border-b border-[var(--color-border)] flex items-center justify-center bg-[var(--color-background)] flex-shrink-0 text-[10px] font-bold text-[var(--color-secondary)] uppercase tracking-tighter sticky top-0 z-40 shadow-sm">
                                {{ t('diffResult') || 'Diff' }}
                            </div>
                            <div class="flex-1 py-1">
                                <div v-for="r in currentSheetDiff.rowCount" :key="'db-' + r" :id="`diff-row-${r - 1}`"
                                    class="h-6 flex items-center justify-center relative">

                                    <!-- Connection Lines (Optional styling purely for visual flow) -->
                                    <div v-if="getRowDiff(r - 1)"
                                        class="absolute left-0 right-0 h-px bg-current opacity-10"
                                        :class="`text-${getRowDiff(r - 1)?.type === 'modified' ? 'yellow-500' : (getRowDiff(r - 1)?.type === 'added' ? 'emerald-500' : 'red-500')}`">
                                    </div>

                                    <ZTooltip v-if="getRowDiff(r - 1)" position="top">
                                        <div class="diff-icon-wrapper relative z-10" :class="[
                                            'diff-icon--' + getRowDiff(r - 1)?.type,
                                            activeCell?.row === (r - 1) ? 'diff-icon--active' : ''
                                        ]" @click="scrollToCell(r - 1, getRowDiff(r - 1)?.col || 0)">
                                            <template v-if="getRowDiff(r - 1)?.type === 'modified'">
                                                <ZIcon name="edit" :size="14" />
                                            </template>
                                            <template v-else-if="getRowDiff(r - 1)?.type === 'added'">
                                                <ZIcon name="plus" :size="14" />
                                            </template>
                                            <template v-else-if="getRowDiff(r - 1)?.type === 'removed'">
                                                <ZIcon name="minus" :size="14" />
                                            </template>
                                        </div>
                                        <template #content>
                                            <div class="p-1 px-2 text-xs">
                                                <div class="font-bold mb-1 opacity-70">
                                                    {{ getRowDiff(r - 1)?.type === 'modified' ? t('modified') :
                                                        (getRowDiff(r - 1)?.type === 'added' ? t('added') : t('removed')) }}
                                                </div>
                                                <div class="flex items-center gap-2 whitespace-nowrap">
                                                    <span v-if="getRowDiff(r - 1)?.source"
                                                        class="text-red-400 line-through">{{ getRowDiff(r - 1)?.source
                                                        }}</span>
                                                    <ZIcon v-if="getRowDiff(r - 1)?.type === 'modified'"
                                                        name="arrow-right" :size="10" />
                                                    <span v-if="getRowDiff(r - 1)?.target"
                                                        class="text-green-400 font-bold">{{ getRowDiff(r - 1)?.target
                                                        }}</span>
                                                </div>
                                                <div class="mt-1 text-[10px] opacity-50">{{ getRowDiff(r - 1)?.address
                                                }}
                                                </div>
                                            </div>
                                        </template>
                                    </ZTooltip>
                                </div>
                            </div>
                        </div>

                        <div ref="targetTableRef" class="flex-1 overflow-auto native-grid custom-scrollbar"
                            @scroll="syncScroll">
                            <table class="excel-table">
                                <thead>
                                    <tr>
                                        <th class="corner-header"></th>
                                        <th v-for="c in currentSheetDiff.colCount" :key="'shr-' + c" class="col-header">
                                            {{ getColumnName(c - 1) }}
                                        </th>
                                    </tr>
                                </thead>
                                <tbody>
                                    <tr v-for="r in currentSheetDiff.rowCount" :key="'srr-' + r">
                                        <td class="row-header">{{ r }}</td>
                                        <td v-for="c in currentSheetDiff.colCount" :key="'tc-' + r + '-' + c"
                                            :id="`cell-target-${r - 1}-${c - 1}`" class="cell-wrapper"
                                            :class="getCellClass(r - 1, c - 1, 'target')">
                                            <div class="cell-content">
                                                <span class="val-plain">{{ currentSheetDiff.targetData[r - 1]?.[c - 1]
                                                    }}</span>
                                            </div>
                                        </td>
                                    </tr>
                                </tbody>
                            </table>
                        </div>
                    </template>
                </div>

                <!-- ── DIFFERENCE PANEL SIDEBAR ─────────────────── -->
                <transition name="slide-right">
                    <div v-if="showDiffPanel"
                        class="absolute right-0 top-0 bottom-0 w-80 bg-[var(--color-surface)] border-l border-[var(--color-border)] z-40 shadow-2xl flex flex-col">
                        <div
                            class="h-12 flex items-center justify-between px-4 border-b border-[var(--color-border)] bg-[var(--color-background)]">
                            <h3 class="font-bold text-sm">{{ t('cellDiff') }}</h3>
                            <ZButton variant="ghost" size="icon-sm" @click="showDiffPanel = false">
                                <ZIcon name="x" :size="16" />
                            </ZButton>
                        </div>
                        <div class="flex-1 overflow-y-auto custom-scrollbar p-2 space-y-1">
                            <div v-for="(diff, idx) in currentSheetDiff?.diffs" :key="idx"
                                class="p-3 rounded-lg border border-transparent hover:border-[var(--color-border)] hover:bg-[var(--color-background)] cursor-pointer group transition-all"
                                :class="{ 'diff-item--active': activeCell?.row === diff.row && activeCell?.col === diff.col }"
                                @click="scrollToCell(diff.row, diff.col)">
                                <div class="flex items-center justify-between mb-2">
                                    <span
                                        class="text-[10px] font-mono font-bold px-1.5 py-0.5 rounded bg-[var(--color-surface)] text-[var(--color-secondary)] border border-[var(--color-border)]">{{
                                            diff.address }}</span>
                                    <ZBadge
                                        :variant="getCellClass(diff.row, diff.col).includes('cell-added') ? 'success' : (getCellClass(diff.row, diff.col).includes('cell-removed') ? 'danger' : 'primary')"
                                        size="sm">
                                        {{ getCellClass(diff.row, diff.col).replace('cell-', '')
                                            .replace('cell--active',
                                                '').toUpperCase() }}
                                    </ZBadge>
                                </div>
                                <div class="grid grid-cols-[1fr,auto,1fr] items-center gap-2">
                                    <div class="text-xs truncate opacity-60 line-through" v-if="diff.source">{{
                                        diff.source }}</div>
                                    <div class="text-xs truncate italic opacity-40 mx-auto" v-else>Empty</div>

                                    <ZIcon name="arrow-right" :size="10" class="opacity-30" />

                                    <div class="text-xs truncate font-bold" v-if="diff.target">{{ diff.target }}</div>
                                    <div class="text-xs truncate italic opacity-40" v-else>Empty</div>
                                </div>
                            </div>
                        </div>
                    </div>
                </transition>
                <!-- ── BOTTOM SHEET TABS ────────────────────────────── -->
                <div
                    class="h-9 bg-[#f3f3f3] dark:bg-[#2a2a2a] border-t border-[var(--color-border)] flex items-center px-1 overflow-hidden flex-shrink-0">
                    <div class="flex h-full items-end gap-px overflow-x-auto no-scrollbar">
                        <button v-for="sheet in diffResult" :key="sheet.name" class="sheet-tab"
                            :class="{ 'sheet-tab--active': selectedSheetName === sheet.name }"
                            @click="selectedSheetName = sheet.name">
                            <span class="sheet-tab-name">{{ sheet.name }}</span>
                            <span v-if="getSheetDiffCount(sheet.name)" class="sheet-diff-dot"></span>
                        </button>
                    </div>
                </div>

                <!-- Footer Legend -->
                <DiffLegend :items="[
                    { label: t('cellOriginal'), swatchClass: 'bg-[#fff5f5] border border-[#ffc9c9] dark:bg-[#3b1d1d] dark:border-[#555]' },
                    { label: t('cellModified'), swatchClass: 'bg-[#ebfbee] border border-[#b2f2bb] dark:bg-[#1b3121] dark:border-[#555]' },
                    { label: 'Changed', swatchClass: 'bg-[#fff9db] border border-[#ffec99] dark:bg-[#3e3810] dark:border-[#555]' }
                ]" />
            </div>
        </div>
    </div>
</template>

<style scoped lang="scss">
.excel-root {
    background: var(--color-background);
    font-family: var(--font-family, Inter, system-ui, sans-serif);
}

/* ── ZTools Modern Grid ───────────────────────────── */
.native-grid {
    position: relative;
    background: var(--color-background);
}

.excel-table {
    border-spacing: 0;
    border-collapse: separate;
    table-layout: fixed;
    width: max-content;
}

.corner-header {
    position: sticky;
    top: 0;
    left: 0;
    z-index: 45;
    width: 48px;
    height: 36px;
    background: var(--color-surface);
    border-right: 1px solid var(--color-border);
    border-bottom: 1px solid var(--color-border);
}

.col-header {
    position: sticky;
    top: 0;
    z-index: 25;
    height: 36px;
    min-width: 120px;
    background: var(--color-surface);
    border-right: 1px solid var(--color-border);
    border-bottom: 1px solid var(--color-border);
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--color-secondary);
    text-align: center;
    transition: all 0.2s;

    &--active {
        background: var(--color-cta-faded);
        color: var(--color-cta);
        border-bottom: 2px solid var(--color-cta);
    }
}

.row-header {
    position: sticky;
    left: 0;
    z-index: 25;
    width: 48px;
    background: var(--color-surface);
    border-right: 1px solid var(--color-border);
    border-bottom: 1px solid var(--color-border);
    font-size: 10px;
    font-weight: 500;
    color: var(--color-secondary);
    text-align: center;
    transition: all 0.2s;

    &--active {
        background: var(--color-cta-faded);
        color: var(--color-cta);
        border-right: 2px solid var(--color-cta);
    }
}

.cell-wrapper {
    padding: 0;
    border-right: 1px dotted var(--color-border);
    border-bottom: 1px dotted var(--color-border);
    min-width: 120px;
    height: 48px;
    background: transparent;
    transition: all 0.2s;

    &:hover {
        background: var(--color-surface);
    }
}

.cell-content {
    height: 100%;
    display: flex;
    flex-direction: column;
    justify-content: center;
    padding: 6px 12px;
    font-size: 13px;
    color: var(--color-text);
    overflow: hidden;
}

/* ── Diff States ──────────────────────────── */
.cell-modified {
    background: color-mix(in srgb, var(--color-warning) 10%, transparent) !important;
}

.cell-added {
    background: var(--color-insert-bg) !important;
}

.cell-removed {
    background: var(--color-delete-bg) !important;
}

.cell--active {
    position: relative;
    box-shadow: inset 0 0 0 2px var(--color-cta) !important;
    z-index: 30;
    background: var(--color-cta-faded) !important;
}

.val-old {
    color: var(--color-danger);
    text-decoration: line-through;
    font-size: 11px;
    opacity: 0.7;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}

.val-new {
    color: var(--color-success);
    font-weight: 600;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}

.val-plain {
    opacity: 0.9;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}

/* ── Side Labels ───────────────────────────── */
.side-label {
    position: sticky;
    top: 36px;
    left: 48px;
    z-index: 40;
    font-size: 10px;
    font-weight: 700;
    padding: 4px 12px;
    border-radius: 0 0 8px 0;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-top: none;
    border-left: none;
    backdrop-filter: blur(8px);
}

.source-label {
    color: var(--color-danger);
}

.target-label {
    color: var(--color-success);
}

/* ── Diff Bar ──────────────────────────────────────── */
.diff-icon-wrapper {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    border-radius: 8px;
    transition: all 0.2s cubic-bezier(0.175, 0.885, 0.32, 1.275);
    cursor: pointer;
}

.diff-icon--modified {
    color: #eab308;
    background-color: rgba(234, 179, 8, 0.1);
}

.diff-icon--added {
    color: #10b981;
    background-color: rgba(16, 185, 129, 0.1);
}

.diff-icon--removed {
    color: #ef4444;
    background-color: rgba(239, 68, 68, 0.1);
}

.diff-icon--active {
    transform: scale(1.15);
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
}

.diff-icon--active.diff-icon--modified {
    background-color: #eab308;
    color: white !important;
}

.diff-icon--active.diff-icon--added {
    background-color: #10b981;
    color: white !important;
}

.diff-icon--active.diff-icon--removed {
    background-color: #ef4444;
    color: white !important;
}

.dark .diff-icon--active.diff-icon--modified,
.dark .diff-icon--active.diff-icon--added,
.dark .diff-icon--active.diff-icon--removed {
    color: #111 !important;
}

.diff-icon-wrapper:hover:not(.diff-icon--active) {
    transform: scale(1.1);
    filter: brightness(1.2);
}

/* ── Sheet Tabs ────────────────────────────────────── */
.sheet-tab {
    height: 100%;
    display: flex;
    align-items: center;
    padding: 0 24px;
    background: transparent;
    border: none;
    cursor: pointer;
    font-size: 13px;
    font-weight: 500;
    color: var(--color-secondary);
    position: relative;
    transition: all 0.2s;

    &:hover {
        color: var(--color-text);
        background: var(--color-surface);
    }

    &--active {
        color: var(--color-cta);
        font-weight: 700;

        &::after {
            content: '';
            position: absolute;
            bottom: 0;
            left: 20%;
            right: 20%;
            height: 3px;
            background: var(--color-cta);
            border-radius: 3px 3px 0 0;
        }
    }
}

.sheet-diff-dot {
    width: 6px;
    height: 6px;
    background: var(--color-danger);
    border-radius: 50%;
    margin-left: 8px;
}

.custom-scrollbar {
    &::-webkit-scrollbar {
        width: 6px;
        height: 6px;
    }

    &::-webkit-scrollbar-track {
        background: transparent;
    }

    &::-webkit-scrollbar-thumb {
        background: var(--color-border);
        border-radius: 10px;

        &:hover {
            background: var(--color-secondary);
        }
    }
}

.no-scrollbar::-webkit-scrollbar {
    display: none;
}

/* ── Transitions & Specific Highlights ─────────── */
.slide-right-enter-active,
.slide-right-leave-active {
    transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1);
}

.slide-right-enter-from,
.slide-right-leave-to {
    transform: translateX(100%);
}

.diff-item--active {
    border-color: var(--color-cta) !important;
    background: var(--color-cta-faded) !important;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.05);
}
</style>
