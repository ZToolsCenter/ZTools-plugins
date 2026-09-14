<template>
  <main class="ocr-shell">
    <div class="engine-selector">
      <span class="engine-label">引擎</span>
      <div class="engine-tabs">
        <button
          v-for="tab in engineTabs"
          :key="tab.id"
          type="button"
          class="engine-tab"
          :class="{ active: engine === tab.id, pending: tab.pending }"
          :disabled="tab.disabled"
          :title="tab.title"
          @click="engine = tab.id"
        >{{ tab.label }}<span v-if="tab.badge" class="engine-tab-badge">{{ tab.badge }}</span></button>
      </div>
      <span class="actions-spacer"></span>
      <button
        type="button"
        class="mini-button mem-release"
        title="识别后 ONNX 模型常驻内存（免 2-4s 冷启动）；点此立即释放，下次识别自动重启"
        @click="releaseOnnxServers"
      >释放内存</button>
    </div>

    <section class="workbench">
      <section
        class="preview-pane"
        :class="{ dragging: isDragging }"
        @dragenter.prevent="isDragging = true"
        @dragover.prevent
        @dragleave.prevent="isDragging = false"
        @drop.prevent="onDrop"
      >
        <div class="preview-stage-area">
        <div v-if="!previewSrc" class="empty-state">
          <div class="empty-icon">▧</div>
          <div class="empty-title">选择图片或截图</div>
          <div class="empty-subtitle">支持 png、jpg、webp、bmp、tiff</div>
        </div>
        <div v-else ref="stageRef" class="preview-stage" @wheel.prevent="onStageWheel" @dblclick="resetZoom">
          <div
            class="preview-transform"
            :style="{ transform: `translate(${panX}px, ${panY}px) scale(${zoom})` }"
          >
            <img ref="previewImageRef" class="preview-image" :src="previewSrc" alt="待识别图片" :style="previewImageStyle" @pointerdown="beginPan" @load="computePreviewFit">
            <div v-if="engine === 'mixed' && (mixedFormulaSegments.length || mixedExcludedBoxes.length)" class="mixed-overlay" @mouseleave="activeMixedIndex = -1">
              <div
                v-for="(seg, i) in mixedFormulaSegments"
                :key="`mixed-box-${i}`"
                class="mixed-box"
                :class="[seg.type, { active: activeMixedIndex === seg.index, resizing: formulaResizing && formulaResizing.mode === 'mixed' && formulaResizing.index === i }]"
                :style="formulaResizing && formulaResizing.mode === 'mixed' && formulaResizing.index === i ? mixedBoxStyle(formulaResizeBox) : mixedBoxStyle(seg.box)"
                :title="`#${seg.index} ${seg.type}${seg.latex ? ' · ' + seg.latex : ''}（拖角点调整框大小，点击排除）`"
                @click="toggleMixedExclude(seg)"
              >{{ i }}<template v-if="!mixedExcludedKeys.has(boxKey(seg.box))">
                <span
                  v-for="corner in ['nw', 'ne', 'sw', 'se']"
                  :key="`mhandle-${i}-${corner}`"
                  class="formula-resize-handle"
                  :class="`corner-${corner}`"
                  @pointerdown.stop.prevent="startResize($event, 'mixed', seg, corner)"
                ></span>
              </template></div>
              <div
                v-for="(b, i) in mixedExcludedBoxes"
                :key="`mixed-excl-${i}`"
                class="mixed-box excluded"
                :style="mixedBoxStyle(b.box)"
                :title="`已排除 · ${b.type}（点击恢复）`"
                @click="toggleMixedExclude(b)"
              >{{ i }}</div>
            </div>
            <div v-if="engine === 'formula' && formulaItems.length" class="formula-overlay" :class="{ 'busy': formulaMultiBusy }" @mouseleave="activeFormulaIndex = -1">
              <div
                v-for="(item, i) in formulaItems"
                :key="`fbox-${i}`"
                class="formula-box"
                :class="[item.type, { active: activeFormulaIndex === i, excluded: item.excluded, resizing: formulaResizing && formulaResizing.mode === 'formula' && formulaResizing.index === i }]"
                :style="formulaResizing && formulaResizing.mode === 'formula' && formulaResizing.index === i ? formulaBoxStyle(formulaResizeBox) : formulaBoxStyle(item.box)"
                :title="`#${i} ${item.type === 'isolated' ? '独立' : '行内'}${item.excluded ? ' · 已排除（点击恢复）' : ''}${item.latex ? ' · ' + item.latex : ''}${item.excluded ? '' : '（拖角点调整框大小，拖框体平移，点击排除）'}`"
                @click="toggleFormulaExclude(item)"
                @mouseenter="activeFormulaIndex = formulaItemIndex(item)"
                @pointerdown="startFormulaMove($event, item)"
              >{{ i }}<template v-if="!item.excluded">
                <span
                  v-for="corner in ['nw', 'ne', 'sw', 'se']"
                  :key="`fhandle-${i}-${corner}`"
                  class="formula-resize-handle"
                  :class="`corner-${corner}`"
                  @pointerdown.stop.prevent="startResize($event, 'formula', item, corner)"
                ></span>
              </template></div>
            </div>
            <div v-if="tableOverlayVisible" class="table-overlay interactive">
              <span
                v-for="(top, i) in tableRowLines"
                :key="`row-${i}`"
                class="overlay-line row-line"
                :style="{ top: `${top}%` }"
                title="拖动调整行分界 · 双击删除"
                @pointerdown.stop.prevent="beginSepDrag($event, 'row', i)"
                @dblclick.stop="removeSep('row', i)"
              ></span>
              <span
                v-for="(left, i) in tableColLines"
                :key="`col-${i}`"
                class="overlay-line col-line"
                :style="{ left: `${left}%` }"
                title="拖动调整列分界 · 双击删除"
                @pointerdown.stop.prevent="beginSepDrag($event, 'col', i)"
                @dblclick.stop="removeSep('col', i)"
              ></span>
            </div>
          </div>
        </div>
        </div>
        <div v-if="previewDockVisible" class="preview-dock">
          <template v-if="engine === 'formula' && mfdReady">
            <div class="cluster-row">
              <span class="cluster-slider-label">框外扩</span>
              <input
                v-model.number="formulaBoxPad"
                class="cluster-range"
                type="range"
                min="0"
                max="40"
                step="1"
                title="扩大标记框可让公式引擎看到更完整的上下文，提升识别率；过大可能裹入邻近文字"
                @change="rerunFormulaMultiWithSelection"
              >
              <span class="cluster-slider-value">{{ formulaBoxPad }}px</span>
            </div>
            <div class="cluster-row">
              <span class="cluster-slider-label">检测阈值</span>
              <input
                v-model.number="formulaConf"
                class="cluster-range"
                type="range"
                min="0.25"
                max="0.9"
                step="0.05"
                title="数值越小检测越灵敏，但易把普通字母误判为公式；误检时调大数值"
                @change="rerunFormulaMulti"
              >
              <span class="cluster-slider-value">{{ formulaConf.toFixed(2) }}</span>
            </div>
          </template>
          <template v-else-if="engine === 'mixed' && mfdReady">
            <div class="cluster-row">
              <span class="cluster-slider-label">框外扩</span>
              <input
                v-model.number="mixedBoxPad"
                class="cluster-range"
                type="range"
                min="0"
                max="40"
                step="1"
                title="扩大标记框可让公式引擎看到更完整的上下文，提升识别率；过大可能裹入邻近文字"
                @change="rerunMixedWithPad"
              >
              <span class="cluster-slider-value">{{ mixedBoxPad }}px</span>
            </div>
            <div class="cluster-row">
              <span class="cluster-slider-label">检测阈值</span>
              <input
                v-model.number="mixedConf"
                class="cluster-range"
                type="range"
                min="0.25"
                max="0.9"
                step="0.05"
                title="数值越小检测越灵敏，但易把普通字母误判为公式；误检时调大数值"
                @change="rerunMixedWithPad"
              >
              <span class="cluster-slider-value">{{ mixedConf.toFixed(2) }}</span>
            </div>
            <button type="button" class="mini-button" :disabled="detectLoading || !previewSrc" @click="detectMixedOnly">仅检测公式区域</button>
          </template>
          <template v-else-if="tableAvailable">
            <button type="button" class="mini-button" title="在最大空隙处插入一条行分界线" @click="addSep('row')">+ 行线</button>
            <button type="button" class="mini-button" title="在最大空隙处插入一条列分界线" @click="addSep('col')">+ 列线</button>
            <button v-if="manualSepsActive" type="button" class="mini-button" title="恢复自动聚类结果" @click="resetSeps">重置</button>
            <div class="cluster-row">
              <span class="cluster-slider-label">阈值</span>
              <input
                v-model.number="clusterFactor"
                class="cluster-range"
                type="range"
                min="0.2"
                max="1.5"
                step="0.05"
                title="拖动调整行列聚类阈值，实时重算表格（会覆盖手动分隔线）"
              >
              <span class="cluster-slider-value">{{ clusterFactor.toFixed(2) }}×</span>
            </div>
          </template>
          <template v-else-if="engine === 'formula' && formulaReady && !mfdReady && !formulaMfdHintDismissed">
            <div class="mfd-hint-banner">
              <div class="mfd-hint-text">安装 MFD 检测模型（约 80MB）后，可自动框选图片中的多个公式</div>
              <button
                type="button"
                class="mini-button mfd-hint-download"
                :disabled="mfdDownloading || mfdMessage"
                @click="startMfdDownload"
              >{{ mfdMessage ? '下载中…' : '下载' }}</button>
              <button
                type="button"
                class="mfd-hint-close"
                title="不再提示"
                @click="formulaMfdHintDismissed = true"
              >×</button>
            </div>
            <div v-if="mfdMessage" class="mfd-hint-progress">{{ mfdMessage }}</div>
          </template>
        </div>
        <div v-if="batchActive" class="batch-panel">
          <div class="batch-head">
            <span class="batch-title">批量识别 · {{ batchItems.length }} 项</span>
            <span class="actions-spacer"></span>
            <button type="button" class="mini-button" :disabled="!batchMergedText" @click="copyBatchText">复制全部</button>
            <button type="button" class="mini-button" :disabled="!batchMergedText" @click="exportBatchTxt">导出 TXT</button>
            <button type="button" class="mini-button" :disabled="batchRunning" @click="closeBatch">关闭</button>
          </div>
          <ul class="batch-list">
            <li v-for="item in batchItems" :key="item.id" class="batch-item">
              <span class="batch-status" :class="item.status">{{ batchStatusLabel(item.status) }}</span>
              <span class="batch-name" :title="item.error || item.name">{{ item.name }}</span>
            </li>
          </ul>
        </div>
        <div v-if="runtimeOverlayVisible" class="runtime-mask">
          <span v-if="runtimeBusy" class="spinner"></span>
          <div class="runtime-title">{{ runtimeTitle }}</div>
          <div class="runtime-message">{{ runtimeMessage }}</div>
          <div v-if="runtimeProgressVisible" class="runtime-progress">
            <div class="runtime-progress-bar" :style="{ width: `${runtimeProgress.percent}%` }"></div>
          </div>
          <div v-if="runtimeProgressVisible" class="runtime-progress-text">{{ runtimeProgressText }}</div>
          <button
            v-if="runtimeCanDownload"
            type="button"
            class="runtime-download-button"
            @click="startRuntimeDownload"
          >
            {{ runtimeButtonText }}
          </button>
        </div>
        <div v-if="engine === 'rapidocr' && !onnxReady" class="runtime-mask">
          <span v-if="onnxDownloading" class="spinner"></span>
          <div class="runtime-title">{{ onnxDownloading ? '正在下载 ONNX OCR 引擎' : 'ONNX OCR 引擎未下载' }}</div>
          <div class="runtime-message">
            {{ onnxMessage || '内置 PP-OCR v4 引擎（约 60MB，一次性下载），无需 Python，双端通用，支持表格识别' }}
          </div>
          <button
            v-if="!onnxDownloading"
            type="button"
            class="runtime-download-button"
            @click="startOnnxDownload"
          >下载 ONNX OCR 引擎</button>
        </div>
        <div v-if="engine === 'formula' && !formulaReady" class="runtime-mask">
          <span v-if="formulaDownloading" class="spinner"></span>
          <div class="runtime-title">{{ formulaDownloading ? '正在下载公式识别模型' : '公式识别模型未下载' }}</div>
          <div class="runtime-message">
            {{ formulaMessage || '内置 RapidLaTeXOCR 引擎（约 171MB，一次性下载），将公式图片识别为 LaTeX 代码' }}
          </div>
          <button
            v-if="!formulaDownloading"
            type="button"
            class="runtime-download-button"
            @click="startFormulaDownload"
          >下载公式识别模型</button>
        </div>
        <div v-if="engine === 'mixed' && !mfdReady" class="runtime-mask">
          <span v-if="mfdDownloading" class="spinner"></span>
          <div class="runtime-title">{{ mfdDownloading ? '正在下载图文混排模型' : '图文混排模型未下载' }}</div>
          <div class="runtime-message">
            {{ mfdMessage || '内置 MFD 公式检测模型（约 80MB，一次性下载），与 ONNX 引擎、公式识别模型配合使用' }}
          </div>
          <button
            v-if="!mfdDownloading"
            type="button"
            class="runtime-download-button"
            @click="startMfdDownload"
          >下载图文混排模型 (约 80MB)</button>
        </div>
        <div v-if="loading" class="busy-mask">
          <span class="spinner"></span>
          <span>{{ loadingMessage }}</span>
          <span v-if="isFirstRunLoading && engine === 'wechat'" class="loading-note">首次使用需要初始化 OCR 模型</span>
        </div>
      </section>

      <section class="result-pane">
        <div class="result-header">
          <div class="view-tabs">
            <button
              type="button"
              class="view-tab"
              :class="{ active: resultView === 'text' }"
              @click="setResultView('text')"
            >文本</button>
            <button
              type="button"
              class="view-tab"
              :class="{ active: resultView === 'table' }"
              :disabled="!tableAvailable"
              @click="setResultView('table')"
            >表格</button>
          </div>

          <label
            class="toggle table-toggle"
            :class="{ 'is-disabled': !tableCapable }"
            :title="tableCapable ? '' : '表格识别需系统 OCR 或 ONNX OCR 引擎'"
            @click="onTableModeToggle"
          >
            <input v-model="tableMode" type="checkbox" :disabled="!tableCapable">
            <span class="switch"></span>
            <span>识别为表格</span>
          </label>

          <div class="result-actions">
            <select v-model="translateTarget" class="lang-select" title="翻译目标语言">
              <option value="">自动目标语言</option>
              <option value="zh">中文</option>
              <option value="en">English</option>
              <option value="ja">日本語</option>
              <option value="ko">한국어</option>
              <option value="fr">Français</option>
              <option value="de">Deutsch</option>
              <option value="es">Español</option>
              <option value="ru">Русский</option>
            </select>
            <button
              type="button"
              class="mini-button"
              :disabled="translating || (!rawResultText && !translatedText)"
              @click="toggleTranslate"
            >{{ translating ? '翻译中' : translationActive ? '原文' : '翻译' }}</button>
            <template v-if="engine === 'formula' && rawResultText">
              <button
                type="button"
                class="mini-button"
                title="行内公式 $…$"
                @click="copyFormula('inline')"
              >$…$ 复制</button>
              <button
                type="button"
                class="mini-button"
                title="块级公式 $$…$$"
                @click="copyFormula('block')"
              >$$…$$ 复制</button>
              <button
                type="button"
                class="mini-button"
                title="原生 LaTeX \(…\)"
                @click="copyFormula('native')"
              >\(…\) 复制</button>
            </template>
            <div class="history-wrap">
              <button
                type="button"
                class="mini-button"
                :class="{ active: historyOpen }"
                @click="historyOpen = !historyOpen"
              >
                <span>历史</span>
                <span v-if="history.length" class="history-badge">{{ history.length }}</span>
              </button>
              <transition name="history">
                <div v-if="historyOpen" class="history-panel">
                  <div class="history-head">
                    <span class="history-title">识别历史</span>
                    <input
                      v-model="historySearch"
                      class="history-search"
                      type="text"
                      placeholder="搜索历史文本…"
                      spellcheck="false"
                    >
                    <button
                      type="button"
                      class="mini-button"
                      :disabled="!displayHistory.length"
                      @click="exportHistoryTxt"
                    >导出 TXT</button>
                    <button
                      type="button"
                      class="mini-button danger"
                      :disabled="!history.length"
                      @click="clearHistory"
                    >清空历史</button>
                  </div>
                  <div v-if="!history.length" class="history-empty">暂无识别历史</div>
                  <div v-else-if="!displayHistory.length" class="history-empty">无匹配结果</div>
                  <ul v-else class="history-list">
                    <li
                      v-for="item in displayHistory"
                      :key="item.id"
                      class="history-item"
                      @click="applyHistoryItem(item)"
                    >
                      <img v-if="item.thumb" class="history-thumb" :src="item.thumb" alt="">
                      <div class="history-item-main">
                        <div class="history-item-meta">
                          <span class="history-engine">{{ engineLabel(item.engine) }}</span>
                          <span class="history-time">{{ formatHistoryTime(item.ts) }}</span>
                        </div>
                        <div class="history-item-text">{{ item.text }}</div>
                      </div>
                      <div class="history-item-actions">
                        <button
                          type="button"
                          class="history-fav"
                          :class="{ on: item.fav }"
                          :title="item.fav ? '取消收藏' : '收藏（置顶）'"
                          @click.stop="toggleHistoryFav(item)"
                        >{{ item.fav ? '★' : '☆' }}</button>
                        <button
                          type="button"
                          class="history-refill"
                          :title="historySourceMap.has(item.id) ? '回填原图并重识别' : '仅用缩略图回看'"
                          @click.stop="refillHistoryImage(item)"
                        >{{ historySourceMap.has(item.id) ? '回填并重识别' : '回填图片' }}</button>
                        <button
                          type="button"
                          class="history-delete"
                          title="删除"
                          @click.stop="deleteHistoryItem(item.id)"
                        >×</button>
                      </div>
                    </li>
                  </ul>
                </div>
              </transition>
            </div>
          </div>
        </div>

        <div class="result-scroll" :class="{ 'fill-mode': formulaMultiActive }">
        <div v-if="engine === 'formula' && rawResultText && !formulaItems.length" class="formula-preview">
          <div class="formula-preview-head">
            <span class="formula-preview-title">公式预览</span>
            <span v-if="formulaAutoFixed" class="formula-preview-fixed" title="识别结果含 LaTeX 语法错误（如双下标），预览已自动容错修复；源码未改动">
              已容错修复
            </span>
            <span class="formula-preview-hint">实时渲染 · 改动下方 LaTeX 即时更新</span>
          </div>
          <div v-if="formulaHtml" class="formula-preview-body" v-html="formulaHtml"></div>
          <div v-else class="formula-preview-error">
            <span class="formula-error-badge">渲染失败</span>
            <span class="formula-error-msg">{{ formulaRenderError || 'LaTeX 语法有误，请修正后再试' }}</span>
          </div>
        </div>

        <div v-if="engine === 'formula' && formulaItems.length" class="formula-multi-panel" :class="{ fill: formulaMultiActive }">
          <div class="formula-multi-head">
            <span class="formula-multi-title">多公式 · {{ formulaVisibleItems.length }} 个</span>
            <span v-if="formulaMultiBusy" class="formula-multi-rerun">
              <span class="spinner"></span>重新识别中
            </span>
            <span class="formula-multi-hint">标记框操作已移至左侧预览栏</span>
            <span class="actions-spacer"></span>
            <button
              type="button"
              class="mini-button"
              :disabled="formulaMultiBusy || !formulaMultiJoined"
              @click="copyTextValue(formulaMultiJoined)"
            >复制全部</button>
            <button
              type="button"
              class="mini-button"
              :disabled="!formulaMultiJoined"
              @click="exportFormulaTex"
            >导出 TEX</button>
            <button
              type="button"
              class="mini-button"
              :disabled="!formulaMultiJoined"
              @click="exportFormulaMd"
            >导出 MD</button>
            <div class="copy-menu-wrap">
              <button
                type="button"
                class="mini-button"
                :disabled="!formulaMultiJoined"
                @click="formulaCopyMenuOpen = !formulaCopyMenuOpen"
              >多格式复制 ▾</button>
              <div v-if="formulaCopyMenuOpen" class="copy-menu">
                <button type="button" class="copy-menu-item" @click="copyFormulaMulti('mathml')">MathML(Word 可粘贴)</button>
                <button type="button" class="copy-menu-item" @click="copyFormulaMulti('html')">KaTeX HTML</button>
                <button type="button" class="copy-menu-item" @click="copyFormulaMulti('unicode')">Unicode 纯文本</button>
              </div>
            </div>
            <button
              v-if="hasLowConfidenceItems"
              type="button"
              class="mini-button"
              :disabled="formulaMultiBusy"
              :title="`重识别 ${lowConfidenceItems.length} 个中/低置信公式`"
              @click="rerecognizeLowConfidence"
            >重识别低置信({{ lowConfidenceItems.length }})</button>
          </div>
          <div v-if="excludedFormulaItems.length" class="excluded-chip-row">
            <span class="excluded-chip-label">已排除：</span>
            <button
              v-for="item in excludedFormulaItems"
              :key="`excl-${formulaItems.indexOf(item)}`"
              type="button"
              class="excluded-chip"
              :title="`恢复 #${formulaItems.indexOf(item)}`"
              @click="toggleFormulaExclude(item)"
            >#{{ formulaItems.indexOf(item) }}</button>
            <button type="button" class="mini-button excluded-restore-all" @click="restoreAllExcluded">全部恢复</button>
          </div>
          <div v-if="!formulaVisibleItems.length" class="formula-all-excluded">
            已全部排除，点击图片中的灰色虚线框可恢复
          </div>
          <div v-else class="formula-multi-list">
            <div
              v-for="(item, i) in formulaVisibleItems"
              :key="`frow-${i}`"
              class="formula-multi-row"
              :class="{ active: activeFormulaIndex === formulaItems.indexOf(item) }"
              @mouseenter="activeFormulaIndex = formulaItemIndex(item)"
              @mouseleave="activeFormulaIndex = -1"
            >
              <div class="formula-multi-row-head">
                <span class="formula-multi-index">{{ i }}</span>
                <span class="formula-multi-type" :class="item.type">{{ item.type === 'isolated' ? '独立' : '行内' }}</span>
                <span
                  v-if="formulaScoreLevel(item)"
                  class="formula-conf"
                  :class="formulaScoreLevel(item).cls"
                  :title="formulaScoreLevel(item).tip"
                >{{ formulaScoreLevel(item).label }}</span>
                <button
                  type="button"
                  class="mini-button"
                  @click="toggleFormulaExclude(item)"
                >排除</button>
                <span class="actions-spacer"></span>
                <button
                  type="button"
                  class="mini-button"
                  @click="formulaEditIndex = formulaEditIndex === i ? -1 : i"
                >{{ formulaEditIndex === i ? '收起' : '编辑' }}</button>
                <button
                  type="button"
                  class="mini-button"
                  :disabled="item.rerunning || formulaMultiBusy"
                  @click="rerecognizeFormulaItem(item)"
                >{{ item.rerunning ? '识别中…' : '重识别' }}</button>
                <button
                  type="button"
                  class="mini-button"
                  :disabled="!item.latex"
                  @click="copyTextValue(item.latex)"
                >复制</button>
              </div>
              <div
                v-if="item.latex"
                class="formula-multi-preview"
                title="双击编辑 LaTeX"
                v-html="formulaRowHtml(item)"
                @dblclick="formulaEditIndex = i"
              ></div>
              <div v-else class="formula-multi-empty" title="双击输入 LaTeX" @dblclick="formulaEditIndex = i">未识别出公式</div>
              <template v-if="formulaEditIndex === i">
                <textarea
                  ref="formulaEditInput"
                  v-model="item.latex"
                  class="formula-multi-edit"
                  spellcheck="false"
                  :placeholder="item.latex ? '' : '输入 LaTeX'"
                  @input="item.edited = true"
                  @keydown.esc.stop="formulaEditIndex = -1"
                ></textarea>
                <div class="formula-multi-edit-foot">
                  <button type="button" class="mini-button" @click="formulaEditIndex = -1">完成</button>
                </div>
              </template>
            </div>
          </div>
        </div>

        <div v-if="engine === 'mixed' && mixedSegments.length" class="mixed-panel">
          <div class="mixed-toolbar">
            <div class="view-tabs">
              <button
                type="button"
                class="view-tab"
                :class="{ active: mixedView === 'render' }"
                @click="mixedView = 'render'"
              >渲染</button>
              <button
                type="button"
                class="view-tab"
                :class="{ active: mixedView === 'source' }"
                @click="mixedView = 'source'"
              >源文</button>
            </div>
            <div class="mixed-actions">
              <button type="button" class="mini-button" :disabled="!mixedSegments.length" @click="exportMixedMarkdown">导出 MD</button>
              <button type="button" class="mini-button" :disabled="!mixedSegments.length" @click="exportMixedHtml">导出 HTML</button>
              <button type="button" class="mini-button" :disabled="!mixedSegments.length" @click="exportMixedTxt">导出 TXT</button>
              <button type="button" class="mini-button" :disabled="!mixedSegments.length" @click="exportMixedPng">导出 PNG</button>
              <div class="copy-menu-wrap">
                <button type="button" class="mini-button" :disabled="!mixedSegments.length" @click="copyMenuOpen = !copyMenuOpen">多格式复制 ▾</button>
                <div v-if="copyMenuOpen" class="copy-menu">
                  <button type="button" class="copy-menu-item" @click="copyMixed('text')">纯文本</button>
                  <button type="button" class="copy-menu-item" @click="copyMixed('markdown')">Markdown</button>
                  <button type="button" class="copy-menu-item" @click="copyMixed('latex')">LaTeX(公式)</button>
                  <button type="button" class="copy-menu-item" @click="copyMixed('html')">富文本 HTML</button>
                </div>
              </div>
            </div>
          </div>
          <div v-if="mixedFormulaOnly" class="mixed-note">文本引擎未返回带框文本行，已按「仅公式」模式识别（文本行缺失）。</div>
          <div v-if="mixedFormulaSegments.length" class="mixed-fs-row">
            <span class="mixed-fs-label">公式行</span>
            <button
              v-for="(seg, i) in mixedFormulaSegments"
              :key="`mfs-${i}`"
              type="button"
              class="mixed-fs-chip"
              :class="{ active: activeMixedIndex === i }"
              :title="formulaScoreLevel(seg) ? `${formulaScoreLevel(seg).tip}（点击定位）` : '点击定位'"
              @click="activeMixedIndex = i"
            >
              <span class="mixed-fs-idx">{{ i }}</span>
              <span v-if="formulaScoreLevel(seg)" class="formula-conf" :class="formulaScoreLevel(seg).cls">{{ formulaScoreLevel(seg).label }}</span>
            </button>
            <span class="actions-spacer"></span>
            <button
              type="button"
              class="mini-button"
              :disabled="mixedFastRerunning"
              @click="rerecognizeMixedFormula"
            >{{ mixedFastRerunning ? '重识别中…' : '重识别公式行' }}</button>
          </div>
          <div v-for="(w, wi) in mixedWarnings" :key="`mw-${wi}`" class="mixed-note">{{ w }}</div>
          <div
            v-if="mixedView === 'render'"
            class="mixed-render"
            :class="{ 'has-active': activeMixedIndex >= 0 }"
            @mouseover="onMixedRenderHover"
            v-html="mixedRenderHtml"
          ></div>
          <template v-else>
            <textarea
              v-model="mixedSource"
              class="mixed-source"
              spellcheck="false"
              placeholder="编辑 Markdown 源文（行内 $…$，独立 $$…$$），点击「应用」重新渲染"
            ></textarea>
            <button type="button" class="mini-button mixed-apply" @click="applyMixedSource">应用并重新渲染</button>
          </template>
        </div>

        <textarea
          v-if="resultView === 'text' && engine !== 'mixed' && !formulaMultiActive"
          v-model="displayText"
          :readonly="translationActive"
          :class="{ 'translation-view': translationActive }"
          spellcheck="false"
          :placeholder="translationActive ? '翻译结果' : '识别结果会显示在这里'"
        ></textarea>

        <div v-else-if="!formulaMultiActive" class="table-view">
          <div v-if="tableAvailable" class="table-actions">
            <div class="table-actions-row">
              <button type="button" class="mini-button" @click="copyTable">复制表格</button>
              <button type="button" class="mini-button" @click="copyTableMarkdown">复制 MD</button>
              <button type="button" class="mini-button" @click="exportCsv">导出 CSV</button>
              <button type="button" class="mini-button" @click="exportXlsx">导出 Excel</button>
              <button type="button" class="mini-button" @click="exportTableMd">导出 MD</button>
              <span v-if="tableDims" class="table-dims">{{ tableDims }}</span>
              <span class="actions-spacer"></span>
              <span class="table-dock-hint">行/列线与阈值操作已移至左侧预览栏</span>
            </div>
          </div>
          <div v-if="tableAvailable" class="table-scroll">
            <table class="table-preview-table">
              <tbody>
                <tr v-for="(row, r) in tableGrid.grid" :key="`trow-${r}`">
                  <td
                    v-for="(cell, c) in row"
                    :key="`tcell-${r}-${c}`"
                    :class="{ filled: cell, low: tableGrid.lowCells.has(`${r}-${c}`) }"
                  ><div
                    class="cell-edit"
                    contenteditable="true"
                    spellcheck="false"
                    @blur="onCellEdit($event, r, c)"
                  >{{ cell }}</div></td>
                </tr>
              </tbody>
            </table>
          </div>
          <div v-else class="table-empty">暂无表格数据，请使用系统 OCR 或 ONNX OCR 引擎并开启「识别为表格」后重新识别</div>
        </div>
        </div>
      </section>
    </section>

    <footer class="toolbar">
      <div class="left-actions">
        <button type="button" class="tool-button" :disabled="loading || !readyToRecognize" @click="selectImage">
          <span class="icon">▧</span>
          <span>选择图片</span>
        </button>
        <button type="button" class="tool-button" :disabled="loading || !readyToRecognize" @click="captureScreen">
          <span class="icon">⌗</span>
          <span>屏幕截图</span>
        </button>
      </div>

      <label class="toggle">
        <input v-model="stripNewlines" type="checkbox">
        <span class="switch"></span>
        <span>智能断行</span>
      </label>

      <div class="right-actions">
        <button type="button" class="tool-button" :disabled="loading || !hasContent" @click="clearAll">
          <span class="icon">×</span>
          <span>清空</span>
        </button>
        <button type="button" class="copy-button" :disabled="loading || !displayText" @click="copyResult">
          <span class="copy-icon">⧉</span>
          <span>复制结果</span>
        </button>
        <button type="button" class="copy-button" :disabled="loading || !displayText" @click="copyAndClose">
          <span class="copy-icon">⧉</span>
          <span>复制并关闭</span>
        </button>
      </div>
    </footer>

    <input ref="fileInput" class="file-input" type="file" multiple accept="image/*,application/pdf" @change="onFileSelected">
    <div v-if="toastMessage" class="toast">{{ toastMessage }}</div>
  </main>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import * as XLSX from 'xlsx'
