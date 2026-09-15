<script setup lang="ts">
  // @ts-nocheck TODO: 逐步添加类型注解后移除
  import { reactive, watch, computed, ref } from 'vue';

  const props = defineProps({ visible: Boolean, initialData: Object });
  const emit = defineEmits(['close', 'save']);

  const TYPE_OPTIONS = [
    { value: 'stdio', label: 'stdio' },
    { value: 'sse', label: 'SSE' },
    { value: 'streamable-http', label: 'streamable-http' }
  ];

  const AUTH_OPTIONS = [
    { value: 'none', label: '无' },
    { value: 'bearer', label: 'Bearer Token' },
    { value: 'api-key', label: 'API Key' }
  ];

  const form = reactive({
    name: '',
    type: 'stdio',
    description: '',
    enabled: true,
    // stdio
    command: '',
    argsStr: '',
    envRows: [],
    // sse
    sseUrl: '',
    sseHeadersStr: '',
    sseAuthType: 'none',
    sseApiKey: '',
    // http
    httpUrl: '',
    httpHeadersStr: '',
    httpAuthType: 'none',
    httpApiKey: '',
    // advanced
    timeout: 30,
    autoStart: true,
    apps: ['claude']
  });

  // JSON 导入
  const showJsonImport = ref(false);
  const jsonInput = ref('');
  const jsonError = ref('');

  function importJson() {
    jsonError.value = '';
    try {
      var parsed = JSON.parse(jsonInput.value);
      // 支持两种格式：
      // 1. { "mcpServers": { "name": { ... } } } — 标准 MCP 配置
      // 2. { "command": "npx", "args": [...] } — 直接服务器配置
      var serverName = '';
      var serverConfig = null;

      if (parsed.mcpServers && typeof parsed.mcpServers === 'object') {
        var keys = Object.keys(parsed.mcpServers);
        if (keys.length > 0) {
          serverName = keys[0];
          serverConfig = parsed.mcpServers[serverName];
        }
      } else if (parsed.command || parsed.url || parsed.args) {
        serverConfig = parsed;
      }

      if (!serverConfig) {
        jsonError.value = '未找到有效的 MCP Server 配置';
        return;
      }

      // 填充表单
      if (serverName) form.name = serverName;

      if (serverConfig.command) {
        form.type = 'stdio';
        form.command = serverConfig.command || '';
        form.argsStr = (serverConfig.args || []).join(' ');
        form.envRows = serverConfig.env
          ? Object.keys(serverConfig.env).map(function (k) {
              return { key: k, value: serverConfig.env[k] };
            })
          : [];
      } else if (serverConfig.url) {
        form.type = 'streamable-http';
        form.httpUrl = serverConfig.url || '';
        form.httpHeadersStr = serverConfig.headers
          ? Object.keys(serverConfig.headers)
              .map(function (k) {
                return k + ': ' + serverConfig.headers[k];
              })
              .join('\n')
          : '';
      }

      showJsonImport.value = false;
      jsonInput.value = '';
    } catch (e) {
      jsonError.value = 'JSON 解析失败: ' + (e.message || '格式错误');
    }
  }

  // env 键值对编辑
  function addEnvRow() {
    form.envRows.push({ key: '', value: '' });
  }
  function removeEnvRow(i) {
    form.envRows.splice(i, 1);
  }

  // args 解析：支持引号包裹
  function parseArgs(str) {
    if (!str || !str.trim()) return [];
    var result = [];
    var current = '';
    var inQuote = false;
    var quoteChar = '';
    for (var i = 0; i < str.length; i++) {
      var ch = str[i];
      if (inQuote) {
        if (ch === quoteChar) {
          inQuote = false;
        } else {
          current += ch;
        }
      } else if (ch === '"' || ch === "'") {
        inQuote = true;
        quoteChar = ch;
      } else if (ch === ' ' || ch === '\t') {
        if (current) {
          result.push(current);
          current = '';
        }
      } else {
        current += ch;
      }
    }
    if (current) result.push(current);
    return result;
  }

  // headers 解析：每行 Key: Value
  function parseHeaders(str) {
    if (!str || !str.trim()) return {};
    var headers = {};
    str.split(/\r?\n/).forEach(function (line) {
      var idx = line.indexOf(':');
      if (idx > 0) {
        var key = line.substring(0, idx).trim();
        var val = line.substring(idx + 1).trim();
        if (key) headers[key] = val;
      }
    });
    return headers;
  }

  // 从 form 构建保存数据
  function buildSaveData() {
    var data = {
      id: props.initialData?.id || undefined,
      name: form.name,
      type: form.type,
      description: form.description,
      enabled: form.enabled,
      timeout: form.timeout,
      autoStart: form.autoStart,
      apps: form.apps,
      createdAt: props.initialData?.createdAt || undefined
    };

    if (form.type === 'stdio') {
      var env = {};
      form.envRows.forEach(function (r) {
        if (r.key) env[r.key] = r.value;
      });
      data.stdio = {
        command: form.command,
        args: parseArgs(form.argsStr),
        env: env
      };
      data.sse = null;
      data.http = null;
    } else if (form.type === 'sse') {
      data.stdio = null;
      data.sse = {
        url: form.sseUrl,
        headers: parseHeaders(form.sseHeadersStr),
        authType: form.sseAuthType,
        apiKey: form.sseApiKey
      };
      data.http = null;
    } else {
      data.stdio = null;
      data.sse = null;
      data.http = {
        url: form.httpUrl,
        headers: parseHeaders(form.httpHeadersStr),
        authType: form.httpAuthType,
        apiKey: form.httpApiKey
      };
    }

    return data;
  }

  // 配置预览
  const configPreview = computed(() => {
    var data = buildSaveData();
    var entry = null;
    if (data.type === 'stdio' && data.stdio) {
      entry = { command: data.stdio.command, args: data.stdio.args };
      if (data.stdio.env && Object.keys(data.stdio.env).length) entry.env = data.stdio.env;
    } else if (data.type === 'sse' && data.sse) {
      entry = { url: data.sse.url };
      if (data.sse.headers && Object.keys(data.sse.headers).length)
        entry.headers = data.sse.headers;
    } else if (data.type === 'streamable-http' && data.http) {
      entry = { url: data.http.url };
      if (data.http.headers && Object.keys(data.http.headers).length)
        entry.headers = data.http.headers;
    }
    if (!entry) return '{}';
    var obj = {};
    obj[data.name || 'server-name'] = entry;
    return JSON.stringify(obj, null, 2);
  });

  // 表单回填
  watch(
    () => props.visible,
    function (v) {
      if (!v) return;
      var d = props.initialData;
      if (d) {
        form.name = d.name || '';
        form.type = d.type || 'stdio';
        form.description = d.description || '';
        form.enabled = d.enabled !== false;
        form.command = d.stdio?.command || '';
        form.argsStr = (d.stdio?.args || []).join(' ');
        form.envRows = d.stdio?.env
          ? Object.keys(d.stdio.env).map(function (k) {
              return { key: k, value: d.stdio.env[k] };
            })
          : [];
        form.sseUrl = d.sse?.url || '';
        form.sseHeadersStr = d.sse?.headers
          ? Object.keys(d.sse.headers)
              .map(function (k) {
                return k + ': ' + d.sse.headers[k];
              })
              .join('\n')
          : '';
        form.sseAuthType = d.sse?.authType || 'none';
        form.sseApiKey = d.sse?.apiKey || '';
        form.httpUrl = d.http?.url || '';
        form.httpHeadersStr = d.http?.headers
          ? Object.keys(d.http.headers)
              .map(function (k) {
                return k + ': ' + d.http.headers[k];
              })
              .join('\n')
          : '';
        form.httpAuthType = d.http?.authType || 'none';
        form.httpApiKey = d.http?.apiKey || '';
        form.timeout = d.timeout || 30;
        form.autoStart = d.autoStart !== false;
        form.apps = d.apps || [];
      } else {
        // 重置为默认值
        form.name = '';
        form.type = 'stdio';
        form.description = '';
        form.enabled = true;
        form.command = '';
        form.argsStr = '';
        form.envRows = [];
        form.sseUrl = '';
        form.sseHeadersStr = '';
        form.sseAuthType = 'none';
        form.sseApiKey = '';
        form.httpUrl = '';
        form.httpHeadersStr = '';
        form.httpAuthType = 'none';
        form.httpApiKey = '';
        form.timeout = 30;
        form.autoStart = true;
        form.apps = ['claude'];
      }
    }
  );

  function handleSave() {
    emit('save', buildSaveData());
  }

  function handleClose() {
    emit('close');
  }
