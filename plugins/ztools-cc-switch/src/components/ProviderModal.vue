<script setup>
import { computed, onMounted, reactive, ref, watch } from 'vue'

const props = defineProps({
  provider: { type: Object, required: true },
  clients: { type: Array, required: true }
})
const emit = defineEmits(['close', 'save'])
const form = reactive({ ...props.provider, clients: [...(props.provider.clients || [])] })
form.promptCacheRouting ||= 'auto'
form.modelMapText = JSON.stringify(props.provider.modelMap || {}, null, 2)
const revealKey = ref(false)
const error = ref('')
const authProviders = ref([])
const fetchedModels = ref([])
const modelQuery = ref('')
const fetchingModels = ref(false)
const desktopEnabled = computed(() => form.clients.includes('claude-desktop'))
const visibleModels = computed(() => {
  const query = modelQuery.value.trim().toLowerCase()
  return (query ? fetchedModels.value.filter((item) => item.id.toLowerCase().includes(query) || String(item.ownedBy || '').toLowerCase().includes(query)) : fetchedModels.value).slice(0, 100)
})

onMounted(async () => {
  try { authProviders.value = await window.ccSwitch.listAuthProviders() } catch {}
})
watch(() => form.authProvider, (value) => {
  if (value === 'codex_oauth') { form.baseUrl ||= 'https://chatgpt.com/backend-api/codex'; form.apiType = 'responses'; form.wireApi = 'responses' }
  if (value === 'xai_oauth') { form.baseUrl ||= 'https://api.x.ai/v1'; form.apiType = 'responses' }
  if (value === 'github_copilot') { form.baseUrl ||= 'https://api.githubcopilot.com'; form.apiType = 'openai_compat' }
})
watch(() => form.claudeDesktopMode, (value) => {
  if (value === 'direct') { form.claudeDesktopApiFormat = 'anthropic'; form.apiType = 'anthropic'; form.authProvider = ''; form.isFullUrl = false }
})

function toggleClient(id) {
  form.clients = form.clients.includes(id)
    ? form.clients.filter((item) => item !== id)
    : [...form.clients, id]
}
function addDesktopRoute() {
  form.claudeDesktopRoutes = [...(form.claudeDesktopRoutes || []), { routeId: 'claude-sonnet-5', upstreamModel: '', labelOverride: '', supports1m: false }]
}
function removeDesktopRoute(index) {
  form.claudeDesktopRoutes = (form.claudeDesktopRoutes || []).filter((_, routeIndex) => routeIndex !== index)
}
async function fetchModels() {
  error.value = ''
  if (!form.authProvider && !String(form.apiKey || '').trim()) { error.value = '获取模型前请填写 API Key'; return }
  if (!String(form.baseUrl || '').trim()) { error.value = '获取模型前请填写 Base URL'; return }
  fetchingModels.value = true
  try {
    fetchedModels.value = form.authProvider
      ? await window.ccSwitch.fetchManagedModels(form.authProvider, form.authAccountId, form.baseUrl)
      : await window.ccSwitch.fetchModelsForConfig({ baseUrl: form.baseUrl, apiKey: form.apiKey, isFullUrl: form.isFullUrl, modelsUrl: form.modelsUrl, customUserAgent: form.customUserAgent })
    if (!fetchedModels.value.length) error.value = 'Provider 返回的模型列表为空'
  } catch (fetchError) { error.value = fetchError.message || '获取模型列表失败' }
  finally { fetchingModels.value = false }
}

function submit() {
  error.value = ''
  if (!form.name.trim()) error.value = '请输入 Provider 名称'
  else if (!form.baseUrl.trim()) error.value = '请输入 Base URL'
  else if (!form.clients.length) error.value = '请至少选择一个客户端'
  if (error.value) return
  let modelMap = {}
  try { modelMap = JSON.parse(form.modelMapText || '{}') } catch { error.value = '模型映射必须是有效的 JSON 对象'; return }
  if (!modelMap || Array.isArray(modelMap) || typeof modelMap !== 'object') { error.value = '模型映射必须是 JSON 对象'; return }
  const output = { ...form, modelMap }; delete output.modelMapText
  output.claudeDesktopRoutes = (output.claudeDesktopRoutes || []).map((route) => ({
    routeId: String(route.routeId || '').trim(), upstreamModel: String(route.upstreamModel || '').trim(),
    labelOverride: String(route.labelOverride || '').trim(), supports1m: Boolean(route.supports1m)
  })).filter((route) => route.routeId && route.upstreamModel)
  emit('save', output)
}
</script>