import katex from 'katex'
import 'katex/dist/katex.min.css'
import './styles/katex-fonts.css'
import {
  buildGrid,
  clusterTable,
  extractCells,
  LOW_CONFIDENCE_THRESHOLD
} from './lib/tableModel.js'
import { sanitizeLatexForRender } from './lib/latexRepair.js'
// P2-8 拆分：纯函数进 lib，App.vue 只保留状态与 DOM 逻辑。
import { formulaScoreLevel, buildFormulaTexExport, buildFormulaMdExport, buildHistoryExportText } from './lib/formulaExport.js'
import { gridToTsv, gridToCsv, gridToMarkdown } from './lib/tableModel.js'
import {
  mergeAndOrderSegments,
  normalizedBottomLeftToPixels,
  segmentsToMarkdown,
  markdownToSegments,
  segmentsToPlainText,
  segmentsToLatex,
  segmentsToHtml
} from './lib/mixedLayout.js'

const OCR_IMAGE_STORAGE_KEY = 'native_ocr_image'
const OCR_IMAGE_EVENT = 'native-ocr-image'
const OCR_CAPTURE_CODE = 'native-ocr-capture'
const HISTORY_KEY = 'native_ocr_history'
const HISTORY_LIMIT = 50
const HISTORY_TEXT_LIMIT = 5000

const fileInput = ref(null)
const previewSrc = ref('')
const rawResultText = ref('')
const loading = ref(false)
const loadingMessage = ref('识别中')
const isFirstRunLoading = ref(false)
const stripNewlines = ref(false)
const isDragging = ref(false)
const toastMessage = ref('')
const runtimeStatus = ref('checking')
const runtimeMessage = ref('正在检查 OCR 运行时')
const runtimeVersion = ref('')
const runtimeLatestVersion = ref('')
const runtimeProgress = ref({
  phase: '',
  percent: 0,
  downloaded: 0,
  total: 0
})
const engine = ref(localStorage.getItem('native_ocr_engine') || 'wechat')
const lastRecognizedSource = ref('')
const visionAvailable = ref(false)
const onnxReady = ref(false)
const onnxDownloading = ref(false)
const onnxMessage = ref('')
const formulaReady = ref(false)
const formulaDownloading = ref(false)
const formulaMessage = ref('')
// --- 图文混排（mixed text + formula）状态 ---
const mfdReady = ref(false)
const mfdDownloading = ref(false)
const mfdMessage = ref('')
const formulaMfdHintDismissed = ref(false) // 公式页签 MFD 下载引导横幅是否已关闭（会话内不再显示）
const mixedSegments = ref([]) // 识别得到的 segments（与服务端结构一致，含 box/lineNumber）
const mixedImageSize = ref({ w: 0, h: 0 }) // 原始图片尺寸，用于 overlay 百分比定位
const mixedFormulaOnly = ref(false) // 文本引擎无法返回带框文本行 → 仅公式模式
const mixedWarnings = ref([]) // 服务端返回的非致命告警（如 textLines 坐标空间疑似不匹配）
const mixedSource = ref('') // 可编辑的 Markdown 源文
const mixedView = ref('render') // 'render' | 'source'
const activeMixedIndex = ref(-1) // 当前高亮联动的 segment 下标
const detectLoading = ref(false)
const copyMenuOpen = ref(false)
const previewImageRef = ref(null)
// --- 截图自适应（contain-fit）：大图缩放到刚好放进左栏，不产生页面滚动 ---
const previewFit = ref({ w: 0, h: 0 }) // 计算出的适配尺寸（0 = 未计算，回落 CSS 约束）
let stageResizeObserver = null

// 纯 CSS 链（max-height 百分比落在 inline-block/auto 高度祖先上会失效）做不到可靠 contain-fit，
// 用 JS 按左栏客户区计算。scale 封顶 1：只缩不放，小截图保持原始尺寸避免放大模糊。
function computePreviewFit() {
  const stage = stageRef.value
  const img = previewImageRef.value
  const natW = img && (img.naturalWidth || img.width)
  const natH = img && (img.naturalHeight || img.height)
  if (!stage || !natW || !natH) {
    if (previewFit.value.w || previewFit.value.h) previewFit.value = { w: 0, h: 0 }
    return
  }
  const sw = stage.clientWidth
  const sh = stage.clientHeight
  if (!sw || !sh) return
  const scale = Math.min(sw / natW, sh / natH, 1)
  const w = Math.max(1, Math.round(natW * scale))
  const h = Math.max(1, Math.round(natH * scale))
  if (previewFit.value.w !== w || previewFit.value.h !== h) previewFit.value = { w, h }
}

const previewImageStyle = computed(() => {
  const { w, h } = previewFit.value
  return w > 0 && h > 0 ? { width: `${w}px`, height: `${h}px` } : {}
})

// stageRef 因 v-if 随 previewSrc 出现/消失，观察器需同步挂载/卸载。
function syncStageResizeObserver() {
  const stage = stageRef.value
  if (stage && typeof ResizeObserver !== 'undefined') {
    if (!stageResizeObserver) stageResizeObserver = new ResizeObserver(() => computePreviewFit())
    if (stageResizeObserver._target !== stage) {
      stageResizeObserver.disconnect()
      stageResizeObserver.observe(stage)
      stageResizeObserver._target = stage
    }
    computePreviewFit()
  } else if (!stage && stageResizeObserver) {
    stageResizeObserver.disconnect()
    stageResizeObserver._target = null
  }
}

watch(previewSrc, () => {
  previewFit.value = { w: 0, h: 0 }
  nextTick(syncStageResizeObserver)
})

// 左栏底部「标记操作坞」：标记线/标记框相关操作集中在预览下方，按引擎条件渲染。
const previewDockVisible = computed(() => {
  if ((engine.value === 'formula' || engine.value === 'mixed') && mfdReady.value) return true
  // A1：公式引擎已就绪但未装 MFD 模型 → 在 dock 位置显示非阻塞下载引导横幅。
  if (engine.value === 'formula' && formulaReady.value && !mfdReady.value && !formulaMfdHintDismissed.value) return true
  return tableAvailable.value
})
// --- 多公式识别（formula 引擎，依赖 MFD 检测）状态 ---
const formulaItems = ref([]) // [{type, score, box, latex}]，latex 可编辑（每行 v-model）
const formulaImageSize = ref({ w: 0, h: 0 }) // 原始图片尺寸，用于 overlay 百分比定位
// A3：偏好持久化（沿用 clusterFactor 的 localStorage 模式，key 前缀 native_ocr_）。
// 数值读回用 Number.isFinite 守卫，避免合法 0（如 boxPad=0）被 || 干掉。
function loadPrefNumber(key, def) {
  try {
    const raw = localStorage.getItem(key)
    if (raw == null) return def
    const n = Number(raw)
    return Number.isFinite(n) ? n : def
  } catch (_) {
    return def
  }
}
function loadPrefBool(key, def) {
  try {
    const raw = localStorage.getItem(key)
    if (raw == null) return def
    return raw === '1' || raw === 'true'
  } catch (_) {
    return def
  }
}
function savePref(key, val) {
  try {
    localStorage.setItem(key, String(val))
  } catch (_) {
    // Ignore storage failures.
  }
}
const formulaBoxPad = ref(loadPrefNumber('native_ocr_formula_box_pad', 2)) // 标记框外扩像素，0..40，默认 2
const formulaConf = ref(loadPrefNumber('native_ocr_formula_conf', 0.55)) // MFD 检测置信度阈值：越低越灵敏（易误检字母），越高越保守。0.55=实测最优：斜体正文误检 score≈0.50，真公式下界 0.711
const formulaMultiBusy = ref(false) // 滑块重识别进行中
const activeFormulaIndex = ref(-1) // 当前高亮联动的 formula item 下标
// 0.7.8：LaTeX 编辑框默认收起（KaTeX 预览已足够展示），双击预览或点「编辑」展开。
const formulaEditIndex = ref(-1)
// 0.7.10：多公式模式下主结果区（原始文本框/空表格占位）整体隐藏，右栏只保留逐行预览
const formulaMultiActive = computed(() => engine.value === 'formula' && formulaItems.value.length > 0)
const formulaEditInput = ref(null)
watch(formulaEditIndex, async (idx) => {
  if (idx >= 0) {
    await nextTick()
    // v-for 内的 template ref 收集为数组，按当前行下标取
    const el = Array.isArray(formulaEditInput.value) ? formulaEditInput.value[idx] : formulaEditInput.value
    el?.focus?.()
  }
})
let formulaMultiHintShown = false // 单公式降级提示只弹一次
// --- 图文混排裁剪外扩 + 灵敏度 ---
const mixedBoxPad = ref(loadPrefNumber('native_ocr_mixed_box_pad', 2)) // 标记框外扩像素，0..40，默认 2
const mixedConf = ref(loadPrefNumber('native_ocr_mixed_conf', 0.25)) // MFD 检测置信度阈值，混排默认保持原行为 0.25，不回归
// --- 混排页签：手动排除误检公式框 ---
const mixedExcludedKeys = ref(new Set()) // 被排除（回归文本）的公式框 boxKey 集合
const mixedDetectedBoxes = ref([]) // 本次图片检测到的全部公式框（含后被排除的），用于 overlay 双列表
const mixedBoxOverrides = ref(new Map()) // B10：resize 调整后的框，key=检测框 boxKey，value=调整后 box
const lastMixedTextLines = ref([]) // P1-4：最近一次混排识别的文本行（快速重识别时复用，跳过文本 OCR）
const lastMixedBoxes = ref([]) // P1-4：最近一次混排识别的公式框（同上，跳过 MFD 检测）
const mixedFastRerunning = ref(false) // P1-4：快速重识别进行中
let formulaExcludeTimer = 0 // 公式页签排除重跑去抖 timer
let mixedExcludeTimer = 0 // 混排页签排除重跑去抖 timer
const lastResult = ref(null)
const resultView = ref('text')
const tableMode = ref(loadPrefBool('native_ocr_table_mode', false))
const translatedText = ref('')
const translatedCells = ref({})
const translationActive = ref(false)
const translating = ref(false)
const translateTarget = ref(localStorage.getItem('native_ocr_translate_target') || '')
const zoom = ref(1)
const panX = ref(0)
const panY = ref(0)
const batchItems = ref([])
const batchRunning = ref(false)
let panState = null
let pdfjsPromise = null
const clusterFactor = ref(Number(localStorage.getItem('native_ocr_cluster_factor')) || 0.6)
const history = ref(loadHistory())
// B9：同会话内 id→完整 source 的内存映射（localStorage 不存原图，避免配额爆炸）。
// 存在时「回填」直接用原图并可重识别；持久化恢复的旧历史无原图 → 缩略图回看即可。
const historySourceMap = new Map()
const historyOpen = ref(false)

let toastTimer = 0
let lastSource = ''
let hasRecognizedOnce = false
let pendingRecognition = null

