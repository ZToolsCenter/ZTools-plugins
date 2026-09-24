<script setup lang="ts">
  // @ts-nocheck TODO: 逐步添加类型注解后移除
  import { computed } from 'vue';
  import { APP_LABELS } from '../../composables/shared';
  import { renderMarkdown } from '../../utils/markdown';
  import { diffLines } from 'diff';

  const props = defineProps({
    show: { type: Boolean, default: false },
    session: { type: Object, default: null },
    messages: { type: Array, default: () => [] },
    loading: { type: Boolean, default: false }
  });

  const emit = defineEmits(['update:show', 'export', 'copyTo']);

  // 合并消息内的 contentBlocks：
  //  - tool_use 吸收紧随其后的 tool_result（参数+结果收进一个折叠块）
  //  - thinking 吸收紧随其后的 text（思考+正文合并，思考默认折叠）
  // 返回渲染单元数组：tool_use 单元含 { name, input, result? }，thinking 单元含 { text, followText? }
  function mergeBlocks(blocks) {
    const units = [];
    for (let i = 0; i < blocks.length; i++) {
      const b = blocks[i];
      if (b.type === 'tool_use') {
        const unit = { kind: 'tool_use', name: b.name, input: b.input || {} };
        const next = blocks[i + 1];
        if (next && next.type === 'tool_result') {
          unit.result = next.text || '';
          i++;
        }
        units.push(unit);
      } else if (b.type === 'thinking') {
        const unit = { kind: 'thinking', text: b.text || '' };
        const next = blocks[i + 1];
        if (next && next.type === 'text') {
          unit.followText = next.text || '';
          i++;
        }
        units.push(unit);
      } else {
        units.push(b);
      }
    }
    return units;
  }

  const displayMessages = computed(() => {
    return (props.messages || []).map(msg => ({
      ...msg,
      units: mergeBlocks(msg.contentBlocks || [])
    }));
  });

  const metaItems = computed(() => {
    if (!props.session) return [];
    const s = props.session;
    const items = [];
    if (s.model) items.push({ label: '模型', value: s.model });
    if (s.projectPath) items.push({ label: '项目', value: s.projectPath, tooltip: s.projectPath });
    items.push({ label: '创建', value: formatTime(s.createdAt) });
    items.push({ label: '更新', value: formatTime(s.updatedAt) });
    items.push({ label: '消息', value: String(props.messages.length || s.messageCount || 0) });
    if (s.tokenUsage) items.push({ label: 'Tokens', value: formatTokens(s.tokenUsage) });
    return items;
  });

  function onClose() {
    emit('update:show', false);
  }

  // 根据应用生成对应的恢复命令前缀（复制恢复命令按钮提示用）
  function copyCmdFor(app) {
    if (app === 'codex') return 'codex --resume <id>';
    if (app === 'opencode') return 'opencode --session <id>';
    return 'claude --resume <id>';
  }

  function formatTime(ts) {
    if (!ts) return '—';
    try {
      var d = new Date(ts);
      var y = d.getFullYear();
      var m = ('0' + (d.getMonth() + 1)).slice(-2);
      var day = ('0' + d.getDate()).slice(-2);
      var h = ('0' + d.getHours()).slice(-2);
      var min = ('0' + d.getMinutes()).slice(-2);
      return `${y}-${m}-${day} ${h}:${min}`;
    } catch (e) {
      return ts;
    }
  }

  function formatTokens(n) {
    if (!n) return '—';
    return n.toLocaleString();
  }

  function getToolSummary(block) {
    var input = block.input;
    if (!input) return '';
    if (block.type === 'patch') {
      var pfiles = input.files || [];
      return pfiles.length > 2
        ? pfiles.slice(0, 2).join(', ') + ' 等 ' + pfiles.length + ' 个文件'
        : pfiles.join(', ');
    }
    var name = (block.name || '').toLowerCase();
    if (name === 'edit' || name === 'read' || name === 'write') {
      var fp = input.file_path || input.filePath || input.path || '';
      if (fp) {
        var parts = fp.replace(/\\/g, '/').split('/');
        return parts.slice(-2).join('/');
      }
    }
    if (name === 'bash') {
      var cmd = input.command || '';
      return cmd.length > 40 ? cmd.substring(0, 40) + '...' : cmd;
    }
    if (name === 'grep') {
      return input.pattern || '';
    }
    if (name === 'glob') {
      return input.pattern || '';
    }
    if (name === 'agent') {
      return input.description || '';
    }
    if (name === 'todowrite') return '';
    return '';
  }

  function formatToolInput(block) {
    var input = block.input;
    if (!input) return '';
    var name = (block.name || '').toLowerCase();
    // Patch: 显示修改文件的 diff 内容
    if (name === 'patch') {
      var patches = input.patches || [];
      if (!patches.length) return input.files ? '修改文件:\n' + input.files.join('\n') : '';
      var parts = patches.map(function (p) {
        var line = '文件: ' + p.file;
        if (p.additions != null || p.deletions != null) {
          line += '  (+' + (p.additions || 0) + ' -' + (p.deletions || 0) + ')';
        }
        if (p.patch) line += '\n' + p.patch;
        return line;
      });
      return parts.join('\n\n');
    }
    // Write: 显示文件路径和内容摘要
    if (name === 'write') {
      var wparts = [];
      if (input.file_path || input.filePath)
        wparts.push('文件: ' + (input.file_path || input.filePath));
      if (input.content)
        wparts.push(
          '内容:\n' +
            (input.content.length > 500 ? input.content.substring(0, 500) + '...' : input.content)
        );
      return wparts.join('\n\n');
    }
    // Bash: 显示命令
    if (name === 'bash') {
      return input.command || '';
    }
    // Edit: 不用纯文本，用 diff 渲染（返回空，由模板处理）
    if (name === 'edit') return '';
    // 其他: JSON 格式化
    try {
      return JSON.stringify(input, null, 2);
    } catch (e) {
      return String(input);
    }
  }

  function getEditDiff(block) {
    var input = block.input;
    var oldStr = input.old_string || input.oldString;
    var newStr = input.new_string || input.newString;
    if (!oldStr || !newStr) return [];
    return diffLines(oldStr, newStr);
  }
