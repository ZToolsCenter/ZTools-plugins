<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useGitStore } from '../../stores/git';
import { useI18n } from 'vue-i18n';
import { ElMessageBox } from 'element-plus';
import type { Project, GitBinaryDiffMeta, GitImageDiffPayload } from '../../types';
import { showPersistentGitError } from './message';
import GitImageDiffView from './GitImageDiffView.vue';
import { isCurrentGitImageRequest, type GitImageRequestIdentity } from '../../utils/gitImageRequest';

const props = defineProps<{
  project: Project;
}>();

const { t } = useI18n();
const gitStore = useGitStore();

/** 该项目自己那一桶 diff 选中态（store 已按 projectId 分桶） */
const selection = computed(() => gitStore.getDiffSelection(props.project.id));
const diffContent = computed(() => selection.value.content);
const diffFile = computed(() => selection.value.file);
const diffOldPath = computed(() => selection.value.oldPath || '');
const hasSelectedFile = computed(() => !!selection.value.file);
const reverting = ref(false);
const imageDiff = ref<GitImageDiffPayload | null>(null);
const binaryMeta = ref<GitBinaryDiffMeta | null>(null);
const binaryLoading = ref(false);
const binaryError = ref('');
let binaryRequestId = 0;

/***********************正文被淘汰后按需重取*********************/
// 桶数超上限时只丢 content、保留「看的是哪个文件」（见 utils/gitDiffSelection.ts）。
// 这里把缺失的正文补回来，让淘汰对用户不可见——否则切回项目会显示成「什么都没选」。
//
// 每个目标只重取一次：diff 本身可能就是空的（比如空的未跟踪文件），
// 那样「取回来还是空」会让这个 watch 反复自激成死循环。
const refetchedTargets = new Set<string>();

watch([selection, () => props.project.id, () => props.project.path], ([current]) => {
  void loadBinaryPreview(current);
  if (!current.file || current.content) return;

  const target = current.source === 'worktree'
    ? `${props.project.id}:worktree:${current.staged ? 'staged' : 'unstaged'}:${current.file}`
    : `${props.project.id}:commit:${current.source.commit}:${current.file}`;
  if (refetchedTargets.has(target)) return;
  refetchedTargets.add(target);

  const request = current.source === 'worktree'
    ? gitStore.getDiff(props.project.id, props.project.path, current.file, current.staged, current.oldPath)
    : gitStore.getDiffCommitFile(props.project.id, props.project.path, current.source.commit, current.file, current.oldPath);

  // 取不到就维持空态：getDiff 失败时内部已清桶，这里不再重试
  void request.catch(() => {});
}, { immediate: true });

const DIFF_BINARY_MARKER = '__BINARY_FILE__';
const DIFF_TOO_LARGE_MARKER = '__FILE_TOO_LARGE__';
const isBinaryFile = computed(() => diffContent.value === DIFF_BINARY_MARKER);
const isTooLargeFile = computed(() => diffContent.value === DIFF_TOO_LARGE_MARKER);
const isImageFile = computed(() =>
  /\.(png|jpe?g|webp|gif|bmp|svg|ico)$/i.test(diffFile.value)
  || /\.(png|jpe?g|webp|gif|bmp|svg|ico)$/i.test(diffOldPath.value),
);
// 图片大小由图片 endpoint 按 10 MB/侧、20 MB 总量校验，不能被文本 diff 的 5 MB 门槛提前拦截。
const isImageDiff = computed(() => isImageFile.value);
const isBinaryFallback = computed(() => isBinaryFile.value && !isImageDiff.value);

function binaryRequestIdentity(current: typeof selection.value): GitImageRequestIdentity {
  return {
    projectId: props.project.id,
    projectPath: props.project.path,
    source: current.source === 'worktree' ? 'worktree' : `commit:${current.source.commit}`,
    staged: current.staged,
    file: current.file,
    oldPath: current.oldPath || '',
  };
}

function isCurrentBinaryRequest(requestId: number, identity: GitImageRequestIdentity): boolean {
  const current = binaryRequestIdentity(selection.value);
  return isCurrentGitImageRequest(requestId, binaryRequestId, identity, current)
    && identity.projectId === props.project.id
    && identity.projectPath === props.project.path;
}