const hasContent = computed(() => Boolean(previewSrc.value || rawResultText.value))
const runtimeReady = computed(() => runtimeStatus.value === 'ready')
const isMacPlatform = (window.nativeOcr?.getPlatform?.() || 'darwin') === 'darwin'
const wechatReady = computed(() => runtimeReady.value)
const wechatSupported = computed(() => runtimeStatus.value !== 'unsupported')
// 引擎页签排序：Windows 上 ONNX OCR（识别率最优）排第一；
// macOS 保持 macOS Vision → ONNX OCR → 微信 OCR。
const engineTabs = computed(() => {
  const onnxTab = {
    id: 'rapidocr',
    label: 'ONNX OCR',
    pending: !onnxReady.value,
    disabled: false,
    badge: onnxReady.value ? '' : '未下载',
    title: onnxReady.value ? '内置 ONNX 引擎（PP-OCR v4），支持表格识别' : '点击下载内置 ONNX 引擎（无需 Python）'
  }
  const visionTab = isMacPlatform
    ? {
        id: 'vision', label: 'macOS Vision', pending: false,
        disabled: !visionAvailable.value, badge: '',
        title: visionAvailable.value ? '' : '需要 macOS 及 swift 命令'
      }
    : {
        id: 'vision', label: 'Windows OCR', pending: false,
        disabled: !visionAvailable.value, badge: '',
        title: visionAvailable.value ? '' : '需要 Windows 10 及 PowerShell'
      }
  const formulaTab = {
    id: 'formula',
    label: '公式识别',
    pending: !formulaReady.value,
    disabled: false,
    badge: formulaReady.value ? '' : '未下载',
    title: formulaReady.value
      ? '将公式图片识别为 LaTeX 代码（RapidLaTeXOCR）'
      : '点击下载公式识别模型（约 171MB，依赖 ONNX 引擎）'
  }
  // 图文混排：在 ONNX 引擎 + 公式模型的基础上，再叠加 MFD 公式检测模型。
  // 顺序保持「在 formula 之前插入」，即 Mac: vision, onnx, mixed, formula, wechat；
  // Windows: onnx, mixed, formula, vision。
  const mixedTab = {
    id: 'mixed',
    label: '图文混排',
    pending: !mfdReady.value,
    disabled: false,
    badge: mfdReady.value ? '' : '未下载',
    title: mfdReady.value
      ? '混合文本与公式：文本按阅读顺序排版，公式行内/独立渲染并导出'
      : '点击下载图文混排模型（约 80MB，依赖 ONNX 引擎与公式模型）'
  }
  if (!isMacPlatform) {
    return [onnxTab, mixedTab, formulaTab, visionTab]
  }
  const wechatTab = {
    id: 'wechat', label: '微信 OCR',
    pending: !runtimeReady.value, disabled: false,
    badge: wechatReady.value ? '' : '未装',
    title: runtimeReady.value ? '调用微信自带离线 OCR' : '需要下载微信 OCR 运行时'
  }
  return [visionTab, onnxTab, mixedTab, formulaTab, wechatTab]
})
const readyToRecognize = computed(() => {
  if (engine.value === 'vision') return visionAvailable.value
  if (engine.value === 'rapidocr') return onnxReady.value
  if (engine.value === 'formula') return formulaReady.value
  if (engine.value === 'mixed') return mfdReady.value
  return wechatReady.value
})
const runtimeBusy = computed(() => ['checking', 'downloading', 'extracting'].includes(runtimeStatus.value))
const runtimeCanDownload = computed(() => ['missing', 'outdated', 'error'].includes(runtimeStatus.value))
const runtimeOverlayVisible = computed(() => engine.value === 'wechat' && isMacPlatform && !runtimeReady.value)
const runtimeProgressVisible = computed(() => ['downloading', 'extracting'].includes(runtimeStatus.value))
const tableCapable = computed(() => {
  if (engine.value === 'vision') return visionAvailable.value
  if (engine.value === 'rapidocr') return onnxReady.value
  return false
})

const stageRef = ref(null)
const manualRowSeps = ref(null)
const manualColSeps = ref(null)
const cellEdits = ref({})
let sepDragState = null

const autoClusters = computed(() => {
  if (!tableMode.value || !tableCapable.value) return null
  const lines = (lastResult.value && lastResult.value.lines) || []
  if (!Array.isArray(lines) || !lines.some((line) => line && line.box)) return null
  return clusterTable(lines, clusterFactor.value)
})

function sepsFromCenters(clusters, key) {
  const seps = []
  for (let i = 0; i < clusters.length - 1; i += 1) {
    seps.push((clusters[i][key] + clusters[i + 1][key]) / 2)
  }
  return seps.sort((a, b) => a - b)
}

const rowSeps = computed(() => {
  if (Array.isArray(manualRowSeps.value)) return [...manualRowSeps.value].sort((a, b) => a - b)
  const clusters = autoClusters.value && autoClusters.value.rowClusters
  return clusters ? sepsFromCenters(clusters, 'cy') : []
})

const colSeps = computed(() => {
  if (Array.isArray(manualColSeps.value)) return [...manualColSeps.value].sort((a, b) => a - b)
  const clusters = autoClusters.value && autoClusters.value.colClusters
  return clusters ? sepsFromCenters(clusters, 'cx') : []
})

const manualSepsActive = computed(() => Array.isArray(manualRowSeps.value) || Array.isArray(manualColSeps.value))

const tableGrid = computed(() => {
  if (!tableMode.value || !tableCapable.value) return null
  const lines = (lastResult.value && lastResult.value.lines) || []
  if (!Array.isArray(lines) || !lines.some((line) => line && line.box)) return null
  const cells = extractCells(lines)
  if (!cells.length) return null
  const overrides = translationActive.value && Object.keys(translatedCells.value).length
    ? translatedCells.value
    : cellEdits.value
  return buildGrid(cells, rowSeps.value, colSeps.value, overrides)
})

const tableAvailable = computed(() => Boolean(tableGrid.value))
const tableDims = computed(() => {
  const grid = tableGrid.value && tableGrid.value.grid
  if (!grid || !grid.length) return ''
  return `${grid.length} 行 × ${grid[0].length} 列`
})
const tableRowLines = computed(() => rowSeps.value.map((y) => Math.round((1 - y) * 1000) / 10))
const tableColLines = computed(() => colSeps.value.map((x) => Math.round(x * 1000) / 10))
const tableOverlayVisible = computed(() => tableAvailable.value && resultView.value === 'table')
const runtimeTitle = computed(() => {
  if (runtimeStatus.value === 'checking') return '检查 OCR 运行时'
  if (runtimeStatus.value === 'downloading') return '下载 OCR 运行时'
  if (runtimeStatus.value === 'extracting') return '安装 OCR 运行时'
  if (runtimeStatus.value === 'outdated') return '更新 OCR 运行时'
  if (runtimeStatus.value === 'error') return 'OCR 运行时不可用'
  return '下载 OCR 运行时'
})
const runtimeButtonText = computed(() => runtimeStatus.value === 'outdated' ? '下载更新' : '下载 OCR 运行时')
const runtimeProgressText = computed(() => {
  const percent = Math.max(0, Math.min(100, runtimeProgress.value.percent || 0))
  if (runtimeStatus.value === 'extracting') return `正在解包 ${percent}%`
  const total = runtimeProgress.value.total
  const downloaded = runtimeProgress.value.downloaded
  if (total) return `${formatBytes(downloaded)} / ${formatBytes(total)} · ${percent}%`
  return percent ? `${percent}%` : '正在下载'
})

function stripLineBreaks(text) {
  return String(text || '').replace(/\s*\r?\n\s*/g, '')
}

const CJK_CHAR_RE = /[\u4e00-\u9fff\u3000-\u303f\uff00-\uffef]/

function joinGap(head, tail) {
  const lastChar = head.slice(-1)
  const firstChar = tail.slice(0, 1)
  if (CJK_CHAR_RE.test(lastChar) || CJK_CHAR_RE.test(firstChar)) return ''
  if (/[-–—/\\((（]$/.test(head) || /^[).，、。！？;；]/.test(tail)) return ''
  if (/[A-Za-z0-9]$/.test(head) && /^[A-Za-z0-9(]/.test(tail)) return ' '
  return ''
}

function smartJoin(text) {
  const lines = String(text || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
  const paragraphs = []
  let buffer = ''
  for (const line of lines) {
    if (!buffer) {
      buffer = line
    } else {
      buffer += joinGap(buffer, line) + line
    }
    if (/[。！？!?…；;]$/.test(line)) {
      paragraphs.push(buffer)
      buffer = ''
    }
  }
  if (buffer) paragraphs.push(buffer)
  return paragraphs.join('\n')
}

const displayText = computed({
  get() {
    if (translationActive.value) return translatedText.value
    return stripNewlines.value ? smartJoin(rawResultText.value) : rawResultText.value
  },
  set(value) {
    if (translationActive.value) return
    rawResultText.value = stripNewlines.value ? stripLineBreaks(value) : value
  }
})

function showToast(message) {
  toastMessage.value = message
  window.clearTimeout(toastTimer)
  toastTimer = window.setTimeout(() => {
    toastMessage.value = ''
  }, 1800)
}

// --- 公式预览（KaTeX 离线渲染） ---
// 把识别出的 LaTeX 渲染成可视化公式，便于判断识别是否正确；
// 源码编辑后实时重渲染。OCR 模型常输出结构性非法 LaTeX（如双下标），
// 渲染前先做容错修复，保证「能预览」优先；源码本身保持不变。
const formulaRenderError = ref('')
const formulaAutoFixed = ref(false) // 本次渲染是否触发了容错修复

const formulaHtml = computed(() => {
  if (engine.value !== 'formula') return ''
  const latex = (rawResultText.value || '').trim()
  if (!latex) return ''

  const options = {
    displayMode: true,
    throwOnError: true,
    strict: false,
    trust: false,
    output: 'htmlAndMathml'
  }

  // 1) 先按原文渲染
  try {
    const html = katex.renderToString(latex, options)
    formulaRenderError.value = ''
    formulaAutoFixed.value = false
    return html
  } catch (_) {
    // 落到容错路径
  }

  // 2) 容错修复后重试（修复仅用于预览，不回写源码）
  const repaired = sanitizeLatexForRender(latex)
  if (repaired !== latex) {
    try {
      const html = katex.renderToString(repaired, options)
      formulaRenderError.value = ''
      formulaAutoFixed.value = true
      return html
    } catch (_) {
      // 继续落到错误态
    }
  }

  // 3) 仍然失败：尝试 KaTeX 容错模式（红色标注错误位置而非整块空白）
  try {
    const html = katex.renderToString(latex, { ...options, throwOnError: false, errorColor: '#c0392b' })
    formulaRenderError.value = '部分语法无法解析，已尽力渲染'
    formulaAutoFixed.value = false
    return html
  } catch (error) {
    formulaRenderError.value = error && error.message ? error.message : 'LaTeX 解析失败'
    formulaAutoFixed.value = false
    return ''
  }
})

// 识别结果变化时清除上一次的渲染状态
watch(rawResultText, () => {
  if (formulaRenderError.value) formulaRenderError.value = ''
  if (formulaAutoFixed.value) formulaAutoFixed.value = false
})

function formatError(error) {
  return error && error.message ? error.message : String(error || '操作失败')
}

function formatBytes(bytes) {
  const value = Number(bytes || 0)
  if (value >= 1024 * 1024) return `${(value / 1024 / 1024).toFixed(1)} MB`
  if (value >= 1024) return `${(value / 1024).toFixed(1)} KB`
  return `${value} B`
}

function isValidHistoryItem(item) {
  return Boolean(
    item
    && typeof item.id === 'string'
    && typeof item.text === 'string'
    && (item.engine === 'wechat' || item.engine === 'vision' || item.engine === 'rapidocr' || item.engine === 'formula' || item.engine === 'mixed')
    && Number.isFinite(Number(item.ts))
  )
}

function loadHistory() {
  try {
    const raw = localStorage.getItem(HISTORY_KEY)
    const parsed = raw ? JSON.parse(raw) : []
    if (!Array.isArray(parsed)) return []
    return parsed.filter(isValidHistoryItem).slice(0, HISTORY_LIMIT)
  } catch (_) {
    return []
  }
}

function persistHistory() {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(history.value))
  } catch (_) {
    // Ignore storage failures.
  }
}

// P1-7 历史增强：搜索过滤 + 收藏置顶 + 批量导出。
const historySearch = ref('')

// 展示列表：收藏优先（组内保持时间倒序），搜索时再按关键词过滤。
const displayHistory = computed(() => {
  const kw = historySearch.value.trim().toLowerCase()
  const list = kw
    ? history.value.filter((item) => String(item.text || '').toLowerCase().includes(kw))
    : history.value.slice()
  return list.filter((i) => i.fav).concat(list.filter((i) => !i.fav))
})

function toggleHistoryFav(item) {
  if (!item) return
  item.fav = !item.fav
  persistHistory()
}

function exportHistoryTxt() {
  const text = buildHistoryExportText(displayHistory.value, {
    engineLabel: (item) => engineLabel(item.engine),
    formatTime: (ts) => formatHistoryTime(ts)
  })
  if (!text) {
    showToast('暂无历史可导出')
    return
  }
  try {
    downloadBlob(new Blob([text], { type: 'text/plain;charset=utf-8;' }), `native-ocr-history-${Date.now()}.txt`)
    showToast('已导出历史')
  } catch (_) {
    showToast('导出失败')
  }
}

function pushHistory(text, engineName) {
  const trimmed = String(text || '').trim()
  if (!trimmed) return
  const stored = trimmed.length > HISTORY_TEXT_LIMIT ? trimmed.slice(0, HISTORY_TEXT_LIMIT) : trimmed
  const existingIndex = history.value.findIndex((item) => item.text === stored)
  if (existingIndex === 0) return
  const next = history.value.slice()
  if (existingIndex > 0) {
    next.splice(existingIndex, 1)
  }
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
  next.unshift({
    id,
    engine: engineName === 'vision' || engineName === 'rapidocr' || engineName === 'formula' || engineName === 'mixed' ? engineName : 'wechat',
    text: stored,
    ts: Date.now()
  })
  if (next.length > HISTORY_LIMIT) next.length = HISTORY_LIMIT
  history.value = next
  persistHistory()
  // B9：同会话原图映射（回填+重识别用）；缩略图异步生成后回填，失败静默降级为无 thumb。
  if (lastRecognizedSource.value) historySourceMap.set(id, lastRecognizedSource.value)
  if (previewSrc.value) {
    makeThumb(previewSrc.value).then((thumb) => {
      const found = history.value.find((h) => h.id === id)
      if (found && thumb) {
        found.thumb = thumb
        persistHistory()
      }
    }).catch(() => {})
  }
}

// B9：把图片缩到最长边 120px 的 JPEG(0.7) dataURL，约 5-10KB，返回 Promise（失败 reject）。
function makeThumb(src) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      try {
        const max = 120
        const nw = img.naturalWidth || img.width || 0
        const nh = img.naturalHeight || img.height || 0
        if (!nw || !nh) return reject(new Error('invalid image size'))
        const scale = Math.min(max / nw, max / nh, 1)
        const w = Math.max(1, Math.round(nw * scale))
        const h = Math.max(1, Math.round(nh * scale))
        const canvas = document.createElement('canvas')
        canvas.width = w
        canvas.height = h
        const ctx = canvas.getContext('2d')
        ctx.drawImage(img, 0, 0, w, h)
        resolve(canvas.toDataURL('image/jpeg', 0.7))
      } catch (e) {
        reject(e)
      }
    }
    img.onerror = () => reject(new Error('thumb load failed'))
    img.src = src
  })
}

function engineLabel(engineName) {
  if (engineName === 'vision') return '系统 OCR'
  if (engineName === 'rapidocr') return 'ONNX OCR'
  if (engineName === 'formula') return '公式识别'
  if (engineName === 'mixed') return '图文混排'
  if (engineName === 'mixed') return '图文混排'
  return '微信 OCR'
}