<template>
  <div class="modal-backdrop" @mousedown.self="$emit('close')">
    <section class="provider-modal" role="dialog" aria-modal="true" aria-labelledby="provider-dialog-title">
      <header class="modal-header">
        <div>
          <span class="eyebrow">ROUTE CONFIGURATION</span>
          <h2 id="provider-dialog-title">{{ form.id ? '编辑 Provider' : '添加 Provider' }}</h2>
        </div>
        <button class="modal-close" aria-label="关闭" @click="$emit('close')">×</button>
      </header>

      <form @submit.prevent="submit">
        <div class="form-grid two-columns">
          <div class="form-field">
            <label for="provider-name"><span>名称</span></label>
            <input id="provider-name" v-model="form.name" autocomplete="off" placeholder="例如 DeepSeek" autofocus />
          </div>
          <div class="form-field model-field">
            <label for="provider-model"><span>模型名称</span></label>
            <div class="model-input-row"><input id="provider-model" v-model="form.model" autocomplete="off" placeholder="例如 deepseek-chat" /><button type="button" class="secondary-button" :disabled="fetchingModels" @click="fetchModels"><span v-if="fetchingModels" class="spinner" />获取模型</button></div>
          </div>
        </div>

        <div class="form-field">
          <label for="provider-base-url"><span>Base URL</span></label>
          <input id="provider-base-url" v-model="form.baseUrl" type="url" autocomplete="off" placeholder="https://api.example.com" />
        </div>

        <div class="form-grid two-columns model-endpoint-fields">
          <div class="form-field"><label for="provider-models-url"><span>Models URL（可选）</span></label><input id="provider-models-url" v-model="form.modelsUrl" type="url" autocomplete="off" placeholder="https://api.example.com/v1/models" /><small>留空时按上游规则从 Base URL 推导候选端点。</small></div>
          <div class="form-field"><label for="provider-user-agent"><span>自定义 User-Agent（可选）</span></label><input id="provider-user-agent" v-model="form.customUserAgent" autocomplete="off" placeholder="Claude-Code/…" /><small>用于有 UA 白名单的 Provider。</small></div>
        </div>
        <label class="fast-mode full-url-toggle"><input v-model="form.isFullUrl" type="checkbox" /><span><strong>Base URL 是完整请求地址</strong><small>从 `/v1/messages` 或 `/chat/completions` 反推模型列表端点。</small></span></label>

        <div v-if="fetchedModels.length" class="model-picker"><header><div><span class="card-label">AVAILABLE MODELS</span><strong>{{ fetchedModels.length }}</strong></div><input v-model="modelQuery" placeholder="搜索模型或厂商" /></header><div><button v-for="item in visibleModels" :key="item.id" type="button" :class="{ selected: form.model === item.id }" @click="form.model = item.id"><span>{{ item.id }}</span><small>{{ item.ownedBy || 'unknown' }}</small></button></div><p v-if="!visibleModels.length">没有匹配的模型</p></div>

        <div class="form-grid two-columns auth-binding-fields">
          <div class="form-field">
            <label for="provider-auth-type"><span>认证方式</span></label>
            <select id="provider-auth-type" v-model="form.authProvider">
              <option value="">API Key</option>
              <option v-for="auth in authProviders" :key="auth.id" :value="auth.id">{{ auth.name }}</option>
            </select>
            <small>订阅账号由认证中心管理，Token 不会暴露给此表单。</small>
          </div>
          <div v-if="form.authProvider" class="form-field">
            <label for="provider-auth-account"><span>绑定账号</span></label>
            <select id="provider-auth-account" v-model="form.authAccountId">
              <option value="">使用默认账号</option>
              <option v-for="account in authProviders.find((item) => item.id === form.authProvider)?.accounts || []" :key="account.id" :value="account.id">{{ account.label }}{{ account.isDefault ? '（默认）' : '' }}</option>
            </select>
          </div>
        </div>

        <label v-if="form.authProvider === 'codex_oauth'" class="fast-mode"><input v-model="form.fastMode" type="checkbox" /><span><strong>FAST mode</strong><small>向 Codex 官方 Responses 请求写入 priority service tier。</small></span></label>

        <div v-if="form.clients.includes('codex')" class="form-field">
          <label for="provider-wire-api"><span>Codex API 协议</span></label>
          <select id="provider-wire-api" v-model="form.wireApi">
            <option value="responses">Responses API</option>
            <option value="chat_completions">Chat Completions</option>
          </select>
          <small>应与 Provider 实际支持的 Codex 协议一致。</small>
        </div>

        <div v-if="form.clients.includes('codex') && form.wireApi === 'chat_completions'" class="form-field">
          <label for="provider-prompt-cache-routing"><span>Codex Prompt Cache 路由</span></label>
          <select id="provider-prompt-cache-routing" v-model="form.promptCacheRouting">
            <option value="auto">自动（OpenAI / Kimi Coding）</option>
            <option value="enabled">强制启用</option>
            <option value="disabled">禁用</option>
          </select>
          <small>只转发客户端显式 Cache Key 或真实 Session ID，不使用 previous_response_id。</small>
        </div>

        <div v-if="form.clients.includes('claude')" class="form-field">
          <label for="provider-claude-auth"><span>Claude 鉴权字段</span></label>
          <select id="provider-claude-auth" v-model="form.claudeAuthField">
            <option value="ANTHROPIC_AUTH_TOKEN">ANTHROPIC_AUTH_TOKEN</option>
            <option value="ANTHROPIC_API_KEY">ANTHROPIC_API_KEY</option>
          </select>
          <small>切换时只写入所选字段，避免两个密钥字段互相覆盖。</small>
        </div>

        <div v-if="form.clients.some((id) => ['claude', 'opencode', 'openclaw', 'hermes'].includes(id))" class="form-field">
          <label for="provider-api-type"><span>上游 API 类型</span></label>
          <select id="provider-api-type" v-model="form.apiType">
            <option value="openai_compat">OpenAI Chat Completions</option>
            <option value="responses">OpenAI Responses</option>
            <option value="anthropic">Anthropic Messages</option>
            <option value="gemini">Gemini GenerateContent</option>
          </select>
          <small>本地路由会据此选择鉴权方式和协议整流策略。</small>
        </div>

        <section v-if="desktopEnabled" class="desktop-route-console">
          <header>
            <div><span class="card-label">CLAUDE DESKTOP 3P</span><h3>Gateway 部署策略</h3><p>Direct 写入原生 Anthropic Gateway；Proxy 经本地 Router 转换协议并映射安全模型 ID。</p></div>
            <span class="desktop-signal"><i />{{ form.claudeDesktopMode === 'proxy' ? 'ROUTED' : 'DIRECT' }}</span>
          </header>
          <div class="desktop-mode-grid">
            <label :class="{ selected: form.claudeDesktopMode === 'direct' }"><input v-model="form.claudeDesktopMode" type="radio" value="direct" /><span><strong>Direct 3P</strong><small>仅原生 Anthropic API；模型 ID 必须保持一致。</small></span></label>
            <label :class="{ selected: form.claudeDesktopMode === 'proxy' }"><input v-model="form.claudeDesktopMode" type="radio" value="proxy" /><span><strong>Local Gateway</strong><small>支持 OpenAI、Responses、Gemini 与 OAuth。</small></span></label>
          </div>
          <div v-if="form.claudeDesktopMode === 'proxy'" class="form-field desktop-format-field"><label for="desktop-format"><span>上游协议</span></label><select id="desktop-format" v-model="form.claudeDesktopApiFormat"><option value="anthropic">Anthropic Messages</option><option value="openai_chat">OpenAI Chat Completions</option><option value="openai_responses">OpenAI Responses</option><option value="gemini_native">Gemini GenerateContent</option></select></div>
          <div class="desktop-route-head"><div><strong>模型目录与映射</strong><small>Desktop 只看到 Claude-safe Route ID，真实模型仅在本地转发。</small></div><button type="button" class="secondary-button" @click="addDesktopRoute">添加映射</button></div>
          <div class="desktop-route-list">
            <article v-for="(route, index) in form.claudeDesktopRoutes || []" :key="`${index}-${route.routeId}`">
              <div class="form-field"><label><span>Desktop Route ID</span></label><input v-model="route.routeId" placeholder="claude-sonnet-5" /></div>
              <div class="route-arrow">→</div>
              <div class="form-field"><label><span>Upstream Model</span></label><input v-model="route.upstreamModel" placeholder="kimi-k2.7-code" /></div>
              <label class="route-one-m"><input v-model="route.supports1m" type="checkbox" /><span>1M</span></label>
              <button type="button" class="icon-button danger" title="删除映射" @click="removeDesktopRoute(index)">×</button>
            </article>
            <p v-if="!(form.claudeDesktopRoutes || []).length" class="desktop-route-empty">未配置映射时，将使用顶部“模型名称”作为唯一模型。</p>
          </div>
        </section>

        <div class="form-field">
          <label for="provider-failover"><span>故障转移优先级</span></label>
          <input id="provider-failover" v-model.number="form.failoverPriority" type="number" min="0" max="99" placeholder="0" />
          <small>0 表示不进入备用队列；数字越小优先级越高。</small>
        </div>

        <section class="billing-config-section">
          <span class="card-label">USAGE BILLING</span>
          <div class="form-grid two-columns">
            <div class="form-field"><label for="provider-cost-multiplier"><span>成本倍率覆盖</span></label><input id="provider-cost-multiplier" v-model="form.costMultiplier" inputmode="decimal" placeholder="留空继承应用默认" /><small>留空继承应用级默认；填写时必须为非负数。</small></div>
            <div class="form-field"><label for="provider-pricing-source"><span>计价模型来源覆盖</span></label><select id="provider-pricing-source" v-model="form.pricingModelSource"><option value="">继承应用默认</option><option value="response">响应模型</option><option value="request">请求模型</option></select><small>Provider 覆盖优先于应用默认。</small></div>
            <div class="form-field"><label for="provider-daily-limit"><span>每日消费限额（USD）</span></label><input id="provider-daily-limit" v-model="form.limitDailyUsd" inputmode="decimal" placeholder="留空不限额" /></div>
            <div class="form-field"><label for="provider-monthly-limit"><span>每月消费限额（USD）</span></label><input id="provider-monthly-limit" v-model="form.limitMonthlyUsd" inputmode="decimal" placeholder="留空不限额" /></div>
          </div>
        </section>

        <div class="form-field">
          <label for="provider-model-map"><span>模型映射 JSON</span></label>
          <textarea id="provider-model-map" v-model="form.modelMapText" rows="4" placeholder='{"claude-sonnet-4-5":"gpt-5.2"}' />
          <small>按客户端请求模型映射到上游模型；未命中时使用“模型名称”。</small>
        </div>

        <div v-if="!form.authProvider" class="form-field">
          <label for="provider-api-key"><span>API Key</span></label>
          <div class="input-with-action">
            <input id="provider-api-key" v-model="form.apiKey" :type="revealKey ? 'text' : 'password'" autocomplete="off" placeholder="sk-••••••••" />
            <button type="button" :aria-label="revealKey ? '隐藏 API Key' : '显示 API Key'" @click="revealKey = !revealKey">{{ revealKey ? '隐藏' : '显示' }}</button>
          </div>
          <small>密钥仅保存在本机插件数据目录中。</small>
        </div>

      <fieldset>
          <legend>适用客户端</legend>
          <div class="client-options">
            <button
              v-for="client in clients"
              :key="client.id"
              type="button"
              :class="{ selected: form.clients.includes(client.id) }"
              :style="{ '--client-accent': client.accent }"
              @click="toggleClient(client.id)"
            >
              <i />{{ client.name }}
            </button>
          </div>
      </fieldset>
      <label v-if="form.clients.some((id) => ['claude','codex','gemini'].includes(id))" class="toggle-row common-config-toggle"><span><strong>应用通用配置片段</strong><small>切换时合并设置页为对应客户端保存的共享偏好。</small></span><input v-model="form.commonConfigEnabled" type="checkbox" /></label>
      <label v-if="form.clients.includes('claude')" class="toggle-row"><span><strong>AWS Bedrock Provider</strong><small>本地路由转发前应用上游 Thinking 与 Prompt Cache 优化器。</small></span><input v-model="form.isBedrock" type="checkbox" /></label>

        <p v-if="error" class="form-error">{{ error }}</p>
        <footer class="modal-actions">
          <button type="button" class="secondary-button" @click="$emit('close')">取消</button>
          <button type="submit" class="primary-button">保存 Provider</button>
        </footer>
      </form>
    </section>
  </div>
</template>