</script>

<template>
  <n-drawer
    :show="visible"
    width="50vw"
    placement="right"
    @update:show="
      v => {
        if (!v) handleClose();
      }
    "
  >
    <n-drawer-content closable>
      <template #header>
        {{ initialData ? '编辑 MCP Server' : '添加 MCP Server' }}
      </template>

      <div class="drawer-body">
        <!-- JSON 导入 -->
        <n-card size="small" :bordered="true" class="section-card">
          <template #header>
            <n-flex align="center" justify="space-between" style="width: 100%">
              <n-text depth="2" style="font-size: 12px; font-weight: 600">快速导入</n-text>
              <n-button size="tiny" quaternary @click="showJsonImport = !showJsonImport">
                {{ showJsonImport ? '收起' : 'JSON 导入 ›' }}
              </n-button>
            </n-flex>
          </template>
          <template v-if="showJsonImport">
            <n-flex vertical :size="8">
              <n-input
                v-model:value="jsonInput"
                type="textarea"
                :rows="6"
                placeholder='粘贴 JSON 配置，如：
{
  "mcpServers": {
    "amap-maps": {
      "command": "npx",
      "args": ["-y", "@amap/amap-maps-mcp-server"],
      "env": { "AMAP_MAPS_API_KEY": "your-key" }
    }
  }
}'
                style="
                  font-family: 'SF Mono', 'Cascadia Code', 'Consolas', monospace;
                  font-size: 12px;
                "
              />
              <n-text v-if="jsonError" type="error" style="font-size: 11px">{{ jsonError }}</n-text>
              <n-button
                type="primary"
                size="small"
                @click="importJson"
                :disabled="!jsonInput.trim()"
              >
                解析并填充
              </n-button>
            </n-flex>
          </template>
        </n-card>

        <!-- 基本信息 -->
        <n-card title="基本信息" size="small" :bordered="true" class="section-card">
          <n-flex vertical :size="10">
            <n-grid :cols="2" :x-gap="10">
              <n-gi>
                <n-form-item
                  label="名称"
                  label-placement="top"
                  label-style="font-size: 11px; font-weight: 600;"
                >
                  <n-input v-model:value="form.name" placeholder="如 Filesystem" />
                </n-form-item>
              </n-gi>
              <n-gi>
                <n-form-item
                  label="类型"
                  label-placement="top"
                  label-style="font-size: 11px; font-weight: 600;"
                >
                  <n-select v-model:value="form.type" :options="TYPE_OPTIONS" />
                </n-form-item>
              </n-gi>
            </n-grid>
            <n-form-item
              label="描述"
              label-placement="top"
              label-style="font-size: 11px; font-weight: 600;"
            >
              <n-input
                v-model:value="form.description"
                placeholder="选填，简要描述该 MCP Server 的功能"
              />
            </n-form-item>
          </n-flex>
        </n-card>

        <!-- 传输配置：stdio -->
        <n-card
          v-if="form.type === 'stdio'"
          title="stdio 配置"
          size="small"
          :bordered="true"
          class="section-card"
        >
          <n-flex vertical :size="10">
            <n-form-item
              label="命令"
              label-placement="top"
              label-style="font-size: 11px; font-weight: 600;"
            >
              <n-input v-model:value="form.command" placeholder="npx" />
            </n-form-item>
            <n-form-item
              label="参数"
              label-placement="top"
              label-style="font-size: 11px; font-weight: 600;"
            >
              <template #label>
                <n-text style="font-size: 11px; font-weight: 600"
                  >参数
                  <n-text depth="3" style="font-weight: 400"
                    >(空格分隔，引号包裹含空格的参数)</n-text
                  ></n-text
                >
              </template>
              <n-input
                v-model:value="form.argsStr"
                placeholder="-y @modelcontextprotocol/server-filesystem /path"
              />
            </n-form-item>
            <div>
              <n-text style="font-size: 11px; font-weight: 600; display: block; margin-bottom: 6px"
                >环境变量</n-text
              >
              <div v-for="(row, i) in form.envRows" :key="i" class="env-row">
                <n-input v-model:value="row.key" placeholder="KEY" size="small" class="env-key" />
                <n-input
                  v-model:value="row.value"
                  placeholder="value"
                  size="small"
                  class="env-val"
                />
                <n-button quaternary type="error" size="tiny" @click="removeEnvRow(i)">×</n-button>
              </div>
              <n-button dashed size="small" @click="addEnvRow" style="margin-top: 4px; width: 100%"
                >+ 添加环境变量</n-button
              >
            </div>
          </n-flex>
        </n-card>

        <!-- 传输配置：sse -->
        <n-card
          v-if="form.type === 'sse'"
          title="SSE 配置"
          size="small"
          :bordered="true"
          class="section-card"
        >
          <n-flex vertical :size="10">
            <n-form-item
              label="URL"
              label-placement="top"
              label-style="font-size: 11px; font-weight: 600;"
            >
              <n-input v-model:value="form.sseUrl" placeholder="https://example.com/mcp/sse" />
            </n-form-item>
            <n-form-item
              label="认证"
              label-placement="top"
              label-style="font-size: 11px; font-weight: 600;"
            >
              <n-select v-model:value="form.sseAuthType" :options="AUTH_OPTIONS" />
            </n-form-item>
            <n-form-item
              v-if="form.sseAuthType !== 'none'"
              label="API Key / Token"
              label-placement="top"
              label-style="font-size: 11px; font-weight: 600;"
            >
              <n-input
                v-model:value="form.sseApiKey"
                type="password"
                show-password-on="click"
                placeholder="sk-..."
              />
            </n-form-item>
            <n-form-item
              label="Headers"
              label-placement="top"
              label-style="font-size: 11px; font-weight: 600;"
            >
              <template #label>
                <n-text style="font-size: 11px; font-weight: 600"
                  >Headers
                  <n-text depth="3" style="font-weight: 400">(每行一个 Key: Value)</n-text></n-text
                >
              </template>
              <n-input
                v-model:value="form.sseHeadersStr"
                type="textarea"
                :rows="3"
                placeholder="X-Custom: value"
              />
            </n-form-item>
          </n-flex>
        </n-card>

        <!-- 传输配置：streamable-http -->
        <n-card
          v-if="form.type === 'streamable-http'"
          title="HTTP 配置"
          size="small"
          :bordered="true"
          class="section-card"
        >
          <n-flex vertical :size="10">
            <n-form-item
              label="URL"
              label-placement="top"
              label-style="font-size: 11px; font-weight: 600;"
            >
              <n-input v-model:value="form.httpUrl" placeholder="https://example.com/mcp" />
            </n-form-item>
            <n-form-item
              label="认证"
              label-placement="top"
              label-style="font-size: 11px; font-weight: 600;"
            >
              <n-select v-model:value="form.httpAuthType" :options="AUTH_OPTIONS" />
            </n-form-item>
            <n-form-item
              v-if="form.httpAuthType !== 'none'"
              label="API Key / Token"
              label-placement="top"
              label-style="font-size: 11px; font-weight: 600;"
            >
              <n-input
                v-model:value="form.httpApiKey"
                type="password"
                show-password-on="click"
                placeholder="sk-..."
              />
            </n-form-item>
            <n-form-item
              label="Headers"
              label-placement="top"
              label-style="font-size: 11px; font-weight: 600;"
            >
              <template #label>
                <n-text style="font-size: 11px; font-weight: 600"
                  >Headers
                  <n-text depth="3" style="font-weight: 400">(每行一个 Key: Value)</n-text></n-text
                >
              </template>
              <n-input
                v-model:value="form.httpHeadersStr"
                type="textarea"
                :rows="3"
                placeholder="X-Custom: value"
              />
            </n-form-item>
          </n-flex>
        </n-card>

        <!-- 高级设置 -->
        <n-card title="高级设置" size="small" :bordered="true" class="section-card">
          <n-flex vertical :size="10">
            <n-grid :cols="2" :x-gap="10">
              <n-gi>
                <n-form-item
                  label="超时(秒)"
                  label-placement="top"
                  label-style="font-size: 11px; font-weight: 600;"
                >
                  <n-input-number
                    v-model:value="form.timeout"
                    :min="1"
                    :max="300"
                    :show-button="false"
                    style="width: 100%"
                  />
                </n-form-item>
              </n-gi>
              <n-gi>
                <n-form-item
                  label="自动启动"
                  label-placement="top"
                  label-style="font-size: 11px; font-weight: 600;"
                >
                  <n-switch v-model:value="form.autoStart" />
                </n-form-item>
              </n-gi>
            </n-grid>
          </n-flex>
        </n-card>

        <!-- 配置预览 -->
        <n-card title="配置预览" size="small" :bordered="true" class="section-card">
          <div class="preview-code">
            <n-code :code="configPreview" language="json" />
          </div>
          <n-text depth="3" style="font-size: 10px; margin-top: 4px; display: block"
            >保存后将自动同步到关联应用的配置文件</n-text
          >
        </n-card>
      </div>

      <template #footer>
        <n-flex justify="end" :size="8">
          <n-button quaternary @click="handleClose">取消</n-button>
          <n-button type="primary" strong @click="handleSave" :disabled="!form.name">保存</n-button>
        </n-flex>
      </template>
    </n-drawer-content>
  </n-drawer>