function formatHistoryTime(ts) {
  const date = new Date(Number(ts) || 0)
  if (!date.getTime()) return ''
  const pad = (value) => String(value).padStart(2, '0')
  const today = new Date()
  const sameDay = date.getFullYear() === today.getFullYear()
    && date.getMonth() === today.getMonth()
    && date.getDate() === today.getDate()
  if (sameDay) return `${pad(date.getHours())}:${pad(date.getMinutes())}`
  return `${date.getMonth() + 1}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function clearHistory() {
  history.value = []
  persistHistory()
}

function deleteHistoryItem(id) {
  history.value = history.value.filter((item) => item.id !== id)
  persistHistory()
}

function applyHistoryItem(item) {
  if (!item || typeof item.text !== 'string') return
  rawResultText.value = item.text
  lastResult.value = null
  translationActive.value = false
  translatedText.value = ''
  translatedCells.value = {}
  resultView.value = 'text'
  historyOpen.value = false
  showToast('已回填历史记录')
}

// B9：回填图片。内存有原图 → 直接重识别；否则仅用缩略图回看（不重识别）。
function refillHistoryImage(item) {
  if (!item) return
  const src = historySourceMap.get(item.id)
  if (src) {
    historyOpen.value = false
    recognizeSource(src, src)
  } else if (item.thumb) {
    previewSrc.value = item.thumb
    showToast('缩略图仅供回看，如需重识别请重新截图/粘贴原图')
  } else {
    showToast('无可用原图')
  }
}

async function toggleTranslate() {
  if (translationActive.value) {
    translationActive.value = false
    return
  }
  if (!window.nativeOcr?.translateText) {
    showToast('当前环境不支持翻译')
    return
  }
  const toLang = translateTarget.value || (/[\u4e00-\u9fff]/.test(rawResultText.value) ? 'en' : 'zh')
  if (resultView.value === 'table' && tableGrid.value) {
    await translateTableView(toLang)
    return
  }
  const text = rawResultText.value
  if (!text) {
    showToast('没有可翻译的内容')
    return
  }
  translating.value = true
  try {
    const result = await window.nativeOcr.translateText(text, toLang)
    translatedText.value = result?.text || ''
    translationActive.value = true
    showToast(`已翻译为 ${toLang}`)
  } catch (error) {
    showToast(`翻译失败：${formatError(error)}`)
  } finally {
    translating.value = false
  }
}

async function translateTableView(toLang) {
  const grid = tableGrid.value.grid
  const keys = []
  const segments = []
  for (let r = 0; r < grid.length; r += 1) {
    for (let c = 0; c < grid[r].length; c += 1) {
      const text = String(grid[r][c] || '').trim()
      if (!text) continue
      keys.push(`${r}-${c}`)
      segments.push(text)
    }
  }
  if (!segments.length) {
    showToast('表格中没有可翻译的内容')
    return
  }
  translating.value = true
  try {
    const translated = await window.nativeOcr.translateSegments(segments, toLang)
    const map = {}
    keys.forEach((key, index) => { map[key] = String(translated[index] ?? '') })
    translatedCells.value = map
    translationActive.value = true
    showToast(`表格已翻译为 ${toLang}`)
  } catch (error) {
    showToast(`翻译失败：${formatError(error)}`)
  } finally {
    translating.value = false
  }
}

function onTableModeToggle() {
  if (!tableCapable.value) {
    showToast('表格识别需系统 OCR 或 ONNX OCR 引擎')
  }
}

function beginSepDrag(event, type, index) {
  if (!tableAvailable.value) return
  const stage = stageRef.value
  if (!stage) return
  const rect = stage.getBoundingClientRect()
  if (!rect.height || !rect.width) return
  sepDragState = { type, index, rect }
  window.addEventListener('pointermove', onSepDragMove)
  window.addEventListener('pointerup', endSepDrag, { once: true })
  onSepDragMove(event)
}

function onSepDragMove(event) {
  if (!sepDragState) return
  const { type, index, rect } = sepDragState
  const margin = 0.008
  const seps = [...(type === 'row' ? rowSeps.value : colSeps.value)]
  if (index < 0 || index >= seps.length) return
  const raw = type === 'row'
    ? 1 - ((event.clientY - rect.top - panY.value) / zoom.value) / rect.height
    : ((event.clientX - rect.left - panX.value) / zoom.value) / rect.width
  const min = (index > 0 ? seps[index - 1] : 0) + margin
  const max = (index < seps.length - 1 ? seps[index + 1] : 1) - margin
  if (max <= min) return
  seps[index] = Math.min(max, Math.max(min, raw))
  if (type === 'row') manualRowSeps.value = seps
  else manualColSeps.value = seps
}

function endSepDrag() {
  sepDragState = null
  window.removeEventListener('pointermove', onSepDragMove)
}

function removeSep(type, index) {
  const seps = [...(type === 'row' ? rowSeps.value : colSeps.value)]
  if (index < 0 || index >= seps.length) return
  seps.splice(index, 1)
  if (type === 'row') manualRowSeps.value = seps
  else manualColSeps.value = seps
}

function addSep(type) {
  const seps = [...(type === 'row' ? rowSeps.value : colSeps.value)]
  const bounds = [0, ...seps, 1]
  let bestGap = -1
  let bestPos = 0.5
  for (let i = 0; i < bounds.length - 1; i += 1) {
    const gap = bounds[i + 1] - bounds[i]
    if (gap > bestGap) {
      bestGap = gap
      bestPos = (bounds[i] + bounds[i + 1]) / 2
    }
  }
  if (bestGap <= 0.02) {
    showToast('没有可插入的空间')
    return
  }
  const next = [...seps, bestPos].sort((a, b) => a - b)
  if (type === 'row') manualRowSeps.value = next
  else manualColSeps.value = next
}

function resetSeps() {
  manualRowSeps.value = null
  manualColSeps.value = null
  cellEdits.value = {}
}

function onCellEdit(event, r, c) {
  const text = String(event.target.textContent || '').replace(/\n+$/g, '')
  cellEdits.value = { ...cellEdits.value, [`${r}-${c}`]: text }
}

// ---------------------------------------------------------------------------
// 图片缩放 / 平移
// ---------------------------------------------------------------------------

function onStageWheel(event) {
  if (!previewSrc.value) return
  const stage = stageRef.value
  if (!stage) return
  const rect = stage.getBoundingClientRect()
  const pointerX = event.clientX - rect.left
  const pointerY = event.clientY - rect.top
  const factor = event.deltaY < 0 ? 1.15 : 1 / 1.15
  const next = Math.min(8, Math.max(1, zoom.value * factor))
  if (next === zoom.value) return
  const ratio = next / zoom.value
  panX.value = pointerX - (pointerX - panX.value) * ratio
  panY.value = pointerY - (pointerY - panY.value) * ratio
  zoom.value = next
  if (zoom.value === 1) {
    panX.value = 0
    panY.value = 0
  }
}

function resetZoom() {
  zoom.value = 1
  panX.value = 0
  panY.value = 0
  computePreviewFit()
}

function beginPan(event) {
  if (zoom.value <= 1) return
  panState = {
    pointerX: event.clientX - panX.value,
    pointerY: event.clientY - panY.value
  }
  window.addEventListener('pointermove', onPanMove)
  window.addEventListener('pointerup', endPan, { once: true })
}

function onPanMove(event) {
  if (!panState) return
  panX.value = event.clientX - panState.pointerX
  panY.value = event.clientY - panState.pointerY
}

function endPan() {
  panState = null
  window.removeEventListener('pointermove', onPanMove)
}

// ---------------------------------------------------------------------------
// 全局快捷键
// ---------------------------------------------------------------------------

function onGlobalKeydown(event) {
  const meta = event.metaKey || event.ctrlKey
  if (meta && event.key === 'Enter') {
    if (displayText.value) {
      event.preventDefault()
      copyAndClose()
    }
    return
  }
  if (meta && (event.key === 'c' || event.key === 'C')) {
    if (String(window.getSelection?.() || '')) return
    if (displayText.value) {
      event.preventDefault()
      copyTextValue(displayText.value)
    }
    return
  }
  // B7：公式框方向键微调（1px，Shift=10px）。仅当焦点不在可输入控件、且有高亮公式框时拦截。
  if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key)) {
    const activeEl = document.activeElement
    const inEditable = activeEl && (activeEl.isContentEditable || ['TEXTAREA', 'INPUT', 'SELECT'].includes(activeEl.tagName))
    if (!inEditable && activeFormulaIndex.value >= 0) {
      const item = formulaItems.value[activeFormulaIndex.value]
      if (item && !item.excluded) {
        event.preventDefault()
        const step = event.shiftKey ? 10 : 1
        const dx = event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0
        const dy = event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0
        const imgW = (formulaImageSize.value && formulaImageSize.value.w) || Infinity
        const imgH = (formulaImageSize.value && formulaImageSize.value.h) || Infinity
        let [x1, y1, x2, y2] = item.box
        x1 = Math.min(Math.max(0, x1 + dx), imgW)
        y1 = Math.min(Math.max(0, y1 + dy), imgH)
        x2 = Math.min(Math.max(0, x2 + dx), imgW)
        y2 = Math.min(Math.max(0, y2 + dy), imgH)
        item.box = normalizeMixedBox([x1, y1, x2, y2])
        scheduleFormulaRerun()
      }
    }
    // 非公式高亮态（或处于可输入控件）：不拦截，保留默认滚动/光标行为。
    return
  }
  if (event.key === 'Escape') {
    // ① 取消公式框拖拽/平移（不写回）
    if (formulaResizing.value) {
      formulaResizing.value = null
      formulaResizeBox.value = null
      window.removeEventListener('pointermove', onFormulaResizeMove)
      window.removeEventListener('pointerup', onFormulaResizeUp)
      return
    }
    // ② 取消表格分隔线拖拽
    if (sepDragState) {
      sepDragState = null
      window.removeEventListener('pointermove', onSepDragMove)
      return
    }
    const active = document.activeElement
    if (active && (active.isContentEditable || ['TEXTAREA', 'INPUT', 'SELECT'].includes(active.tagName))) {
      active.blur?.()
      return
    }
    closePluginWindow()
  }
}

watch(tableMode, (val) => {
  if (val) {
    if (tableAvailable.value) resultView.value = 'table'
  } else {
    resultView.value = 'text'
  }
})

watch(clusterFactor, (val) => {
  localStorage.setItem('native_ocr_cluster_factor', String(val))
  manualRowSeps.value = null
  manualColSeps.value = null
  cellEdits.value = {}
})

// A3：偏好持久化 —— 数值/布尔变更写回 localStorage（key 前缀 native_ocr_）。
watch(formulaBoxPad, (v) => savePref('native_ocr_formula_box_pad', v))
watch(formulaConf, (v) => savePref('native_ocr_formula_conf', v))
watch(mixedBoxPad, (v) => savePref('native_ocr_mixed_box_pad', v))
watch(mixedConf, (v) => savePref('native_ocr_mixed_conf', v))
watch(tableMode, (v) => savePref('native_ocr_table_mode', v ? '1' : '0'))

watch(lastResult, () => {
  manualRowSeps.value = null
  manualColSeps.value = null
  cellEdits.value = {}
  translationActive.value = false
  translatedText.value = ''
})

watch([manualRowSeps, manualColSeps], () => {
  cellEdits.value = {}
})

function setResultView(view) {
  if (view === 'table' && !tableAvailable.value) {
    showToast('暂无表格数据')
    return
  }
  resultView.value = view
}

async function copyTextValue(text) {
  const value = String(text || '')
  if (!value) {
    showToast('没有可复制的内容')
    return false
  }
  try {
    if (window.ztools?.copyText) {
      window.ztools.copyText(value)
    } else if (window.nativeOcr?.copyText) {
      window.nativeOcr.copyText(value)
    } else {
      await navigator.clipboard.writeText(value)
    }
    showToast('已复制')
    return true
  } catch (_) {
    showToast('复制失败')
    return false
  }
}

// 按不同 LaTeX 语法包装公式后再复制：行内 $…$ / 块级 $$…$$ / 原生 \(…\)
async function copyFormula(kind) {
  const latex = rawResultText.value
  if (!latex) {
    showToast('没有可复制的公式')
    return
  }
  let wrapped = latex
  if (kind === 'inline') wrapped = `$${latex}$`
  else if (kind === 'block') wrapped = `$$${latex}$$`
  else if (kind === 'native') wrapped = `\\(${latex}\\)`
  await copyTextValue(wrapped)
}

async function copyResult() {
  const text = displayText.value
  if (!text) {
    showToast('没有可复制的结果')
    return
  }
  await copyTextValue(text)
}

function closePluginWindow() {
  try {
    if (window.ztools?.hidePlugin) {
      window.ztools.hidePlugin()
      return true
    }
    if (window.ztools?.outPlugin) {
      window.ztools.outPlugin()
      return true
    }
  } catch (_) {
    // Fall through to the failure toast below.
  }
  showToast('当前环境不支持关闭插件')
  return false
}

async function copyAndClose() {
  const text = displayText.value
  if (!text) {
    showToast('没有可复制的结果')
    return
  }
  const copied = await copyTextValue(text)
  if (copied) closePluginWindow()
}

async function startFormulaDownload() {
  if (!window.nativeOcr?.installOnnxFormula) {
    showToast('当前环境不支持下载公式识别模型')
    return
  }
  formulaDownloading.value = true
  formulaMessage.value = '正在检查运行环境'
  try {
    if (!onnxReady.value) {
      await window.nativeOcr.installOnnxRuntime((progress = {}) => {
        const percent = Number(progress.percent || 0)
        formulaMessage.value = `${progress.message || '下载 ONNX 引擎'} ${percent}%`
      })
      onnxReady.value = await window.nativeOcr.isOnnxOcrAvailable?.() || false
    }
    if (!onnxReady.value) {
      formulaMessage.value = 'ONNX 运行环境下载未完成，请重试'
      showToast('ONNX 运行环境下载未完成')
      return
    }
    await window.nativeOcr.installOnnxFormula((progress = {}) => {
      const percent = Number(progress.percent || 0)
      formulaMessage.value = `${progress.message || '下载中'} ${percent}%`
    })
    formulaReady.value = await window.nativeOcr.isOnnxFormulaAvailable?.() || false
    if (formulaReady.value) {
      formulaMessage.value = ''
      showToast('公式识别模型已就绪')
    } else {
      formulaMessage.value = '下载流程已结束，但校验未通过，请重试'
      showToast('公式识别模型下载未完成')
    }
  } catch (error) {
    formulaMessage.value = `下载失败：${formatError(error)}`
    showToast('公式识别模型下载失败')
  } finally {
    formulaDownloading.value = false
  }
}

async function startOnnxDownload() {
  if (!window.nativeOcr?.installOnnxRuntime) {
    showToast('当前环境不支持下载 ONNX OCR 引擎')
    return
  }
  onnxDownloading.value = true
  onnxMessage.value = '正在获取引擎包'
  try {
    await window.nativeOcr.installOnnxRuntime((progress = {}) => {
      const percent = Number(progress.percent || 0)
      onnxMessage.value = `${progress.message || '下载中'} ${percent}%`
    })
    onnxReady.value = await window.nativeOcr.isOnnxOcrAvailable?.() || false
    if (onnxReady.value) {
      onnxMessage.value = ''
      showToast('ONNX OCR 引擎已就绪')
    } else {
      onnxMessage.value = '下载流程已结束，但引擎校验未通过，请重试'
      showToast('ONNX OCR 引擎下载未完成')
    }
  } catch (error) {
    onnxMessage.value = `下载失败：${formatError(error)}`
    showToast('ONNX OCR 引擎下载失败')
  } finally {
    onnxDownloading.value = false
  }
}

async function copyTable() {
  if (!tableGrid.value) {
    showToast('暂无表格可复制')
    return
  }
  await copyTextValue(gridToTsv(tableGrid.value.grid))
}

// P2-10：Markdown 表格复制/导出（与混排/公式导出对齐）。
async function copyTableMarkdown() {
  if (!tableGrid.value) {
    showToast('暂无表格可复制')
    return
  }
  await copyTextValue(gridToMarkdown(tableGrid.value.grid))
}

function exportTableMd() {
  if (!tableGrid.value) {
    showToast('暂无表格可导出')
    return
  }
  const md = gridToMarkdown(tableGrid.value.grid)
  try {
    downloadBlob(new Blob([md], { type: 'text/markdown;charset=utf-8;' }), `native-ocr-table-${Date.now()}.md`)
    showToast('已导出 Markdown')
  } catch (_) {
    showToast('导出失败')
  }
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}

function exportCsv() {
  if (!tableGrid.value) {
    showToast('暂无表格可导出')
    return
  }
  const csv = gridToCsv(tableGrid.value.grid)
  try {
    downloadBlob(new Blob([`\ufeff${csv}`], { type: 'text/csv;charset=utf-8;' }), `native-ocr-table-${Date.now()}.csv`)
    showToast('已导出 CSV')
  } catch (_) {
    showToast('导出失败')
  }
}

function exportXlsx() {
  if (!tableGrid.value) {
    showToast('暂无表格可导出')
    return
  }
  try {
    const grid = tableGrid.value.grid
    const worksheet = XLSX.utils.aoa_to_sheet(grid)
    const colWidths = []
    const colCount = grid[0]?.length || 0
    for (let c = 0; c < colCount; c += 1) {
      let width = 8
      for (const row of grid) {
        width = Math.max(width, String(row[c] || '').length + 2)
      }
      colWidths.push({ wch: Math.min(60, width) })
    }
    worksheet['!cols'] = colWidths
    const workbook = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(workbook, worksheet, 'OCR')
    const data = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' })
    downloadBlob(new Blob([data], { type: 'application/octet-stream' }), `native-ocr-table-${Date.now()}.xlsx`)
    showToast('已导出 Excel')
  } catch (_) {
    showToast('导出失败')
  }
}

function applyRuntimeStatus(info) {
  runtimeVersion.value = info?.version || ''
  runtimeLatestVersion.value = info?.latestVersion || ''
  if (info?.ready) {
    runtimeStatus.value = 'ready'
    runtimeMessage.value = info.message || ''
    runtimeProgress.value = { phase: '', percent: 100, downloaded: 0, total: 0 }
    return true
  }
  runtimeStatus.value = info?.status || 'missing'
  runtimeMessage.value = info?.message || '需要下载 OCR 运行时后才能识别'
  runtimeProgress.value = { phase: '', percent: 0, downloaded: 0, total: 0 }
  return false
}

async function refreshRuntimeStatus() {
  if (!window.nativeOcr?.checkRuntime) {
    runtimeStatus.value = 'error'
    runtimeMessage.value = '当前环境不支持 OCR 运行时检查'
    return false
  }
  runtimeStatus.value = 'checking'
  runtimeMessage.value = '正在检查 OCR 运行时'
  try {
    return applyRuntimeStatus(await window.nativeOcr.checkRuntime())
  } catch (error) {
    runtimeStatus.value = 'error'
    runtimeMessage.value = formatError(error)
    return false
  }
}

async function startRuntimeDownload() {
  if (!window.nativeOcr?.installRuntime) {
    runtimeStatus.value = 'error'
    runtimeMessage.value = '当前环境不支持 OCR 运行时下载'
    return
  }
  runtimeStatus.value = 'checking'
  runtimeMessage.value = '正在获取 OCR 运行时版本'
  runtimeProgress.value = { phase: 'metadata', percent: 0, downloaded: 0, total: 0 }
  try {
    const status = await window.nativeOcr.installRuntime((progress = {}) => {
      const phase = progress.phase || ''
      if (progress.version) runtimeLatestVersion.value = progress.version
      runtimeProgress.value = {
        phase,
        percent: Number(progress.percent || 0),
        downloaded: Number(progress.downloaded || 0),
        total: Number(progress.total || 0)
      }
      if (phase === 'download') {
        runtimeStatus.value = 'downloading'
        runtimeMessage.value = runtimeLatestVersion.value
          ? `正在下载 ${runtimeLatestVersion.value}`
          : '正在下载 OCR 运行时'
      } else if (phase === 'extract') {
        runtimeStatus.value = 'extracting'
        runtimeMessage.value = '正在解包 OCR 运行时'
      } else if (phase === 'done') {
        runtimeStatus.value = 'ready'
        runtimeMessage.value = ''
      }
    })
    applyRuntimeStatus(status)
    showToast('OCR 运行时已就绪')
    const pending = pendingRecognition
    pendingRecognition = null
    if (pending) await recognizeSource(pending.source, pending.preview)
  } catch (error) {
    runtimeStatus.value = 'error'
    runtimeMessage.value = formatError(error)
  }
}

async function waitForUiPaint() {
  await nextTick()
  await new Promise((resolve) => {
    if (typeof window.requestAnimationFrame !== 'function') {
      window.setTimeout(resolve, 0)
      return
    }
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(resolve)
    })
  })
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ''))
    reader.onerror = () => reject(reader.error || new Error('读取图片失败'))
    reader.readAsDataURL(file)
  })
}

async function previewForSource(source) {
  if (typeof source === 'string' && source.startsWith('data:image/')) return source
  if (window.nativeOcr?.readImageDataUrl) {
    return window.nativeOcr.readImageDataUrl(source)
  }
  return ''
}

function recognizeWithEngine(source) {
  if (engine.value === 'vision') return window.nativeOcr.recognizeVision(source)
  if (engine.value === 'rapidocr') return window.nativeOcr.recognizeOnnxOcr(source)
  if (engine.value === 'formula') return window.nativeOcr.recognizeOnnxFormula(source)
  return window.nativeOcr.recognize(source)
}

// WebP/BMP/GIF 等格式服务端解码硬限制只认 PNG/JPEG——在入口统一转 PNG 中转，服务端不动。
// 数据源均为 dataURL（拖拽/粘贴/截图统一走 FileReader），canvas 可解码 Chromium 支持的全部格式。
function dataUrlSubtype(src) {
  const m = /^data:image\/([a-zA-Z0-9.+-]+);/.exec(src || '')
  return m ? m[1].toLowerCase() : ''
}

function convertDataUrlToPng(src) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas')
        canvas.width = img.naturalWidth || img.width
        canvas.height = img.naturalHeight || img.height
        canvas.getContext('2d').drawImage(img, 0, 0)
        resolve(canvas.toDataURL('image/png'))
      } catch (err) {
        reject(err)
      }
    }
    img.onerror = () => reject(new Error('图片解码失败'))
    img.src = src
  })
}

async function ensureRecognizableSource(src) {
  if (typeof src !== 'string' || !src.startsWith('data:image/')) return src
  const sub = dataUrlSubtype(src)
  if (sub === 'png' || sub === 'jpeg' || sub === 'jpg') return src
  try {
    return await convertDataUrlToPng(src)
  } catch (_) {
    return src // 转换失败保留原样，让服务端报出原始错误
  }
}

async function recognizeSource(source, preview = '', force = false) {
  if (!source || loading.value) return
  // #11：非 PNG/JPEG 一律先转 PNG（含 preview——多公式路径把 previewSrc 当识别输入）。
  source = await ensureRecognizableSource(source)
  if (preview) preview = await ensureRecognizableSource(preview)
  if (engine.value === 'rapidocr' && !onnxReady.value) {
    showToast('请先下载 ONNX OCR 引擎')
    return
  }
  if (engine.value === 'formula' && !formulaReady.value) {
    showToast('请先下载公式识别模型')
    return
  }
  if (engine.value === 'mixed' && !mfdReady.value) {
    showToast('请先下载图文混排模型')
    return
  }
  if (engine.value !== 'vision' && engine.value !== 'rapidocr' && engine.value !== 'formula' && engine.value !== 'mixed' && !runtimeReady.value) {
    pendingRecognition = { source, preview }
    try {
      previewSrc.value = preview || await previewForSource(source)
    } catch (_) {
      // Keep the download prompt usable even if preview loading fails.
    }
    showToast('请先下载 OCR 运行时')
    return
  }
  if (!force && source === lastSource && rawResultText.value) return
  // 仅新图（source 变化）清空手工排除状态与框 resize override；同一张图的滑块/切换重跑保留。
  if (source !== lastSource) {
    mixedExcludedKeys.value = new Set()
    mixedBoxOverrides.value = new Map()
  }
  lastSource = source
  lastRecognizedSource.value = source
  loading.value = true
  isFirstRunLoading.value = !hasRecognizedOnce
  loadingMessage.value = isFirstRunLoading.value
    ? (engine.value === 'vision'
      ? '正在识别'
      : engine.value === 'rapidocr'
        ? '正在加载 ONNX OCR 模型'
        : engine.value === 'formula'
          ? '正在加载公式识别模型'
          : '正在加载 OCR')
    : '识别中'
  rawResultText.value = ''
  lastResult.value = null
  mixedSegments.value = []
  mixedWarnings.value = []
  formulaItems.value = []
  activeFormulaIndex.value = -1
  let attemptedRecognition = false
  try {
    previewSrc.value = preview || await previewForSource(source)
    await waitForUiPaint()
    attemptedRecognition = true
    if (engine.value === 'mixed') {
      await recognizeMixed(source)
    } else if (engine.value === 'formula' && mfdReady.value) {
      await recognizeFormulaMulti(source)
    } else {
      if (engine.value === 'formula' && !mfdReady.value && !formulaMultiHintShown) {
        formulaMultiHintShown = true
        showToast('未安装 MFD 模型，使用单公式模式；安装图文混排模型后可自动多公式框选')
      }
      const result = await recognizeWithEngine(source)
      lastResult.value = result || null
      rawResultText.value = result?.text || ''
      if (rawResultText.value) {
        pushHistory(rawResultText.value, result?.engine)
        if (tableMode.value && tableAvailable.value) {
          resultView.value = 'table'
        }
      } else {
        showToast('未识别到文字')
      }
    }
  } catch (error) {
    rawResultText.value = ''
    lastResult.value = null
    showToast(formatError(error))
  } finally {
    if (attemptedRecognition) hasRecognizedOnce = true
    loading.value = false
    isFirstRunLoading.value = false
  }
}

// ===========================================================================
// 图文混排（mixed text + formula）
// ===========================================================================

// 把任意 box 写法归一化为 [x1, y1, x2, y2]（支持 [x1,y1,x2,y2] 与 {x,y,w,h}）。
function normalizeMixedBox(box) {
  if (!box) return [0, 0, 0, 0]
  if (Array.isArray(box)) {
    const [a, b, c, d] = box
    return [Number(a) || 0, Number(b) || 0, Number(c) || 0, Number(d) || 0]
  }
  if (typeof box === 'object') {
    if ('x1' in box && 'y1' in box && 'x2' in box && 'y2' in box) {
      return [box.x1, box.y1, box.x2, box.y2]
    }
    if ('x' in box && 'y' in box && 'w' in box && 'h' in box) {
      return [box.x, box.y, box.x + box.w, box.y + box.h]
    }
  }
  return [0, 0, 0, 0]
}

// 从文本引擎的识别结果里抽取带框文本行，映射到 mixed API 需要的 textLines。
// 文本引擎选择：macOS 优先 vision，其他平台用 onnx（保持简单，见函数注释）。
function extractMixedTextLines(result) {
  if (!result) return []
  const lines = result.lines || result.data || result.boxes
  if (!Array.isArray(lines)) return []
  const out = []
  for (const line of lines) {
    if (!line) continue
    const text = line.text != null ? String(line.text) : ''
    const box = line.box || line.position || line.bbox
    if (!box) continue
    const item = { text, box: normalizeMixedBox(box), score: Number.isFinite(line.score) ? line.score : 1 }
    // 逐字符框：Vision 会返回它，用于把「一行文字里夹着行内公式」的整行按公式区间切开。
    // 坐标与 line.box 同为归一化底左，由 normalizedBottomLeftToPixels 一并换算。
    if (Array.isArray(line.chars) && line.chars.length) {
      item.chars = line.chars
    }
    out.push(item)
  }
  return out
}

// 与 formulaHtml 同款的 KaTeX 三级容错渲染（renderMath 回调用）。
function renderMixedMath(latex, displayMode) {
  const raw = String(latex || '').trim()
  if (!raw) return ''
  const options = { displayMode, throwOnError: true, strict: false, trust: false, output: 'htmlAndMathml' }
  try {
    return katex.renderToString(raw, options)
  } catch (_) {
    // 落到容错路径
  }
  const repaired = sanitizeLatexForRender(raw)
  if (repaired !== raw) {
    try {
      return katex.renderToString(repaired, options)
    } catch (_) {
      // 继续
    }
  }
  try {
    return katex.renderToString(raw, { ...options, throwOnError: false, errorColor: '#c0392b' })
  } catch (error) {
    return `<span class="mixed-math-error" title="${
      (error && error.message ? error.message : 'LaTeX 解析失败').replace(/"/g, '&quot;')
    }">${raw.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</span>`
  }
}

