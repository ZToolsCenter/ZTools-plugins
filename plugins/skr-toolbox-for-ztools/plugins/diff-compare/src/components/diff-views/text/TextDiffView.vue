<script setup lang="ts">
/**
 * 文本差异对比视图组件
 * 使用 Monaco Editor 提供强大的文本对比功能
 * 支持语法高亮、多种编程语言、自动语言检测、主题切换等功能
 */

import { ref, computed, watch, watchEffect, onMounted, onUnmounted, shallowRef } from "vue";
import { useI18n } from "vue-i18n";
import * as monaco from 'monaco-editor/esm/vs/editor/editor.api'
import editorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker'
import ZSelect from "@/components/ui/ZSelect.vue";
import ZTooltip from "@/components/ui/ZTooltip.vue";
import ZButton from "@/components/ui/ZButton.vue";
import ZBadge from "@/components/ui/ZBadge.vue";
import ZIcon from "@/components/ui/ZIcon.vue";
import { useAutoFormat, langOptions } from "@/composables/useText";
import { useTheme } from "@/composables/useTheme";
import { toMonacoLanguage, detectLanguage } from "@/utils/formatter";
import { debounce } from "@/utils/common";

/**
 * Monaco Editor 环境配置
 * 只使用基础 editor worker，禁用语言服务以提升性能
 */
self.MonacoEnvironment = {
  getWorker(_: any, label: string) {
    return new editorWorker();
  }
};

/**
 * 国际化翻译函数
 */
const { t } = useI18n();

/**
 * 文本视图模式：split-分屏对比, unified-内联对比
 */
const textViewMode = ref<"split" | "unified">("split");

/**
 * 选中的编程语言
 * 'auto' 表示自动检测语言
 */
const selectedLang = ref("auto");

/**
 * 源文本内容
 */
const sourceText = ref('')

/**
 * 目标文本内容
 */
const targetText = ref('')

/**
 * 自动格式化 composable
 * 用于在输入时自动格式化代码
 */
const { scheduleAutoFormat } = useAutoFormat()

/**
 * 主题 composable
 * isDark: 是否为暗色模式
 * themeMode: 当前主题模式 (system/light/dark)
 */
const { isDark, themeMode } = useTheme()

/**
 * Monaco Editor 主题计算属性
 * 根据应用主题模式返回对应的 Monaco 主题
 * @returns 'vs' 亮色主题 或 'vs-dark' 暗色主题
 */
const monacoTheme = computed(() => {
  if (themeMode.value === 'light') return 'vs'
  if (themeMode.value === 'dark') return 'vs-dark'
  return isDark.value ? 'vs-dark' : 'vs'
})

/**
 * Monaco Editor 容器 DOM 引用
 */
const containerRef = ref<HTMLElement | null>(null)

/**
 * Monaco Diff Editor 实例
 * 使用 shallowRef 避免深度响应带来的性能开销
 */
let diffEditorInstance: monaco.editor.IStandaloneDiffEditor | null = null

/**
 * 左侧（原始）编辑器 Model 实例
 */
let originalModel: monaco.editor.ITextModel | null = null

/**
 * 右侧（修改）编辑器 Model 实例
 */
let modifiedModel: monaco.editor.ITextModel | null = null

/**
 * 左侧（原始）编辑器实例引用
 */
const originalEditorRef = shallowRef<monaco.editor.IStandaloneCodeEditor | null>(null)

/**
 * 右侧（修改后）编辑器实例引用
 */
const modifiedEditorRef = shallowRef<monaco.editor.IStandaloneCodeEditor | null>(null)

/**
 * 带国际化语言选项的计算属性
 * 将语言选项转换为支持 i18n 的格式
 * @returns 带有本地化标签的语言选项数组
 */
const langOptionsWithI18n = computed(() => {
  return langOptions.value.map(opt =>
    opt.value === "auto" ? { label: t("autoDetect"), value: opt.value } : opt
  )
})

/**
 * 源文本检测到的语言
 */
const sourceLang = ref('plaintext');

/**
 * 目标文本检测到的语言
 */
const targetLang = ref('plaintext');

/**
 * 检测源文本编程语言（防抖处理）
 * 使用 500ms 防抖避免频繁调用语言检测
 */
const detectSourceLanguage = debounce((text: string) => {
  if (selectedLang.value === 'auto' && text) {
    sourceLang.value = detectLanguage(text);
  }
}, 500);

/**
 * 检测目标文本编程语言（防抖处理）
 * 使用 500ms 防抖避免频繁调用语言检测
 */
const detectTargetLanguage = debounce((text: string) => {
  if (selectedLang.value === 'auto' && text) {
    targetLang.value = detectLanguage(text);
  }
}, 500);