</script>

<template>
  <n-modal :show="show" @update:show="onClose" :auto-focus="false">
    <n-card
      class="session-detail-card"
      title="会话详情"
      closable
      @close="onClose"
      content-style="padding: 16px 24px; overflow-y: auto;"
      footer-style="padding: 0 24px 16px; border-top: none;"
      :style="{ '--n-title-font-size': '16px' }"
    >
      <template v-if="session">
        <!-- 会话信息：单行紧凑栏 -->
        <div class="detail-meta">
          <n-tag size="tiny" :bordered="false" round>{{
            APP_LABELS[session.app] || session.app
          }}</n-tag>
          <span class="detail-meta-title" :title="session.title">{{ session.title }}</span>
          <n-text
            v-for="(item, i) in metaItems"
            :key="i"
            depth="3"
            class="detail-meta-item"
            :title="item.tooltip"
          >
            {{ item.label }} {{ item.value }}
          </n-text>
        </div>

        <!-- 消息列表：气泡式，默认全部展开 -->
        <n-divider />

        <div v-if="loading" class="detail-loading">
          <n-spin size="small" />
          <n-text depth="3" style="font-size: 12px">加载中...</n-text>
        </div>

        <div v-else-if="messages.length === 0" class="detail-empty">
          <n-text depth="3" style="font-size: 12px">暂无消息记录</n-text>
        </div>

        <div v-else class="message-list">
          <div
            v-for="(msg, idx) in displayMessages"
            :key="idx"
            class="message-item"
            :class="'message-item--' + msg.role"
          >
            <div class="message-bubble">
              <div class="message-bubble-head">
                <n-tag
                  :type="msg.role === 'user' ? 'info' : 'success'"
                  size="tiny"
                  :bordered="false"
                >
                  {{ msg.role === 'user' ? '用户' : '助手' }}
                </n-tag>
                <span v-if="msg.timestamp" class="message-time">{{
                  formatTime(msg.timestamp)
                }}</span>
              </div>
              <template v-for="(unit, bIdx) in msg.units" :key="bIdx">
                <div
                  v-if="unit.type === 'text'"
                  class="message-content markdown-body"
                  v-html="renderMarkdown(unit.text)"
                ></div>
                <div v-else-if="unit.type === 'file'" class="message-file">📎 {{ unit.name }}</div>
                <div v-else-if="unit.kind === 'thinking'" class="message-thinking-text">
                  <details class="message-thinking">
                    <summary>💭 思考过程</summary>
                    <div
                      class="message-thinking-body markdown-body"
                      v-html="renderMarkdown(unit.text)"
                    ></div>
                  </details>
                  <div
                    v-if="unit.followText"
                    class="message-content markdown-body"
                    v-html="renderMarkdown(unit.followText)"
                  ></div>
                </div>
                <details v-else-if="unit.kind === 'tool_use'" class="message-tool-use">
                  <summary>
                    🔧 {{ unit.name
                    }}<span v-if="getToolSummary(unit)" class="message-tool-detail">{{
                      getToolSummary(unit)
                    }}</span>
                  </summary>
                  <div
                    v-if="unit.input && Object.keys(unit.input).length > 0"
                    class="message-tool-input"
                  >
                    <div
                      v-if="unit.name === 'Edit' && (unit.input.old_string || unit.input.oldString)"
                      class="message-diff"
                    >
                      <div
                        v-for="(part, pIdx) in getEditDiff(unit)"
                        :key="pIdx"
                        class="message-diff-line"
                        :class="{
                          'message-diff--add': part.added,
                          'message-diff--del': part.removed
                        }"
                      >
                        <pre class="message-diff-text">{{ part.value }}</pre>
                      </div>
                    </div>
                    <pre v-else class="message-tool-params">{{ formatToolInput(unit) }}</pre>
                  </div>
                  <div
                    v-if="unit.result"
                    class="message-tool-result-body markdown-body"
                    v-html="renderMarkdown(unit.result)"
                  ></div>
                </details>
                <details v-else-if="unit.type === 'patch'" class="message-patch-block">
                  <summary>
                    <span class="message-patch-summary"
                      >📝 修改了 {{ (unit.input.files || []).length }} 个文件：{{
                        getToolSummary(unit)
                      }}</span
                    >
                  </summary>
                  <div v-if="unit.input.patches && unit.input.patches.length" class="message-diff">
                    <div
                      v-for="(df, dfIdx) in unit.input.patches"
                      :key="dfIdx"
                      class="message-patch"
                    >
                      <div class="message-patch-file">{{ df.file }}</div>
                      <div
                        v-for="(line, liIdx) in (df.patch || '').split('\n')"
                        :key="liIdx"
                        class="message-patch-line"
                        :class="{
                          'message-diff--add': line.startsWith('+') && !line.startsWith('+++'),
                          'message-diff--del': line.startsWith('-') && !line.startsWith('---')
                        }"
                      >
                        <pre class="message-diff-text">{{ line }}</pre>
                      </div>
                    </div>
                  </div>
                  <div v-else class="message-tool-params">{{ formatToolInput(unit) }}</div>
                </details>
              </template>
            </div>
          </div>
        </div>
      </template>

      <template #footer>
        <div class="detail-footer">
          <n-space :size="6">
            <n-button
              size="small"
              quaternary
              @click="emit('copyTo', session?.app)"
              :title="'复制 ' + copyCmdFor(session?.app) + ' 命令'"
            >
              复制恢复命令
            </n-button>
            <n-button size="small" quaternary @click="emit('export', session)">导出</n-button>
            <n-button size="small" type="primary" @click="onClose">关闭</n-button>
          </n-space>
        </div>
      </template>
    </n-card>
  </n-modal>
