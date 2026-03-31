<script setup lang="ts">
import { computed, ref } from 'vue';
import { useGitStore } from '../../stores/git';
import { useI18n } from 'vue-i18n';
import type { Project } from '../../types';

const props = defineProps<{
  project: Project;
}>();

const { t } = useI18n();
const gitStore = useGitStore();

const diffContent = computed(() => gitStore.selectedDiff);
const diffFile = computed(() => gitStore.selectedDiffFile);
const reverting = ref(false);

interface DiffLine {
  type: 'add' | 'del' | 'context';
  content: string;
  oldNum?: number;
  newNum?: number;
}

interface DiffHunk {
  header: string;
  lines: DiffLine[];
  rawLines: string[];
}

const diffHeaders = computed(() => {
  const headers: string[] = [];
  for (const line of diffContent.value.split('\n')) {
    if (line.startsWith('diff --git') || line.startsWith('index ') || line.startsWith('--- ') || line.startsWith('+++ ')) {
      headers.push(line);
    }
    if (line.startsWith('@@')) break;
  }
  return headers;
});

const parsedHunks = computed((): DiffHunk[] => {
  const raw = diffContent.value;
  if (!raw) return [];

  const hunks: DiffHunk[] = [];
  let current: DiffHunk | null = null;
  let oldNum = 0;
  let newNum = 0;

  for (const line of raw.split('\n')) {
    if (line.startsWith('diff --git') || line.startsWith('index ') || line.startsWith('---') || line.startsWith('+++')) {
      continue;
    }

    if (line.startsWith('@@')) {
      const match = line.match(/@@ -(\d+)/);
      if (match) {
        oldNum = parseInt(match[1]) - 1;
        const newMatch = line.match(/@@ -\d+(?:,\d+)? \+(\d+)/);
        newNum = newMatch ? parseInt(newMatch[1]) - 1 : oldNum;
      }
      current = { header: line, lines: [], rawLines: [line] };
      hunks.push(current);
      continue;
    }

    if (!current) continue;

    current.rawLines.push(line);
    if (line.startsWith('+')) {
      newNum++;
      current.lines.push({ type: 'add', content: line.slice(1), newNum });
    } else if (line.startsWith('-')) {
      oldNum++;
      current.lines.push({ type: 'del', content: line.slice(1), oldNum });
    } else {
      oldNum++;
      newNum++;
      current.lines.push({
        type: 'context',
        content: line.startsWith(' ') ? line.slice(1) : line,
        oldNum,
        newNum,
      });
    }
  }
  return hunks;
});

const stats = computed(() => {
  let adds = 0;
  let dels = 0;
  for (const hunk of parsedHunks.value) {
    for (const line of hunk.lines) {
      if (line.type === 'add') adds++;
      else if (line.type === 'del') dels++;
    }
  }
  return { adds, dels };
});

async function rollbackHunk(hunk: DiffHunk) {
  if (!diffFile.value || !hunk.rawLines.length || reverting.value) return;
  reverting.value = true;
  try {
    const patchText = `${diffHeaders.value.join('\n')}\n${hunk.rawLines.join('\n')}\n`;
    await gitStore.revertHunk(
      props.project.id,
      props.project.path,
      patchText,
      gitStore.selectedDiffStaged,
    );
  } finally {
    reverting.value = false;
  }
}
</script>

<template>
  <div class="h-full flex flex-col overflow-hidden">
    <!-- No diff selected -->
    <div v-if="!diffContent" class="flex-1 flex flex-col items-center justify-center text-slate-400 dark:text-slate-500 gap-1">
      <div class="i-mdi-file-document-outline text-2xl" />
      <span class="text-[11px]">{{ t('git.selectFileToView') }}</span>
    </div>

    <template v-else>
      <!-- Header -->
      <div class="flex items-center gap-2 px-3 py-1.5 border-b border-slate-200/40 dark:border-slate-700/30 shrink-0 text-[11px]">
        <span class="font-medium text-slate-700 dark:text-slate-300 truncate flex-1">{{ diffFile || t('git.commitDetail') }}</span>
        <span class="text-green-500 font-mono">+{{ stats.adds }}</span>
        <span class="text-red-500 font-mono">-{{ stats.dels }}</span>
      </div>

      <!-- Diff content -->
      <div class="flex-1 overflow-auto font-mono text-[11px] leading-[18px] p-2 space-y-2">
        <div
          v-for="(hunk, hunkIndex) in parsedHunks"
          :key="hunkIndex"
          class="border border-slate-200/50 dark:border-slate-700/40 rounded-md overflow-hidden"
        >
          <div class="px-2 py-1 bg-slate-100/60 dark:bg-slate-800/50 border-b border-slate-200/40 dark:border-slate-700/40 text-[10px] flex items-center">
            <span class="text-blue-600 dark:text-blue-400 truncate">{{ hunk.header }}</span>
            <button
              class="ml-auto px-2 py-0.5 rounded text-[10px] bg-rose-500/10 text-rose-600 hover:bg-rose-500/18 disabled:opacity-60 cursor-pointer"
              :disabled="reverting"
              @click="rollbackHunk(hunk)"
            >
              回滚区块
            </button>
          </div>
          <table class="w-full border-collapse">
            <tbody>
              <tr
                v-for="(line, i) in hunk.lines"
                :key="i"
                :class="{
                  'bg-green-500/8': line.type === 'add',
                  'bg-red-500/8': line.type === 'del',
                }"
              >
                <td class="w-[1px] whitespace-nowrap px-1.5 text-right text-slate-400/60 dark:text-slate-500/40 select-none border-r border-slate-200/20 dark:border-slate-700/15">
                  {{ line.oldNum || '' }}
                </td>
                <td class="w-[1px] whitespace-nowrap px-1.5 text-right text-slate-400/60 dark:text-slate-500/40 select-none border-r border-slate-200/20 dark:border-slate-700/15">
                  {{ line.newNum || '' }}
                </td>
                <td
                  class="px-2 whitespace-pre"
                  :class="{
                    'text-green-700 dark:text-green-300': line.type === 'add',
                    'text-red-700 dark:text-red-300': line.type === 'del',
                    'text-slate-700 dark:text-slate-300': line.type === 'context',
                  }"
                >{{ line.content }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </template>
  </div>
</template>