/**
 * 监听源文本变化，触发自动语言检测
 */
watch(sourceText, (text) => {
  if (selectedLang.value !== 'auto') return;
  detectSourceLanguage(text);
});

/**
 * 监听目标文本变化，触发自动语言检测
 */
watch(targetText, (text) => {
  if (selectedLang.value !== 'auto') return;
  detectTargetLanguage(text);
});

/**
 * 监听语言选择变化
 * 当用户手动选择语言或切换到自动检测时更新语言状态
 */
watch(selectedLang, () => {
  if (selectedLang.value !== 'auto') {
    // 用户手动选择语言
    sourceLang.value = selectedLang.value;
    targetLang.value = selectedLang.value;
  } else {
    // 切换到自动检测模式，立即检测当前文本语言
    sourceLang.value = detectLanguage(sourceText.value);
    targetLang.value = detectLanguage(targetText.value);
  }
  // 更新编辑器的语言设置
  updateLanguage();
});

/**
 * 监听语言检测结果变化
 * 当自动检测到新语言时更新编辑器
 */
watch([sourceLang, targetLang], () => {
  updateLanguage();
});

/**
 * 初始化 Monaco Diff Editor
 * 创建编辑器实例并配置各项功能
 */
const initMonacoEditor = () => {
  // 防止重复初始化
  if (!containerRef.value || diffEditorInstance) return;

  // 设置初始主题
  monaco.editor.setTheme(monacoTheme.value);

  // 创建 Diff Editor 实例
  diffEditorInstance = monaco.editor.createDiffEditor(containerRef.value, {
    automaticLayout: true,                                 // 自动调整布局
    theme: monacoTheme.value,                              // 主题
    fontSize: 14,                                          // 字体大小
    fontFamily: 'JetBrains Mono, monospace',               // 字体族
    lineHeight: 24,                                        // 行高
    fontLigatures: true,                                   // 字体连字
    minimap: { enabled: false },                           // 禁用小地图
    scrollBeyondLastLine: false,                           // 禁用滚动超过最后一行
    renderSideBySide: textViewMode.value === 'split',      // 分屏或内联模式
    useInlineViewWhenSpaceIsLimited: false,                // 禁用内联视图
    splitViewDefaultRatio: 0.5,                            // 左右分屏各占 50%
    readOnly: false,                                       // 可编辑
    enableSplitViewResizing: true,                         // 允许调整分屏大小
    ignoreTrimWhitespace: false,                           // 不忽略空白字符差异
    originalEditable: true,                                // 左侧编辑器可编辑
    renderOverviewRuler: true,                             // 显示概览标尺
    diffWordWrap: 'on',                                   // 禁用差异 word wrap
    scrollbar: {
      verticalScrollbarSize: 10,                           // 垂直滚动条宽度
      horizontalScrollbarSize: 10,                         // 水平滚动条高度
    },
  });

  // 获取左右两侧的编辑器实例
  originalEditorRef.value = diffEditorInstance.getOriginalEditor();
  modifiedEditorRef.value = diffEditorInstance.getModifiedEditor();

  // 监听左侧编辑器内容变化，同步到源文本
  originalEditorRef.value.onDidChangeModelContent(() => {
    sourceText.value = originalEditorRef.value?.getValue() || '';
  });

  // 监听右侧编辑器内容变化，同步到目标文本
  modifiedEditorRef.value.onDidChangeModelContent(() => {
    targetText.value = modifiedEditorRef.value?.getValue() || '';
  });

  // 创建初始 Model 并设置到 Diff Editor
  const sourceMonacoLang = toMonacoLanguage(sourceLang.value);
  const targetMonacoLang = toMonacoLanguage(targetLang.value);
  originalModel = monaco.editor.createModel(sourceText.value, sourceMonacoLang);
  modifiedModel = monaco.editor.createModel(targetText.value, targetMonacoLang);
  diffEditorInstance.setModel({
    original: originalModel,
    modified: modifiedModel
  });
}

/**
 * 更新编辑器内容
 * 复用现有 Model，只更新文本内容
 */
const updateEditorContent = () => {
  if (!originalModel || !modifiedModel) return;

  originalModel.setValue(sourceText.value);
  modifiedModel.setValue(targetText.value);
}

/**
 * 更新编辑器语言
 * 切换 Monaco Editor 的语法高亮语言
 */
const updateLanguage = () => {
  if (!originalModel || !modifiedModel) return;

  const sourceMonacoLang = toMonacoLanguage(sourceLang.value);
  const targetMonacoLang = toMonacoLanguage(targetLang.value);

  monaco.editor.setModelLanguage(originalModel, sourceMonacoLang);
  monaco.editor.setModelLanguage(modifiedModel, targetMonacoLang);
}