</template>

<style lang="scss" scoped>
  .session-detail-card {
    width: 100%;
    max-width: 900px;
    height: 100vh;
    border-radius: 0;
  }

  .detail-meta {
    display: flex;
    align-items: center;
    gap: 10px;
    flex-wrap: wrap;
    font-size: 12px;
  }

  .detail-meta-title {
    font-weight: 600;
    font-size: 13px;
    color: var(--text);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 320px;
  }

  .detail-meta-item {
    font-size: 12px;
    white-space: nowrap;
  }

  .detail-footer {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    padding-top: 12px;
    border-top: 1px solid var(--border);
  }

  .detail-loading,
  .detail-empty {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    padding: 32px 0;
  }

  .message-list {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .message-item {
    display: flex;

    &--user {
      justify-content: flex-start;
    }

    &--assistant {
      justify-content: flex-end;
    }
  }

  .message-bubble {
    max-width: 88%;
    min-width: 40%;
    border-radius: 10px;
    padding: 8px 12px;
    background: var(--bg-card);
    border: 1px solid var(--border);

    .message-item--user & {
      background: rgba(32, 128, 240, 0.07);
      border-color: rgba(32, 128, 240, 0.25);
    }

    .message-item--assistant & {
      background: rgba(24, 160, 88, 0.06);
      border-color: rgba(24, 160, 88, 0.22);
    }
  }

  .message-bubble-head {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 6px;
  }

  .message-time {
    font-size: 10px;
    color: var(--text-secondary);
    margin-left: auto;
  }

  .message-thinking {
    font-size: 12px;
    color: var(--text-secondary);
    border: 1px dashed var(--border);
    border-radius: 4px;
    padding: 0;
    margin-top: 4px;

    summary {
      cursor: pointer;
      padding: 4px 8px;
      font-size: 11px;
      color: var(--text-secondary);
      user-select: none;

      &:hover {
        background: var(--bg-hover);
      }
    }

    &[open] summary {
      border-bottom: 1px dashed var(--border);
    }
  }

  .message-thinking-body {
    padding: 6px 8px;
    max-height: 200px;
    overflow-y: auto;
  }

  .message-thinking-text {
    .message-content {
      margin-top: 4px;
    }
  }

  .message-patch-block {
    font-size: 12px;
    color: var(--text-secondary);
    border: 1px solid var(--border);
    border-radius: 4px;
    padding: 0;
    margin-top: 4px;

    summary {
      cursor: pointer;
      padding: 4px 8px;
      font-size: 11px;
      color: var(--text-secondary);
      user-select: none;

      &:hover {
        background: var(--bg-hover);
      }
    }

    &[open] summary {
      border-bottom: 1px solid var(--border);
    }
  }

  .message-patch-summary {
    color: var(--text);
  }

  .message-tool-use {
    font-size: 11px;
    color: var(--text-secondary);
    background: var(--bg-hover);
    border-radius: 4px;
    margin-top: 2px;
    overflow: hidden;

    > summary {
      cursor: pointer;
      padding: 4px 8px;
      font-size: 11px;
      color: var(--text-secondary);
      user-select: none;

      &:hover {
        background: var(--bg-card);
      }
    }

    &[open] > summary {
      border-bottom: 1px solid var(--border);
    }
  }

  .message-file {
    font-size: 11px;
    color: var(--text-secondary);
    background: var(--bg-hover);
    border-radius: 4px;
    padding: 3px 8px;
    margin-top: 2px;
  }

  .message-tool-detail {
    margin-left: 6px;
    opacity: 0.7;
    font-size: 10px;
  }

  .message-tool-input {
    border-top: 1px solid var(--border);
    padding: 0;
  }

  .message-tool-params {
    margin: 0;
    padding: 6px 8px;
    font-size: 11px;
    line-height: 1.5;
    white-space: pre-wrap;
    word-break: break-word;
    max-height: 200px;
    overflow-y: auto;
    font-family: monospace;
  }

  .message-diff {
    max-height: 250px;
    overflow-y: auto;
    font-size: 11px;
    line-height: 1.5;
  }

  .message-patch {
    border-top: 1px dashed var(--border);

    &:first-child {
      border-top: none;
    }
  }

  .message-patch-file {
    padding: 4px 8px;
    background: var(--bg-card);
    font-weight: 600;
    font-size: 10px;
    position: sticky;
    top: 0;
    z-index: 1;
  }

  .message-diff-line {
    margin: 0;
  }

  .message-diff-text {
    margin: 0;
    padding: 0 8px;
    white-space: pre-wrap;
    word-break: break-word;
  }

  .message-diff--add {
    background: rgba(40, 167, 69, 0.15);

    .message-diff-text {
      color: #28a745;
    }
  }

  .message-diff--del {
    background: rgba(220, 53, 69, 0.15);

    .message-diff-text {
      color: #dc3545;
    }
  }

  .message-tool-result-body {
    padding: 6px 8px;
    max-height: 300px;
    overflow-y: auto;
    font-size: 11px;
    line-height: 1.5;
  }

  .message-content {
    font-size: 12px;
    line-height: 1.6;
    color: var(--text);
    word-break: break-word;
    margin: 0;

    &.markdown-body {
      :deep(h1),
      :deep(h2),
      :deep(h3) {
        margin: 8px 0 6px;
        font-weight: 600;
      }

      :deep(h1) {
        font-size: 15px;
      }
      :deep(h2) {
        font-size: 14px;
      }
      :deep(h3) {
        font-size: 13px;
      }

      :deep(p) {
        margin: 6px 0;
      }

      :deep(code) {
        background: var(--bg-hover);
        padding: 1px 4px;
        border-radius: 3px;
        font-size: 11px;
        font-family: monospace;
      }

      :deep(pre) {
        background: var(--bg-hover);
        padding: 8px 10px;
        border-radius: 4px;
        overflow-x: auto;
        margin: 6px 0;
      }

      :deep(pre code) {
        background: none;
        padding: 0;
      }

      :deep(pre code .hljs-comment),
      :deep(pre code .hljs-quote) {
        color: var(--text-muted);
        font-style: italic;
      }

      :deep(pre code .hljs-string),
      :deep(pre code .hljs-meta .hljs-string) {
        color: var(--success);
      }

      :deep(pre code .hljs-number),
      :deep(pre code .hljs-literal) {
        color: var(--danger);
      }

      :deep(pre code .hljs-keyword),
      :deep(pre code .hljs-selector-tag),
      :deep(pre code .hljs-built_in),
      :deep(pre code .hljs-type) {
        color: var(--primary-pressed);
      }

      :deep(pre code .hljs-title),
      :deep(pre code .hljs-section),
      :deep(pre code .hljs-function .hljs-title) {
        color: var(--primary-hover);
      }

      :deep(pre code .hljs-attr),
      :deep(pre code .hljs-attribute),
      :deep(pre code .hljs-variable) {
        color: var(--primary);
      }

      :deep(pre code .hljs-tag),
      :deep(pre code .hljs-name) {
        color: var(--text);
      }

      :deep(pre code .hljs-symbol),
      :deep(pre code .hljs-bullet),
      :deep(pre code .hljs-link) {
        color: var(--primary);
      }

      :deep(pre code .hljs-emphasis) {
        font-style: italic;
      }

      :deep(pre code .hljs-strong) {
        font-weight: 600;
      }

      :deep(pre code .hljs-addition) {
        color: var(--success);
        background: rgba(40, 167, 69, 0.15);
      }

      :deep(pre code .hljs-deletion) {
        color: var(--danger);
        background: rgba(220, 53, 69, 0.15);
      }

      :deep(blockquote) {
        border-left: 3px solid var(--primary);
        padding-left: 10px;
        margin: 6px 0;
        color: var(--text-secondary);
      }

      :deep(ul),
      :deep(ol) {
        padding-left: 18px;
        margin: 6px 0;
      }

      :deep(li) {
        margin: 2px 0;
      }

      :deep(a) {
        color: var(--primary);
        text-decoration: none;
      }

      :deep(a:hover) {
        text-decoration: underline;
      }

      :deep(table) {
        border-collapse: collapse;
        width: 100%;
        margin: 6px 0;
      }

      :deep(th),
      :deep(td) {
        border: 1px solid var(--border);
        padding: 4px 8px;
        text-align: left;
      }

      :deep(th) {
        background: var(--bg-hover);
        font-weight: 600;
      }

      :deep(hr) {
        border: none;
        border-top: 1px solid var(--border);
        margin: 12px 0;
      }

      :deep(img) {
        max-width: 100%;
        border-radius: 4px;
      }
    }
  }
</style>