const mixedRenderHtml = computed(() => {
  if (engine.value !== 'mixed' || !mixedSegments.value.length) return ''
  let html = segmentsToHtml(mixedSegments.value, { renderMath: renderMixedMath })
  const ai = activeMixedIndex.value
  if (ai >= 0) {
    html = html.replace(
      `data-mixed-index="${ai}"`,
      `data-mixed-index="${ai}" class="mixed-seg-active"`
    )
  }
  return html
})

// 把预览图按比例定位到 overlay 容器（overlay 覆盖在 img 之上，随 transform 缩放/平移）。
function mixedBoxStyle(box) {
  const img = previewImageRef.value
  const W = (mixedImageSize.value && mixedImageSize.value.w) || (img && img.naturalWidth) || 1
  const H = (mixedImageSize.value && mixedImageSize.value.h) || (img && img.naturalHeight) || 1
  const [x1, y1, x2, y2] = expandBoxForDisplay(box, mixedBoxPad.value, { w: W, h: H })
  return {
    left: `${(x1 / W) * 100}%`,
    top: `${(y1 / H) * 100}%`,
    width: `${((x2 - x1) / W) * 100}%`,
    height: `${((y2 - y1) / H) * 100}%`
  }
}

// 把 [x1,y1,x2,y2] 按 pad 外扩并 clamp 到图片尺寸（仅用于 overlay 显示，不改动源数据）。
function expandBoxForDisplay(box, pad, size) {
  const [x1, y1, x2, y2] = box || [0, 0, 0, 0]
  const W = (size && size.w) || 1
  const H = (size && size.h) || 1
  const p = Number(pad) || 0
  return [
    Math.max(0, x1 - p),
    Math.max(0, y1 - p),
    Math.min(W, x2 + p),
    Math.min(H, y2 + p)
  ]
}

// 框的稳定键：归一化后取整拼接，用于跨重跑匹配排除状态。
function boxKey(box) {
  const [x1, y1, x2, y2] = normalizeMixedBox(box)
  return [x1, y1, x2, y2].map((v) => Math.round(v)).join(',')
}

// 多公式 overlay 定位（外扩后），对齐 mixedBoxStyle 的百分比写法。
function formulaBoxStyle(box) {
  const img = previewImageRef.value
  const W = (formulaImageSize.value && formulaImageSize.value.w) || (img && img.naturalWidth) || 1
  const H = (formulaImageSize.value && formulaImageSize.value.h) || (img && img.naturalHeight) || 1
  const [x1, y1, x2, y2] = expandBoxForDisplay(box, formulaBoxPad.value, { w: W, h: H })
  return {
    left: `${(x1 / W) * 100}%`,
    top: `${(y1 / H) * 100}%`,
    width: `${((x2 - x1) / W) * 100}%`,
    height: `${((y2 - y1) / H) * 100}%`
  }
}

// 多公式每行预览：独立公式用 displayMode，行内公式用行内模式（三档容错同 mixed）。
function formulaRowHtml(item) {
  if (!item) return ''
  return renderMixedMath(item.latex, item.type !== 'embedding')
}

const formulaVisibleItems = computed(() => formulaItems.value.filter((i) => !i.excluded))
// B8：已排除的公式项（panel 头部下方 chip 行管理）。
const excludedFormulaItems = computed(() => formulaItems.value.filter((i) => i.excluded))

const formulaMultiJoined = computed(() =>
  formulaVisibleItems.value.map((i) => i.latex).filter(Boolean).join('\n\n')
)

// 标注框拖拽/平移（公式、混排页签 overlay 未排除框共用）：实时态与防误触标记。
// formulaResizing = { mode:'formula'|'mixed', index, corner, startX, startY, origBox, imgW, imgH }
const formulaResizing = ref(null) // 拖拽/平移进行中的状态
const formulaResizeBox = ref(null) // 实时 [x1,y1,x2,y2] 原图像素（拖拽中覆盖显示）
const formulaDragMoved = ref(false) // 拖拽/平移位移 >2px 置真，pointerup 后抑制 click 误触发排除

// 去抖重跑：toggle 排除与拖拽/平移提交共用，600ms 合并连续操作。
function scheduleFormulaRerun() {
  if (formulaExcludeTimer) clearTimeout(formulaExcludeTimer)
  formulaExcludeTimer = window.setTimeout(() => {
    formulaExcludeTimer = 0
    rerunFormulaMultiWithSelection()
  }, 600)
}

// 点击公式框/行头切换「排除」并按 boxKey 去抖重跑（仅识别保留框）。
// 拖拽/平移结束的 click 会被 formulaDragMoved 守卫拦截，避免误切换排除状态。
// 0.7.9：排除/恢复都 toast 反馈——排除的行从右栏消失（仅剩灰框+芯片），不提示会被误认为误删。
function toggleFormulaExclude(item) {
  if (formulaDragMoved.value) {
    formulaDragMoved.value = false
    return
  }
  const idx = formulaItems.value.indexOf(item)
  activeFormulaIndex.value = idx
  item.excluded = !item.excluded
  showToast(item.excluded
    ? `已排除 #${idx}（点灰色框或「已排除」芯片可恢复）`
    : `已恢复 #${idx}`)
  scheduleFormulaRerun()
}

// B8：全部恢复已排除的公式框。
function restoreAllExcluded() {
  for (const item of formulaItems.value) item.excluded = false
  scheduleFormulaRerun()
}

// 左右联动统一索引：overlay 循环用 formulaItems 下标，右栏行循环用 formulaVisibleItems，
// 但两者引用同一 item 对象，indexOf 结果一致（n 很小，无性能问题）。
function formulaItemIndex(item) {
  return formulaItems.value.indexOf(item)
}

// 显示 px → 原图像素 的比例：用实时 img 渲染矩形宽高反推，兼容 contain-fit 缩放。
// 公式用 formulaImageSize，混排用 mixedImageSize（同一 previewImageRef 渲染，rect 相同）。
function displayRatioFor(st) {
  const img = previewImageRef.value
  if (!img || !st.imgW || !st.imgH) return { rx: 1, ry: 1 }
  const rect = img.getBoundingClientRect()
  if (!rect.width || !rect.height) return { rx: 1, ry: 1 }
  return { rx: st.imgW / rect.width, ry: st.imgH / rect.height }
}

// 启动框体拖拽/平移。corner='move' 表示整体平移，否则为四角之一缩放。
// mode 区分 formula（写回 formulaItems.box）/ mixed（写 override 到 mixedBoxOverrides）。
function startResize(event, mode, item, corner) {
  event.stopPropagation()
  event.preventDefault()
  let index
  const origBox = normalizeMixedBox(item.box)
  if (mode === 'formula') {
    if (item.excluded) return
    index = formulaItems.value.indexOf(item)
  } else {
    if (mixedExcludedKeys.value.has(boxKey(item.box))) return
    index = mixedFormulaSegments.value.findIndex((s) => boxKey(s.box) === boxKey(item.box))
  }
  if (index < 0) return
  const imgSize = mode === 'formula' ? formulaImageSize.value : mixedImageSize.value
  formulaResizing.value = { mode, index, corner, startX: event.clientX, startY: event.clientY, origBox, imgW: imgSize.w || 1, imgH: imgSize.h || 1 }
  formulaResizeBox.value = origBox
  formulaDragMoved.value = false
  window.addEventListener('pointermove', onFormulaResizeMove)
  window.addEventListener('pointerup', onFormulaResizeUp)
}

function onFormulaResizeMove(event) {
  const st = formulaResizing.value
  if (!st) return
  const { rx, ry } = displayRatioFor(st)
  const dx = (event.clientX - st.startX) * rx
  const dy = (event.clientY - st.startY) * ry
  const W = st.imgW
  const H = st.imgH
  const MIN = 8
  let [x1, y1, x2, y2] = st.origBox
  if (st.corner === 'move') {
    const w = x2 - x1
    const h = y2 - y1
    x1 = Math.min(Math.max(0, x1 + dx), W - w)
    y1 = Math.min(Math.max(0, y1 + dy), H - h)
    x2 = x1 + w
    y2 = y1 + h
  } else {
    if (st.corner.includes('w')) x1 = Math.min(Math.max(0, x1 + dx), x2 - MIN)
    if (st.corner.includes('e')) x2 = Math.min(Math.max(x1 + MIN, x2 + dx), W)
    if (st.corner.includes('n')) y1 = Math.min(Math.max(0, y1 + dy), y2 - MIN)
    if (st.corner.includes('s')) y2 = Math.min(Math.max(y1 + MIN, y2 + dy), H)
  }
  formulaResizeBox.value = [x1, y1, x2, y2]
  if (Math.abs(event.clientX - st.startX) > 2 || Math.abs(event.clientY - st.startY) > 2) formulaDragMoved.value = true
}

function onFormulaResizeUp() {
  window.removeEventListener('pointermove', onFormulaResizeMove)
  window.removeEventListener('pointerup', onFormulaResizeUp)
  const st = formulaResizing.value
  const finalBox = formulaResizeBox.value
  formulaResizing.value = null
  formulaResizeBox.value = null
  if (!st || !finalBox || !formulaDragMoved.value) return
  const box = normalizeMixedBox([
    Math.round(finalBox[0]),
    Math.round(finalBox[1]),
    Math.round(finalBox[2]),
    Math.round(finalBox[3])
  ])
  if (st.mode === 'formula') {
    formulaItems.value[st.index].box = box
    scheduleFormulaRerun()
  } else {
    const seg = mixedFormulaSegments.value[st.index]
    if (!seg) return
    const key = boxKey(seg.box)
    const next = new Map(mixedBoxOverrides.value)
    next.set(key, box)
    mixedBoxOverrides.value = next
    scheduleMixedRerun()
  }
}

// 公式框体整体平移：框体（非角点）pointerdown 进入潜在平移态，复用 startResize(corner='move')。
function startFormulaMove(event, item) {
  startResize(event, 'formula', item, 'move')
}

async function recognizeFormulaMulti(source, opts = {}) {
  const dataUrl = previewSrc.value || source
  const givenBoxes = opts.givenBoxes
  let res
  try {
    if (givenBoxes) {
      // 框选路径：跳过 MFD 检测，只对给定框逐个裁剪识别（省一次检测）。
      res = await window.nativeOcr.recognizeOnnxFormulas(dataUrl, { boxPad: formulaBoxPad.value, conf: formulaConf.value, boxes: givenBoxes })
    } else {
      // 全量路径：服务端重新检测 + 识别。
      res = await window.nativeOcr.recognizeOnnxFormulas(dataUrl, { boxPad: formulaBoxPad.value, conf: formulaConf.value })
    }
  } catch (error) {
    showToast(formatError(error))
    return
  }
  if (!res || res.ok === false) {
    showToast('多公式识别失败')
    return
  }
  const rawItems = Array.isArray(res.items) ? res.items : []
  if (!givenBoxes) {
    // 全量检测：重新确定图片尺寸与排除状态。
    let size = res.image && res.image.w ? { w: res.image.w, h: res.image.h } : null
    if (!size || !size.w) {
      try {
        const el = await loadImageElement(dataUrl)
        size = { w: el.naturalWidth || el.width || 0, h: el.naturalHeight || el.height || 0 }
      } catch (_) {
        size = { w: 0, h: 0 }
      }
    }
    formulaImageSize.value = size
  }
  const prevByKey = new Map(formulaItems.value.map((i) => [boxKey(i.box), i]))
  let items
  if (givenBoxes) {
    // 框选路径：保留原顺序，按 boxKey 合并回 formulaItems；排除项不动。
    const freshByKey = new Map(rawItems.map((it) => [boxKey(it.box), it]))
    items = formulaItems.value.map((p) => {
      if (p.excluded) return p
      const fresh = freshByKey.get(boxKey(p.box))
      if (fresh) {
        return {
          type: fresh.type || 'isolated',
          score: Number.isFinite(fresh.score) ? fresh.score : 1,
          decodeScore: Number.isFinite(fresh.decodeScore) ? fresh.decodeScore : null,
          box: normalizeMixedBox(fresh.box),
          // 0.7.9 编辑保护：用户手动改过的 latex 不被重跑结果覆盖
          latex: p.edited ? p.latex : String(fresh.latex || ''),
          excluded: false,
          edited: !!p.edited
        }
      }
      return p
    })
  } else {
    // 全量路径：preserveExclusion 时按 boxKey 继承旧排除状态（conf 变化需重检测但保留手工排除）。
    items = rawItems.map((it) => {
      const prev = prevByKey.get(boxKey(it.box))
      const excluded = opts.preserveExclusion && prev ? prev.excluded : false
      return {
        type: it.type || 'isolated',
        score: Number.isFinite(it.score) ? it.score : 1,
        decodeScore: Number.isFinite(it.decodeScore) ? it.decodeScore : null,
        box: normalizeMixedBox(it.box),
        // 0.7.9 编辑保护：同框（boxKey 相同）且用户改过 latex 时保留手改内容
        latex: prev && prev.edited ? prev.latex : String(it.latex || ''),
        excluded,
        edited: prev ? !!prev.edited : false
      }
    })
  }
  formulaItems.value = items
  activeFormulaIndex.value = -1
  formulaEditIndex.value = -1
  // 排除项不参与历史/复制全部（当前编辑后的 latex 由 formulaMultiJoined 提供）。
  rawResultText.value = items.filter((i) => !i.excluded).map((i) => i.latex).filter(Boolean).join('\n\n')
  lastResult.value = null
  if (!items.length) showToast('未检测到公式')
}

// conf 滑块：全量重检测并继承保留的排除状态（省一次调用，丢弃 excluded 项的 latex 不显示）。
async function rerunFormulaMulti() {
  if (!formulaItems.value.length || formulaMultiBusy.value || !lastRecognizedSource.value) return
  formulaMultiBusy.value = true
  try {
    await recognizeFormulaMulti(lastRecognizedSource.value, { preserveExclusion: true })
  } finally {
    formulaMultiBusy.value = false
  }
}

// 框选变化路径（toggle 排除 / 框外扩滑块）：仅识别保留框，排除框不动。
async function rerunFormulaMultiWithSelection() {
  if (!formulaItems.value.length || formulaMultiBusy.value || !lastRecognizedSource.value) return
  const boxes = formulaItems.value
    .filter((i) => !i.excluded)
    .map((i) => ({ type: i.type, score: i.score, box: i.box }))
  if (!boxes.length) {
    showToast('已排除全部公式框')
    // 不发请求，清空全部 latex（保留灰显行以便恢复）。
    formulaItems.value = formulaItems.value.map((i) => ({ ...i, latex: '' }))
    rawResultText.value = ''
    return
  }
  formulaMultiBusy.value = true
  try {
    await recognizeFormulaMulti(lastRecognizedSource.value, { givenBoxes: boxes })
  } finally {
    formulaMultiBusy.value = false
  }
}

// 行级重识别：只对单个框重新裁剪识别，原地更新 latex/decodeScore，不动其他行。
async function rerecognizeFormulaItem(item) {
  if (!item || item.excluded || formulaMultiBusy.value || !lastRecognizedSource.value) return
  formulaMultiBusy.value = true
  item.rerunning = true
  try {
    const dataUrl = previewSrc.value || lastRecognizedSource.value
    const res = await window.nativeOcr.recognizeOnnxFormulas(dataUrl, {
      boxPad: formulaBoxPad.value,
      conf: formulaConf.value,
      boxes: [{ type: item.type, score: item.score, box: item.box }]
    })
    if (!res || res.ok === false) {
      showToast('重识别失败')
      return
    }
    const fresh = (res.items || []).find((it) => boxKey(normalizeMixedBox(it.box)) === boxKey(item.box))
    if (!fresh) {
      showToast('重识别失败：框未返回结果')
      return
    }
    item.latex = String(fresh.latex || '')
    item.decodeScore = Number.isFinite(fresh.decodeScore) ? fresh.decodeScore : null
    item.score = Number.isFinite(fresh.score) ? fresh.score : item.score
    item.edited = false // 显式重识别以新结果为准，清除编辑保护
    if (!item.latex) showToast('未识别出公式，可手动输入 LaTeX')
  } catch (error) {
    showToast(formatError(error))
  } finally {
    item.rerunning = false
    formulaMultiBusy.value = false
  }
}

// #13 公式页签文件导出：.tex（每条一行 LaTeX）与 .md（独立公式块）。
// 文本构建在 lib/formulaExport.js（P2-8 拆分，可单测）。
function exportFormulaTex() {
  const tex = buildFormulaTexExport(formulaVisibleItems.value)
  if (!tex) {
    showToast('暂无公式可导出')
    return
  }
  try {
    downloadBlob(new Blob([tex], { type: 'application/x-tex;charset=utf-8;' }), `native-ocr-formula-${Date.now()}.tex`)
    showToast('已导出 TEX')
  } catch (_) {
    showToast('导出失败')
  }
}

function exportFormulaMd() {
  const md = buildFormulaMdExport(formulaVisibleItems.value)
  if (!md) {
    showToast('暂无公式可导出')
    return
  }
  try {
    downloadBlob(new Blob([md], { type: 'text/markdown;charset=utf-8;' }), `native-ocr-formula-${Date.now()}.md`)
    showToast('已导出 MD')
  } catch (_) {
    showToast('导出失败')
  }
}

// P1-5：低置信行集合（decodeScore < -0.35 即「中/低」档），供一键批量重识别。
const lowConfidenceItems = computed(() => formulaVisibleItems.value.filter(
  (i) => Number.isFinite(Number(i.decodeScore)) && Number(i.decodeScore) < -0.35
))
const hasLowConfidenceItems = computed(() => lowConfidenceItems.value.length > 0)

// 低置信批量重识别：走 givenBoxes 框选路径，一次请求只重识别这些框，其余行不动。
async function rerecognizeLowConfidence() {
  if (!lowConfidenceItems.value.length || formulaMultiBusy.value || !lastRecognizedSource.value) return
  const boxes = lowConfidenceItems.value.map((i) => ({ type: i.type, score: i.score, box: i.box }))
  formulaMultiBusy.value = true
  try {
    await recognizeFormulaMulti(lastRecognizedSource.value, { givenBoxes: boxes })
  } finally {
    formulaMultiBusy.value = false
  }
}

// P1-6：多公式结果区多格式复制（与单公式预览的 copyFormula 互不冲突）。
// MathML 走富文本剪贴板（Word/Pages 可直接粘贴为公式）。
const formulaCopyMenuOpen = ref(false)

function formulaLatexJoined() {
  return formulaVisibleItems.value.map((i) => String(i.latex || '').trim()).filter(Boolean).join('\n\n')
}

function formulaRendered(format) {
  const items = formulaVisibleItems.value.map((i) => String(i.latex || '').trim()).filter(Boolean)
  const render = (latex, displayMode, output) => {
    try {
      return katex.renderToString(latex, { displayMode, throwOnError: false, strict: false, output })
    } catch (_) {
      return ''
    }
  }
  if (format === 'mathml') {
    const mathmls = items.map((latex) => render(latex, true, 'mathml')).filter(Boolean)
    const html = `<html><body><p>${mathmls.join('</p><p>')}</p></body></html>`
    return { html, plain: items.join('\n\n') }
  }
  // Unicode 纯文本：渲染 HTML 后取 textContent（结构丢失但可读，适合聊天/笔记快速粘贴）。
  const unicode = items
    .map((latex) => {
      const html = render(latex, true, 'html')
      if (!html) return latex
      const el = document.createElement('div')
      el.innerHTML = html
      return (el.textContent || '').replace(/\s+/g, ' ').trim() || latex
    })
    .join('\n')
  return { html: '', plain: unicode }
}

async function copyFormulaMulti(format) {
  const latex = formulaLatexJoined()
  if (!latex) {
    showToast('暂无公式')
    return
  }
  formulaCopyMenuOpen.value = false
  const { html, plain } = formulaRendered(format)
  try {
    if (html && navigator.clipboard && window.ClipboardItem) {
      const item = new window.ClipboardItem({
        'text/html': new Blob([html], { type: 'text/html' }),
        'text/plain': new Blob([plain], { type: 'text/plain' })
      })
      await navigator.clipboard.write([item])
      showToast('已复制富文本')
      return
    }
    await copyTextValue(plain)
  } catch (_) {
    await copyTextValue(plain)
  }
}

async function rerunMixedWithPad() {
  if (loading.value || !lastRecognizedSource.value) return
  await recognizeSource(lastRecognizedSource.value, previewSrc.value, true)
}

// P2-11：手动释放常驻 ONNX 服务进程，归还内存。下次识别自动重新拉起。
async function releaseOnnxServers() {
  try {
    const n = await window.nativeOcr.releaseOnnxServers()
    showToast(n > 0 ? `已释放 ${n} 个模型进程` : '当前没有常驻模型进程')
  } catch (_) {
    showToast('释放失败')
  }
}

// 去抖重跑：点击排除与拖拽提交共用，600ms 合并连续操作。
function scheduleMixedRerun() {
  if (mixedExcludeTimer) clearTimeout(mixedExcludeTimer)
  mixedExcludeTimer = window.setTimeout(() => {
    mixedExcludeTimer = 0
    rerunMixedWithPad()
  }, 600)
}

// 点击 overlay 框切换「排除」：加入/移出 mixedExcludedKeys（Set 整体重赋值保证响应性），去抖重跑。
function toggleMixedExclude(target) {
  const key = boxKey(target.box)
  const next = new Set(mixedExcludedKeys.value)
  if (next.has(key)) next.delete(key)
  else next.add(key)
  mixedExcludedKeys.value = next
  scheduleMixedRerun()
}