</template>

<style scoped>
  /* ── Drawer 项目基调 ── */
  :deep(.n-drawer-body-content) {
    background: var(--bg);
    color: var(--text);
  }
  :deep(.n-drawer-content) {
    background: var(--bg) !important;
    color: var(--text);
    --n-text-color: var(--text);
  }
  :deep(.n-drawer-header__main) {
    color: var(--text);
  }
  :deep(.n-drawer-content .n-drawer-header) {
    background: var(--bg);
    border-bottom: 1px solid var(--border);
  }
  :deep(.n-drawer-content .n-drawer-footer) {
    background: var(--bg);
    border-top: 1px solid var(--border);
  }

  .drawer-body {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .section-card :deep(.n-card__content) {
    padding: 8px 10px;
  }
  .section-card :deep(.n-card-header) {
    padding: 8px 10px 4px;
  }
  .section-card :deep(.n-card-header__main) {
    color: var(--text);
  }

  /* 表单项紧凑 */
  .drawer-body :deep(.n-form-item) {
    margin-bottom: 0 !important;
    --n-label-padding-vertical: 0 0 2px 0 !important;
    --n-blank-height-small: 0px !important;
    --n-blank-height-medium: 0px !important;
    --n-blank-height-large: 0px !important;
  }
  .drawer-body :deep(.n-form-item .n-form-item-label) {
    font-weight: 600;
    padding-bottom: 2px !important;
    min-height: auto !important;
    line-height: 1.4;
  }
  .drawer-body :deep(.n-form-item .n-form-item-blank) {
    min-height: 0;
  }
  .drawer-body :deep(.n-base-selection),
  .drawer-body :deep(.n-input) {
    --n-height: 30px !important;
  }
  .drawer-body :deep(.n-form-item .n-form-item-feedback-wrapper) {
    min-height: 0 !important;
    padding-top: 0 !important;
  }
  .drawer-body :deep(.n-gi .n-form-item) {
    margin-bottom: 0;
  }

  /* 环境变量行 */
  .env-row {
    display: flex;
    gap: 6px;
    align-items: center;
    margin-bottom: 4px;
  }
  .env-key {
    flex: 1;
  }
  .env-val {
    flex: 2;
  }

  /* 配置预览 */
  .preview-code {
    background: var(--primary-light);
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 8px 10px;
    font-family: 'SF Mono', 'Cascadia Code', 'Consolas', monospace;
    font-size: 12px;
    line-height: 1.5;
    overflow-x: auto;
    max-height: 200px;
    overflow-y: auto;
  }
</style>