function formatBinaryError(error: unknown): string {
  const message = String(error);
  return message.includes('too_large') ? t('git.imageTooLarge') : message;
}

async function loadBinaryPreview(current: typeof selection.value) {
  const requestId = ++binaryRequestId;
  const identity = binaryRequestIdentity(current);
  imageDiff.value = null;
  binaryMeta.value = null;
  binaryError.value = '';
  binaryLoading.value = false;
  if (!current.file) return;

  const imageFile = /\.(png|jpe?g|webp|gif|bmp|svg|ico)$/i.test(current.file)
    || /\.(png|jpe?g|webp|gif|bmp|svg|ico)$/i.test(current.oldPath || '');
  const shouldLoadBinaryMeta = current.content === DIFF_BINARY_MARKER && !imageFile;
  if (!imageFile && !shouldLoadBinaryMeta) return;

  binaryLoading.value = true;
  try {
    const args = current.source === 'worktree'
      ? { staged: current.staged, commit: undefined, oldPath: current.oldPath }
      : { staged: false, commit: current.source.commit, oldPath: current.oldPath };
    if (imageFile) {
      const result = await gitStore.getImageDiff(
        props.project.id,
        props.project.path,
        current.file,
        args.staged,
        args.commit,
        args.oldPath,
      );
      if (!isCurrentBinaryRequest(requestId, identity)) return;
      imageDiff.value = result;
    } else {
      const result = await gitStore.getBinaryDiffMeta(
        props.project.path,
        current.file,
        args.staged,
        args.commit,
        args.oldPath,
      );
      if (!isCurrentBinaryRequest(requestId, identity)) return;
      binaryMeta.value = result;
    }
  } catch (error) {
    if (isCurrentBinaryRequest(requestId, identity)) binaryError.value = formatBinaryError(error);
  } finally {
    if (isCurrentBinaryRequest(requestId, identity)) binaryLoading.value = false;
  }
}

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
    if (line.startsWith('@@')) break;
    if (line.length > 0) headers.push(line);
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

const rawDiffLines = computed(() => diffContent.value.split('\n').filter(line => line.length > 0));
const hasParsedHunks = computed(() => parsedHunks.value.length > 0);

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

async function applyHunk(hunk: DiffHunk, mode: 'stage' | 'unstage' | 'discard') {
  if (!diffFile.value || !hunk.rawLines.length || reverting.value || selection.value.source !== 'worktree') return;
  if (mode === 'discard') {
    try {
      await ElMessageBox.confirm(t('git.discardHunkConfirm'), t('common.warning'), { type: 'warning' });
    } catch {
      return;
    }
  }
  reverting.value = true;
  try {
    const patchText = `${diffHeaders.value.join('\n')}\n${hunk.rawLines.join('\n')}\n`;
    await gitStore.applyHunk(
      props.project.id,
      props.project.path,
      patchText,
      mode,
    );
  } catch (error) {
    showPersistentGitError(t('git.operationFailed', { error: String(error) }));
  } finally {
    reverting.value = false;
  }
}

