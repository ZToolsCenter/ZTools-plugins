// Codex presets - only diff from defaults; merged with providers.js at runtime
export default [
  { provider: 'openai_official', authData: {}, config: '' },
  {
    provider: 'kimi',
    baseUrl: 'https://api.moonshot.cn/v1',
    model: 'kimi-k2.7-code',
    apiFormat: 'openai_chat',
    models: ['kimi-k2.7-code', 'kimi-k3'],
    modelCatalog: [
      { model: 'kimi-k2.7-code', displayName: 'Kimi K2.7 Code', contextWindow: 262144 },
      { model: 'kimi-k3', displayName: 'Kimi K3', contextWindow: 1048576 }
    ],
    endpointCandidates: ['https://api.moonshot.cn/v1']
  },
  {
    provider: 'kimi_for_coding',
    baseUrl: 'https://api.kimi.com/coding/v1',
    model: 'kimi-for-coding',
    apiFormat: 'openai_chat',
    models: ['kimi-for-coding'],
    modelCatalog: [
      { model: 'kimi-for-coding', displayName: 'Kimi For Coding', contextWindow: 262144 }
    ],
    endpointCandidates: ['https://api.kimi.com/coding/v1'],
    configName: 'kimi_coding'
  },
  {
    provider: 'packycode',
    baseUrl: 'https://www.packyapi.com/v1',
    model: 'gpt-5.5',
    endpointCandidates: ['https://www.packyapi.com/v1', 'https://api-slb.packyapi.com/v1']
  },
  {
    provider: 'zetaapi',
    baseUrl: 'https://api.zetaapi.ai/v1',
    model: 'gpt-5.5',
    endpointCandidates: ['https://api.zetaapi.ai/v1']
  },
  {
    provider: 'apinebula',
    baseUrl: 'https://apinebula.com/v1',
    model: 'gpt-5.5',
    apiFormat: 'openai_responses',
    endpointCandidates: ['https://apinebula.com/v1'],
    configName: 'APINebula',
    reviewModel: 'gpt-5.5'
  },
  {
    provider: 'aicodemirror',
    category: 'custom',
    baseUrl: 'https://api.aicodemirror.com/api/codex/backend-api/codex',
    model: 'gpt-5.5',
    endpointCandidates: [
      'https://api.aicodemirror.com/api/codex/backend-api/codex',
      'https://api.claudecode.net.cn/api/codex/backend-api/codex'
    ]
  },
  {
    provider: 'patewayai',
    baseUrl: 'https://api.pateway.ai/v1',
    model: 'gpt-5.5',
    endpointCandidates: ['https://api.pateway.ai/v1']
  },
  {
    provider: 'fennoai',
    baseUrl: 'https://api.fenno.ai',
    model: 'gpt-5.5',
    endpointCandidates: ['https://api.fenno.ai'],
    configName: 'fenno'
  },
  { provider: 'runapi', baseUrl: 'https://runapi.co/v1', model: 'gpt-5.5' },
  {
    provider: 'unity2_ai',
    baseUrl: 'https://api.unity2.ai',
    model: 'gpt-5.5',
    endpointCandidates: ['https://api.unity2.ai'],
    configName: 'unity2'
  },
  {
    provider: 'shengsuanyun',
    baseUrl: 'https://router.shengsuanyun.com/api/v1',
    model: 'openai/gpt-5.5'
  },
  {
    provider: 'aigocode',
    baseUrl: 'https://api.aigocode.com',
    model: 'gpt-5.5',
    endpointCandidates: ['https://api.aigocode.com']
  },
  {
    provider: 'subrouter',
    baseUrl: 'https://subrouter.ai/v1',
    model: 'gpt-5.5',
    endpointCandidates: ['https://subrouter.ai/v1']
  },
  {
    provider: 'apikey_fun',
    baseUrl: 'https://api.apikey.fun/v1',
    model: 'gpt-5.5',
    apiFormat: 'openai_responses',
    endpointCandidates: ['https://api.apikey.fun/v1', 'https://slb.apikey.fun/v1'],
    configName: 'APIKEY.FUN',
    reviewModel: 'gpt-5.5'
  },
  {
    provider: 'code0',
    baseUrl: 'https://code0.ai/v1',
    model: 'gpt-5.5',
    endpointCandidates: ['https://code0.ai/v1']
  },
  {
    provider: 'teamorouter',
    baseUrl: 'https://api.teamorouter.com/v1',
    model: 'gpt-5.5',
    endpointCandidates: ['https://api.teamorouter.com/v1']
  },
  { provider: 'claudecn', baseUrl: 'https://claudecn.top/v1', model: 'gpt-5.5' },
  {
    provider: '火山agentplan',
    baseUrl: 'https://ark.cn-beijing.volces.com/api/plan/v3',
    model: 'ark-code-latest',
    apiFormat: 'openai_responses',
    models: ['ark-code-latest'],
    modelCatalog: [
      { model: 'ark-code-latest', displayName: 'Ark Code Latest', contextWindow: 256000 }
    ],
    endpointCandidates: ['https://ark.cn-beijing.volces.com/api/plan/v3'],
    configName: 'ark_agentplan'
  },
  {
    provider: 'byteplus',
    baseUrl: 'https://ark.ap-southeast.bytepluses.com/api/coding/v3',
    model: 'ark-code-latest',
    apiFormat: 'openai_chat',
    models: ['ark-code-latest'],
    modelCatalog: [
      { model: 'ark-code-latest', displayName: 'Ark Code Latest', contextWindow: 256000 }
    ],
    endpointCandidates: ['https://ark.ap-southeast.bytepluses.com/api/coding/v3']
  },
  {
    provider: 'doubaoseed',
    baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
    model: 'doubao-seed-2-1-pro-260628',
    apiFormat: 'openai_responses',
    models: ['doubao-seed-2-1-pro-260628'],
    modelCatalog: [
      {
        model: 'doubao-seed-2-1-pro-260628',
        displayName: 'Doubao Seed 2.1 Pro',
        contextWindow: 262144
      }
    ],
    endpointCandidates: ['https://ark.cn-beijing.volces.com/api/v3']
  },
  {
    provider: 'siliconflow',
    baseUrl: 'https://api.siliconflow.cn/v1',
    model: 'Pro/MiniMaxAI/MiniMax-M2.7',
    apiFormat: 'openai_chat',
    models: ['Pro/MiniMaxAI/MiniMax-M2.7'],
    modelCatalog: [
      {
        model: 'Pro/MiniMaxAI/MiniMax-M2.7',
        displayName: 'Pro / MiniMax M2.7',
        contextWindow: 200000
      }
    ],
    endpointCandidates: ['https://api.siliconflow.cn/v1']
  },
  {
    provider: 'siliconflow_en',
    baseUrl: 'https://api.siliconflow.com/v1',
    model: 'MiniMaxAI/MiniMax-M2.7',
    apiFormat: 'openai_chat',
    models: ['MiniMaxAI/MiniMax-M2.7'],
    modelCatalog: [
      { model: 'MiniMaxAI/MiniMax-M2.7', displayName: 'MiniMax M2.7', contextWindow: 200000 }
    ],
    endpointCandidates: ['https://api.siliconflow.com/v1']
  },
  {
    provider: 'nekocode',
    baseUrl: 'https://nekocode.ai/v1',
    model: 'gpt-5.5',
    endpointCandidates: ['https://nekocode.ai/v1']
  },
  {
    provider: 'atlascloud',
    baseUrl: 'https://api.atlascloud.ai/v1',
    model: 'zai-org/glm-5.1',
    apiFormat: 'openai_chat',
    models: ['zai-org/glm-5.1'],
    modelCatalog: [{ model: 'zai-org/glm-5.1', displayName: 'GLM 5.1', contextWindow: 200000 }],
    endpointCandidates: ['https://api.atlascloud.ai/v1'],
    configName: 'AtlasCloud',
    noReasoningEffort: true
  },
  {
    provider: 'compshare',
    baseUrl: 'https://api.modelverse.cn/v1',
    model: 'gpt-5.5',
    endpointCandidates: ['https://api.modelverse.cn/v1']
  },
  {
    provider: 'compshare_coding_plan',
    baseUrl: 'https://cp.compshare.cn/v1',
    model: 'gpt-5.5',
    endpointCandidates: ['https://cp.compshare.cn/v1'],
    configName: 'compshare_coding'
  },
  {
    provider: 'ccsub',
    baseUrl: 'https://www.ccsub.net/v1',
    model: 'gpt-5.5',
    endpointCandidates: ['https://www.ccsub.net/v1']
  },
  {
    provider: 'sssaicode',
    baseUrl: 'https://node-hk.sssaicodeapi.com/api/v1',
    model: 'gpt-5.5',
    endpointCandidates: [
      'https://node-hk.sssaicodeapi.com/api/v1',
      'https://node-hk.sssaiapi.com/api/v1',
      'https://node-cf.sssaicodeapi.com/api/v1'
    ]
  },
  {
    provider: 'micu',
    baseUrl: 'https://www.micuapi.ai/v1',
    model: 'gpt-5.5',
    endpointCandidates: ['https://www.micuapi.ai/v1']
  },
  { provider: 'rightcode', baseUrl: 'https://right.codes/codex/v1', model: 'gpt-5.5' },
  {
    provider: 'etok_ai',
    baseUrl: 'https://api.etok.ai/v1',
    model: 'gpt-5.5',
    endpointCandidates: ['https://api.etok.ai/v1'],
    configName: 'etok'
  },
  {
    provider: 'cubence',
    baseUrl: 'https://api.cubence.com/v1',
    model: 'gpt-5.5',
    endpointCandidates: [
      'https://api.cubence.com/v1',
      'https://api-cf.cubence.com/v1',
      'https://api-dmit.cubence.com/v1',
      'https://api-bwg.cubence.com/v1'
    ]
  },
  {
    provider: 'crazyrouter',
    category: 'custom',
    baseUrl: 'https://cn.crazyrouter.com/v1',
    model: 'gpt-5.5',
    endpointCandidates: ['https://cn.crazyrouter.com/v1']
  },
  {
    provider: 'dmxapi',
    apiKeyUrl: '',
    baseUrl: 'https://www.dmxapi.cn/v1',
    model: 'gpt-5.5',
    endpointCandidates: ['https://www.dmxapi.cn/v1']
  },
  {
    provider: 'qiniu',
    baseUrl: 'https://api.qnaigc.com/bypass/openai/v1',
    model: 'gpt-5.5',
    endpointCandidates: [
      'https://api.qnaigc.com/bypass/openai/v1',
      'https://api.modelink.ai/bypass/openai/v1'
    ]
  },
  {
    provider: 'sudocode_chat',
    baseUrl: 'https://api.sudocode.chat/v1',
    model: 'gpt-5.6-sol',
    apiFormat: 'openai_responses',
    endpointCandidates: ['https://api.sudocode.chat/v1'],
    configName: 'SudoCode',
    reviewModel: 'gpt-5.6-sol'
  },
  {
    provider: 'sudocode_us',
    baseUrl: 'https://sudocode.us/v1',
    model: 'gpt-5.5',
    apiFormat: 'openai_responses',
    endpointCandidates: ['https://sudocode.us/v1', 'https://sudocode.run/v1'],
    configName: 'sudocode',
    reviewModel: 'gpt-5.5',
    modelVerbosity: 'high'
  },
  {
    provider: 'amux',
    baseUrl: 'https://api.amux.ai/v1',
    model: 'gpt-5.5',
    endpointCandidates: ['https://api.amux.ai/v1']
  },
  {
    provider: 'azure_openai',
    baseUrl: 'https://YOUR_RESOURCE_NAME.openai.azure.com/openai',
    model: 'gpt-5.5',
    endpointCandidates: ['https://YOUR_RESOURCE_NAME.openai.azure.com/openai'],
    config:
      'model_provider = "custom"\nmodel = "gpt-5.5"\nmodel_reasoning_effort = "high"\ndisable_response_storage = true\n\n[model_providers.custom]\nname = "Azure OpenAI"\nbase_url = "https://YOUR_RESOURCE_NAME.openai.azure.com/openai"\nenv_key = "OPENAI_API_KEY"\nquery_params = { "api-version" = "2025-04-01-preview" }\nwire_api = "responses"\nrequires_openai_auth = true'
  },
  {
    provider: 'deepseek',
    baseUrl: 'https://api.deepseek.com',
    model: 'deepseek-v4-flash',
    apiFormat: 'openai_chat',
    models: ['deepseek-v4-flash', 'deepseek-v4-pro'],
    modelCatalog: [
      { model: 'deepseek-v4-flash', displayName: 'DeepSeek V4 Flash', contextWindow: 1000000 },
      { model: 'deepseek-v4-pro', displayName: 'DeepSeek V4 Pro', contextWindow: 1000000 }
    ],
    endpointCandidates: ['https://api.deepseek.com']
  },
  {
    provider: 'zhipu_glm',
    baseUrl: 'https://open.bigmodel.cn/api/coding/paas/v4',
    model: 'glm-5.2',
    apiFormat: 'openai_chat',
    models: ['glm-5.2'],
    modelCatalog: [{ model: 'glm-5.2', displayName: 'GLM-5.2', contextWindow: 200000 }],
    endpointCandidates: ['https://open.bigmodel.cn/api/coding/paas/v4']
  },
  {
    provider: 'zhipu_glm_en',
    baseUrl: 'https://api.z.ai/api/coding/paas/v4',
    model: 'glm-5.2',
    apiFormat: 'openai_chat',
    models: ['glm-5.2'],
    modelCatalog: [{ model: 'glm-5.2', displayName: 'GLM-5.2', contextWindow: 200000 }],
    endpointCandidates: ['https://api.z.ai/api/coding/paas/v4']
  },
  {
    provider: 'baidu_qianfan_coding_plan',
    baseUrl: 'https://qianfan.baidubce.com/v2/coding',
    model: 'qianfan-code-latest',
    apiFormat: 'openai_chat',
    models: ['qianfan-code-latest'],
    modelCatalog: [
      { model: 'qianfan-code-latest', displayName: 'Qianfan Code Latest', contextWindow: 131072 }
    ],
    endpointCandidates: ['https://qianfan.baidubce.com/v2/coding'],
    configName: 'qianfan_coding'
  },
  {
    provider: 'bailian',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    model: 'qwen3-coder-plus',
    apiFormat: 'openai_responses',
    models: ['qwen3-coder-plus'],
    modelCatalog: [
      { model: 'qwen3-coder-plus', displayName: 'Qwen3 Coder Plus', contextWindow: 1048576 }
    ],
    endpointCandidates: ['https://dashscope.aliyuncs.com/compatible-mode/v1']
  },
  {
    provider: 'bailian_token_plan',
    baseUrl: 'https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1',
    model: 'qwen3.8-max',
    apiFormat: 'openai_responses',
    models: ['qwen3.8-max'],
    modelCatalog: [{ model: 'qwen3.8-max', displayName: 'Qwen3.8 Max' }],
    endpointCandidates: ['https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1']
  },
  {
    provider: 'stepfun',
    baseUrl: 'https://api.stepfun.com/step_plan/v1',
    model: 'step-3.7-flash',
    apiFormat: 'openai_chat',
    models: ['step-3.7-flash', 'step-3.5-flash-2603', 'step-3.5-flash'],
    modelCatalog: [
      { model: 'step-3.7-flash', displayName: 'Step 3.7 Flash', contextWindow: 262144 },
      { model: 'step-3.5-flash-2603', displayName: 'Step 3.5 Flash 2603', contextWindow: 262144 },
      { model: 'step-3.5-flash', displayName: 'Step 3.5 Flash', contextWindow: 262144 }
    ],
    endpointCandidates: ['https://api.stepfun.com/step_plan/v1']
  },
  {
    provider: 'stepfun_en',
    baseUrl: 'https://api.stepfun.ai/step_plan/v1',
    model: 'step-3.7-flash',
    apiFormat: 'openai_chat',
    models: ['step-3.7-flash', 'step-3.5-flash-2603', 'step-3.5-flash'],
    modelCatalog: [
      { model: 'step-3.7-flash', displayName: 'Step 3.7 Flash', contextWindow: 262144 },
      { model: 'step-3.5-flash-2603', displayName: 'Step 3.5 Flash 2603', contextWindow: 262144 },
      { model: 'step-3.5-flash', displayName: 'Step 3.5 Flash', contextWindow: 262144 }
    ],
    endpointCandidates: ['https://api.stepfun.ai/step_plan/v1']
  },
  {
    provider: 'modelscope',
    baseUrl: 'https://api-inference.modelscope.cn/v1',
    model: 'ZhipuAI/GLM-5.1',
    apiFormat: 'openai_chat',
    models: ['ZhipuAI/GLM-5.1'],
    modelCatalog: [
      { model: 'ZhipuAI/GLM-5.1', displayName: 'ZhipuAI / GLM-5.1', contextWindow: 200000 }
    ],
    endpointCandidates: ['https://api-inference.modelscope.cn/v1']
  },
  {
    provider: 'longcat',
    baseUrl: 'https://api.longcat.chat/openai/v1',
    model: 'LongCat-2.0',
    apiFormat: 'openai_responses',
    models: ['LongCat-2.0'],
    modelCatalog: [{ model: 'LongCat-2.0', displayName: 'LongCat 2.0', contextWindow: 1048576 }],
    endpointCandidates: ['https://api.longcat.chat/openai/v1']
  },
  {
    provider: 'minimax',
    baseUrl: 'https://api.minimaxi.com/v1',
    model: 'MiniMax-M3',
    apiFormat: 'openai_responses',
    models: ['MiniMax-M3'],
    modelCatalog: [
      {
        model: 'MiniMax-M3',
        displayName: 'MiniMax-M3',
        contextWindow: 1000000,
        supportsParallelToolCalls: true,
        inputModalities: ['text', 'image'],
        baseInstructions:
          "You are Codex, a coding agent based on MiniMax-M3. You and the user share the same workspace and collaborate to achieve the user's goals."
      }
    ],
    endpointCandidates: ['https://api.minimaxi.com/v1']
  },
  {
    provider: 'minimax_en',
    baseUrl: 'https://api.minimax.io/v1',
    model: 'MiniMax-M3',
    apiFormat: 'openai_responses',
    models: ['MiniMax-M3'],
    modelCatalog: [
      {
        model: 'MiniMax-M3',
        displayName: 'MiniMax-M3',
        contextWindow: 1000000,
        supportsParallelToolCalls: true,
        inputModalities: ['text', 'image'],
        baseInstructions:
          "You are Codex, a coding agent based on MiniMax-M3. You and the user share the same workspace and collaborate to achieve the user's goals."
      }
    ],
    endpointCandidates: ['https://api.minimax.io/v1']
  },
  {
    provider: 'bailing',
    apiKeyUrl: 'https://ling.tbox.cn/open',
    baseUrl: 'https://api.tbox.cn/api/llm/v1',
    model: 'Ling-2.6-1T',
    apiFormat: 'openai_chat',
    models: ['Ling-2.6-1T'],
    modelCatalog: [{ model: 'Ling-2.6-1T', displayName: 'Ling-2.6-1T', contextWindow: 262144 }],
    endpointCandidates: ['https://api.tbox.cn/api/llm/v1']
  },
  {
    provider: 'xiaomi_mimo',
    baseUrl: 'https://api.xiaomimimo.com/v1',
    model: 'mimo-v2.5-pro',
    apiFormat: 'openai_chat',
    models: ['mimo-v2.5-pro', 'mimo-v2.5'],
    modelCatalog: [
      {
        model: 'mimo-v2.5-pro',
        displayName: 'MiMo V2.5 Pro',
        contextWindow: 1048576,
        inputModalities: ['text'],
        baseInstructions:
          "You are MiMo, an AI assistant developed by Xiaomi. Today's date: {date} {week}. Your knowledge cutoff date is December 2024."
      },
      {
        model: 'mimo-v2.5',
        displayName: 'MiMo V2.5',
        contextWindow: 1048576,
        inputModalities: ['text', 'image'],
        baseInstructions:
          "You are MiMo, an AI assistant developed by Xiaomi. Today's date: {date} {week}. Your knowledge cutoff date is December 2024."
      }
    ],
    endpointCandidates: ['https://api.xiaomimimo.com/v1']
  },
  {
    provider: 'xiaomi_mimo_token_plan_china',
    baseUrl: 'https://token-plan-cn.xiaomimimo.com/v1',
    model: 'mimo-v2.5-pro',
    apiFormat: 'openai_chat',
    models: ['mimo-v2.5-pro', 'mimo-v2.5'],
    modelCatalog: [
      {
        model: 'mimo-v2.5-pro',
        displayName: 'MiMo V2.5 Pro',
        contextWindow: 1048576,
        inputModalities: ['text'],
        baseInstructions:
          "You are MiMo, an AI assistant developed by Xiaomi. Today's date: {date} {week}. Your knowledge cutoff date is December 2024."
      },
      {
        model: 'mimo-v2.5',
        displayName: 'MiMo V2.5',
        contextWindow: 1048576,
        inputModalities: ['text', 'image'],
        baseInstructions:
          "You are MiMo, an AI assistant developed by Xiaomi. Today's date: {date} {week}. Your knowledge cutoff date is December 2024."
      }
    ],
    endpointCandidates: ['https://token-plan-cn.xiaomimimo.com/v1'],
    configName: 'xiaomi_mimo_token_plan'
  },
  {
    provider: 'novita_ai',
    baseUrl: 'https://api.novita.ai/openai/v1',
    model: 'zai-org/glm-5.1',
    apiFormat: 'openai_chat',
    models: ['zai-org/glm-5.1'],
    modelCatalog: [{ model: 'zai-org/glm-5.1', displayName: 'GLM-5.1', contextWindow: 202800 }],
    endpointCandidates: ['https://api.novita.ai/openai/v1'],
    configName: 'novita'
  },
  {
    provider: 'xai_grok',
    baseUrl: 'https://api.x.ai/v1',
    model: 'grok-4.5',
    apiFormat: 'openai_responses',
    models: ['grok-4.5'],
    modelCatalog: [
      {
        model: 'grok-4.5',
        displayName: 'Grok 4.5',
        contextWindow: 500000,
        supportsParallelToolCalls: true,
        inputModalities: ['text', 'image']
      }
    ],
    endpointCandidates: ['https://api.x.ai/v1'],
    configName: 'xai'
  },
  {
    provider: 'xai_grok_oauth',
    baseUrl: 'https://api.x.ai/v1',
    model: 'grok-4.5',
    apiFormat: 'openai_responses',
    models: ['grok-4.5'],
    modelCatalog: [
      {
        model: 'grok-4.5',
        displayName: 'Grok 4.5',
        contextWindow: 500000,
        supportsParallelToolCalls: true,
        inputModalities: ['text', 'image']
      }
    ],
    configName: 'xai'
  },
  {
    provider: 'nvidia',
    baseUrl: 'https://integrate.api.nvidia.com/v1',
    model: 'moonshotai/kimi-k2.5',
    apiFormat: 'openai_chat',
    models: ['moonshotai/kimi-k2.5'],
    modelCatalog: [
      { model: 'moonshotai/kimi-k2.5', displayName: 'Kimi K2.5', contextWindow: 262144 }
    ],
    endpointCandidates: ['https://integrate.api.nvidia.com/v1']
  },
  {
    provider: 'opencode_go',
    baseUrl: 'https://opencode.ai/zen/go/v1',
    model: 'glm-5.2',
    apiFormat: 'openai_chat',
    models: [
      'glm-5.2',
      'glm-5.1',
      'kimi-k2.7-code',
      'deepseek-v4-pro',
      'deepseek-v4-flash',
      'mimo-v2.5-pro'
    ],
    modelCatalog: [
      { model: 'glm-5.2', displayName: 'GLM 5.2', contextWindow: 204800 },
      { model: 'glm-5.1', displayName: 'GLM 5.1', contextWindow: 204800 },
      { model: 'kimi-k2.7-code', displayName: 'Kimi K2.7 Code', contextWindow: 262144 },
      { model: 'deepseek-v4-pro', displayName: 'DeepSeek V4 Pro' },
      { model: 'deepseek-v4-flash', displayName: 'DeepSeek V4 Flash' },
      { model: 'mimo-v2.5-pro', displayName: 'MiMo V2.5 Pro', contextWindow: 1048576 }
    ],
    endpointCandidates: ['https://opencode.ai/zen/go/v1']
  },
  {
    provider: 'aihubmix',
    apiKeyUrl: '',
    baseUrl: 'https://aihubmix.com/v1',
    model: 'gpt-5.5',
    endpointCandidates: ['https://aihubmix.com/v1', 'https://api.aihubmix.com/v1']
  },
  {
    provider: 'cherryin',
    baseUrl: 'https://open.cherryin.net/v1',
    model: 'openai/gpt-5.5',
    endpointCandidates: ['https://open.cherryin.net/v1']
  },
  { provider: 'relaxycode', baseUrl: 'https://www.relaxycode.com/v1', model: 'gpt-5.5' },
  {
    provider: 'e_flowcode',
    baseUrl: 'https://e-flowcode.cc/v1',
    model: 'gpt-5.5',
    endpointCandidates: ['https://e-flowcode.cc/v1'],
    config:
      'model_provider = "custom"\nmodel = "gpt-5.5"\nmodel_reasoning_effort = "high"\ndisable_response_storage = true\npersonality = "pragmatic"\n\n[model_providers.custom]\nname = "E-FlowCode"\nbase_url = "https://e-flowcode.cc/v1"\nwire_api = "responses"\nrequires_openai_auth = true\nmodel_context_window = 1000000\nmodel_auto_compact_token_limit = 9000000'
  },
  {
    provider: 'pipellm',
    baseUrl: 'https://cc-api.pipellm.ai/v1',
    model: 'gpt-5.5',
    reasoningEffort: 'medium',
    endpointCandidates: ['https://cc-api.pipellm.ai/v1'],
    config:
      'model_provider = "custom"\nmodel = "gpt-5.5"\nmodel_reasoning_effort = "medium"\ndisable_response_storage = true\n\n[model_providers.custom]\nname = "PIPELLM"\nwire_api = "responses"\nrequires_openai_auth = true\nbase_url = "https://cc-api.pipellm.ai/v1"'
  },
  { provider: 'openrouter', baseUrl: 'https://openrouter.ai/api/v1', model: 'gpt-5.5' },
  {
    provider: 'therouter',
    baseUrl: 'https://api.therouter.ai/v1',
    model: 'openai/gpt-5.3-codex',
    endpointCandidates: ['https://api.therouter.ai/v1']
  }
];