// 混排 overlay：活跃（未排除）公式段 —— 仅公式类，文本段不画框。
const mixedFormulaSegments = computed(() => mixedSegments.value.filter((s) => s.type !== 'text'))
// 混排 overlay：被排除的公式框（双列表，灰显，点击恢复）。
const mixedExcludedBoxes = computed(() =>
  mixedDetectedBoxes.value.filter((b) => mixedExcludedKeys.value.has(boxKey(b.box)))
)

// 把公式区域涂白，再交给文本引擎。文本引擎会把公式字形当成普通文字读进来
// （例如行内的 z、z~q(z|x) 会既出现在文本行里、又单独成为公式段），
// 遮罩后再做文本 OCR 可以避免这种重复。与 Pix2Text 的处理一致。
function maskFormulaRegions(imageEl, boxes, pad = 4) {
  const W = imageEl.naturalWidth || imageEl.width
  const H = imageEl.naturalHeight || imageEl.height
  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d')
  ctx.drawImage(imageEl, 0, 0, W, H)
  ctx.fillStyle = '#ffffff'
  for (const b of boxes || []) {
    const raw = b && b.box ? b.box : b
    const box = normalizeMixedBox(raw)
    const x1 = Math.max(0, Math.floor(box[0]) - pad)
    const y1 = Math.max(0, Math.floor(box[1]) - pad)
    const x2 = Math.min(W, Math.ceil(box[2]) + pad)
    const y2 = Math.min(H, Math.ceil(box[3]) + pad)
    if (x2 > x1 && y2 > y1) ctx.fillRect(x1, y1, x2 - x1, y2 - y1)
  }
  return canvas.toDataURL('image/png')
}

async function recognizeMixed(source) {
  mixedFormulaOnly.value = false
  mixedWarnings.value = []
  const dataUrl = previewSrc.value || source

  // 0) 图片自然尺寸：遮罩与坐标换算都以它为准（不能用预览的 CSS 尺寸）。
  let imageEl = null
  let natural = { w: 0, h: 0 }
  try {
    imageEl = await loadImageElement(dataUrl)
    natural = {
      w: imageEl.naturalWidth || imageEl.width || 0,
      h: imageEl.naturalHeight || imageEl.height || 0
    }
  } catch (_) {
    // 拿不到尺寸时后续会退化为「不传 textLines」，避免用错坐标空间。
  }

  // 1) 先做一次 MFD 检测：既用于画框，也用于「先把公式区域涂白再跑文本 OCR」。
  //    检测结果会回传给服务端复用，避免重复推理。
  let boxes = []
  try {
    const det = await window.nativeOcr.detectOnnxMfd(dataUrl, { conf: mixedConf.value })
    if (det && det.ok !== false && Array.isArray(det.boxes)) boxes = det.boxes
  } catch (_) {
    // 检测失败不致命：退化为不遮罩、由服务端自行检测。
  }
  // 先应用 resize override（B10）：key=检测框 boxKey，value=调整后 box。
  // 必须在排除过滤之前应用，保证「被 resize 框的排除键」与「过滤键」一致，避免排除功能被 resize 破坏。
  boxes = boxes.map((b) => {
    const key = boxKey(b.box)
    const ov = mixedBoxOverrides.value.get(key)
    return ov ? { ...b, box: ov } : b
  })
  // 存原始全部检测框（含后被排除的、含 resize 调整），用于 overlay 双列表；过滤后的 boxes 用于后续环节。
  mixedDetectedBoxes.value = boxes
  boxes = boxes.filter((b) => !mixedExcludedKeys.value.has(boxKey(b.box)))

  // 2) 文本半边：取带框文本行。macOS 优先 vision，否则用 onnx。
  //    若所选文本引擎不返回框（或失败），退化为 textLines: [] 仅做公式识别，并在 UI 提示。
  let textLines = []
  let usedVision = false
  let textSource = dataUrl
  // 遮罩策略（关键）：macOS Vision 会返回**逐字符框**（chars），此时**不遮罩**。
  // 让文本 OCR 原样读出公式字形，再由 splitTextLinePieces 按逐字符框把这些字形精确
  // 替换成公式段 —— 这样既消除「公式字形重复出现在文本里」，又能得到真正交错的
  // 「图文混排」阅读顺序（文本/公式交替，而不是整行文字后堆公式）。
  // 反过来，若先遮罩，公式区域被涂白、字符框自然落不到公式区间内，交错切分便无从判断。
  // 若文本引擎不返回 chars（如 Windows ONNX），无法定位公式字形，才退回老办法：
  // 先把公式区域涂白再 OCR，至少保证文本里不混入公式字形。
  const willUseVision = isMacPlatform && visionAvailable.value
  if (!willUseVision && boxes.length && imageEl) {
    try {
      textSource = maskFormulaRegions(imageEl, boxes)
    } catch (_) {
      textSource = dataUrl
    }
  }
  try {
    if (isMacPlatform && visionAvailable.value) {
      const r = await window.nativeOcr.recognizeVision(textSource)
      textLines = extractMixedTextLines(r)
      usedVision = true
    } else if (onnxReady.value) {
      const r = await window.nativeOcr.recognizeOnnxOcr(textSource)
      textLines = extractMixedTextLines(r)
    }
  } catch (_) {
    showToast('文本识别失败，已退化为仅公式识别')
  }

  // 3) macOS Vision 的 boundingBox 是「归一化 0..1、原点在左下」，而 MFD 的公式框是
  //    「原图像素、原点在左上」。两者不换算直接混用会让文本行坐标塌缩到图像左上角、
  //    全部挤进同一行，使合并顺序与丢弃判定静默失效 → 必须换算成像素坐标。
  if (usedVision && textLines.length) {
    if (natural.w > 0 && natural.h > 0) {
      textLines = normalizedBottomLeftToPixels(textLines, natural.w, natural.h)
    } else {
      // 尺寸未知时不冒险传错坐标。
      textLines = []
    }
  }
  if (!textLines.length) mixedFormulaOnly.value = true

  // 4) 调用图文混排识别（source 用原图 data URL，保证公式裁切与预览一致）。
  const mixed = await window.nativeOcr.recognizeOnnxMixed(dataUrl, { textLines, boxes, boxPad: mixedBoxPad.value, conf: mixedConf.value })
  if (!mixed || mixed.ok === false) {
    showToast('图文混排识别失败')
    return
  }
  // P1-4：保存本轮 textLines/boxes，供「混排行快速重识别」跳过文本 OCR 与 MFD 检测。
  lastMixedTextLines.value = textLines
  lastMixedBoxes.value = boxes
  if (Array.isArray(mixed.warnings) && mixed.warnings.length) {
    mixedWarnings.value = mixed.warnings.map((w) => String(w))
  }

  // 5) 优先用服务端 segments（已含阅读顺序与 lineNumber）；缺失时客户端兜底合并。
  const segs = Array.isArray(mixed.segments) && mixed.segments.length
    ? mixed.segments.map((s, i) => ({ ...s, box: normalizeMixedBox(s.box), index: i }))
    : mergeAndOrderSegments({ textLines, formulaBoxes: (mixed.boxes || []).map((b) => ({ type: b.type, score: b.score, box: b.box })) })
        .map((s, i) => ({ ...s, index: i }))
  mixedSegments.value = segs
  mixedImageSize.value = mixed.image && mixed.image.w ? { w: mixed.image.w, h: mixed.image.h } : natural
  // 客户端从 segments 生成 markdown（与服务端一致），保证编辑可同步、可往返。
  const md = segmentsToMarkdown(segs)
  mixedSource.value = md
  mixedView.value = 'render'
  activeMixedIndex.value = -1
  resultView.value = 'text'
  rawResultText.value = mixed.markdown || md
  if (!segs.length) showToast('未识别到内容')
}

// P1-4：混排行快速重识别——复用上轮 textLines/boxes（跳过文本 OCR 与 MFD 检测），
// 只重跑公式解码与合并。点任意公式 chip 的重识别按钮触发，全部公式行原地刷新。
async function rerecognizeMixedFormula() {
  if (mixedFastRerunning.value || loading.value || !lastRecognizedSource.value) return
  if (!lastMixedTextLines.value.length && !lastMixedBoxes.value.length) {
    showToast('请先做一次混排识别')
    return
  }
  mixedFastRerunning.value = true
  try {
    const dataUrl = previewSrc.value || lastRecognizedSource.value
    const mixed = await window.nativeOcr.recognizeOnnxMixed(dataUrl, {
      textLines: lastMixedTextLines.value,
      boxes: lastMixedBoxes.value,
      boxPad: mixedBoxPad.value,
      conf: mixedConf.value
    })
    if (!mixed || mixed.ok === false) {
      showToast('快速重识别失败')
      return
    }
    if (!(Array.isArray(mixed.segments) && mixed.segments.length)) {
      showToast('快速重识别无结果，已保留原内容')
      return
    }
    const segs = mixed.segments.map((s, i) => ({ ...s, box: normalizeMixedBox(s.box), index: i }))
    mixedSegments.value = segs
    mixedSource.value = segmentsToMarkdown(segs)
    rawResultText.value = mixed.markdown || segmentsToMarkdown(segs)
    activeMixedIndex.value = -1
    showToast('已重识别公式行')
  } catch (error) {
    showToast(formatError(error))
  } finally {
    mixedFastRerunning.value = false
  }
}

// 仅检测公式区域（不跑公式识别），用于低成本预览 boxes。
async function detectMixedOnly() {
  if (!previewSrc.value) {
    showToast('请先选择图片')
    return
  }
  if (!mfdReady.value) {
    showToast('请先下载图文混排模型')
    return
  }
  detectLoading.value = true
  try {
    const res = await window.nativeOcr.detectOnnxMfd(previewSrc.value, { conf: mixedConf.value })
    if (res && res.ok !== false) {
      const allBoxes = res.boxes || []
      mixedDetectedBoxes.value = allBoxes
      const boxes = allBoxes.filter((b) => !mixedExcludedKeys.value.has(boxKey(b.box)))
      mixedImageSize.value = res.image && res.image.w ? { w: res.image.w, h: res.image.h } : mixedImageSize.value
      mixedSegments.value = boxes.map((b, i) => ({
        type: b.type === 'isolated' ? 'isolated' : 'embedding',
        latex: '',
        box: normalizeMixedBox(b.box),
        score: b.score != null ? b.score : 1,
        lineNumber: 0,
        index: i
      }))
      mixedSource.value = segmentsToMarkdown(mixedSegments.value)
      mixedView.value = 'render'
      showToast(`检测到 ${boxes.length} 个公式区域`)
    } else {
      showToast('公式区域检测失败')
    }
  } catch (error) {
    showToast(`检测失败：${formatError(error)}`)
  } finally {
    detectLoading.value = false
  }
}

// 编辑「源文」后重新渲染：把 Markdown 解析回 segments（永不回写/改写用户源码）。
function applyMixedSource() {
  mixedSegments.value = markdownToSegments(mixedSource.value).map((s, i) => ({ ...s, box: s.box || [0, 0, 0, 0], index: i }))
  mixedView.value = 'render'
  showToast('已重新渲染')
}

function onMixedRenderHover(event) {
  const el = event.target.closest && event.target.closest('[data-mixed-index]')
  if (el) activeMixedIndex.value = Number(el.getAttribute('data-mixed-index'))
}

async function startMfdDownload() {
  if (!window.nativeOcr?.installOnnxMfd) {
    showToast('当前环境不支持下载图文混排模型')
    return
  }
  mfdDownloading.value = true
  mfdMessage.value = '正在检查运行环境'
  try {
    if (!onnxReady.value) {
      await window.nativeOcr.installOnnxRuntime((progress = {}) => {
        const percent = Number(progress.percent || 0)
        mfdMessage.value = `${progress.message || '下载 ONNX 引擎'} ${percent}%`
      })
      onnxReady.value = await window.nativeOcr.isOnnxOcrAvailable?.() || false
    }
    if (!onnxReady.value) {
      mfdMessage.value = 'ONNX 运行环境下载未完成，请重试'
      showToast('ONNX 运行环境下载未完成')
      return
    }
    if (!formulaReady.value) {
      await window.nativeOcr.installOnnxFormula((progress = {}) => {
        const percent = Number(progress.percent || 0)
        mfdMessage.value = `${progress.message || '下载公式模型'} ${percent}%`
      })
      formulaReady.value = await window.nativeOcr.isOnnxFormulaAvailable?.() || false
    }
    if (!formulaReady.value) {
      mfdMessage.value = '公式模型下载未完成，请重试'
      showToast('公式模型下载未完成')
      return
    }
    await window.nativeOcr.installOnnxMfd((progress = {}) => {
      const percent = Number(progress.percent || 0)
      mfdMessage.value = `${progress.message || '下载图文混排模型'} ${percent}%`
    })
    mfdReady.value = await window.nativeOcr.isOnnxMfdAvailable?.() || false
    if (mfdReady.value) {
      mfdMessage.value = ''
      showToast('图文混排模型已就绪')
    } else {
      mfdMessage.value = '下载流程已结束，但校验未通过，请重试'
      showToast('图文混排模型下载未完成')
    }
  } catch (error) {
    mfdMessage.value = `下载失败：${formatError(error)}`
    showToast('图文混排模型下载失败')
  } finally {
    mfdDownloading.value = false
  }
}

function loadImageElement(src) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('图片加载失败'))
    img.src = src
  })
}

function exportMixedMarkdown() {
  if (!mixedSegments.value.length) {
    showToast('暂无内容')
    return
  }
  const md = segmentsToMarkdown(mixedSegments.value)
  try {
    downloadBlob(new Blob([md], { type: 'text/markdown;charset=utf-8;' }), `native-ocr-mixed-${Date.now()}.md`)
    showToast('已导出 Markdown')
  } catch (_) {
    showToast('导出失败')
  }
}

function exportMixedTxt() {
  if (!mixedSegments.value.length) {
    showToast('暂无内容')
    return
  }
  const txt = segmentsToPlainText(mixedSegments.value)
  try {
    downloadBlob(new Blob([txt], { type: 'text/plain;charset=utf-8;' }), `native-ocr-mixed-${Date.now()}.txt`)
    showToast('已导出 TXT')
  } catch (_) {
    showToast('导出失败')
  }
}

// 自包含 HTML：公式用 KaTeX 的 MathML 输出（output:'mathml'），无需任何字体文件，
// 保存为 .html 后离线打开即可正确渲染（现代浏览器原生支持 MathML）。
function exportMixedHtml() {
  if (!mixedSegments.value.length) {
    showToast('暂无内容')
    return
  }
  const renderMath = (latex, displayMode) => {
    const raw = String(latex || '').trim()
    if (!raw) return ''
    try {
      return katex.renderToString(raw, { displayMode, throwOnError: false, output: 'mathml', strict: false })
    } catch (_) {
      return `<code>${raw.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</code>`
    }
  }
  const body = segmentsToHtml(mixedSegments.value, { renderMath })
  const html = `<!DOCTYPE html>
<html lang="zh">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>图文混排导出</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif; line-height: 1.9; max-width: 820px; margin: 24px auto; padding: 0 16px; color: #222; }
  .display-math { text-align: center; margin: 14px 0; overflow-x: auto; }
  .inline-math { display: inline-block; vertical-align: middle; }
  .mixed-math-error { color: #c0392b; }
</style>
</head>
<body>
${body}
</body>
</html>
`
  try {
    downloadBlob(new Blob([html], { type: 'text/html;charset=utf-8;' }), `native-ocr-mixed-${Date.now()}.html`)
    showToast('已导出 HTML')
  } catch (_) {
    showToast('导出失败')
  }
}

// 带标注图：把图片绘到 canvas，按类型叠加红/蓝框与序号，导出 PNG。
async function exportMixedPng() {
  if (!mixedSegments.value.length) {
    showToast('暂无内容')
    return
  }
  const src = previewSrc.value
  if (!src) {
    showToast('没有可绘制的图片')
    return
  }
  try {
    const img = await loadImageElement(src)
    const canvas = document.createElement('canvas')
    canvas.width = img.naturalWidth || img.width
    canvas.height = img.naturalHeight || img.height
    const ctx = canvas.getContext('2d')
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
    const W = canvas.width
    const H = canvas.height
    const isEmbed = (t) => t !== 'isolated'
    mixedSegments.value.forEach((seg, i) => {
      if (!seg.box) return
      const [x1, y1, x2, y2] = seg.box
      const color = isEmbed(seg.type) ? 'rgba(220,76,70,0.95)' : 'rgba(26,115,232,0.95)'
      ctx.strokeStyle = color
      ctx.lineWidth = Math.max(2, Math.round(W / 400))
      ctx.strokeRect(x1, y1, x2 - x1, y2 - y1)
      ctx.fillStyle = color
      ctx.font = `${Math.max(12, Math.round(W / 50))}px sans-serif`
      const ly = y1 - 4 < 6 ? y2 + Math.round(W / 50) : y1 - 4
      ctx.fillText(String(i), x1 + 2, ly)
    })
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'))
    if (!blob) {
      showToast('导出失败')
      return
    }
    downloadBlob(blob, `native-ocr-mixed-${Date.now()}.png`)
    showToast('已导出带标注图')
  } catch (error) {
    showToast(`导出失败：${formatError(error)}`)
  }
}

// 多格式复制：纯文本 / Markdown / LaTeX(仅公式) / 富文本 HTML。
// 富文本走 navigator.clipboard.write（text/html + text/plain），失败回退到纯文本。
async function copyMixed(format) {
  if (!mixedSegments.value.length) {
    showToast('暂无内容')
    return
  }
  const segs = mixedSegments.value
  let plain = ''
  let html = ''
  if (format === 'text') {
    plain = segmentsToPlainText(segs)
  } else if (format === 'markdown') {
    plain = segmentsToMarkdown(segs)
  } else if (format === 'latex') {
    plain = segmentsToLatex(segs)
  } else if (format === 'html') {
    const renderMath = (latex, displayMode) => {
      const raw = String(latex || '').trim()
      if (!raw) return ''
      try {
        return katex.renderToString(raw, { displayMode, throwOnError: false, output: 'mathml', strict: false })
      } catch (_) {
        return raw
      }
    }
    html = `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body>${segmentsToHtml(segs, { renderMath })}</body></html>`
    plain = segmentsToPlainText(segs)
  }
  copyMenuOpen.value = false
  try {
    if (html && navigator.clipboard && window.ClipboardItem) {
      const item = new window.ClipboardItem({
        'text/html': new Blob([html], { type: 'text/html' }),
        'text/plain': new Blob([plain], { type: 'text/plain' })
      })
      await navigator.clipboard.write([item])
      showToast('已复制富文本')
      return
    }
    await copyTextValue(plain)
  } catch (_) {
    await copyTextValue(plain)
  }
}

async function handleFile(file) {
  if (!file) return
  try {
    const dataUrl = await readFileAsDataUrl(file)
    const filePath = window.ztools?.getPathForFile ? window.ztools.getPathForFile(file) : ''
    await recognizeSource(filePath || dataUrl, dataUrl)
  } catch (error) {
    showToast(formatError(error))
  }
}

async function selectImage() {
  try {
    if (window.ztools?.showOpenDialog) {
      const files = await Promise.resolve(window.ztools.showOpenDialog({
        properties: ['openFile', 'multiSelections'],
        filters: [
          {
            name: 'Images & PDF',
            extensions: ['png', 'jpg', 'jpeg', 'webp', 'bmp', 'tif', 'tiff', 'pdf']
          }
        ]
      }))
      const picked = Array.isArray(files) ? files : files?.filePaths || []
      if (picked.length > 1) {
        const items = picked.map((filePath) => ({
          id: `batch-${Date.now()}-${batchSeq += 1}`,
          name: String(filePath).split(/[\\/]/).pop(),
          source: filePath,
          status: 'pending',
          text: '',
          error: ''
        }))
        batchItems.value = items
        runBatch()
        return
      }
      const filePath = picked[0] || files
      if (filePath) {
        recognizeSource(filePath)
        return
      }
    }
  } catch (error) {
    showToast(formatError(error))
  }
  fileInput.value?.click()
}

// ---------------------------------------------------------------------------
// 批量识别（多图 / PDF 多页）
// ---------------------------------------------------------------------------

let batchSeq = 0

async function loadPdfjs() {
  if (!pdfjsPromise) {
    pdfjsPromise = Promise.all([
      import('pdfjs-dist'),
      import('pdfjs-dist/build/pdf.worker.min.mjs?url')
    ]).then(([lib, workerModule]) => {
      lib.GlobalWorkerOptions.workerSrc = workerModule.default
      return lib
    })
  }
  return pdfjsPromise
}

async function pdfToPageItems(file) {
  const lib = await loadPdfjs()
  const data = await file.arrayBuffer()
  const doc = await lib.getDocument({ data }).promise
  const items = []
  const baseName = file.name.replace(/\.pdf$/i, '')
  for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber += 1) {
    const page = await doc.getPage(pageNumber)
    const viewport = page.getViewport({ scale: 2 })
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(viewport.width)
    canvas.height = Math.round(viewport.height)
    await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise
    items.push({
      id: `batch-${Date.now()}-${batchSeq += 1}`,
      name: `${baseName} · 第 ${pageNumber}/${doc.numPages} 页`,
      source: canvas.toDataURL('image/png'),
      status: 'pending',
      text: '',
      error: ''
    })
  }
  return items
}

async function fileToBatchItem(file) {
  let source = ''
  try {
    source = window.ztools?.getPathForFile ? window.ztools.getPathForFile(file) : ''
  } catch (_) {
    // Fall back to data URL below.
  }
  if (!source) source = await readFileAsDataUrl(file)
  return {
    id: `batch-${Date.now()}-${batchSeq += 1}`,
    name: file.name,
    source,
    status: 'pending',
    text: '',
    error: ''
  }
}