function formatBytes(size?: number): string {
  if (size == null) return t('git.notPresent');
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

const binaryChangeLabel = computed(() => {
  if (!binaryMeta.value?.beforeExists) return t('git.binaryAdded');
  if (!binaryMeta.value.afterExists) return t('git.binaryDeleted');
  return t('git.binaryChanged');
});
</script>

<template>
  <div class="git-diff-view">
    <!-- No file selected -->
    <div v-if="!hasSelectedFile" class="git-empty">
      <div class="i-mdi-file-document-outline git-empty-icon" />
      <span>{{ t('git.selectFileToView') }}</span>
    </div>

    <!-- File selected but no diff content -->
    <div v-else-if="!diffContent" class="git-empty">
      <div class="i-mdi-check-circle-outline git-empty-icon" />
      <span>{{ t('git.noDiff') }}</span>
    </div>

    <template v-else>
      <!-- Header -->
      <div class="git-diff-header">
        <span class="git-diff-title">{{ diffFile || t('git.commitDetail') }}</span>
        <span v-if="!isImageDiff && !isBinaryFallback && !isTooLargeFile" class="git-diff-stat-add">+{{ stats.adds }}</span>
        <span v-if="!isImageDiff && !isBinaryFallback && !isTooLargeFile" class="git-diff-stat-del">-{{ stats.dels }}</span>
      </div>

      <!-- Image diff -->
      <div v-if="isImageDiff" class="flex-1 min-h-0 flex">
        <GitImageDiffView v-if="imageDiff" :payload="imageDiff" />
        <div v-else-if="binaryLoading" class="git-empty">
          <div class="i-mdi-loading animate-spin git-empty-icon" />
          <span>{{ t('git.loading') }}</span>
        </div>
        <div v-else class="git-empty">
          <div class="i-mdi-alert-circle-outline git-empty-icon" />
          <span>{{ binaryError || t('git.imageDiffUnavailable') }}</span>
        </div>
      </div>

      <!-- Non-image binary fallback -->
      <div v-else-if="isTooLargeFile" class="git-empty">
        <div class="i-mdi-file-alert-outline git-empty-icon" />
        <span>{{ t('git.fileTooLargeNoDiff') }}</span>
      </div>
      <div v-else-if="isBinaryFallback" class="git-binary-fallback">
        <div v-if="binaryLoading" class="git-empty">
          <div class="i-mdi-loading animate-spin git-empty-icon" />
          <span>{{ t('git.loading') }}</span>
        </div>
        <div v-else-if="binaryError" class="git-empty">
          <div class="i-mdi-alert-circle-outline git-empty-icon" />
          <span>{{ binaryError }}</span>
        </div>
        <template v-else-if="binaryMeta">
          <div class="git-binary-title">
            <span class="i-mdi-file-cog-outline" />
            <span>{{ t('git.binaryFile') }}</span>
            <span class="git-binary-status">{{ binaryChangeLabel }}</span>
          </div>
          <div class="git-binary-grid">
            <div><span>{{ t('git.before') }}</span><strong>{{ formatBytes(binaryMeta.beforeSize) }}</strong></div>
            <div><span>{{ t('git.after') }}</span><strong>{{ formatBytes(binaryMeta.afterSize) }}</strong></div>
          </div>
        </template>
      </div>

      <!-- Text diff -->
      <div v-else class="git-diff-body select-text cursor-text">
        <div v-if="!hasParsedHunks" class="git-diff-hunk">
          <div class="git-diff-hunk-header">
            <span class="truncate">{{ diffFile || t('git.commitDetail') }}</span>
          </div>
          <pre class="m-0 p-2 overflow-auto whitespace-pre-wrap">{{ rawDiffLines.join('\n') }}</pre>
        </div>
        <div
          v-for="(hunk, hunkIndex) in parsedHunks"
          :key="hunkIndex"
          class="git-diff-hunk"
        >
          <div class="git-diff-hunk-header">
            <span class="truncate">{{ hunk.header }}</span>
            <div v-if="selection.source === 'worktree'" class="git-diff-hunk-actions">
              <button
                v-if="!selection.staged"
                type="button"
                class="git-diff-hunk-action is-stage"
                :disabled="reverting"
                @click="applyHunk(hunk, 'stage')"
              >
                {{ t('git.stageHunk') }}
              </button>
              <button
                v-if="!selection.staged"
                type="button"
                class="git-diff-hunk-action is-discard"
                :disabled="reverting"
                @click="applyHunk(hunk, 'discard')"
              >
                {{ t('git.discardHunk') }}
              </button>
              <button
                v-else
                type="button"
                class="git-diff-hunk-action is-unstage"
                :disabled="reverting"
                @click="applyHunk(hunk, 'unstage')"
              >
                {{ t('git.unstageHunk') }}
              </button>
            </div>
          </div>
          <table class="git-diff-table">
            <tbody>
              <tr
                v-for="(line, i) in hunk.lines"
                :key="i"
                :class="{
                  'is-add': line.type === 'add',
                  'is-del': line.type === 'del',
                }"
              >
                <td class="git-diff-ln">{{ line.oldNum || '' }}</td>
                <td class="git-diff-ln">{{ line.newNum || '' }}</td>
                <td class="git-diff-code">{{ line.content }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </template>
  </div>
</template>
