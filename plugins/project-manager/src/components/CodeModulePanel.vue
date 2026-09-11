<script setup lang="ts">
import { ref, computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { ElMessage } from 'element-plus';
import { api } from '../api';
import { scanCodeModules } from '../utils/codeModuleScanner';
import { useSettingsStore } from '../stores/settings';
import type { Project, CodeModule, CodeModuleFramework } from '../types';

const { t } = useI18n();

const props = defineProps<{
  project: Project;
}>();

const emit = defineEmits<{
  (e: 'update:modules', modules: CodeModule[]): void;
}>();

/***********************扫描状态*********************/
const scanning = ref(false);

const modules = computed(() => props.project.codeModules || []);

const pinnedModules = computed(() =>
  modules.value.filter(m => m.pinned).sort((a, b) => a.name.localeCompare(b.name)),
);

const unpinnedModules = computed(() =>
  modules.value.filter(m => !m.pinned).sort((a, b) => a.name.localeCompare(b.name)),
);

/***********************框架图标与颜色映射*********************/
function getFrameworkIcon(framework: CodeModuleFramework): string {
  const map: Record<CodeModuleFramework, string> = {
    vue: 'i-mdi-vuejs',
    react: 'i-mdi-react',
    node: 'i-mdi-nodejs',
    java: 'i-mdi-language-java',
    go: 'i-mdi-language-go',
    python: 'i-mdi-language-python',
    dotnet: 'i-mdi-dot-net',
    unknown: 'i-mdi-code-braces',
  };
  return map[framework] || map.unknown;
}

function getFrameworkColor(framework: CodeModuleFramework): string {
  const map: Record<CodeModuleFramework, string> = {
    vue: 'text-emerald-500',
    react: 'text-sky-500',
    node: 'text-green-600',
    java: 'text-orange-500',
    go: 'text-cyan-500',
    python: 'text-yellow-500',
    dotnet: 'text-purple-500',
    unknown: 'text-slate-400',
  };
  return map[framework] || map.unknown;
}

function getFrameworkLabel(framework: CodeModuleFramework): string {
  const map: Record<CodeModuleFramework, string> = {
    vue: 'Vue', react: 'React', node: 'Node',
    java: 'Java', go: 'Go', python: 'Python',
    dotnet: '.NET', unknown: 'Unknown',
  };
  return map[framework] || framework;
}

/***********************扫描代码模块*********************/

/** 递归收集目录条目，最多到指定相对深度 */
async function collectDirEntries(
  rootPath: string,
  relativePath: string,
  maxDepth: number,
  currentDepth: number,
  tree: Record<string, string[]>,
) {
  if (currentDepth > maxDepth) return;
  const fullPath = relativePath ? `${rootPath}/${relativePath}` : rootPath;
  let entries: { name: string; isDirectory: boolean }[];
  try {
    entries = await api.readDir(fullPath);
  } catch {
    return;
  }
  // 记录当前目录的文件列表
  const key = relativePath || '.';
  tree[key] = entries.filter(e => !e.isDirectory).map(e => e.name);
  // 递归进入子目录
  for (const entry of entries) {
    if (entry.isDirectory && !entry.name.startsWith('.') && entry.name !== 'node_modules') {
      const childRelative = relativePath ? `${relativePath}/${entry.name}` : entry.name;
      await collectDirEntries(rootPath, childRelative, maxDepth, currentDepth + 1, tree);
    }
  }
}

async function handleScan() {
  scanning.value = true;
  try {
    const tree: Record<string, string[]> = {};
    await collectDirEntries(props.project.path, '', 3, 0, tree);
    const result = scanCodeModules(tree);

    if (result.length === 0) {
      ElMessage.info(t('dashboard.moduleScanEmpty'));
    } else {
      ElMessage.success(t('dashboard.moduleScanDone', { count: result.length }));
    }

    // 合并已有的置顶状态
    const existingPins = new Map<string, boolean>();
    for (const m of modules.value) {
      existingPins.set(m.relativePath, !!m.pinned);
    }
    for (const m of result) {
      if (existingPins.has(m.relativePath)) {
        m.pinned = existingPins.get(m.relativePath);
      }
    }

    emit('update:modules', result);
  } catch (e) {
    console.error('Failed to scan code modules:', e);
    ElMessage.error(t('dashboard.moduleScanFailed'));
  } finally {
    scanning.value = false;
  }
}

/***********************模块操作*********************/
async function openModuleFolder(module: CodeModule) {
  const fullPath = `${props.project.path}/${module.relativePath}`;
  await api.openFolder(fullPath);
}

async function openModuleInEditor(module: CodeModule) {
  const fullPath = `${props.project.path}/${module.relativePath}`;
  const editorId = props.project.editorId;
  if (editorId) {
    const settings = useSettingsStore();
    const editor = settings.settings.editors?.find(e => e.id === editorId);
    await api.openInEditor(fullPath, editor?.path);
  } else {
    await api.openInEditor(fullPath);
  }
}

function toggleModulePin(module: CodeModule) {
  const updated = modules.value.map(m =>
    m.id === module.id ? { ...m, pinned: !m.pinned } : m,
  );
  emit('update:modules', updated);
}

function removeModule(module: CodeModule) {
  const updated = modules.value.filter(m => m.id !== module.id);
  emit('update:modules', updated);
}
</script>

<template>
  <div class="flex flex-col h-full">
    <!-- 工具栏 -->
    <div class="flex items-center justify-between px-4 py-2 border-b border-slate-200/70 dark:border-slate-700/50">
      <span class="app-text-meta font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
        {{ t('dashboard.modules') }}
      </span>
      <el-button
        type="primary"
        text
        size="small"
        :loading="scanning"
        @click="handleScan"
      >
        <el-icon class="mr-0.5"><div class="i-mdi-radar text-xs" /></el-icon>
        {{ scanning ? t('dashboard.moduleScanning') : t('dashboard.moduleScan') }}
      </el-button>
    </div>

    <!-- 模块列表 -->
    <div class="flex-1 overflow-y-auto p-3 space-y-1.5 custom-scrollbar">
      <!-- 空状态 -->
      <div v-if="modules.length === 0" class="flex flex-col items-center justify-center py-8 text-slate-400 dark:text-slate-500">
        <div class="i-mdi-source-branch text-3xl mb-2 opacity-20" />
        <p class="app-text-body font-medium">{{ t('dashboard.moduleNoModules') }}</p>
        <p class="app-text-meta mt-1">{{ t('dashboard.moduleNoModulesHint') }}</p>
      </div>

      <!-- 置顶模块 -->
      <template v-if="pinnedModules.length > 0">
        <div
          v-for="mod in pinnedModules"
          :key="mod.id"
          class="group flex items-center gap-2.5 px-2.5 py-2 rounded-lg border border-amber-200/50 dark:border-amber-700/30 bg-amber-50/50 dark:bg-amber-900/10 hover:bg-amber-50 dark:hover:bg-amber-900/20 transition-colors cursor-pointer"
          @dblclick="openModuleFolder(mod)"
        >
          <div :class="[getFrameworkIcon(mod.framework), getFrameworkColor(mod.framework)]" class="text-base flex-shrink-0" />
          <div class="flex-1 min-w-0">
            <div class="app-text-control font-semibold text-slate-800 dark:text-slate-100 truncate">{{ mod.name }}</div>
            <div class="app-text-meta text-slate-400 dark:text-slate-500 truncate font-mono">{{ mod.relativePath }}</div>
          </div>
          <span class="app-text-caption px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400 flex-shrink-0">
            {{ getFrameworkLabel(mod.framework) }}
          </span>
          <!-- 操作按钮 -->
          <div class="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
            <button
              class="p-1 rounded hover:bg-amber-100 dark:hover:bg-amber-900/40 text-amber-500"
              :title="t('dashboard.moduleUnpin')"
              @click.stop="toggleModulePin(mod)"
            >
              <div class="i-mdi-pin-off text-xs" />
            </button>
            <button
              class="p-1 rounded hover:bg-blue-50 dark:hover:bg-blue-900/30 text-blue-500"
              :title="t('dashboard.moduleOpenFolder')"
              @click.stop="openModuleFolder(mod)"
            >
              <div class="i-mdi-folder-open-outline text-xs" />
            </button>
            <button
              class="p-1 rounded hover:bg-blue-50 dark:hover:bg-blue-900/30 text-blue-500"
              :title="t('dashboard.moduleOpenEditor')"
              @click.stop="openModuleInEditor(mod)"
            >
              <div class="i-mdi-code-braces text-xs" />
            </button>
            <button
              class="p-1 rounded hover:bg-red-50 dark:hover:bg-red-900/30 text-slate-400 hover:text-red-500"
              :title="t('dashboard.moduleRemove')"
              @click.stop="removeModule(mod)"
            >
              <div class="i-mdi-close text-xs" />
            </button>
          </div>
        </div>
      </template>

      <!-- 非置顶模块 -->
      <template v-if="unpinnedModules.length > 0">
        <div
          v-for="mod in unpinnedModules"
          :key="mod.id"
          class="group flex items-center gap-2.5 px-2.5 py-2 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors cursor-pointer"
          @dblclick="openModuleFolder(mod)"
        >
          <div :class="[getFrameworkIcon(mod.framework), getFrameworkColor(mod.framework)]" class="text-base flex-shrink-0" />
          <div class="flex-1 min-w-0">
            <div class="app-text-control font-semibold text-slate-800 dark:text-slate-100 truncate">{{ mod.name }}</div>
            <div class="app-text-meta text-slate-400 dark:text-slate-500 truncate font-mono">{{ mod.relativePath }}</div>
          </div>
          <span class="app-text-caption px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400 flex-shrink-0">
            {{ getFrameworkLabel(mod.framework) }}
          </span>
          <!-- 操作按钮 -->
          <div class="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
            <button
              class="p-1 rounded hover:bg-amber-50 dark:hover:bg-amber-900/30 text-slate-400 hover:text-amber-500"
              :title="t('dashboard.modulePin')"
              @click.stop="toggleModulePin(mod)"
            >
              <div class="i-mdi-pin text-xs" />
            </button>
            <button
              class="p-1 rounded hover:bg-blue-50 dark:hover:bg-blue-900/30 text-blue-500"
              :title="t('dashboard.moduleOpenFolder')"
              @click.stop="openModuleFolder(mod)"
            >
              <div class="i-mdi-folder-open-outline text-xs" />
            </button>
            <button
              class="p-1 rounded hover:bg-blue-50 dark:hover:bg-blue-900/30 text-blue-500"
              :title="t('dashboard.moduleOpenEditor')"
              @click.stop="openModuleInEditor(mod)"
            >
              <div class="i-mdi-code-braces text-xs" />
            </button>
            <button
              class="p-1 rounded hover:bg-red-50 dark:hover:bg-red-900/30 text-slate-400 hover:text-red-500"
              :title="t('dashboard.moduleRemove')"
              @click.stop="removeModule(mod)"
            >
              <div class="i-mdi-close text-xs" />
            </button>
          </div>
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
.custom-scrollbar::-webkit-scrollbar {
  width: 4px;
}
.custom-scrollbar::-webkit-scrollbar-track {
  background: transparent;
}
.custom-scrollbar::-webkit-scrollbar-thumb {
  background: color-mix(in srgb, var(--app-text-muted) 56%, transparent);
  border-radius: 2px;
}
</style>