function batchStatusLabel(status) {
  return { pending: '等待', running: '识别中', done: '完成', failed: '失败' }[status] || status
}

const batchMergedText = computed(() => batchItems.value
  .filter((item) => item.status === 'done')
  .map((item) => `=== ${item.name} ===\n${item.text || '(未识别到文字)'}`)
  .join('\n\n'))

const batchActive = computed(() => batchItems.value.length > 0)

async function runBatch() {
  if (batchRunning.value) return
  // P0-2：批量按当前引擎分流——公式/混排引擎也支持批量（论文/试卷整批转 LaTeX/MD）。
  const batchEngine = engine.value === 'formula' && mfdReady.value
    ? 'formula'
    : engine.value === 'mixed' && mfdReady.value
      ? 'mixed'
      : 'plain'
  if (engine.value === 'mixed' && !mfdReady.value) {
    showToast('请先下载图文混排模型再批量识别')
    return
  }
  // 公式引擎无 MFD 时为单公式模式（batchEngine='plain' → recognizeWithEngine 兜底），合法不拦截。
  batchRunning.value = true
  try {
    for (const item of batchItems.value) {
      if (item.status !== 'pending') continue
      item.status = 'running'
      try {
        let text = ''
        if (batchEngine === 'formula') {
          // WebP 等 dataURL 先转 PNG（与单图入口同款兜底）；文件路径交给 preload 处理。
          const src = await ensureRecognizableSource(item.source)
          const res = await window.nativeOcr.recognizeOnnxFormulas(src, {
            boxPad: formulaBoxPad.value,
            conf: formulaConf.value
          })
          text = (res && Array.isArray(res.items) ? res.items : [])
            .map((it) => String(it.latex || '').trim())
            .filter(Boolean)
            .join('\n\n')
        } else if (batchEngine === 'mixed') {
          const src = await ensureRecognizableSource(item.source)
          const res = await window.nativeOcr.recognizeOnnxMixed(src, {
            boxPad: mixedBoxPad.value,
            conf: mixedConf.value,
            textLines: [],
            boxes: []
          })
          text = (res && res.markdown) || ''
        } else {
          const result = await recognizeWithEngine(item.source)
          text = result?.text || ''
          lastResult.value = result || null
        }
        item.text = text
        item.status = 'done'
        if (item.text) {
          pushHistory(item.text, batchEngine === 'plain' ? (lastResult.value?.engine || engine.value) : engine.value)
        }
      } catch (error) {
        item.status = 'failed'
        item.error = formatError(error)
      }
    }
    showToast('批量识别完成')
  } finally {
    batchRunning.value = false
  }
}

async function handleFiles(files) {
  const list = Array.from(files || []).filter(Boolean)
  if (!list.length) return
  const pdfs = list.filter((file) => /pdf$/i.test(file.type) || /\.pdf$/i.test(file.name))
  const images = list.filter((file) => !pdfs.includes(file))
  if (list.length === 1 && !pdfs.length) {
    handleFile(list[0])
    return
  }
  try {
    const items = []
    for (const file of images) items.push(await fileToBatchItem(file))
    for (const pdf of pdfs) items.push(...await pdfToPageItems(pdf))
    if (!items.length) return
    batchItems.value = items
    runBatch()
  } catch (error) {
    showToast(`批量加载失败：${formatError(error)}`)
  }
}

function copyBatchText() {
  if (!batchMergedText.value) {
    showToast('暂无批量结果')
    return
  }
  copyTextValue(batchMergedText.value)
}

function exportBatchTxt() {
  if (!batchMergedText.value) {
    showToast('暂无批量结果')
    return
  }
  try {
    downloadBlob(
      new Blob([batchMergedText.value], { type: 'text/plain;charset=utf-8;' }),
      `native-ocr-batch-${Date.now()}.txt`
    )
    showToast('已导出 TXT')
  } catch (_) {
    showToast('导出失败')
  }
}

function closeBatch() {
  if (batchRunning.value) return
  batchItems.value = []
}

function onFileSelected(event) {
  handleFiles(event.target.files)
  event.target.value = ''
}

function onDrop(event) {
  isDragging.value = false
  handleFiles(event.dataTransfer?.files)
}

// Ctrl+V 粘贴截图：从剪贴板找 image/* 项 → dataURL → 走与拖拽/选择相同的识别入口。
// 无图片项时不拦截，文本粘贴不受影响。
function onPaste(event) {
  const dt = event.clipboardData
  if (!dt || !dt.items) return
  let imageItem = null
  for (const it of dt.items) {
    if (it && typeof it.type === 'string' && it.type.startsWith('image/')) {
      imageItem = it
      break
    }
  }
  if (!imageItem) return
  const file = imageItem.getAsFile()
  if (!file) return
  const reader = new FileReader()
  reader.onload = () => {
    const dataUrl = reader.result
    if (typeof dataUrl === 'string' && dataUrl) recognizeSource(dataUrl, dataUrl)
  }
  reader.onerror = () => showToast('粘贴图片读取失败')
  reader.readAsDataURL(file)
}

function captureScreen() {
  if (!window.ztools?.screenCapture) {
    showToast('当前环境不支持截图')
    return
  }
  window.ztools.screenCapture((image) => {
    if (image) recognizeSource(image, image)
  })
}

function clearAll() {
  previewSrc.value = ''
  rawResultText.value = ''
  lastResult.value = null
  lastSource = ''
  lastRecognizedSource.value = ''
  translatedText.value = ''
  translationActive.value = false
  cellEdits.value = {}
  translatedCells.value = {}
  resultView.value = 'text'
  mixedSegments.value = []
  mixedSource.value = ''
  mixedView.value = 'render'
  activeMixedIndex.value = -1
  mixedFormulaOnly.value = false
  mixedWarnings.value = []
}

async function consumeAction(action) {
  if (action?.code === OCR_CAPTURE_CODE) {
    window.setTimeout(captureScreen, 50)
    return
  }
  const image = window.nativeOcr?.getImageFromAction?.(action)
  if (image) await recognizeSource(image)
}

async function consumePendingImage() {
  const pending = window.__NATIVE_OCR_PENDING_IMAGE__
  if (pending) {
    window.__NATIVE_OCR_PENDING_IMAGE__ = ''
    await recognizeSource(pending)
    return
  }
  try {
    const cached = window.ztools?.dbStorage?.getItem?.(OCR_IMAGE_STORAGE_KEY)
    if (cached) previewSrc.value = await previewForSource(cached)
  } catch (_) {
    // Ignore unavailable storage.
  }
}

function onOcrImageEvent(event) {
  const source = event.detail?.source || event.detail
  if (source) recognizeSource(source)
}

watch(engine, (value) => {
  try {
    localStorage.setItem('native_ocr_engine', value)
  } catch (_) {
    // Ignore storage failures.
  }
  lastSource = ''
  if (value === 'wechat') {
    tableMode.value = false
  }
  if (resultView.value === 'table' && !tableAvailable.value) {
    resultView.value = 'text'
  }
  // 切换引擎后自动用新引擎重新识别当前图片（新引擎未就绪时跳过，遮罩会引导下载）
  if (lastRecognizedSource.value && !loading.value && readyToRecognize.value) {
    recognizeSource(lastRecognizedSource.value, previewSrc.value, true)
  }
})

watch(tableAvailable, (available) => {
  if (!available && resultView.value === 'table') {
    resultView.value = 'text'
  }
})

watch(translateTarget, (val) => {
  try {
    localStorage.setItem('native_ocr_translate_target', String(val))
  } catch (_) {
    // Ignore storage failures.
  }
})

onMounted(async () => {
  window.addEventListener(OCR_IMAGE_EVENT, onOcrImageEvent)
  window.addEventListener('keydown', onGlobalKeydown)
  window.addEventListener('paste', onPaste)
  try {
    window.ztools?.onPluginEnter?.(consumeAction)
  } catch (_) {
    // Ignore host API failures.
  }
  try {
    visionAvailable.value = await window.nativeOcr?.isVisionAvailable?.() || false
  } catch (_) {
    // Ignore host API failures.
  }
  try {
    onnxReady.value = await window.nativeOcr?.isOnnxOcrAvailable?.() || false
  } catch (_) {
    // Ignore host API failures.
  }
  try {
    formulaReady.value = await window.nativeOcr?.isOnnxFormulaAvailable?.() || false
  } catch (_) {
    // Ignore host API failures.
  }
  try {
    mfdReady.value = await window.nativeOcr?.isOnnxMfdAvailable?.() || false
  } catch (_) {
    // Ignore host API failures.
  }
  // 微信 OCR 仅支持 macOS；Windows 上历史遗留的 wechat 引擎回退到本机 OCR
  if (engine.value === 'wechat' && !isMacPlatform) {
    engine.value = 'vision'
  }
  if (engine.value === 'vision' && !visionAvailable.value) {
    engine.value = 'rapidocr'
  }
  await refreshRuntimeStatus()
  await consumePendingImage()
})

onBeforeUnmount(() => {
  window.removeEventListener(OCR_IMAGE_EVENT, onOcrImageEvent)
  window.removeEventListener('keydown', onGlobalKeydown)
  window.removeEventListener('paste', onPaste)
  window.removeEventListener('pointermove', onSepDragMove)
  window.removeEventListener('pointermove', onPanMove)
  window.removeEventListener('pointermove', onFormulaResizeMove)
  window.removeEventListener('pointerup', onFormulaResizeUp)
  window.clearTimeout(toastTimer)
  if (stageResizeObserver) {
    stageResizeObserver.disconnect()
    stageResizeObserver = null
  }
})
</script>

<style scoped>
.ocr-shell {
  display: flex;
  flex-direction: column;
  width: 100%;
  /* 固定视口高度 + 禁整页滚动：左右栏各自管理内部滚动（预览自适应，结果区独立滚动） */
  height: 100vh;
  overflow: hidden;
  background: var(--bg-app);
  color: var(--text-primary);
}

.engine-selector {
  display: flex;
  align-items: center;
  gap: 10px;
  flex: 0 0 auto;
  padding: 8px 14px;
  background: var(--bg-surface);
  border-bottom: 1px solid var(--border-color);
}

.engine-label {
  color: var(--text-secondary);
  font-size: 13px;
  font-weight: 650;
}

.engine-tabs {
  display: inline-flex;
  gap: 4px;
  padding: 3px;
  border-radius: 8px;
  background: var(--bg-panel-muted);
}

.engine-tab {
  padding: 4px 12px;
  border-radius: 6px;
  background: transparent;
  color: var(--text-secondary);
  font-size: 13px;
  font-weight: 600;
  white-space: nowrap;
  cursor: pointer;
  transition: background 0.15s ease, color 0.15s ease;
}

.engine-tab:hover:not(:disabled):not(.active) {
  background: var(--bg-hover);
}

.engine-tab.active {
  background: var(--primary-color);
  color: var(--text-white);
  box-shadow: 0 1px 4px var(--primary-shadow);
}

.engine-tab:disabled {
  cursor: not-allowed;
  opacity: 0.45;
}

.engine-tab.pending {
  color: var(--text-tertiary);
}

.engine-tab-badge {
  margin-left: 6px;
  padding: 1px 5px;
  border-radius: 4px;
  background: var(--bg-panel-muted);
  color: var(--text-tertiary);
  font-size: 10px;
  font-weight: 600;
  vertical-align: 1px;
}

.engine-tab.active .engine-tab-badge {
  background: rgba(255, 255, 255, 0.25);
  color: var(--text-white);
}

.workbench {
  flex: 1;
  display: grid;
  grid-template-columns: minmax(280px, 1fr) minmax(360px, 1fr);
  min-height: 0;
  overflow: hidden;
  border-bottom: 1px solid var(--border-color);
}

.preview-pane {
  position: relative;
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  background: var(--bg-panel-muted);
  border-right: 1px solid var(--border-color);
}

/* 预览区：吃满左栏剩余高度，内部居中放置自适应后的截图 */
.preview-stage-area {
  flex: 1;
  min-height: 0;
  width: 100%;
  display: grid;
  place-items: center;
  position: relative;
  overflow: hidden;
}

/* 左栏底部「标记操作坞」：表格标记线 / 公式框标记相关操作集中在预览下方 */
.preview-dock {
  flex: 0 0 auto;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px 14px;
  padding: 8px 12px;
  background: var(--bg-surface);
  border-top: 1px solid var(--border-color);
}

.preview-dock .cluster-row {
  gap: 6px;
}

/* A1：公式页签 MFD 下载引导横幅（非阻塞，dock 位置） */
.mfd-hint-banner {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 4px 2px;
}
.mfd-hint-text {
  flex: 1;
  font-size: 13px;
  color: var(--text-secondary);
}
.mfd-hint-download {
  flex: 0 0 auto;
}
.mfd-hint-close {
  flex: 0 0 auto;
  border: none;
  background: transparent;
  font-size: 16px;
  line-height: 1;
  color: var(--text-tertiary);
  cursor: pointer;
  padding: 2px 6px;
  border-radius: 6px;
}
.mfd-hint-close:hover {
  background: var(--bg-hover-light);
  color: var(--text-primary);
}
.mfd-hint-progress {
  width: 100%;
  font-size: 12px;
  color: var(--text-tertiary);
  padding: 2px 2px 4px;
}

.preview-pane.dragging {
  background: var(--bg-hover-light);
  outline: 2px solid var(--primary-color);
  outline-offset: -2px;
}

.empty-state {
  display: grid;
  gap: 6px;
  place-items: center;
  color: var(--text-secondary);
  text-align: center;
}

.empty-icon {
  display: grid;
  width: 34px;
  height: 34px;
  place-items: center;
  color: var(--text-secondary);
  font-size: 22px;
}

.empty-title {
  font-size: 14px;
  font-weight: 650;
  color: var(--text-primary);
}

.empty-subtitle {
  font-size: 12px;
  color: var(--text-tertiary);
}

.preview-stage {
  position: relative;
  display: grid;
  place-items: center;
  width: 100%;
  height: 100%;
  min-height: 0;
  line-height: 0;
}

.preview-transform {
  position: relative;
  display: inline-block;
  transform-origin: 0 0;
}

.preview-image {
  display: block;
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
  user-select: none;
}

.preview-image:active {
  cursor: grabbing;
}

.batch-panel {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  padding: 10px 14px;
  overflow: hidden;
  background: var(--bg-app);
  z-index: 5;
}

.batch-head {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 0 0 auto;
  padding-bottom: 8px;
  border-bottom: 1px solid var(--border-color);
}

.batch-title {
  font-size: 13px;
  font-weight: 650;
  color: var(--text-primary);
}

.batch-list {
  flex: 1;
  min-height: 0;
  margin: 0;
  padding: 6px 0;
  overflow: auto;
  list-style: none;
}

.batch-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 5px 2px;
  font-size: 13px;
  border-bottom: 1px dashed var(--border-color);
}

.batch-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text-secondary);
}

.batch-status {
  flex: 0 0 auto;
  font-size: 12px;
  font-weight: 600;
  color: var(--text-tertiary);
}

.batch-status.running {
  color: var(--primary-color);
}

.batch-status.done {
  color: #1a9c6b;
}

.batch-status.failed {
  color: #d64545;
}

.lang-select {
  max-width: 110px;
  padding: 3px 6px;
  border: 1px solid var(--border-color);
  border-radius: 6px;
  background: var(--bg-surface);
  color: var(--text-primary);
  font-size: 12px;
}

.table-overlay {
  position: absolute;
  inset: 0;
  pointer-events: none;
}

.overlay-line {
  position: absolute;
  background: var(--primary-color);
  opacity: 0.45;
}

.row-line {
  left: 0;
  right: 0;
  height: 1px;
}

.col-line {
  top: 0;
  bottom: 0;
  width: 1px;
}

.table-overlay.interactive .overlay-line {
  pointer-events: auto;
  opacity: 0.7;
  touch-action: none;
}

.table-overlay.interactive .row-line {
  cursor: row-resize;
}

.table-overlay.interactive .col-line {
  cursor: col-resize;
}

.table-overlay.interactive .overlay-line::after {
  content: '';
  position: absolute;
  inset: -6px;
}

.table-overlay.interactive .row-line::after {
  left: 0;
  right: 0;
}

.table-overlay.interactive .col-line::after {
  top: 0;
  bottom: 0;
}

.busy-mask {
  position: absolute;
  inset: 0;
  display: grid;
  gap: 8px;
  place-content: center;
  background: var(--bg-overlay);
  color: var(--text-primary);
  font-size: 14px;
  font-weight: 650;
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
}

.runtime-mask {
  position: absolute;
  inset: 0;
  display: grid;
  gap: 10px;
  place-content: center;
  justify-items: center;
  padding: 24px;
  background: var(--bg-overlay);
  color: var(--text-primary);
  text-align: center;
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
}

.runtime-title {
  font-size: 15px;
  font-weight: 750;
}

.runtime-message {
  max-width: min(420px, calc(100vw - 48px));
  color: var(--text-secondary);
  font-size: 13px;
  line-height: 1.5;
}

.runtime-message .exe-path {
  display: inline-block;
  margin: 2px 0;
  padding: 2px 6px;
  max-width: 100%;
  border-radius: 4px;
  background: var(--switch-bg);
  color: var(--text-primary);
  font-size: 11px;
  word-break: break-all;
  user-select: all;
}

.runtime-progress {
  width: min(340px, calc(100vw - 56px));
  height: 8px;
  overflow: hidden;
  border-radius: 999px;
  background: var(--switch-bg);
}

.runtime-progress-bar {
  width: 0;
  height: 100%;
  border-radius: inherit;
  background: var(--primary-color);
  transition: width 0.18s ease;
}

.runtime-progress-text {
  color: var(--text-tertiary);
  font-size: 12px;
  line-height: 1.4;
}

.runtime-download-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 34px;
  padding: 0 14px;
  border-radius: 7px;
  background: var(--primary-color);
  color: var(--text-white);
  font-size: 14px;
  font-weight: 700;
  cursor: pointer;
  box-shadow: 0 2px 7px var(--primary-shadow);
}

.runtime-download-button:hover {
  background: var(--primary-hover);
}

.runtime-download-button.ghost {
  background: transparent;
  color: var(--text-secondary);
  font-weight: 500;
  box-shadow: none;
  border: 1px solid var(--switch-bg);
}

.runtime-download-button.ghost:hover {
  background: var(--switch-bg);
  color: var(--text-primary);
}

.loading-note {
  color: var(--text-secondary);
  font-size: 12px;
  font-weight: 500;
}

.spinner {
  width: 22px;
  height: 22px;
  margin: 0 auto;
  border: 2px solid var(--spinner-bg);
  border-top-color: var(--primary-color);
  border-radius: 999px;
  animation: spin 0.8s linear infinite;
}

.result-pane {
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  padding: 0;
  background: var(--bg-panel);
}

/* 结果区独立滚动：header 固定，内容随识别结果多少上下滚动 */
.result-scroll {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
}

/* 0.7.11：多公式模式下面板撑满右栏整列（head 固定，行列表内部滚动） */
.result-scroll.fill-mode {
  display: flex;
  flex-direction: column;
}

.result-scroll.fill-mode .formula-multi-panel {
  flex: 1;
  min-height: 0;
  max-height: none;
}

.result-header {
  display: flex;
  align-items: center;
  gap: 10px;
  flex: 0 0 auto;
  flex-wrap: wrap;
  min-height: 46px;
  padding: 6px 12px;
  border-bottom: 1px solid var(--border-color);
  background: var(--bg-surface);
}

.view-tabs {
  display: inline-flex;
  gap: 2px;
  flex: 0 0 auto;
  padding: 2px;
  border-radius: 7px;
  background: var(--bg-panel-muted);
}

.view-tab {
  padding: 3px 10px;
  border-radius: 5px;
  background: transparent;
  color: var(--text-secondary);
  font-size: 12px;
  font-weight: 650;
  white-space: nowrap;
  cursor: pointer;
  transition: background 0.15s ease, color 0.15s ease;
}

.view-tab:hover:not(:disabled):not(.active) {
  background: var(--bg-hover);
}

.view-tab.active {
  background: var(--primary-color);
  color: var(--text-white);
}

.view-tab:disabled {
  cursor: not-allowed;
  opacity: 0.45;
}

.table-toggle {
  flex: 1 1 auto;
  justify-content: center;
}

.result-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 0 0 auto;
}

.mini-button {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  min-height: 28px;
  padding: 0 10px;
  border-radius: 6px;
  background: var(--bg-panel-muted);
  color: var(--text-secondary);
  font-size: 12px;
  font-weight: 650;
  white-space: nowrap;
  cursor: pointer;
  transition: background 0.15s ease, color 0.15s ease;
}

.mini-button:hover:not(:disabled) {
  background: var(--bg-hover);
  color: var(--text-primary);
}

.mini-button.active {
  background: var(--primary-color);
  color: var(--text-white);
}

.mini-button:disabled {
  cursor: not-allowed;
  opacity: 0.48;
}

.mini-button.danger:hover:not(:disabled) {
  background: rgba(224, 67, 67, 0.16);
  color: #e04343;
}

.history-wrap {
  position: relative;
}

.history-badge {
  display: inline-grid;
  min-width: 16px;
  height: 16px;
  padding: 0 4px;
  place-items: center;
  border-radius: 999px;
  background: var(--primary-color);
  color: var(--text-white);
  font-size: 10px;
  font-weight: 700;
  line-height: 1;
}

