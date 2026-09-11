// Claude presets - only diff from defaults; merged with providers.js at runtime
export default [
  { provider: 'claude_official' },
  {
    provider: 'kimi',
    apiKeyUrl: '',
    baseUrl: 'https://api.moonshot.cn/anthropic',
    model: 'kimi-k2.7-code',
    settingsConfig: {
      env: {
        ANTHROPIC_BASE_URL: 'https://api.moonshot.cn/anthropic',
        ANTHROPIC_AUTH_TOKEN: '',
        ANTHROPIC_MODEL: 'kimi-k2.7-code',
        ANTHROPIC_DEFAULT_HAIKU_MODEL: 'kimi-k2.7-code',
        ANTHROPIC_DEFAULT_SONNET_MODEL: 'kimi-k2.7-code',
        ANTHROPIC_DEFAULT_OPUS_MODEL: 'kimi-k2.7-code'
      }
    }
  },
  {
    provider: 'kimi_for_coding',
    apiKeyUrl: '',
    baseUrl: 'https://api.kimi.com/coding/',
    model: 'kimi-for-coding',
    settingsConfig: {
      env: {
        ANTHROPIC_BASE_URL: 'https://api.kimi.com/coding/',
        ANTHROPIC_AUTH_TOKEN: '',
        ANTHROPIC_MODEL: 'kimi-for-coding',
        ANTHROPIC_DEFAULT_HAIKU_MODEL: 'kimi-for-coding',
        ANTHROPIC_DEFAULT_SONNET_MODEL: 'kimi-for-coding',
        ANTHROPIC_DEFAULT_OPUS_MODEL: 'kimi-for-coding',
        CLAUDE_CODE_MAX_CONTEXT_TOKENS: '262144',
        CLAUDE_CODE_AUTO_COMPACT_WINDOW: '262144'
      }
    }
  },
  {
    provider: 'packycode',
    baseUrl: 'https://www.packyapi.com',
    endpointCandidates: ['https://www.packyapi.com', 'https://api-slb.packyapi.com'],
    settingsConfig: {
      env: { ANTHROPIC_BASE_URL: 'https://www.packyapi.com', ANTHROPIC_AUTH_TOKEN: '' }
    }
  },
  {
    provider: 'zetaapi',
    baseUrl: 'https://api.zetaapi.ai',
    settingsConfig: {
      env: { ANTHROPIC_BASE_URL: 'https://api.zetaapi.ai', ANTHROPIC_AUTH_TOKEN: '' }
    }
  },
  {
    provider: 'apinebula',
    baseUrl: 'https://apinebula.com',
    endpointCandidates: ['https://apinebula.com'],
    settingsConfig: {
      env: {
        ANTHROPIC_BASE_URL: 'https://apinebula.com',
        ANTHROPIC_AUTH_TOKEN: '',
        CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1'
      }
    }
  },
  {
    provider: 'aicodemirror',
    baseUrl: 'https://api.aicodemirror.com/api/claudecode',
    endpointCandidates: [
      'https://api.aicodemirror.com/api/claudecode',
      'https://api.claudecode.net.cn/api/claudecode'
    ],
    settingsConfig: {
      env: {
        ANTHROPIC_BASE_URL: 'https://api.aicodemirror.com/api/claudecode',
        ANTHROPIC_AUTH_TOKEN: ''
      }
    }
  },
  {
    provider: 'patewayai',
    baseUrl: 'https://api.pateway.ai',
    settingsConfig: { env: { ANTHROPIC_BASE_URL: 'https://api.pateway.ai', ANTHROPIC_API_KEY: '' } }
  },
  {
    provider: 'fennoai',
    baseUrl: 'https://api.fenno.ai',
    settingsConfig: {
      env: { ANTHROPIC_BASE_URL: 'https://api.fenno.ai', ANTHROPIC_AUTH_TOKEN: '' }
    }
  },
  {
    provider: 'runapi',
    baseUrl: 'https://runapi.co',
    settingsConfig: { env: { ANTHROPIC_BASE_URL: 'https://runapi.co', ANTHROPIC_AUTH_TOKEN: '' } }
  },
  {
    provider: 'unity2_ai',
    baseUrl: 'https://api.unity2.ai',
    settingsConfig: {
      env: { ANTHROPIC_BASE_URL: 'https://api.unity2.ai', ANTHROPIC_AUTH_TOKEN: '' }
    }
  },
  {
    provider: 'shengsuanyun',
    baseUrl: 'https://router.shengsuanyun.com/api',
    model: 'anthropic/claude-sonnet-5',
    settingsConfig: {
      env: {
        ANTHROPIC_BASE_URL: 'https://router.shengsuanyun.com/api',
        ANTHROPIC_AUTH_TOKEN: '',
        ANTHROPIC_MODEL: 'anthropic/claude-sonnet-5',
        ANTHROPIC_DEFAULT_HAIKU_MODEL: 'anthropic/claude-haiku-4.5',
        ANTHROPIC_DEFAULT_SONNET_MODEL: 'anthropic/claude-sonnet-5',
        ANTHROPIC_DEFAULT_OPUS_MODEL: 'anthropic/claude-opus-4.8'
      }
    }
  },
  {
    provider: 'aigocode',
    baseUrl: 'https://api.aigocode.com',
    endpointCandidates: ['https://api.aigocode.com'],
    settingsConfig: {
      env: { ANTHROPIC_BASE_URL: 'https://api.aigocode.com', ANTHROPIC_AUTH_TOKEN: '' }
    }
  },
  {
    provider: 'subrouter',
    baseUrl: 'https://subrouter.ai',
    settingsConfig: {
      env: { ANTHROPIC_BASE_URL: 'https://subrouter.ai', ANTHROPIC_AUTH_TOKEN: '' }
    }
  },
  {
    provider: 'apikey_fun',
    baseUrl: 'https://api.apikey.fun',
    endpointCandidates: ['https://api.apikey.fun', 'https://slb.apikey.fun'],
    settingsConfig: {
      env: {
        ANTHROPIC_BASE_URL: 'https://api.apikey.fun',
        ANTHROPIC_AUTH_TOKEN: '',
        CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1'
      }
    }
  },
  {
    provider: 'claudeapi',
    baseUrl: 'https://gw.claudeapi.com',
    settingsConfig: {
      env: { ANTHROPIC_BASE_URL: 'https://gw.claudeapi.com', ANTHROPIC_AUTH_TOKEN: '' }
    }
  },
  {
    provider: 'code0',
    baseUrl: 'https://code0.ai',
    settingsConfig: { env: { ANTHROPIC_BASE_URL: 'https://code0.ai', ANTHROPIC_AUTH_TOKEN: '' } }
  },
  {
    provider: 'teamorouter',
    baseUrl: 'https://api.teamorouter.com',
    settingsConfig: {
      env: { ANTHROPIC_BASE_URL: 'https://api.teamorouter.com', ANTHROPIC_AUTH_TOKEN: '' }
    }
  },
  {
    provider: 'claudecn',
    baseUrl: 'https://claudecn.top',
    settingsConfig: {
      env: { ANTHROPIC_BASE_URL: 'https://claudecn.top', ANTHROPIC_AUTH_TOKEN: '' }
    }
  },
  {
    provider: '火山agentplan',
    baseUrl: 'https://ark.cn-beijing.volces.com/api/coding',
    model: 'ark-code-latest',
    settingsConfig: {
      env: {
        ANTHROPIC_BASE_URL: 'https://ark.cn-beijing.volces.com/api/coding',
        ANTHROPIC_AUTH_TOKEN: '',
        ANTHROPIC_MODEL: 'ark-code-latest',
        ANTHROPIC_DEFAULT_HAIKU_MODEL: 'ark-code-latest',
        ANTHROPIC_DEFAULT_SONNET_MODEL: 'ark-code-latest',
        ANTHROPIC_DEFAULT_OPUS_MODEL: 'ark-code-latest'
      }
    }
  },
  {
    provider: 'byteplus',
    baseUrl: 'https://ark.ap-southeast.bytepluses.com/api/coding',
    model: 'ark-code-latest',
    settingsConfig: {
      env: {
        ANTHROPIC_BASE_URL: 'https://ark.ap-southeast.bytepluses.com/api/coding',
        ANTHROPIC_AUTH_TOKEN: '',
        ANTHROPIC_MODEL: 'ark-code-latest',
        ANTHROPIC_DEFAULT_HAIKU_MODEL: 'ark-code-latest',
        ANTHROPIC_DEFAULT_SONNET_MODEL: 'ark-code-latest',
        ANTHROPIC_DEFAULT_OPUS_MODEL: 'ark-code-latest'
      }
    }
  },
  {
    provider: 'doubaoseed',
    baseUrl: 'https://ark.cn-beijing.volces.com/api/compatible',
    model: 'doubao-seed-2-1-pro-260628',
    settingsConfig: {
      env: {
        ANTHROPIC_BASE_URL: 'https://ark.cn-beijing.volces.com/api/compatible',
        ANTHROPIC_AUTH_TOKEN: '',
        API_TIMEOUT_MS: '3000000',
        ANTHROPIC_MODEL: 'doubao-seed-2-1-pro-260628',
        ANTHROPIC_DEFAULT_SONNET_MODEL: 'doubao-seed-2-1-pro-260628',
        ANTHROPIC_DEFAULT_OPUS_MODEL: 'doubao-seed-2-1-pro-260628',
        ANTHROPIC_DEFAULT_HAIKU_MODEL: 'doubao-seed-2-1-pro-260628'
      }
    }
  },
  {
    provider: 'siliconflow',
    baseUrl: 'https://api.siliconflow.cn',
    model: 'Pro/MiniMaxAI/MiniMax-M2.7',
    settingsConfig: {
      env: {
        ANTHROPIC_BASE_URL: 'https://api.siliconflow.cn',
        ANTHROPIC_AUTH_TOKEN: '',
        ANTHROPIC_MODEL: 'Pro/MiniMaxAI/MiniMax-M2.7',
        ANTHROPIC_DEFAULT_HAIKU_MODEL: 'Pro/MiniMaxAI/MiniMax-M2.7',
        ANTHROPIC_DEFAULT_SONNET_MODEL: 'Pro/MiniMaxAI/MiniMax-M2.7',
        ANTHROPIC_DEFAULT_OPUS_MODEL: 'Pro/MiniMaxAI/MiniMax-M2.7'
      }
    }
  },
  {
    provider: 'siliconflow_en',
    baseUrl: 'https://api.siliconflow.com',
    model: 'MiniMaxAI/MiniMax-M2.7',
    settingsConfig: {
      env: {
        ANTHROPIC_BASE_URL: 'https://api.siliconflow.com',
        ANTHROPIC_AUTH_TOKEN: '',
        ANTHROPIC_MODEL: 'MiniMaxAI/MiniMax-M2.7',
        ANTHROPIC_DEFAULT_HAIKU_MODEL: 'MiniMaxAI/MiniMax-M2.7',
        ANTHROPIC_DEFAULT_SONNET_MODEL: 'MiniMaxAI/MiniMax-M2.7',
        ANTHROPIC_DEFAULT_OPUS_MODEL: 'MiniMaxAI/MiniMax-M2.7'
      }
    }
  },
  {
    provider: 'nekocode',
    baseUrl: 'https://nekocode.ai',
    settingsConfig: { env: { ANTHROPIC_BASE_URL: 'https://nekocode.ai', ANTHROPIC_AUTH_TOKEN: '' } }
  },
  {
    provider: 'atlascloud',
    baseUrl: 'https://api.atlascloud.ai',
    model: 'zai-org/glm-5.1',
    endpointCandidates: ['https://api.atlascloud.ai'],
    settingsConfig: {
      env: {
        ANTHROPIC_BASE_URL: 'https://api.atlascloud.ai',
        ANTHROPIC_AUTH_TOKEN: '',
        ANTHROPIC_MODEL: 'zai-org/glm-5.1',
        ANTHROPIC_DEFAULT_HAIKU_MODEL: 'zai-org/glm-5.1',
        ANTHROPIC_DEFAULT_SONNET_MODEL: 'zai-org/glm-5.1',
        ANTHROPIC_DEFAULT_OPUS_MODEL: 'zai-org/glm-5.1',
        CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS: '1'
      }
    }
  },
  {
    provider: 'compshare',
    baseUrl: 'https://api.modelverse.cn',
    endpointCandidates: ['https://api.modelverse.cn'],
    settingsConfig: {
      env: { ANTHROPIC_BASE_URL: 'https://api.modelverse.cn', ANTHROPIC_AUTH_TOKEN: '' }
    }
  },
  {
    provider: 'compshare_coding_plan',
    baseUrl: 'https://cp.compshare.cn',
    endpointCandidates: ['https://cp.compshare.cn'],
    settingsConfig: {
      env: { ANTHROPIC_BASE_URL: 'https://cp.compshare.cn', ANTHROPIC_AUTH_TOKEN: '' }
    }
  },
  {
    provider: 'ccsub',
    baseUrl: 'https://www.ccsub.net',
    settingsConfig: {
      env: { ANTHROPIC_BASE_URL: 'https://www.ccsub.net', ANTHROPIC_AUTH_TOKEN: '' }
    }
  },
  {
    provider: 'sssaicode',
    baseUrl: 'https://node-hk.sssaicodeapi.com/api',
    endpointCandidates: [
      'https://node-hk.sssaicodeapi.com/api',
      'https://node-hk.sssaiapi.com/api',
      'https://node-cf.sssaicodeapi.com/api'
    ],
    settingsConfig: {
      env: { ANTHROPIC_BASE_URL: 'https://node-hk.sssaicodeapi.com/api', ANTHROPIC_AUTH_TOKEN: '' }
    }
  },
  {
    provider: 'micu',
    baseUrl: 'https://www.micuapi.ai',
    endpointCandidates: ['https://www.micuapi.ai'],
    settingsConfig: {
      env: { ANTHROPIC_BASE_URL: 'https://www.micuapi.ai', ANTHROPIC_AUTH_TOKEN: '' }
    }
  },
  {
    provider: 'rightcode',
    baseUrl: 'https://www.right.codes/claude',
    settingsConfig: {
      env: { ANTHROPIC_BASE_URL: 'https://www.right.codes/claude', ANTHROPIC_AUTH_TOKEN: '' }
    }
  },
  {
    provider: 'etok_ai',
    baseUrl: 'https://api.etok.ai',
    settingsConfig: { env: { ANTHROPIC_BASE_URL: 'https://api.etok.ai', ANTHROPIC_AUTH_TOKEN: '' } }
  },
  {
    provider: 'cubence',
    baseUrl: 'https://api.cubence.com',
    endpointCandidates: [
      'https://api.cubence.com',
      'https://api-cf.cubence.com',
      'https://api-dmit.cubence.com',
      'https://api-bwg.cubence.com'
    ],
    settingsConfig: {
      env: { ANTHROPIC_BASE_URL: 'https://api.cubence.com', ANTHROPIC_AUTH_TOKEN: '' }
    }
  },
  {
    provider: 'crazyrouter',
    baseUrl: 'https://cn.crazyrouter.com',
    endpointCandidates: ['https://cn.crazyrouter.com'],
    settingsConfig: {
      env: { ANTHROPIC_BASE_URL: 'https://cn.crazyrouter.com', ANTHROPIC_AUTH_TOKEN: '' }
    }
  },
  {
    provider: 'dmxapi',
    baseUrl: 'https://www.dmxapi.cn',
    endpointCandidates: ['https://www.dmxapi.cn', 'https://api.dmxapi.cn'],
    settingsConfig: {
      env: { ANTHROPIC_BASE_URL: 'https://www.dmxapi.cn', ANTHROPIC_AUTH_TOKEN: '' }
    }
  },
  {
    provider: 'qiniu',
    baseUrl: 'https://api.qnaigc.com',
    endpointCandidates: ['https://api.qnaigc.com', 'https://api.modelink.ai'],
    settingsConfig: {
      env: { ANTHROPIC_BASE_URL: 'https://api.qnaigc.com', ANTHROPIC_AUTH_TOKEN: '' }
    }
  },
  {
    provider: 'sudocode_chat',
    baseUrl: 'https://api.sudocode.chat',
    endpointCandidates: ['https://api.sudocode.chat'],
    settingsConfig: {
      env: {
        ANTHROPIC_BASE_URL: 'https://api.sudocode.chat',
        ANTHROPIC_AUTH_TOKEN: '',
        API_TIMEOUT_MS: '300000'
      }
    }
  },
  {
    provider: 'sudocode_us',
    baseUrl: 'https://sudocode.us',
    endpointCandidates: ['https://sudocode.us', 'https://sudocode.run'],
    settingsConfig: {
      env: {
        ANTHROPIC_BASE_URL: 'https://sudocode.us',
        ANTHROPIC_AUTH_TOKEN: '',
        API_TIMEOUT_MS: '300000'
      }
    }
  },
  {
    provider: 'amux',
    baseUrl: 'https://api.amux.ai',
    settingsConfig: { env: { ANTHROPIC_BASE_URL: 'https://api.amux.ai', ANTHROPIC_AUTH_TOKEN: '' } }
  },
  {
    provider: 'gemini_native',
    baseUrl: 'https://generativelanguage.googleapis.com',
    model: 'gemini-3.5-flash',
    endpointCandidates: ['https://generativelanguage.googleapis.com'],
    settingsConfig: {
      env: {
        ANTHROPIC_BASE_URL: 'https://generativelanguage.googleapis.com',
        ANTHROPIC_API_KEY: '',
        ANTHROPIC_MODEL: 'gemini-3.5-flash',
        ANTHROPIC_DEFAULT_HAIKU_MODEL: 'gemini-3.5-flash',
        ANTHROPIC_DEFAULT_SONNET_MODEL: 'gemini-3.5-flash',
        ANTHROPIC_DEFAULT_OPUS_MODEL: 'gemini-3.5-flash'
      }
    }
  },
  {
    provider: 'deepseek',
    apiKeyUrl: '',
    baseUrl: 'https://api.deepseek.com/anthropic',
    model: 'deepseek-v4-pro',
    settingsConfig: {
      env: {
        ANTHROPIC_BASE_URL: 'https://api.deepseek.com/anthropic',
        ANTHROPIC_AUTH_TOKEN: '',
        ANTHROPIC_MODEL: 'deepseek-v4-pro',
        ANTHROPIC_DEFAULT_HAIKU_MODEL: 'deepseek-v4-flash',
        ANTHROPIC_DEFAULT_SONNET_MODEL: 'deepseek-v4-pro',
        ANTHROPIC_DEFAULT_OPUS_MODEL: 'deepseek-v4-pro'
      }
    }
  },
  {
    provider: 'opencode_go',
    baseUrl: 'https://opencode.ai/zen/go',
    model: 'deepseek-v4-flash',
    endpointCandidates: ['https://opencode.ai/zen/go'],
    settingsConfig: {
      env: {
        ANTHROPIC_BASE_URL: 'https://opencode.ai/zen/go',
        ANTHROPIC_AUTH_TOKEN: '',
        ANTHROPIC_MODEL: 'deepseek-v4-flash',
        ANTHROPIC_DEFAULT_HAIKU_MODEL: 'deepseek-v4-flash',
        ANTHROPIC_DEFAULT_SONNET_MODEL: 'deepseek-v4-flash',
        ANTHROPIC_DEFAULT_OPUS_MODEL: 'deepseek-v4-flash'
      }
    }
  },
  {
    provider: 'zhipu_glm',
    baseUrl: 'https://open.bigmodel.cn/api/anthropic',
    model: 'glm-5.1',
    settingsConfig: {
      env: {
        ANTHROPIC_BASE_URL: 'https://open.bigmodel.cn/api/anthropic',
        ANTHROPIC_AUTH_TOKEN: '',
        ANTHROPIC_MODEL: 'glm-5.1',
        ANTHROPIC_DEFAULT_HAIKU_MODEL: 'glm-5.1',
        ANTHROPIC_DEFAULT_SONNET_MODEL: 'glm-5.1',
        ANTHROPIC_DEFAULT_OPUS_MODEL: 'glm-5.1'
      }
    }
  },
  {
    provider: 'zhipu_glm_en',
    baseUrl: 'https://api.z.ai/api/anthropic',
    model: 'glm-5.1',
    settingsConfig: {
      env: {
        ANTHROPIC_BASE_URL: 'https://api.z.ai/api/anthropic',
        ANTHROPIC_AUTH_TOKEN: '',
        ANTHROPIC_MODEL: 'glm-5.1',
        ANTHROPIC_DEFAULT_HAIKU_MODEL: 'glm-5.1',
        ANTHROPIC_DEFAULT_SONNET_MODEL: 'glm-5.1',
        ANTHROPIC_DEFAULT_OPUS_MODEL: 'glm-5.1'
      }
    }
  },
  {
    provider: 'baidu_qianfan_coding_plan',
    baseUrl: 'https://qianfan.baidubce.com/anthropic/coding',
    model: 'qianfan-code-latest',
    endpointCandidates: ['https://qianfan.baidubce.com/anthropic/coding'],
    settingsConfig: {
      env: {
        ANTHROPIC_BASE_URL: 'https://qianfan.baidubce.com/anthropic/coding',
        ANTHROPIC_AUTH_TOKEN: '',
        ANTHROPIC_MODEL: 'qianfan-code-latest',
        ANTHROPIC_DEFAULT_HAIKU_MODEL: 'qianfan-code-latest',
        ANTHROPIC_DEFAULT_SONNET_MODEL: 'qianfan-code-latest',
        ANTHROPIC_DEFAULT_OPUS_MODEL: 'qianfan-code-latest'
      }
    }
  },
  {
    provider: 'bailian',
    apiKeyUrl: '',
    baseUrl: 'https://dashscope.aliyuncs.com/apps/anthropic',
    settingsConfig: {
      env: {
        ANTHROPIC_BASE_URL: 'https://dashscope.aliyuncs.com/apps/anthropic',
        ANTHROPIC_AUTH_TOKEN: ''
      }
    }
  },
  {
    provider: 'bailian_for_coding',
    baseUrl: 'https://coding.dashscope.aliyuncs.com/apps/anthropic',
    settingsConfig: {
      env: {
        ANTHROPIC_BASE_URL: 'https://coding.dashscope.aliyuncs.com/apps/anthropic',
        ANTHROPIC_AUTH_TOKEN: ''
      }
    }
  },
  {
    provider: 'bailian_token_plan',
    baseUrl: 'https://token-plan.cn-beijing.maas.aliyuncs.com/apps/anthropic',
    model: 'qwen3.8-max',
    settingsConfig: {
      env: {
        ANTHROPIC_BASE_URL: 'https://token-plan.cn-beijing.maas.aliyuncs.com/apps/anthropic',
        ANTHROPIC_AUTH_TOKEN: '',
        ANTHROPIC_MODEL: 'qwen3.8-max',
        ANTHROPIC_DEFAULT_HAIKU_MODEL: 'qwen3.8-max',
        ANTHROPIC_DEFAULT_SONNET_MODEL: 'qwen3.8-max',
        ANTHROPIC_DEFAULT_OPUS_MODEL: 'qwen3.8-max',
        ANTHROPIC_DEFAULT_FABLE_MODEL: 'qwen3.8-max',
        CLAUDE_CODE_SUBAGENT_MODEL: 'qwen3.8-max'
      }
    }
  },
  {
    provider: 'stepfun',
    baseUrl: 'https://api.stepfun.com/step_plan',
    model: 'step-3.5-flash-2603',
    endpointCandidates: ['https://api.stepfun.com/step_plan'],
    settingsConfig: {
      env: {
        ANTHROPIC_BASE_URL: 'https://api.stepfun.com/step_plan',
        ANTHROPIC_AUTH_TOKEN: '',
        ANTHROPIC_MODEL: 'step-3.5-flash-2603',
        ANTHROPIC_DEFAULT_HAIKU_MODEL: 'step-3.5-flash-2603',
        ANTHROPIC_DEFAULT_SONNET_MODEL: 'step-3.5-flash-2603',
        ANTHROPIC_DEFAULT_OPUS_MODEL: 'step-3.5-flash-2603'
      }
    }
  },
  {
    provider: 'stepfun_en',
    baseUrl: 'https://api.stepfun.ai/step_plan',
    model: 'step-3.5-flash-2603',
    endpointCandidates: ['https://api.stepfun.ai/step_plan'],
    settingsConfig: {
      env: {
        ANTHROPIC_BASE_URL: 'https://api.stepfun.ai/step_plan',
        ANTHROPIC_AUTH_TOKEN: '',
        ANTHROPIC_MODEL: 'step-3.5-flash-2603',
        ANTHROPIC_DEFAULT_HAIKU_MODEL: 'step-3.5-flash-2603',
        ANTHROPIC_DEFAULT_SONNET_MODEL: 'step-3.5-flash-2603',
        ANTHROPIC_DEFAULT_OPUS_MODEL: 'step-3.5-flash-2603'
      }
    }
  },
  {
    provider: 'modelscope',
    apiKeyUrl: '',
    baseUrl: 'https://api-inference.modelscope.cn',
    model: 'ZhipuAI/GLM-5.1',
    settingsConfig: {
      env: {
        ANTHROPIC_BASE_URL: 'https://api-inference.modelscope.cn',
        ANTHROPIC_AUTH_TOKEN: '',
        ANTHROPIC_MODEL: 'ZhipuAI/GLM-5.1',
        ANTHROPIC_DEFAULT_HAIKU_MODEL: 'ZhipuAI/GLM-5.1',
        ANTHROPIC_DEFAULT_SONNET_MODEL: 'ZhipuAI/GLM-5.1',
        ANTHROPIC_DEFAULT_OPUS_MODEL: 'ZhipuAI/GLM-5.1'
      }
    }
  },
  {
    provider: 'kat_coder',
    baseUrl:
      'https://vanchin.streamlake.ai/api/gateway/v1/endpoints/${ENDPOINT_ID}/claude-code-proxy',
    model: 'KAT-Coder-Pro V1',
    settingsConfig: {
      env: {
        ANTHROPIC_BASE_URL:
          'https://vanchin.streamlake.ai/api/gateway/v1/endpoints/${ENDPOINT_ID}/claude-code-proxy',
        ANTHROPIC_AUTH_TOKEN: '',
        ANTHROPIC_MODEL: 'KAT-Coder-Pro V1',
        ANTHROPIC_DEFAULT_HAIKU_MODEL: 'KAT-Coder-Air V1',
        ANTHROPIC_DEFAULT_SONNET_MODEL: 'KAT-Coder-Pro V1',
        ANTHROPIC_DEFAULT_OPUS_MODEL: 'KAT-Coder-Pro V1'
      }
    }
  },
  {
    provider: 'longcat',
    baseUrl: 'https://api.longcat.chat/anthropic',
    model: 'LongCat-2.0',
    settingsConfig: {
      env: {
        ANTHROPIC_BASE_URL: 'https://api.longcat.chat/anthropic',
        ANTHROPIC_AUTH_TOKEN: '',
        ANTHROPIC_MODEL: 'LongCat-2.0',
        ANTHROPIC_SMALL_FAST_MODEL: 'LongCat-2.0',
        ANTHROPIC_DEFAULT_HAIKU_MODEL: 'LongCat-2.0',
        ANTHROPIC_DEFAULT_SONNET_MODEL: 'LongCat-2.0',
        ANTHROPIC_DEFAULT_OPUS_MODEL: 'LongCat-2.0',
        CLAUDE_CODE_MAX_OUTPUT_TOKENS: '131072',
        CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: 1
      }
    }
  },
  {
    provider: 'minimax',
    baseUrl: 'https://api.minimaxi.com/anthropic',
    model: 'MiniMax-M2.7',
    settingsConfig: {
      env: {
        ANTHROPIC_BASE_URL: 'https://api.minimaxi.com/anthropic',
        ANTHROPIC_AUTH_TOKEN: '',
        API_TIMEOUT_MS: '3000000',
        CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: 1,
        ANTHROPIC_MODEL: 'MiniMax-M2.7',
        ANTHROPIC_DEFAULT_SONNET_MODEL: 'MiniMax-M2.7',
        ANTHROPIC_DEFAULT_OPUS_MODEL: 'MiniMax-M2.7',
        ANTHROPIC_DEFAULT_HAIKU_MODEL: 'MiniMax-M2.7'
      }
    }
  },
  {
    provider: 'minimax_en',
    baseUrl: 'https://api.minimax.io/anthropic',
    model: 'MiniMax-M2.7',
    settingsConfig: {
      env: {
        ANTHROPIC_BASE_URL: 'https://api.minimax.io/anthropic',
        ANTHROPIC_AUTH_TOKEN: '',
        API_TIMEOUT_MS: '3000000',
        CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: 1,
        ANTHROPIC_MODEL: 'MiniMax-M2.7',
        ANTHROPIC_DEFAULT_SONNET_MODEL: 'MiniMax-M2.7',
        ANTHROPIC_DEFAULT_OPUS_MODEL: 'MiniMax-M2.7',
        ANTHROPIC_DEFAULT_HAIKU_MODEL: 'MiniMax-M2.7'
      }
    }
  },
  {
    provider: 'bailing',
    baseUrl: 'https://api.tbox.cn/api/anthropic',
    model: 'Ling-2.5-1T',
    settingsConfig: {
      env: {
        ANTHROPIC_BASE_URL: 'https://api.tbox.cn/api/anthropic',
        ANTHROPIC_AUTH_TOKEN: '',
        ANTHROPIC_MODEL: 'Ling-2.5-1T',
        ANTHROPIC_DEFAULT_HAIKU_MODEL: 'Ling-2.5-1T',
        ANTHROPIC_DEFAULT_SONNET_MODEL: 'Ling-2.5-1T',
        ANTHROPIC_DEFAULT_OPUS_MODEL: 'Ling-2.5-1T'
      }
    }
  },
  {
    provider: 'aihubmix',
    baseUrl: 'https://aihubmix.com',
    endpointCandidates: ['https://aihubmix.com', 'https://api.aihubmix.com'],
    settingsConfig: { env: { ANTHROPIC_BASE_URL: 'https://aihubmix.com', ANTHROPIC_API_KEY: '' } }
  },
  {
    provider: 'cherryin',
    baseUrl: 'https://open.cherryin.net',
    model: 'anthropic/claude-sonnet-5',
    endpointCandidates: ['https://open.cherryin.net'],
    settingsConfig: {
      env: {
        ANTHROPIC_BASE_URL: 'https://open.cherryin.net',
        ANTHROPIC_AUTH_TOKEN: '',
        ANTHROPIC_MODEL: 'anthropic/claude-sonnet-5',
        ANTHROPIC_DEFAULT_HAIKU_MODEL: 'anthropic/claude-haiku-4.5',
        ANTHROPIC_DEFAULT_SONNET_MODEL: 'anthropic/claude-sonnet-5',
        ANTHROPIC_DEFAULT_OPUS_MODEL: 'anthropic/claude-opus-4.8'
      }
    }
  },
  {
    provider: 'relaxycode',
    baseUrl: 'https://www.relaxycode.com',
    settingsConfig: {
      env: { ANTHROPIC_BASE_URL: 'https://www.relaxycode.com', ANTHROPIC_AUTH_TOKEN: '' }
    }
  },
  {
    provider: 'e_flowcode',
    baseUrl: 'https://e-flowcode.cc',
    endpointCandidates: ['https://e-flowcode.cc'],
    settingsConfig: {
      effortLevel: 'high',
      env: { ANTHROPIC_AUTH_TOKEN: '', ANTHROPIC_BASE_URL: 'https://e-flowcode.cc' },
      enabledPlugins: { 'superpowers@superpowers-marketplace': true },
      includeCoAuthoredBy: false,
      ENABLE_TOOL_SEARCH: true,
      skipWebFetchPreflight: true
    }
  },
  {
    provider: 'openrouter',
    baseUrl: 'https://openrouter.ai/api',
    model: 'anthropic/claude-sonnet-5',
    settingsConfig: {
      env: {
        ANTHROPIC_BASE_URL: 'https://openrouter.ai/api',
        ANTHROPIC_AUTH_TOKEN: '',
        ANTHROPIC_MODEL: 'anthropic/claude-sonnet-5',
        ANTHROPIC_DEFAULT_HAIKU_MODEL: 'anthropic/claude-haiku-4.5',
        ANTHROPIC_DEFAULT_SONNET_MODEL: 'anthropic/claude-sonnet-5',
        ANTHROPIC_DEFAULT_OPUS_MODEL: 'anthropic/claude-opus-4.8'
      }
    }
  },
  {
    provider: 'therouter',
    baseUrl: 'https://api.therouter.ai',
    model: 'anthropic/claude-sonnet-5',
    endpointCandidates: ['https://api.therouter.ai'],
    settingsConfig: {
      env: {
        ANTHROPIC_BASE_URL: 'https://api.therouter.ai',
        ANTHROPIC_AUTH_TOKEN: '',
        ANTHROPIC_API_KEY: '',
        ANTHROPIC_MODEL: 'anthropic/claude-sonnet-5',
        ANTHROPIC_DEFAULT_HAIKU_MODEL: 'anthropic/claude-haiku-4.5',
        ANTHROPIC_DEFAULT_SONNET_MODEL: 'anthropic/claude-sonnet-5',
        ANTHROPIC_DEFAULT_OPUS_MODEL: 'anthropic/claude-opus-4.8'
      }
    }
  },
  {
    provider: 'novita_ai',
    baseUrl: 'https://api.novita.ai/anthropic',
    model: 'zai-org/glm-5.1',
    endpointCandidates: ['https://api.novita.ai/anthropic'],
    settingsConfig: {
      env: {
        ANTHROPIC_BASE_URL: 'https://api.novita.ai/anthropic',
        ANTHROPIC_AUTH_TOKEN: '',
        ANTHROPIC_MODEL: 'zai-org/glm-5.1',
        ANTHROPIC_DEFAULT_HAIKU_MODEL: 'zai-org/glm-5.1',
        ANTHROPIC_DEFAULT_SONNET_MODEL: 'zai-org/glm-5.1',
        ANTHROPIC_DEFAULT_OPUS_MODEL: 'zai-org/glm-5.1'
      }
    }
  },
  {
    provider: 'github_copilot',
    baseUrl: 'https://api.githubcopilot.com',
    model: 'claude-sonnet-5',
    settingsConfig: {
      env: {
        ANTHROPIC_BASE_URL: 'https://api.githubcopilot.com',
        ANTHROPIC_MODEL: 'claude-sonnet-5',
        ANTHROPIC_DEFAULT_HAIKU_MODEL: 'claude-haiku-4.5',
        ANTHROPIC_DEFAULT_SONNET_MODEL: 'claude-sonnet-5',
        ANTHROPIC_DEFAULT_OPUS_MODEL: 'claude-sonnet-5'
      }
    }
  },
  {
    provider: 'codex',
    baseUrl: 'https://chatgpt.com/backend-api/codex',
    model: 'gpt-5.6',
    settingsConfig: {
      env: {
        ANTHROPIC_BASE_URL: 'https://chatgpt.com/backend-api/codex',
        ANTHROPIC_MODEL: 'gpt-5.6',
        ANTHROPIC_DEFAULT_HAIKU_MODEL: 'gpt-5.6-luna',
        ANTHROPIC_DEFAULT_SONNET_MODEL: 'gpt-5.6',
        ANTHROPIC_DEFAULT_OPUS_MODEL: 'gpt-5.6',
        CLAUDE_CODE_MAX_CONTEXT_TOKENS: '372000',
        CLAUDE_CODE_AUTO_COMPACT_WINDOW: '372000'
      }
    }
  },
  {
    provider: 'xai_grok',
    websiteUrl: 'https://x.ai/grok',
    apiKeyUrl: '',
    baseUrl: 'https://api.x.ai/v1',
    model: 'grok-4.5',
    settingsConfig: {
      env: {
        ANTHROPIC_BASE_URL: 'https://api.x.ai/v1',
        ANTHROPIC_MODEL: 'grok-4.5',
        ANTHROPIC_DEFAULT_HAIKU_MODEL: 'grok-4.5',
        ANTHROPIC_DEFAULT_SONNET_MODEL: 'grok-4.5',
        ANTHROPIC_DEFAULT_OPUS_MODEL: 'grok-4.5'
      }
    }
  },
  {
    provider: 'nvidia',
    baseUrl: 'https://integrate.api.nvidia.com',
    model: 'moonshotai/kimi-k2.5',
    settingsConfig: {
      env: {
        ANTHROPIC_BASE_URL: 'https://integrate.api.nvidia.com',
        ANTHROPIC_AUTH_TOKEN: '',
        ANTHROPIC_MODEL: 'moonshotai/kimi-k2.5',
        ANTHROPIC_DEFAULT_HAIKU_MODEL: 'moonshotai/kimi-k2.5',
        ANTHROPIC_DEFAULT_SONNET_MODEL: 'moonshotai/kimi-k2.5',
        ANTHROPIC_DEFAULT_OPUS_MODEL: 'moonshotai/kimi-k2.5'
      }
    }
  },
  {
    provider: 'pipellm',
    baseUrl: 'https://cc-api.pipellm.ai',
    model: 'claude-opus-4-8',
    settingsConfig: {
      env: {
        ANTHROPIC_BASE_URL: 'https://cc-api.pipellm.ai',
        ANTHROPIC_AUTH_TOKEN: '',
        ANTHROPIC_MODEL: 'claude-opus-4-8',
        ANTHROPIC_DEFAULT_HAIKU_MODEL: 'claude-haiku-4-5-20251001',
        ANTHROPIC_DEFAULT_SONNET_MODEL: 'claude-sonnet-5',
        ANTHROPIC_DEFAULT_OPUS_MODEL: 'claude-opus-4-8'
      },
      includeCoAuthoredBy: false
    }
  },
  {
    provider: 'xiaomi_mimo',
    baseUrl: 'https://api.xiaomimimo.com/anthropic',
    model: 'mimo-v2.5-pro',
    settingsConfig: {
      env: {
        ANTHROPIC_BASE_URL: 'https://api.xiaomimimo.com/anthropic',
        ANTHROPIC_AUTH_TOKEN: '',
        ANTHROPIC_MODEL: 'mimo-v2.5-pro',
        ANTHROPIC_DEFAULT_HAIKU_MODEL: 'mimo-v2.5-pro',
        ANTHROPIC_DEFAULT_SONNET_MODEL: 'mimo-v2.5-pro',
        ANTHROPIC_DEFAULT_OPUS_MODEL: 'mimo-v2.5-pro'
      }
    }
  },
  {
    provider: 'xiaomi_mimo_token_plan_china',
    baseUrl: 'https://token-plan-cn.xiaomimimo.com/anthropic',
    model: 'mimo-v2.5-pro',
    settingsConfig: {
      env: {
        ANTHROPIC_BASE_URL: 'https://token-plan-cn.xiaomimimo.com/anthropic',
        ANTHROPIC_AUTH_TOKEN: '',
        ANTHROPIC_MODEL: 'mimo-v2.5-pro',
        ANTHROPIC_DEFAULT_HAIKU_MODEL: 'mimo-v2.5-pro',
        ANTHROPIC_DEFAULT_SONNET_MODEL: 'mimo-v2.5-pro',
        ANTHROPIC_DEFAULT_OPUS_MODEL: 'mimo-v2.5-pro'
      }
    }
  },
  {
    provider: 'aws_bedrock_aksk',
    baseUrl: 'https://bedrock-runtime.${AWS_REGION}.amazonaws.com',
    model: 'global.anthropic.claude-opus-4-8',
    settingsConfig: {
      env: {
        ANTHROPIC_BASE_URL: 'https://bedrock-runtime.${AWS_REGION}.amazonaws.com',
        AWS_ACCESS_KEY_ID: '${AWS_ACCESS_KEY_ID}',
        AWS_SECRET_ACCESS_KEY: '${AWS_SECRET_ACCESS_KEY}',
        AWS_REGION: '${AWS_REGION}',
        ANTHROPIC_MODEL: 'global.anthropic.claude-opus-4-8',
        ANTHROPIC_DEFAULT_HAIKU_MODEL: 'global.anthropic.claude-haiku-4-5-20251001-v1:0',
        ANTHROPIC_DEFAULT_SONNET_MODEL: 'global.anthropic.claude-sonnet-5',
        ANTHROPIC_DEFAULT_OPUS_MODEL: 'global.anthropic.claude-opus-4-8',
        CLAUDE_CODE_USE_BEDROCK: '1'
      }
    }
  },
  {
    provider: 'aws_bedrock_api_key',
    baseUrl: 'https://bedrock-runtime.${AWS_REGION}.amazonaws.com',
    model: 'global.anthropic.claude-opus-4-8',
    settingsConfig: {
      apiKey: '',
      env: {
        ANTHROPIC_BASE_URL: 'https://bedrock-runtime.${AWS_REGION}.amazonaws.com',
        AWS_REGION: '${AWS_REGION}',
        ANTHROPIC_MODEL: 'global.anthropic.claude-opus-4-8',
        ANTHROPIC_DEFAULT_HAIKU_MODEL: 'global.anthropic.claude-haiku-4-5-20251001-v1:0',
        ANTHROPIC_DEFAULT_SONNET_MODEL: 'global.anthropic.claude-sonnet-5',
        ANTHROPIC_DEFAULT_OPUS_MODEL: 'global.anthropic.claude-opus-4-8',
        CLAUDE_CODE_USE_BEDROCK: '1'
      }
    }
  }
];
