// Common provider metadata (name, urls, icon, category)
// Referenced by preset files via `provider` key
// Individual presets can override any of these fields

export const PROVIDERS = {
  aicodemirror: {
    name: 'AICodeMirror',
    websiteUrl: 'https://www.aicodemirror.com',
    apiKeyUrl: 'https://www.aicodemirror.com/register?invitecode=9915W3',
    category: 'third_party',
    icon: 'aicodemirror',
    iconColor: '#000000',
    badge: 'partner'
  },
  aigocode: {
    name: 'AIGoCode',
    websiteUrl: 'https://aigocode.com',
    apiKeyUrl: 'https://aigocode.com/invite/ZTOOLS-CCTOGGLE',
    category: 'third_party',
    icon: 'aigocode',
    iconColor: '#5B7FFF',
    badge: 'partner'
  },
  aihubmix: {
    name: 'AiHubMix',
    websiteUrl: 'https://aihubmix.com',
    apiKeyUrl: 'https://aihubmix.com',
    category: 'aggregator',
    icon: 'aihubmix',
    iconColor: '#006FFB',
    badge: ''
  },
  amux: {
    name: 'Amux',
    websiteUrl: 'https://amux.ai',
    apiKeyUrl: 'https://amux.ai',
    category: 'aggregator',
    icon: 'amux',
    iconColor: '',
    badge: ''
  },
  apikey_fun: {
    name: 'APIKEY.FUN',
    websiteUrl: 'https://apikey.fun',
    apiKeyUrl: 'https://apikey.fun/register?aff=ZtoolsCctoggle',
    category: 'third_party',
    icon: 'apikeyfun',
    iconColor: '',
    badge: 'partner'
  },
  apinebula: {
    name: 'APINebula',
    websiteUrl: 'https://apinebula.com',
    apiKeyUrl: 'https://apinebula.com/VjM74M',
    category: 'third_party',
    icon: 'apinebula',
    iconColor: '',
    badge: 'partner'
  },
  atlascloud: {
    name: 'AtlasCloud',
    websiteUrl: 'https://www.atlascloud.ai/console/coding-plan',
    apiKeyUrl: 'https://www.atlascloud.ai/console/coding-plan',
    category: 'aggregator',
    icon: 'atlascloud',
    iconColor: '',
    badge: 'partner'
  },
  aws_bedrock: {
    name: 'AWS Bedrock',
    websiteUrl: 'https://aws.amazon.com/bedrock/',
    apiKeyUrl: '',
    category: 'cloud_provider',
    icon: 'aws',
    iconColor: '#FF9900',
    badge: ''
  },
  aws_bedrock_aksk: {
    name: 'AWS Bedrock (AKSK)',
    websiteUrl: 'https://aws.amazon.com/bedrock/',
    apiKeyUrl: '',
    category: 'cloud_provider',
    icon: 'aws',
    iconColor: '#FF9900',
    badge: ''
  },
  aws_bedrock_api_key: {
    name: 'AWS Bedrock (API Key)',
    websiteUrl: 'https://aws.amazon.com/bedrock/',
    apiKeyUrl: '',
    category: 'cloud_provider',
    icon: 'aws',
    iconColor: '#FF9900',
    badge: ''
  },
  azure_openai: {
    name: 'Azure OpenAI',
    websiteUrl: 'https://learn.microsoft.com/en-us/azure/ai-foundry/openai/how-to/codex',
    apiKeyUrl: '',
    category: 'third_party',
    icon: 'azure',
    iconColor: '#0078D4',
    badge: 'official'
  },
  baidu_qianfan_coding_plan: {
    name: 'Baidu Qianfan Coding Plan',
    websiteUrl: 'https://cloud.baidu.com/product/qianfan_modelbuilder',
    apiKeyUrl: 'https://console.bce.baidu.com/qianfan/ais/console/applicationConsole/application',
    category: 'cn_official',
    icon: 'baidu',
    iconColor: '#2932E1',
    badge: ''
  },
  bailian: {
    name: 'Bailian',
    websiteUrl: 'https://bailian.console.aliyun.com',
    apiKeyUrl: 'https://bailian.console.aliyun.com/#/api-key',
    category: 'cn_official',
    icon: 'bailian',
    iconColor: '#624AFF',
    badge: ''
  },
  bailian_for_coding: {
    name: 'Bailian For Coding',
    websiteUrl: 'https://bailian.console.aliyun.com',
    apiKeyUrl: '',
    category: 'cn_official',
    icon: 'bailian',
    iconColor: '#624AFF',
    badge: ''
  },
  bailian_token_plan: {
    name: '千问(token-plan)',
    websiteUrl: 'https://platform.qianwenai.com',
    apiKeyUrl: 'https://platform.qianwenai.com/home/api-keys?target=individual',
    category: 'cn_official',
    icon: 'qwen',
    iconColor: '#FF6A00',
    badge: ''
  },
  bailing: {
    name: 'BaiLing',
    websiteUrl: 'https://alipaytbox.yuque.com/sxs0ba/ling/get_started',
    apiKeyUrl: '',
    category: 'cn_official',
    icon: '',
    iconColor: '',
    badge: ''
  },
  byteplus: {
    name: 'BytePlus',
    websiteUrl:
      'https://www.byteplus.com/en/product/modelark?utm_campaign=hw&utm_content=ztoolscctoggle&utm_medium=devrel_tool_web&utm_source=OWO&utm_term=ztoolscctoggle',
    apiKeyUrl:
      'https://www.byteplus.com/en/product/modelark?utm_campaign=hw&utm_content=ztoolscctoggle&utm_medium=devrel_tool_web&utm_source=OWO&utm_term=ztoolscctoggle',
    category: 'cn_official',
    icon: 'byteplus',
    iconColor: '#3370FF',
    badge: 'partner'
  },
  ccsub: {
    name: 'CCSub',
    websiteUrl: 'https://www.ccsub.net',
    apiKeyUrl: 'https://www.ccsub.net/register?ref=Y6Z8DXEA',
    category: 'aggregator',
    icon: 'ccsub',
    iconColor: '',
    badge: 'partner'
  },
  cherryin: {
    name: 'CherryIN',
    websiteUrl: 'https://open.cherryin.ai',
    apiKeyUrl: 'https://open.cherryin.ai/console/token',
    category: 'aggregator',
    icon: 'cherryin',
    iconColor: '',
    badge: ''
  },
  claude_official: {
    name: 'Claude Official',
    websiteUrl: 'https://www.anthropic.com/claude-code',
    apiKeyUrl: '',
    category: 'official',
    icon: 'anthropic',
    iconColor: '#D4915D',
    badge: 'official'
  },
  claudeapi: {
    name: 'ClaudeAPI',
    websiteUrl: 'https://claudeapi.com',
    apiKeyUrl: 'https://console.claudeapi.com/register?aff=pCLD',
    category: 'aggregator',
    icon: 'claudeapi',
    iconColor: '',
    badge: 'partner'
  },
  claudecn: {
    name: 'ClaudeCN',
    websiteUrl: 'https://claudecn.top',
    apiKeyUrl: 'https://claudecn.ai/register?aff=HEL9',
    category: 'third_party',
    icon: 'claudecn',
    iconColor: '',
    badge: 'partner'
  },
  code0: {
    name: 'Code0',
    websiteUrl: 'https://code0.ai',
    apiKeyUrl: 'https://code0.ai/agent/register/B2XHxGjGmRvqgznY',
    category: 'aggregator',
    icon: 'code0',
    iconColor: '',
    badge: 'partner'
  },
  codex: {
    name: 'Codex',
    websiteUrl: 'https://openai.com/chatgpt/pricing',
    apiKeyUrl: '',
    category: 'third_party',
    icon: 'openai',
    iconColor: '#000000',
    badge: ''
  },
  compshare: {
    name: 'Compshare',
    websiteUrl: 'https://www.compshare.cn',
    apiKeyUrl: 'https://www.compshare.cn/coding-plan?ytag=GPU_YY_YX_git_ztools-cctoggle',
    category: 'aggregator',
    icon: 'ucloud',
    iconColor: '#000000',
    badge: 'partner'
  },
  compshare_coding_plan: {
    name: 'Compshare Coding Plan',
    websiteUrl: 'https://www.compshare.cn',
    apiKeyUrl: 'https://www.compshare.cn/coding-plan?ytag=GPU_YY_YX_git_ztools-cctoggle',
    category: 'aggregator',
    icon: 'ucloud',
    iconColor: '#000000',
    badge: 'partner'
  },
  crazyrouter: {
    name: 'CrazyRouter',
    websiteUrl: 'https://www.crazyrouter.com',
    apiKeyUrl: 'https://www.crazyrouter.com/register?aff=OZcm&ref=ztools-cctoggle',
    category: 'third_party',
    icon: 'crazyrouter',
    iconColor: '#000000',
    badge: 'partner'
  },
  cubence: {
    name: 'Cubence',
    websiteUrl: 'https://cubence.com',
    apiKeyUrl: 'https://cubence.com/signup?code=ZTOOLSCCTOGGLE&source=ztoolscctoggle',
    category: 'third_party',
    icon: 'cubence',
    iconColor: '#000000',
    badge: 'partner'
  },
  deepseek: {
    name: 'DeepSeek',
    websiteUrl: 'https://platform.deepseek.com',
    apiKeyUrl: 'https://platform.deepseek.com/api_keys',
    category: 'cn_official',
    icon: 'deepseek',
    iconColor: '#1E88E5',
    badge: ''
  },
  dmxapi: {
    name: 'DMXAPI',
    websiteUrl: 'https://www.dmxapi.cn',
    apiKeyUrl: 'https://www.dmxapi.cn',
    category: 'aggregator',
    icon: '',
    iconColor: '',
    badge: 'partner'
  },
  doubaoseed: {
    name: 'DouBaoSeed',
    websiteUrl:
      'https://console.volcengine.com/ark/region:ark+cn-beijing/apiKey?apikey=%7B%7D&utm_campaign=hw&utm_content=ztoolscctoggle&utm_medium=devrel_tool_web&utm_source=OWO&utm_term=ztoolscctoggle',
    apiKeyUrl:
      'https://console.volcengine.com/ark/region:ark+cn-beijing/apiKey?apikey=%7B%7D&utm_campaign=hw&utm_content=ztoolscctoggle&utm_medium=devrel_tool_web&utm_source=OWO&utm_term=ztoolscctoggle',
    category: 'cn_official',
    icon: 'doubao',
    iconColor: '#3370FF',
    badge: 'partner'
  },
  e_flowcode: {
    name: 'E-FlowCode',
    websiteUrl: 'https://e-flowcode.cc',
    apiKeyUrl: 'https://e-flowcode.cc',
    category: 'third_party',
    icon: 'eflowcode',
    iconColor: '#000000',
    badge: ''
  },
  etok_ai: {
    name: 'ETok.ai',
    websiteUrl: 'https://etok.ai',
    apiKeyUrl: 'https://etok.ai',
    category: 'third_party',
    icon: 'etok',
    iconColor: '#000000',
    badge: 'partner'
  },
  fennoai: {
    name: 'FennoAI',
    websiteUrl: 'https://api.fenno.ai',
    apiKeyUrl:
      'https://api.fenno.ai/register?redirect=/purchase?tab=subscription%26group=16&aff=P9MR3D3PLCNL',
    category: 'aggregator',
    icon: 'fenno',
    iconColor: '',
    badge: 'partner'
  },
  gemini_native: {
    name: 'Gemini Native',
    websiteUrl: 'https://ai.google.dev/gemini-api',
    apiKeyUrl: 'https://aistudio.google.com/app/apikey',
    category: 'third_party',
    icon: 'gemini',
    iconColor: '#4285F4',
    badge: ''
  },
  github_copilot: {
    name: 'GitHub Copilot',
    websiteUrl: 'https://github.com/features/copilot',
    apiKeyUrl: '',
    category: 'third_party',
    icon: 'github',
    iconColor: '#000000',
    badge: ''
  },
  google_official: {
    name: 'Google Official',
    websiteUrl: 'https://ai.google.dev/',
    apiKeyUrl: 'https://aistudio.google.com/apikey',
    category: 'official',
    icon: 'gemini',
    iconColor: '#4285F4',
    badge: 'official'
  },
  kat_coder: {
    name: 'KAT-Coder',
    websiteUrl: 'https://console.streamlake.ai',
    apiKeyUrl: 'https://console.streamlake.ai/console/api-key',
    category: 'cn_official',
    icon: 'catcoder',
    iconColor: '',
    badge: ''
  },
  kimi: {
    name: 'Kimi',
    websiteUrl: 'https://platform.kimi.com?aff=ztools-cctoggle',
    apiKeyUrl: 'https://platform.kimi.com/console/api-keys?aff=ztools-cctoggle',
    category: 'cn_official',
    icon: 'kimi',
    iconColor: '#6366F1',
    badge: 'prime'
  },
  kimi_for_coding: {
    name: 'Kimi For Coding',
    websiteUrl: 'https://www.kimi.com/code/?aff=ztools-cctoggle',
    apiKeyUrl: 'https://www.kimi.com/code/?aff=ztools-cctoggle',
    category: 'cn_official',
    icon: 'kimi',
    iconColor: '#6366F1',
    badge: 'prime'
  },
  longcat: {
    name: 'Longcat',
    websiteUrl: 'https://longcat.chat/platform',
    apiKeyUrl: 'https://longcat.chat/platform/api_keys',
    category: 'cn_official',
    icon: 'longcat',
    iconColor: '#29E154',
    badge: ''
  },
  micu: {
    name: 'Micu',
    websiteUrl: 'https://www.micuapi.ai',
    apiKeyUrl: 'https://www.micuapi.ai/register?aff=aOYQ',
    category: 'third_party',
    icon: 'micu',
    iconColor: '#000000',
    badge: 'partner'
  },
  minimax: {
    name: 'MiniMax',
    websiteUrl: 'https://platform.minimaxi.com',
    apiKeyUrl: 'https://platform.minimaxi.com/subscribe/coding-plan',
    category: 'cn_official',
    icon: 'minimax',
    iconColor: '#FF6B6B',
    badge: ''
  },
  minimax_en: {
    name: 'MiniMax en',
    websiteUrl: 'https://platform.minimax.io',
    apiKeyUrl: 'https://platform.minimax.io/subscribe/coding-plan',
    category: 'cn_official',
    icon: 'minimax',
    iconColor: '#FF6B6B',
    badge: ''
  },
  modelscope: {
    name: 'ModelScope',
    websiteUrl: 'https://modelscope.cn',
    apiKeyUrl: 'https://modelscope.cn/my/myaccesstoken',
    category: 'aggregator',
    icon: 'modelscope',
    iconColor: '#624AFF',
    badge: ''
  },
  nekocode: {
    name: 'NekoCode',
    websiteUrl: 'https://nekocode.ai',
    apiKeyUrl: 'https://nekocode.ai?aff=ZTOOLSCCTOGGLE',
    category: 'aggregator',
    icon: 'nekocode',
    iconColor: '',
    badge: 'partner'
  },
  novita_ai: {
    name: 'Novita AI',
    websiteUrl: 'https://novita.ai',
    apiKeyUrl: 'https://novita.ai',
    category: 'aggregator',
    icon: 'novita',
    iconColor: '#000000',
    badge: ''
  },
  nvidia: {
    name: 'Nvidia',
    websiteUrl: 'https://build.nvidia.com',
    apiKeyUrl: 'https://build.nvidia.com/settings/api-keys',
    category: 'aggregator',
    icon: 'nvidia',
    iconColor: '#000000',
    badge: ''
  },
  openai_official: {
    name: 'OpenAI Official',
    websiteUrl: 'https://chatgpt.com/codex',
    apiKeyUrl: '',
    category: 'official',
    icon: 'openai',
    iconColor: '#00A67E',
    badge: 'official'
  },
  opencode_go: {
    name: 'OpenCode Go',
    websiteUrl: 'https://opencode.ai/go',
    apiKeyUrl: 'https://opencode.ai/go?ref=2YTRG2NGTX',
    category: 'third_party',
    icon: 'opencode',
    iconColor: '#211E1E',
    badge: ''
  },
  openrouter: {
    name: 'OpenRouter',
    websiteUrl: 'https://openrouter.ai',
    apiKeyUrl: 'https://openrouter.ai/keys',
    category: 'aggregator',
    icon: 'openrouter',
    iconColor: '#6566F1',
    badge: ''
  },
  packycode: {
    name: 'PackyCode',
    websiteUrl: 'https://www.packyapi.com',
    apiKeyUrl: 'https://www.packyapi.com/register?aff=ztools-cctoggle',
    category: 'third_party',
    icon: 'packycode',
    iconColor: '',
    badge: 'partner'
  },
  patewayai: {
    name: 'PatewayAI',
    websiteUrl: 'https://pateway.ai',
    apiKeyUrl: 'https://pateway.ai/?ch=etzpm8&aff=WB6M6F67#/',
    category: 'third_party',
    icon: 'pateway',
    iconColor: '',
    badge: 'partner'
  },
  pipellm: {
    name: 'PIPELLM',
    websiteUrl: 'https://code.pipellm.ai',
    apiKeyUrl: 'https://code.pipellm.ai/login?ref=uvw650za',
    category: 'aggregator',
    icon: 'pipellm',
    iconColor: '',
    badge: ''
  },
  qiniu: {
    name: 'Qiniu',
    websiteUrl: 'https://s.qiniu.com/nMvAvy',
    apiKeyUrl: 'https://s.qiniu.com/nMvAvy',
    category: 'aggregator',
    icon: 'qiniu',
    iconColor: '',
    badge: 'partner'
  },
  qwen_coder: {
    name: 'Qwen Coder',
    websiteUrl: 'https://bailian.console.aliyun.com',
    apiKeyUrl: 'https://bailian.console.aliyun.com/#/api-key',
    category: 'cn_official',
    icon: 'qwen',
    iconColor: '#FF6A00',
    badge: ''
  },
  relaxycode: {
    name: 'RelaxyCode',
    websiteUrl: 'https://www.relaxycode.com',
    apiKeyUrl: 'https://www.relaxycode.com/register',
    category: 'third_party',
    icon: 'relaxcode',
    iconColor: '',
    badge: ''
  },
  rightcode: {
    name: 'RightCode',
    websiteUrl: 'https://www.right.codes',
    apiKeyUrl: 'https://www.right.codes/register?aff=ZTOOLSCCTOGGLE',
    category: 'third_party',
    icon: 'rc',
    iconColor: '#E96B2C',
    badge: 'partner'
  },
  runapi: {
    name: 'RunAPI',
    websiteUrl: 'https://runapi.co',
    apiKeyUrl: 'https://runapi.co/register?aff=iOKB',
    category: 'aggregator',
    icon: 'runapi',
    iconColor: '',
    badge: 'partner'
  },
  shengsuanyun: {
    name: 'Shengsuanyun',
    websiteUrl: 'https://www.shengsuanyun.com/?from=CH_4HHXMRYF',
    apiKeyUrl: 'https://www.shengsuanyun.com/?from=CH_4HHXMRYF',
    category: 'aggregator',
    icon: 'shengsuanyun',
    iconColor: '',
    badge: 'partner'
  },
  siliconflow: {
    name: 'SiliconFlow',
    websiteUrl: 'https://siliconflow.cn',
    apiKeyUrl: 'https://cloud.siliconflow.cn/i/YflgU2Ve',
    category: 'aggregator',
    icon: 'siliconflow',
    iconColor: '#6E29F6',
    badge: 'partner'
  },
  siliconflow_en: {
    name: 'SiliconFlow en',
    websiteUrl: 'https://siliconflow.com',
    apiKeyUrl: 'https://cloud.siliconflow.cn/i/YflgU2Ve',
    category: 'aggregator',
    icon: 'siliconflow',
    iconColor: '#000000',
    badge: 'partner'
  },
  sssaicode: {
    name: 'SSSAiCode',
    websiteUrl: 'https://sssaicodeapi.com',
    apiKeyUrl: 'https://sssaicodeapi.com/register?ref=DCP0SM',
    category: 'third_party',
    icon: 'sssaicode',
    iconColor: '#000000',
    badge: 'partner'
  },
  stepfun: {
    name: 'StepFun',
    websiteUrl: 'https://platform.stepfun.com/step-plan',
    apiKeyUrl: 'https://platform.stepfun.com/interface-key',
    category: 'cn_official',
    icon: 'stepfun',
    iconColor: '#16D6D2',
    badge: ''
  },
  stepfun_en: {
    name: 'StepFun en',
    websiteUrl: 'https://platform.stepfun.ai/step-plan',
    apiKeyUrl: 'https://platform.stepfun.ai/interface-key',
    category: 'cn_official',
    icon: 'stepfun',
    iconColor: '#16D6D2',
    badge: ''
  },
  subrouter: {
    name: 'SubRouter',
    websiteUrl: 'https://subrouter.ai',
    apiKeyUrl: 'https://subrouter.ai/register?aff=l3ri',
    category: 'aggregator',
    icon: 'subrouter',
    iconColor: '',
    badge: 'partner'
  },
  sudocode_chat: {
    name: 'SudoCode.chat',
    websiteUrl: 'https://sudocode.chat',
    apiKeyUrl: 'https://sudocode.chat/register?utm_source=ztoolscctoggle&utm_medium=partner',
    category: 'third_party',
    icon: 'sudocode',
    iconColor: '',
    badge: 'partner'
  },
  sudocode_us: {
    name: 'SudoCode.us',
    websiteUrl: 'https://sudocode.us',
    apiKeyUrl: 'https://sudocode.us',
    category: 'third_party',
    icon: 'sudocode-us',
    iconColor: '',
    badge: 'partner'
  },
  teamorouter: {
    name: 'TeamoRouter',
    websiteUrl: 'https://teamorouter.com',
    apiKeyUrl:
      'https://teamorouter.com/?utm_source=ztools_cctoggle&utm_medium=referral&utm_campaign=ai_directory',
    category: 'aggregator',
    icon: 'teamorouter',
    iconColor: '',
    badge: 'partner'
  },
  therouter: {
    name: 'TheRouter',
    websiteUrl: 'https://therouter.ai',
    apiKeyUrl: 'https://dashboard.therouter.ai',
    category: 'aggregator',
    icon: '',
    iconColor: '',
    badge: ''
  },
  unity2_ai: {
    name: 'Unity2.ai',
    websiteUrl: 'https://unity2.ai',
    apiKeyUrl: 'https://unity2.ai/register?source=ztoolscctoggle',
    category: 'aggregator',
    icon: 'unity2',
    iconColor: '',
    badge: 'partner'
  },
  xai_grok: {
    name: 'xAI (Grok)',
    websiteUrl: 'https://x.ai/api',
    apiKeyUrl: 'https://console.x.ai',
    category: 'third_party',
    icon: 'xai',
    iconColor: '#000000',
    badge: ''
  },
  xai_grok_oauth: {
    name: 'xAI (Grok) OAuth',
    websiteUrl: 'https://x.ai/grok',
    apiKeyUrl: '',
    category: 'third_party',
    icon: 'xai',
    iconColor: '#000000',
    badge: ''
  },
  xiaomi_mimo: {
    name: 'Xiaomi MiMo',
    websiteUrl: 'https://platform.xiaomimimo.com',
    apiKeyUrl: 'https://platform.xiaomimimo.com/#/console/api-keys',
    category: 'cn_official',
    icon: 'xiaomimimo',
    iconColor: '#000000',
    badge: ''
  },
  xiaomi_mimo_token_plan_china: {
    name: 'Xiaomi MiMo Token Plan (China)',
    websiteUrl: 'https://platform.xiaomimimo.com/#/token-plan',
    apiKeyUrl: 'https://platform.xiaomimimo.com/#/console/plan-manage',
    category: 'cn_official',
    icon: 'xiaomimimo',
    iconColor: '#000000',
    badge: ''
  },
  zetaapi: {
    name: 'ZetaAPI',
    websiteUrl: 'https://zetaapi.ai',
    apiKeyUrl: 'https://zetaapi.ai/go/u117',
    category: 'aggregator',
    icon: 'zetaapi',
    iconColor: '',
    badge: 'partner'
  },
  zhipu_glm: {
    name: 'Zhipu GLM',
    websiteUrl: 'https://open.bigmodel.cn',
    apiKeyUrl: 'https://www.bigmodel.cn/claude-code?ic=RRVJPB5SII',
    category: 'cn_official',
    icon: 'zhipu',
    iconColor: '#0F62FE',
    badge: ''
  },
  zhipu_glm_en: {
    name: 'Zhipu GLM en',
    websiteUrl: 'https://z.ai',
    apiKeyUrl: 'https://z.ai/subscribe?ic=8JVLJQFSKB',
    category: 'cn_official',
    icon: 'zhipu',
    iconColor: '#0F62FE',
    badge: ''
  },
  火山agentplan: {
    name: '火山Agentplan',
    websiteUrl:
      'https://www.volcengine.com/activity/codingplan?ac=MMAP8JTTCAQ2&rc=6J6FV5N2&utm_campaign=hw&utm_content=ztoolscctoggle&utm_medium=devrel_tool_web&utm_source=OWO&utm_term=ztoolscctoggle',
    apiKeyUrl:
      'https://www.volcengine.com/activity/codingplan?ac=MMAP8JTTCAQ2&rc=6J6FV5N2&utm_campaign=hw&utm_content=ztoolscctoggle&utm_medium=devrel_tool_web&utm_source=OWO&utm_term=ztoolscctoggle',
    category: 'cn_official',
    icon: 'huoshan',
    iconColor: '#3370FF',
    badge: 'partner'
  },
  自定义: {
    name: '自定义',
    websiteUrl: '',
    apiKeyUrl: '',
    category: 'custom',
    icon: '',
    iconColor: '',
    badge: ''
  }
};