/**
 * 更新视图模式
 * 切换分屏视图和内联视图
 */
const updateViewMode = () => {
  if (!diffEditorInstance) return;
  diffEditorInstance.updateOptions({
    renderSideBySide: textViewMode.value === 'split'
  });
}

/**
 * 清空文本
 * 清空源文本和目标文本内容
 */
const onTextClear = () => {
  sourceText.value = ''
  targetText.value = ''
  updateEditorContent()
}

/**
 * 监听文本变化，触发自动格式化
 */
watch([sourceText, targetText], () => {
  scheduleAutoFormat(sourceText, selectedLang.value, "source")
  scheduleAutoFormat(targetText, selectedLang.value, "target")
})

/**
 * 监听语言选择变化，更新编辑器语言
 */
watch(selectedLang, () => {
  updateLanguage()
})

/**
 * 监听视图模式变化
 */
watch(textViewMode, () => {
  updateViewMode()
})

/**
 * 监听主题模式变化，自动更新 Monaco 主题
 * 使用 watchEffect 自动追踪依赖变化
 */
watchEffect(() => {
  const theme = monacoTheme.value
  if (diffEditorInstance) {
    monaco.editor.setTheme(theme)
  }
})

/**
 * 监听文本变化，同步到编辑器
 * 当文本从外部更新时（如格式化后），同步到 Monaco Editor
 */
watch([sourceText, targetText], () => {
  if (!diffEditorInstance) return;

  // 获取编辑器当前内容
  const currentOriginal = originalEditorRef.value?.getValue() || '';
  const currentModified = modifiedEditorRef.value?.getValue() || '';

  // 如果内容不一致，则更新编辑器
  if (currentOriginal !== sourceText.value) {
    originalEditorRef.value?.setValue(sourceText.value);
  }
  if (currentModified !== targetText.value) {
    modifiedEditorRef.value?.setValue(targetText.value);
  }
})

/**
 * 组件挂载时初始化 Monaco Editor
 */
onMounted(() => {
  initMonacoEditor()
})

/**
 * 组件卸载时销毁 Monaco Editor 实例
 * 释放资源，防止内存泄漏
 */
onUnmounted(() => {
  if (diffEditorInstance) {
    diffEditorInstance.setModel(null);
  }
  if (originalModel) {
    originalModel.dispose();
    originalModel = null;
  }
  if (modifiedModel) {
    modifiedModel.dispose();
    modifiedModel = null;
  }
  if (diffEditorInstance) {
    diffEditorInstance.dispose();
    diffEditorInstance = null;
  }
})
</script>

<template>
  <div class="flex flex-col h-full gap-4">
    <!-- Toolbar: 工具栏 -->
    <div
      class="h-14 border-b border-[var(--color-border)] bg-[var(--color-background)] flex items-center justify-between px-5 flex-shrink-0 z-30 shadow-sm relative w-full">
      <div class="flex items-center gap-3">
        <!-- Language Selector: 语言选择器 -->
        <div class="flex items-center gap-2">
          <ZBadge variant="surface" size="lg">{{ t("language") }}</ZBadge>
          <ZSelect v-model="selectedLang" :options="langOptionsWithI18n" class="min-w-[120px]" />
        </div>

        <!-- Divider: 分隔线 -->
        <div class="h-4 w-px bg-[var(--color-border)] mx-1"></div>

        <!-- View Mode: 视图模式切换 -->
        <div class="flex bg-[var(--color-surface)] rounded-md border border-[var(--color-border)] p-1 shadow-sm gap-1">
          <ZButton :variant="textViewMode === 'split' ? 'primary' : 'surface'" size="sm" @click="textViewMode = 'split'"
            class="!rounded-md">
            <ZIcon name="split" :size="14" />
            {{ t("textSplit") }}
          </ZButton>
          <ZButton :variant="textViewMode === 'unified' ? 'primary' : 'surface'" size="sm"
            @click="textViewMode = 'unified'" class="!rounded-md">
            <ZIcon name="unified" :size="14" />
            {{ t("textUnified") }}
          </ZButton>
        </div>

      </div>
      <!-- Clear Button: 清空按钮 -->
      <div class="flex items-center gap-1">
        <ZTooltip :content="t('clearItems')" position="bottom">
          <ZButton variant="danger" size="sm" @click="onTextClear" :disabled="!sourceText && !targetText">
            <ZIcon name="trash" :size="14" />
            {{ t('clearItems') }}
          </ZButton>
        </ZTooltip>
      </div>
    </div>

    <!-- Monaco Editor Container: Monaco 编辑器容器 -->
    <div class="flex-1 min-h-[400px] overflow-hidden">
      <div ref="containerRef" class="w-full h-full"></div>
    </div>
  </div>
</template>

<style scoped lang="scss"></style>