.history-panel {
  position: absolute;
  top: calc(100% + 8px);
  right: 0;
  z-index: 20;
  display: flex;
  flex-direction: column;
  width: min(340px, calc(100vw - 24px));
  max-height: min(420px, 60vh);
  border-radius: 10px;
  border: 1px solid var(--border-color);
  background: var(--bg-overlay);
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.18);
  overflow: hidden;
  backdrop-filter: blur(14px);
  -webkit-backdrop-filter: blur(14px);
}

.history-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  flex: 0 0 auto;
  padding: 10px 12px;
  border-bottom: 1px solid var(--border-color);
}

.history-title {
  color: var(--text-primary);
  font-size: 13px;
  font-weight: 750;
}

.history-empty {
  padding: 24px 12px;
  color: var(--text-tertiary);
  font-size: 13px;
  text-align: center;
}

.history-list {
  flex: 1;
  min-height: 0;
  margin: 0;
  padding: 6px;
  overflow-y: auto;
  list-style: none;
}

.history-item {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 8px 10px;
  border-radius: 7px;
  cursor: pointer;
}

.history-item:hover {
  background: var(--bg-hover);
}

.history-thumb {
  flex: 0 0 auto;
  width: 48px;
  height: 48px;
  object-fit: cover;
  border-radius: 6px;
  border: 1px solid var(--border-color);
  background: var(--bg-panel-muted);
}
.history-item-actions {
  flex: 0 0 auto;
  display: flex;
  flex-direction: column;
  gap: 4px;
  align-items: stretch;
}
.history-refill {
  border: 1px solid var(--border-color);
  background: var(--bg-panel-muted);
  color: var(--text-secondary);
  border-radius: 5px;
  padding: 2px 8px;
  font-size: 11px;
  cursor: pointer;
  white-space: nowrap;
}
.history-refill:hover {
  border-color: var(--primary-color);
  color: var(--text-primary);
}

.history-item-main {
  flex: 1;
  min-width: 0;
}

.history-item-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 4px;
}

.history-engine {
  color: var(--primary-color);
  font-size: 11px;
  font-weight: 700;
}

.history-time {
  color: var(--text-tertiary);
  font-size: 11px;
}

.history-item-text {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  color: var(--text-primary);
  font-size: 12px;
  line-height: 1.5;
  word-break: break-all;
}

.history-delete {
  display: inline-grid;
  flex: 0 0 auto;
  width: 20px;
  height: 20px;
  place-items: center;
  border-radius: 5px;
  background: transparent;
  color: var(--text-tertiary);
  font-size: 15px;
  line-height: 1;
  cursor: pointer;
}

.history-delete:hover {
  background: var(--bg-hover);
  color: #e04343;
}

/* P1-7 历史搜索框 + 收藏按钮 */
.history-search {
  flex: 1 1 120px;
  min-width: 90px;
  max-width: 200px;
  padding: 3px 8px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg-primary);
  color: var(--text-primary);
  font-size: 12px;
  outline: none;
}

.history-search:focus {
  border-color: var(--accent, #4a7dff);
}

.history-fav {
  flex: 0 0 auto;
  border: none;
  background: transparent;
  color: var(--text-tertiary);
  font-size: 14px;
  line-height: 1;
  cursor: pointer;
  padding: 2px;
}

.history-fav.on {
  color: #e8a020;
}

.history-fav:hover {
  color: #e8a020;
}

/* P1-4 混排公式 chip 行 */
.mixed-fs-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  margin: 6px 0;
}

.mixed-fs-label {
  font-size: 11px;
  color: var(--text-tertiary);
}

.mixed-fs-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 1px 7px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--bg-primary);
  cursor: pointer;
}

.mixed-fs-chip.active {
  border-color: var(--accent, #4a7dff);
}

.mixed-fs-idx {
  font-size: 11px;
  font-weight: 600;
  color: var(--text-secondary);
}

/* P2-11 内存释放按钮：弱化样式，避免抢占注意力 */
.mem-release {
  font-size: 11px;
  opacity: 0.75;
}

.history-enter-active,
.history-leave-active {
  transition: opacity 0.15s ease, transform 0.15s ease;
}

.history-enter-from,
.history-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}

.result-pane textarea {
  width: 100%;
  /* 在 .result-scroll（block 容器）内 flex:1 失效：给足最小高度，随内容自身滚动 */
  flex: none;
  min-height: 100%;
  padding: 18px 20px;
  resize: none;
  border: 0;
  outline: 0;
  background: transparent;
  color: var(--text-primary);
  font-size: 16px;
  line-height: 1.6;
}

.result-pane textarea::placeholder {
  color: var(--text-tertiary);
}

/* --- 公式预览 --- */
.formula-preview {
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
  max-height: 46%;
  border-bottom: 1px solid var(--border-color);
  background: var(--bg-panel-muted);
}

.formula-preview-head {
  display: flex;
  align-items: baseline;
  gap: 10px;
  padding: 10px 20px 6px;
}

.formula-preview-title {
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.04em;
  color: var(--text-secondary);
}

.formula-preview-hint {
  margin-left: auto;
  font-size: 11px;
  color: var(--text-tertiary);
}

.formula-preview-fixed {
  flex-shrink: 0;
  padding: 1px 7px;
  border-radius: 4px;
  background: var(--formula-fixed-bg, rgba(214, 137, 16, 0.14));
  color: var(--formula-fixed-text, #a86a00);
  font-size: 11px;
  font-weight: 600;
  line-height: 1.6;
  cursor: help;
}

.formula-preview-body {
  flex: 1;
  min-height: 64px;
  overflow: auto;
  padding: 8px 20px 18px;
  color: var(--text-primary);
}

.formula-preview-body .katex-display {
  margin: 0;
}

.formula-preview-body .katex {
  font-size: 1.55em;
}

.formula-preview-error {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 12px 20px 18px;
}

.formula-error-badge {
  flex-shrink: 0;
  padding: 1px 7px;
  border-radius: 4px;
  background: var(--formula-error-bg, rgba(220, 76, 70, 0.12));
  color: var(--formula-error-text, #c0392b);
  font-size: 11px;
  font-weight: 600;
  line-height: 1.6;
}

.formula-error-msg {
  font-size: 12px;
  line-height: 1.6;
  color: var(--formula-error-text, #c0392b);
  word-break: break-word;
}

/* --- 多公式模式：图片上标记框 overlay --- */
.formula-overlay {
  position: absolute;
  inset: 0;
  pointer-events: none;
  z-index: 2;
}

/* A4：重识别进行中禁用 overlay 交互，防误拖/误触 */
.formula-overlay.busy {
  pointer-events: none;
}

.formula-box {
  position: absolute;
  box-sizing: border-box;
  border: 2px solid transparent;
  border-radius: 3px;
  font-size: 11px;
  line-height: 14px;
  color: #fff;
  pointer-events: auto;
  cursor: pointer;
  display: flex;
  align-items: flex-start;
  justify-content: flex-start;
  padding: 0 2px;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.6);
  background: rgba(0, 0, 0, 0.04);
}

.formula-box.embedding {
  border-color: rgba(220, 76, 70, 0.9);
  background: rgba(220, 76, 70, 0.12);
}

.formula-box.isolated {
  border-color: rgba(26, 115, 232, 0.9);
  background: rgba(26, 115, 232, 0.12);
}

.formula-box.active {
  border-width: 3px;
  background: rgba(255, 196, 0, 0.22);
  border-color: #ffc400;
  z-index: 3;
}

.formula-box.excluded {
  border-style: dashed;
  opacity: 0.35;
  background: transparent;
}

/* 标注框四角拖拽手柄（仅未排除框渲染） */
.formula-resize-handle {
  position: absolute;
  width: 12px;
  height: 12px;
  background: #fff;
  border: 2px solid #1a73e8;
  border-radius: 50%;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.35);
  pointer-events: auto;
  cursor: nwse-resize;
  z-index: 4;
}

.formula-resize-handle.corner-nw {
  left: -7px;
  top: -7px;
  cursor: nwse-resize;
}

.formula-resize-handle.corner-ne {
  right: -7px;
  top: -7px;
  cursor: nesw-resize;
}

.formula-resize-handle.corner-sw {
  left: -7px;
  bottom: -7px;
  cursor: nesw-resize;
}

.formula-resize-handle.corner-se {
  right: -7px;
  bottom: -7px;
  cursor: nwse-resize;
}

.formula-box.resizing {
  border-color: #ffc400;
  border-width: 3px;
}

.mixed-box.resizing {
  border-color: #ffc400;
  border-width: 3px;
  z-index: 3;
}

/* --- 多公式模式：结果面板 --- */
.formula-multi-panel {
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
  max-height: 52%;
  border-bottom: 1px solid var(--border-color);
  background: var(--bg-panel-muted);
}

.formula-multi-head {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 20px 6px;
  flex-wrap: wrap;
}

.formula-multi-hint,
.table-dock-hint {
  color: var(--text-tertiary);
  font-size: 12px;
  white-space: nowrap;
}

.formula-multi-title {
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.04em;
  color: var(--text-secondary);
}

.formula-pad-row,
.mixed-pad-row,
.formula-conf-row,
.mixed-conf-row {
  flex: 1 1 220px;
  min-width: 200px;
  flex-wrap: nowrap;
}

.formula-multi-list {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 4px 20px 16px;
}

.formula-multi-row {
  padding: 8px 0;
  border-top: 1px solid var(--border-color);
}

.formula-multi-row:first-child {
  border-top: none;
}

.formula-multi-row.active {
  background: rgba(255, 196, 0, 0.08);
}

.formula-multi-row-head {
  display: flex;
  align-items: center;
  gap: 8px;
}

.formula-multi-index {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 18px;
  height: 18px;
  padding: 0 4px;
  border-radius: 4px;
  background: var(--bg-elevated, rgba(127, 127, 127, 0.16));
  color: var(--text-secondary);
  font-size: 11px;
  font-weight: 600;
}

.formula-multi-type {
  font-size: 11px;
  font-weight: 600;
  padding: 1px 7px;
  border-radius: 4px;
}

.formula-multi-type.embedding {
  background: rgba(220, 76, 70, 0.14);
  color: #c0392b;
}

.formula-multi-type.isolated {
  background: rgba(26, 115, 232, 0.14);
  color: #1a73e8;
}

/* 解码置信度徽章：高=绿 中=橙 低=红，悬停 tooltip 显示具体分数 */
.formula-conf {
  font-size: 11px;
  font-weight: 600;
  padding: 1px 7px;
  border-radius: 4px;
  cursor: help;
}

.formula-conf.conf-high {
  background: rgba(30, 142, 62, 0.14);
  color: #1e8e3e;
}

.formula-conf.conf-mid {
  background: rgba(230, 145, 20, 0.16);
  color: #b06000;
}

.formula-conf.conf-low {
  background: rgba(220, 76, 70, 0.16);
  color: #c0392b;
}

.formula-multi-preview {
  margin: 6px 0;
  overflow-x: auto;
  color: var(--text-primary);
  /* 0.7.8：预览是主要展示形态，字号放大 */
  font-size: 16px;
  cursor: text;
}

.formula-multi-preview .katex-display {
  margin: 0;
}

.formula-multi-preview .katex {
  font-size: 1.6em;
}

.formula-multi-empty {
  margin: 6px 0;
  font-size: 12px;
  color: var(--text-tertiary);
}

.formula-all-excluded {
  margin: 10px 20px 16px;
  padding: 14px 16px;
  border: 1px dashed var(--border-color);
  border-radius: 8px;
  background: var(--bg-panel-muted);
  color: var(--text-secondary);
  font-size: 13px;
  text-align: center;
}

/* A4：重识别中 spinner + 文案 */
.formula-multi-rerun {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--text-secondary);
}
.formula-multi-rerun .spinner {
  width: 13px;
  height: 13px;
  margin: 0;
  border-width: 2px;
}

/* B8：已排除公式 chip 管理行 */
.excluded-chip-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  padding: 8px 20px;
  border-top: 1px dashed var(--border-color);
}
.excluded-chip-label {
  font-size: 12px;
  color: var(--text-tertiary);
}
.excluded-chip {
  border: 1px solid var(--border-color);
  background: var(--bg-panel-muted);
  color: var(--text-secondary);
  border-radius: 999px;
  padding: 2px 10px;
  font-size: 12px;
  cursor: pointer;
}
.excluded-chip:hover {
  border-color: var(--primary-color);
  color: var(--text-primary);
}
.excluded-restore-all {
  margin-left: auto;
}

.formula-multi-edit {
  /* 0.7.8：编辑框仅在编辑态显示，限宽不再占满整行 */
  width: 100%;
  max-width: 560px;
  min-height: 54px;
  resize: vertical;
  padding: 6px 8px;
  border: 1px solid var(--border-color);
  border-radius: 6px;
  background: var(--bg-input, #fff);
  color: var(--text-primary);
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 12px;
  line-height: 1.5;
  box-sizing: border-box;
}

.formula-multi-edit-foot {
  display: flex;
  justify-content: flex-end;
  margin: 4px 0 6px;
}

.table-view {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

.table-actions {
  flex: 0 0 auto;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--border-color);
}

.table-actions-row {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  min-width: 0;
}

.actions-spacer {
  flex: 1 1 auto;
}

.cluster-row {
  flex-wrap: nowrap;
}

.cluster-slider-label {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-secondary);
  white-space: nowrap;
}

.cluster-range {
  flex: 1 1 auto;
  min-width: 140px;
  accent-color: var(--primary-color);
}

.cluster-slider-value {
  min-width: 44px;
  text-align: right;
  font-variant-numeric: tabular-nums;
  color: var(--text-primary);
  font-size: 12px;
}

.table-dims {
  color: var(--text-tertiary);
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.table-scroll {
  flex: 1;
  min-height: 0;
  padding: 10px 14px;
  overflow: auto;
}

.table-preview-table {
  min-width: 100%;
  border-collapse: collapse;
  font-size: 13px;
  line-height: 1.5;
}

.table-preview-table td {
  min-width: 48px;
  padding: 6px 12px;
  border: 1px solid var(--border-color);
  color: var(--text-tertiary);
  vertical-align: top;
  white-space: pre-wrap;
  word-break: break-word;
}

.table-preview-table td.filled {
  color: var(--text-primary);
  font-weight: 500;
}

.table-preview-table td.low {
  background: rgba(255, 179, 0, 0.16);
}

.table-preview-table td.low::after {
  content: '±';
  float: right;
  color: #e6a23c;
  font-size: 11px;
  font-weight: 700;
}

.cell-edit {
  min-height: 1em;
  outline: none;
  cursor: text;
}

.table-preview-table td:focus-within {
  outline: 2px solid var(--primary-color);
  outline-offset: -2px;
  background: var(--bg-hover);
}

.translation-view {
  color: var(--text-secondary);
  font-style: italic;
}

.table-empty {
  display: grid;
  flex: 1;
  place-items: center;
  padding: 20px;
  color: var(--text-tertiary);
  font-size: 13px;
  text-align: center;
}

.toolbar {
  flex: 0 0 54px;
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto auto;
  align-items: center;
  gap: 12px;
  min-height: 54px;
  padding: 8px 14px;
  background: var(--bg-surface);
}

.left-actions {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 10px;
}

.right-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 10px;
}

.tool-button,
.copy-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  min-height: 34px;
  padding: 0 10px;
  border-radius: 7px;
  white-space: nowrap;
  cursor: pointer;
}

.tool-button {
  background: transparent;
  color: var(--text-secondary);
  font-size: 14px;
  font-weight: 650;
}

.tool-button:hover:not(:disabled) {
  background: var(--bg-hover);
}

.copy-button {
  min-width: 104px;
  background: var(--primary-color);
  color: var(--text-white);
  font-size: 14px;
  font-weight: 700;
  box-shadow: 0 2px 7px var(--primary-shadow);
}

.copy-button:hover:not(:disabled) {
  background: var(--primary-hover);
}

.tool-button:disabled,
.copy-button:disabled {
  cursor: not-allowed;
  opacity: 0.48;
}

.icon,
.copy-icon {
  display: inline-grid;
  width: 18px;
  place-items: center;
  font-size: 18px;
  line-height: 1;
}

.toggle {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  color: var(--text-secondary);
  font-size: 14px;
  font-weight: 600;
  white-space: nowrap;
  cursor: pointer;
}

.toggle.is-disabled {
  cursor: not-allowed;
  opacity: 0.5;
}

.toggle input {
  position: absolute;
  opacity: 0;
  pointer-events: none;
}

.switch {
  position: relative;
  width: 38px;
  height: 22px;
  flex: 0 0 auto;
  border-radius: 999px;
  background: var(--switch-bg);
  transition: background 0.16s ease;
}

.switch::after {
  position: absolute;
  top: 2px;
  left: 2px;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: var(--text-white);
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.24);
  content: "";
  transition: transform 0.16s ease;
}

.toggle input:checked + .switch {
  background: var(--primary-color);
}

.toggle input:checked + .switch::after {
  transform: translateX(16px);
}

.file-input {
  display: none;
}

.toast {
  position: fixed;
  right: 18px;
  bottom: 66px;
  max-width: min(420px, calc(100vw - 36px));
  padding: 10px 14px;
  border-radius: 7px;
  background: var(--toast-bg);
  color: var(--toast-text);
  font-size: 13px;
  line-height: 1.4;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.2);
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

@media (max-width: 760px) {
  .ocr-shell {
    grid-template-rows: minmax(0, 1fr) auto;
  }

  .workbench {
    grid-template-columns: 1fr;
    grid-template-rows: minmax(220px, 44vh) minmax(220px, 1fr);
  }

  .preview-pane {
    border-right: 0;
    border-bottom: 1px solid var(--border-color);
  }

  .result-header {
    flex-wrap: wrap;
    gap: 8px;
  }

  .table-toggle {
    flex-basis: 100%;
    justify-content: flex-start;
  }

  .result-pane textarea {
    padding: 14px;
    font-size: 15px;
  }

  .toolbar {
    grid-template-columns: 1fr;
    gap: 10px;
  }

  .left-actions {
    justify-content: space-between;
    gap: 4px;
  }

  .right-actions {
    justify-content: space-between;
    gap: 8px;
  }

  .tool-button,
  .copy-button {
    min-height: 32px;
    padding: 0 8px;
    font-size: 13px;
  }

  .toggle {
    justify-content: center;
  }
}

/* --- 图文混排：区域 overlay / 结果面板 / 复制菜单 --- */
.mixed-overlay {
  position: absolute;
  inset: 0;
  pointer-events: none;
  z-index: 2;
}

.mixed-box {
  position: absolute;
  box-sizing: border-box;
  border: 2px solid transparent;
  border-radius: 3px;
  font-size: 11px;
  line-height: 14px;
  color: #fff;
  pointer-events: auto;
  cursor: pointer;
  display: flex;
  align-items: flex-start;
  justify-content: flex-start;
  padding: 0 2px;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.6);
  background: rgba(0, 0, 0, 0.04);
}

.mixed-box.embedding {
  border-color: rgba(220, 76, 70, 0.9);
  background: rgba(220, 76, 70, 0.12);
}

.mixed-box.isolated {
  border-color: rgba(26, 115, 232, 0.9);
  background: rgba(26, 115, 232, 0.12);
}

.mixed-box.active {
  border-width: 3px;
  background: rgba(255, 196, 0, 0.22);
  border-color: #ffc400;
  z-index: 3;
}

.mixed-box.excluded {
  border-style: dashed;
  opacity: 0.35;
  background: transparent;
}

.mixed-panel {
  display: flex;
  flex-direction: column;
  min-height: 0;
  flex: 1;
  overflow: hidden;
}

.mixed-toolbar {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  padding: 8px 4px 10px;
  border-bottom: 1px solid var(--border-color);
}

.mixed-actions {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
  margin-left: auto;
}

.mixed-note {
  padding: 6px 8px;
  font-size: 12px;
  color: var(--text-secondary);
  background: var(--bg-panel-muted);
  border-radius: 6px;
}

.mixed-render {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 12px 14px;
  font-size: 15px;
  line-height: 1.8;
  word-break: break-word;
}

.mixed-render :deep(.inline-math) {
  display: inline-block;
  vertical-align: middle;
  margin: 0 1px;
}

.mixed-render :deep(.display-math) {
  display: block;
  text-align: center;
  margin: 10px 0;
  overflow-x: auto;
}

.mixed-render :deep([data-mixed-index]) {
  border-radius: 3px;
  transition: background 0.12s ease;
}

.mixed-render.has-active :deep([data-mixed-index]:hover),
.mixed-render :deep([data-mixed-index]:hover) {
  background: rgba(255, 196, 0, 0.18);
  cursor: pointer;
}

.mixed-render :deep(.mixed-seg-active) {
  background: rgba(255, 196, 0, 0.3);
  border-radius: 3px;
}

.mixed-source {
  flex: 1;
  min-height: 0;
  width: 100%;
  resize: none;
  border: none;
  outline: none;
  padding: 12px 14px;
  background: var(--bg-panel);
  color: var(--text-primary);
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 13px;
  line-height: 1.7;
}

.mixed-apply {
  align-self: flex-end;
  margin: 8px 12px;
}

.mixed-math-error {
  color: var(--formula-error-text);
}

.copy-menu-wrap {
  position: relative;
}

.copy-menu {
  position: absolute;
  right: 0;
  top: calc(100% + 4px);
  z-index: 20;
  display: flex;
  flex-direction: column;
  min-width: 140px;
  padding: 4px;
  border-radius: 8px;
  background: var(--bg-surface);
  border: 1px solid var(--border-color);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.18);
}

.copy-menu-item {
  padding: 6px 10px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--text-primary);
  font-size: 13px;
  text-align: left;
  cursor: pointer;
  white-space: nowrap;
}

.copy-menu-item:hover {
  background: var(--bg-hover);
}
</style>
