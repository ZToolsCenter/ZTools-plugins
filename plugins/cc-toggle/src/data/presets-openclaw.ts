// OpenClaw presets - only diff from defaults; merged with providers.js at runtime
export default [
  {
    provider: 'kimi',
    baseUrl: 'https://api.moonshot.cn/v1',
    model: 'kimi-k2.7-code',
    models: ['kimi-k2.7-code', 'kimi-k3'],
    settingsConfig: {
      baseUrl: 'https://api.moonshot.cn/v1',
      apiKey: '',
      api: 'openai-completions',
      models: [
        {
          id: 'kimi-k2.7-code',
          name: 'Kimi K2.7 Code',
          contextWindow: 262144,
          cost: { input: 0.95, output: 4, cacheRead: 0.19 }
        },
        {
          id: 'kimi-k3',
          name: 'Kimi K3',
          contextWindow: 1048576,
          cost: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 0 }
        }
      ]
    },
    suggestedDefaults: {
      model: { primary: 'kimi/kimi-k2.7-code' },
      modelCatalog: { 'kimi/kimi-k2.7-code': { alias: 'Kimi' } }
    }
  },
  {
    provider: 'kimi_for_coding',
    apiKeyUrl: 'https://platform.kimi.com/console/api-keys?aff=cc-switch',
    baseUrl: 'https://api.kimi.com/v1',
    model: 'kimi-for-coding',
    models: ['kimi-for-coding'],
    settingsConfig: {
      baseUrl: 'https://api.kimi.com/v1',
      apiKey: '',
      api: 'openai-completions',
      models: [
        {
          id: 'kimi-for-coding',
          name: 'Kimi For Coding',
          contextWindow: 131072,
          cost: { input: 0.95, output: 4, cacheRead: 0.19 }
        }
      ]
    },
    suggestedDefaults: {
      model: { primary: 'kimi-coding/kimi-for-coding' },
      modelCatalog: { 'kimi-coding/kimi-for-coding': { alias: 'Kimi' } }
    }
  },
  {
    provider: 'packycode',
    baseUrl: 'https://www.packyapi.com',
    model: 'claude-opus-4-8',
    apiProtocol: 'anthropic-messages',
    models: ['claude-opus-4-8', 'claude-sonnet-5'],
    settingsConfig: {
      baseUrl: 'https://www.packyapi.com',
      apiKey: '',
      api: 'anthropic-messages',
      models: [
        {
          id: 'claude-opus-4-8',
          name: 'Claude Opus 4.8',
          contextWindow: 1000000,
          cost: { input: 5, output: 25 }
        },
        {
          id: 'claude-sonnet-5',
          name: 'Claude Sonnet 5',
          contextWindow: 1000000,
          cost: { input: 3, output: 15 }
        }
      ]
    },
    suggestedDefaults: {
      model: { primary: 'packycode/claude-opus-4-8', fallbacks: ['packycode/claude-sonnet-5'] },
      modelCatalog: {
        'packycode/claude-opus-4-8': { alias: 'Opus' },
        'packycode/claude-sonnet-5': { alias: 'Sonnet' }
      }
    }
  },
  {
    provider: 'zetaapi',
    baseUrl: 'https://api.zetaapi.ai/v1',
    model: 'gpt-5.5',
    models: ['gpt-5.5'],
    settingsConfig: {
      baseUrl: 'https://api.zetaapi.ai/v1',
      apiKey: '',
      api: 'openai-completions',
      models: [{ id: 'gpt-5.5', name: 'GPT-5.5', contextWindow: 400000 }]
    },
    suggestedDefaults: {
      model: { primary: 'zetaapi/gpt-5.5' },
      modelCatalog: { 'zetaapi/gpt-5.5': { alias: 'GPT-5.5' } }
    }
  },
  {
    provider: 'apinebula',
    baseUrl: 'https://apinebula.com/v1',
    model: 'gpt-5.5',
    models: ['gpt-5.5'],
    settingsConfig: {
      baseUrl: 'https://apinebula.com/v1',
      apiKey: '',
      api: 'openai-completions',
      models: [{ id: 'gpt-5.5', name: 'GPT-5.5' }]
    },
    suggestedDefaults: { model: { primary: 'apinebula/gpt-5.5' } }
  },
  {
    provider: 'aicodemirror',
    baseUrl: 'https://api.aicodemirror.com/api/claudecode',
    model: 'claude-opus-4-8',
    apiProtocol: 'anthropic-messages',
    models: ['claude-opus-4-8', 'claude-sonnet-5'],
    settingsConfig: {
      baseUrl: 'https://api.aicodemirror.com/api/claudecode',
      apiKey: '',
      api: 'anthropic-messages',
      models: [
        {
          id: 'claude-opus-4-8',
          name: 'Claude Opus 4.8',
          contextWindow: 1000000,
          cost: { input: 5, output: 25 }
        },
        {
          id: 'claude-sonnet-5',
          name: 'Claude Sonnet 5',
          contextWindow: 1000000,
          cost: { input: 3, output: 15 }
        }
      ]
    },
    suggestedDefaults: {
      model: {
        primary: 'aicodemirror/claude-opus-4-8',
        fallbacks: ['aicodemirror/claude-sonnet-5']
      },
      modelCatalog: {
        'aicodemirror/claude-opus-4-8': { alias: 'Opus' },
        'aicodemirror/claude-sonnet-5': { alias: 'Sonnet' }
      }
    }
  },
  {
    provider: 'fennoai',
    baseUrl: 'https://api.fenno.ai/v1',
    model: 'gpt-5.5',
    models: ['gpt-5.5'],
    settingsConfig: {
      baseUrl: 'https://api.fenno.ai/v1',
      apiKey: '',
      api: 'openai-completions',
      models: [{ id: 'gpt-5.5', name: 'GPT-5.5', contextWindow: 400000 }]
    },
    suggestedDefaults: {
      model: { primary: 'fenno/gpt-5.5' },
      modelCatalog: { 'fenno/gpt-5.5': { alias: 'GPT-5.5' } }
    }
  },
  {
    provider: 'runapi',
    baseUrl: 'https://runapi.co',
    model: 'claude-opus-4-8',
    apiProtocol: 'anthropic-messages',
    models: ['claude-opus-4-8', 'claude-sonnet-5', 'claude-haiku-4-5'],
    settingsConfig: {
      baseUrl: 'https://runapi.co',
      apiKey: '',
      api: 'anthropic-messages',
      models: [
        { id: 'claude-opus-4-8', name: 'Claude Opus 4.8', contextWindow: 1000000 },
        { id: 'claude-sonnet-5', name: 'Claude Sonnet 5', contextWindow: 1000000 },
        { id: 'claude-haiku-4-5', name: 'Claude Haiku 4.5', contextWindow: 200000 }
      ]
    },
    suggestedDefaults: {
      model: { primary: 'runapi/claude-sonnet-5' },
      modelCatalog: {
        'runapi/claude-opus-4-8': { alias: 'Opus' },
        'runapi/claude-sonnet-5': { alias: 'Sonnet' },
        'runapi/claude-haiku-4-5': { alias: 'Haiku' }
      }
    }
  },
  {
    provider: 'unity2_ai',
    baseUrl: 'https://api.unity2.ai/v1',
    model: 'gpt-5.5',
    models: ['gpt-5.5'],
    settingsConfig: {
      baseUrl: 'https://api.unity2.ai/v1',
      apiKey: '',
      api: 'openai-completions',
      models: [
        { id: 'gpt-5.5', name: 'GPT-5.5', contextWindow: 400000, cost: { input: 5, output: 15 } }
      ]
    },
    suggestedDefaults: {
      model: { primary: 'unity2/gpt-5.5' },
      modelCatalog: { 'unity2/gpt-5.5': { alias: 'GPT-5.5' } }
    }
  },
  {
    provider: 'shengsuanyun',
    baseUrl: 'https://router.shengsuanyun.com/api',
    model: 'anthropic/claude-opus-4.8',
    apiProtocol: 'anthropic-messages',
    models: ['anthropic/claude-opus-4.8', 'anthropic/claude-sonnet-5'],
    settingsConfig: {
      baseUrl: 'https://router.shengsuanyun.com/api',
      apiKey: '',
      api: 'anthropic-messages',
      models: [
        {
          id: 'anthropic/claude-opus-4.8',
          name: 'Claude Opus 4.8',
          contextWindow: 1000000,
          cost: { input: 5, output: 25 }
        },
        {
          id: 'anthropic/claude-sonnet-5',
          name: 'Claude Sonnet 5',
          contextWindow: 1000000,
          cost: { input: 3, output: 15 }
        }
      ]
    },
    suggestedDefaults: {
      model: {
        primary: 'shengsuanyun/anthropic/claude-opus-4.8',
        fallbacks: ['shengsuanyun/anthropic/claude-sonnet-5']
      },
      modelCatalog: {
        'shengsuanyun/anthropic/claude-opus-4.8': { alias: 'Opus' },
        'shengsuanyun/anthropic/claude-sonnet-5': { alias: 'Sonnet' }
      }
    }
  },
  {
    provider: 'aigocode',
    baseUrl: 'https://api.aigocode.com',
    model: 'claude-opus-4-8',
    apiProtocol: 'anthropic-messages',
    models: ['claude-opus-4-8', 'claude-sonnet-5'],
    settingsConfig: {
      baseUrl: 'https://api.aigocode.com',
      apiKey: '',
      api: 'anthropic-messages',
      models: [
        {
          id: 'claude-opus-4-8',
          name: 'Claude Opus 4.8',
          contextWindow: 1000000,
          cost: { input: 5, output: 25 }
        },
        {
          id: 'claude-sonnet-5',
          name: 'Claude Sonnet 5',
          contextWindow: 1000000,
          cost: { input: 3, output: 15 }
        }
      ]
    },
    suggestedDefaults: {
      model: { primary: 'aigocode/claude-opus-4-8', fallbacks: ['aigocode/claude-sonnet-5'] },
      modelCatalog: {
        'aigocode/claude-opus-4-8': { alias: 'Opus' },
        'aigocode/claude-sonnet-5': { alias: 'Sonnet' }
      }
    }
  },
  {
    provider: 'subrouter',
    baseUrl: 'https://subrouter.ai/v1',
    model: 'gpt-5.5',
    models: ['gpt-5.5'],
    settingsConfig: {
      baseUrl: 'https://subrouter.ai/v1',
      apiKey: '',
      api: 'openai-completions',
      models: [{ id: 'gpt-5.5', name: 'GPT-5.5', contextWindow: 400000 }]
    },
    suggestedDefaults: {
      model: { primary: 'subrouter/gpt-5.5' },
      modelCatalog: { 'subrouter/gpt-5.5': { alias: 'GPT-5.5' } }
    }
  },
  {
    provider: 'apikey_fun',
    baseUrl: 'https://api.apikey.fun',
    model: 'claude-opus-4-8',
    apiProtocol: 'anthropic-messages',
    models: ['claude-opus-4-8', 'claude-sonnet-5', 'claude-haiku-4-5'],
    settingsConfig: {
      baseUrl: 'https://api.apikey.fun',
      apiKey: '',
      api: 'anthropic-messages',
      models: [
        { id: 'claude-opus-4-8', name: 'Claude Opus 4.8', contextWindow: 1000000 },
        { id: 'claude-sonnet-5', name: 'Claude Sonnet 5', contextWindow: 1000000 },
        { id: 'claude-haiku-4-5', name: 'Claude Haiku 4.5', contextWindow: 200000 }
      ]
    },
    suggestedDefaults: {
      model: { primary: 'apikeyfun/claude-opus-4-8', fallbacks: ['apikeyfun/claude-sonnet-5'] },
      modelCatalog: {
        'apikeyfun/claude-opus-4-8': { alias: 'Opus' },
        'apikeyfun/claude-sonnet-5': { alias: 'Sonnet' },
        'apikeyfun/claude-haiku-4-5': { alias: 'Haiku' }
      }
    }
  },
  {
    provider: 'code0',
    baseUrl: 'https://code0.ai/v1',
    model: 'gpt-5.5',
    models: ['gpt-5.5'],
    settingsConfig: {
      baseUrl: 'https://code0.ai/v1',
      apiKey: '',
      api: 'openai-completions',
      models: [{ id: 'gpt-5.5', name: 'GPT-5.5', contextWindow: 400000 }]
    },
    suggestedDefaults: {
      model: { primary: 'code0/gpt-5.5' },
      modelCatalog: { 'code0/gpt-5.5': { alias: 'GPT-5.5' } }
    }
  },
  {
    provider: 'teamorouter',
    baseUrl: 'https://api.teamorouter.com/v1',
    model: 'gpt-5.5',
    models: ['gpt-5.5'],
    settingsConfig: {
      baseUrl: 'https://api.teamorouter.com/v1',
      apiKey: '',
      api: 'openai-completions',
      models: [{ id: 'gpt-5.5', name: 'GPT-5.5', contextWindow: 400000 }]
    },
    suggestedDefaults: {
      model: { primary: 'teamorouter/gpt-5.5' },
      modelCatalog: { 'teamorouter/gpt-5.5': { alias: 'GPT-5.5' } }
    }
  },
  {
    provider: 'claudecn',
    baseUrl: 'https://claudecn.top',
    model: 'claude-opus-4-8',
    apiProtocol: 'anthropic-messages',
    models: ['claude-opus-4-8', 'claude-sonnet-5', 'claude-haiku-4-5'],
    settingsConfig: {
      baseUrl: 'https://claudecn.top',
      apiKey: '',
      api: 'anthropic-messages',
      models: [
        { id: 'claude-opus-4-8', name: 'Claude Opus 4.8', contextWindow: 1000000 },
        { id: 'claude-sonnet-5', name: 'Claude Sonnet 5', contextWindow: 1000000 },
        { id: 'claude-haiku-4-5', name: 'Claude Haiku 4.5', contextWindow: 200000 }
      ]
    },
    suggestedDefaults: {
      model: { primary: 'claudecn/claude-sonnet-5' },
      modelCatalog: {
        'claudecn/claude-opus-4-8': { alias: 'Opus' },
        'claudecn/claude-sonnet-5': { alias: 'Sonnet' },
        'claudecn/claude-haiku-4-5': { alias: 'Haiku' }
      }
    }
  },
  {
    provider: '火山agentplan',
    baseUrl: 'https://ark.cn-beijing.volces.com/api/coding/v3',
    model: 'ark-code-latest',
    models: ['ark-code-latest'],
    settingsConfig: {
      baseUrl: 'https://ark.cn-beijing.volces.com/api/coding/v3',
      apiKey: '',
      api: 'openai-completions',
      models: [{ id: 'ark-code-latest', name: 'Ark Code Latest', contextWindow: 256000 }]
    },
    suggestedDefaults: {
      model: { primary: 'ark_agentplan/ark-code-latest' },
      modelCatalog: { 'ark_agentplan/ark-code-latest': { alias: 'Ark Code' } }
    }
  },
  {
    provider: 'byteplus',
    baseUrl: 'https://ark.ap-southeast.bytepluses.com/api/coding/v3',
    model: 'ark-code-latest',
    models: ['ark-code-latest'],
    settingsConfig: {
      baseUrl: 'https://ark.ap-southeast.bytepluses.com/api/coding/v3',
      apiKey: '',
      api: 'openai-completions',
      models: [{ id: 'ark-code-latest', name: 'Ark Code Latest', contextWindow: 256000 }]
    },
    suggestedDefaults: {
      model: { primary: 'byteplus/ark-code-latest' },
      modelCatalog: { 'byteplus/ark-code-latest': { alias: 'Ark Code' } }
    }
  },
  {
    provider: 'doubaoseed',
    baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
    model: 'doubao-seed-2-1-pro-260628',
    models: ['doubao-seed-2-1-pro-260628'],
    settingsConfig: {
      baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
      apiKey: '',
      api: 'openai-completions',
      models: [
        {
          id: 'doubao-seed-2-1-pro-260628',
          name: 'DouBao Seed 2.1 Pro',
          contextWindow: 262144,
          cost: { input: 0.84, output: 4.2 }
        }
      ]
    },
    suggestedDefaults: {
      model: { primary: 'doubaoseed/doubao-seed-2-1-pro-260628' },
      modelCatalog: { 'doubaoseed/doubao-seed-2-1-pro-260628': { alias: 'DouBao' } }
    }
  },
  {
    provider: 'siliconflow',
    baseUrl: 'https://api.siliconflow.cn/v1',
    model: 'Pro/MiniMaxAI/MiniMax-M2.7',
    models: ['Pro/MiniMaxAI/MiniMax-M2.7'],
    settingsConfig: {
      baseUrl: 'https://api.siliconflow.cn/v1',
      apiKey: '',
      api: 'openai-completions',
      models: [
        {
          id: 'Pro/MiniMaxAI/MiniMax-M2.7',
          name: 'MiniMax M2.7',
          contextWindow: 200000,
          cost: { input: 0.3, output: 1.2, cacheRead: 0.06, cacheWrite: 0.375 }
        }
      ]
    },
    suggestedDefaults: {
      model: { primary: 'siliconflow/Pro/MiniMaxAI/MiniMax-M2.7' },
      modelCatalog: { 'siliconflow/Pro/MiniMaxAI/MiniMax-M2.7': { alias: 'MiniMax' } }
    }
  },
  {
    provider: 'siliconflow_en',
    baseUrl: 'https://api.siliconflow.com/v1',
    model: 'MiniMaxAI/MiniMax-M2.7',
    models: ['MiniMaxAI/MiniMax-M2.7'],
    settingsConfig: {
      baseUrl: 'https://api.siliconflow.com/v1',
      apiKey: '',
      api: 'openai-completions',
      models: [
        {
          id: 'MiniMaxAI/MiniMax-M2.7',
          name: 'MiniMax M2.7',
          contextWindow: 200000,
          cost: { input: 0.3, output: 1.2, cacheRead: 0.06, cacheWrite: 0.375 }
        }
      ]
    },
    suggestedDefaults: {
      model: { primary: 'siliconflow-en/MiniMaxAI/MiniMax-M2.7' },
      modelCatalog: { 'siliconflow-en/MiniMaxAI/MiniMax-M2.7': { alias: 'MiniMax' } }
    }
  },
  {
    provider: 'nekocode',
    baseUrl: 'https://nekocode.ai/v1',
    model: 'gpt-5.5',
    models: ['gpt-5.5'],
    settingsConfig: {
      baseUrl: 'https://nekocode.ai/v1',
      apiKey: '',
      api: 'openai-completions',
      models: [{ id: 'gpt-5.5', name: 'GPT-5.5', contextWindow: 400000 }]
    },
    suggestedDefaults: {
      model: { primary: 'nekocode/gpt-5.5' },
      modelCatalog: { 'nekocode/gpt-5.5': { alias: 'GPT-5.5' } }
    }
  },
  {
    provider: 'atlascloud',
    baseUrl: 'https://api.atlascloud.ai/v1',
    model: 'zai-org/glm-5.1',
    models: ['zai-org/glm-5.1'],
    settingsConfig: {
      baseUrl: 'https://api.atlascloud.ai/v1',
      apiKey: '',
      api: 'openai-completions',
      models: [{ id: 'zai-org/glm-5.1', name: 'GLM 5.1' }]
    },
    suggestedDefaults: { model: { primary: 'atlascloud/zai-org/glm-5.1' } }
  },
  {
    provider: 'compshare',
    baseUrl: 'https://api.modelverse.cn/v1',
    model: 'claude-opus-4-8',
    apiProtocol: 'anthropic-messages',
    models: ['claude-opus-4-8'],
    settingsConfig: {
      baseUrl: 'https://api.modelverse.cn/v1',
      apiKey: '',
      api: 'anthropic-messages',
      models: [
        {
          id: 'claude-opus-4-8',
          name: 'Claude Opus 4.8',
          contextWindow: 1000000,
          cost: { input: 5, output: 25 }
        }
      ]
    },
    suggestedDefaults: {
      model: { primary: 'compshare/claude-opus-4-8' },
      modelCatalog: { 'compshare/claude-opus-4-8': { alias: 'Opus' } }
    }
  },
  {
    provider: 'compshare_coding_plan',
    baseUrl: 'https://cp.compshare.cn/v1',
    model: 'claude-opus-4-8',
    apiProtocol: 'anthropic-messages',
    models: ['claude-opus-4-8'],
    settingsConfig: {
      baseUrl: 'https://cp.compshare.cn/v1',
      apiKey: '',
      api: 'anthropic-messages',
      models: [
        {
          id: 'claude-opus-4-8',
          name: 'Claude Opus 4.8',
          contextWindow: 1000000,
          cost: { input: 5, output: 25 }
        }
      ]
    },
    suggestedDefaults: {
      model: { primary: 'compshare-coding/claude-opus-4-8' },
      modelCatalog: { 'compshare-coding/claude-opus-4-8': { alias: 'Opus' } }
    }
  },
  {
    provider: 'ccsub',
    baseUrl: 'https://www.ccsub.net/v1',
    model: 'gpt-5.5',
    models: ['gpt-5.5'],
    settingsConfig: {
      baseUrl: 'https://www.ccsub.net/v1',
      apiKey: '',
      api: 'openai-completions',
      models: [
        { id: 'gpt-5.5', name: 'GPT-5.5', contextWindow: 400000, cost: { input: 5, output: 15 } }
      ]
    },
    suggestedDefaults: {
      model: { primary: 'ccsub/gpt-5.5' },
      modelCatalog: { 'ccsub/gpt-5.5': { alias: 'GPT-5.5' } }
    }
  },
  {
    provider: 'sssaicode',
    baseUrl: 'https://node-hk.sssaicodeapi.com/api',
    model: 'claude-opus-4-8',
    apiProtocol: 'anthropic-messages',
    models: ['claude-opus-4-8', 'claude-sonnet-5'],
    settingsConfig: {
      baseUrl: 'https://node-hk.sssaicodeapi.com/api',
      apiKey: '',
      api: 'anthropic-messages',
      models: [
        {
          id: 'claude-opus-4-8',
          name: 'Claude Opus 4.8',
          contextWindow: 1000000,
          cost: { input: 5, output: 25 }
        },
        {
          id: 'claude-sonnet-5',
          name: 'Claude Sonnet 5',
          contextWindow: 1000000,
          cost: { input: 3, output: 15 }
        }
      ]
    },
    suggestedDefaults: {
      model: { primary: 'sssaicode/claude-opus-4-8', fallbacks: ['sssaicode/claude-sonnet-5'] },
      modelCatalog: {
        'sssaicode/claude-opus-4-8': { alias: 'Opus' },
        'sssaicode/claude-sonnet-5': { alias: 'Sonnet' }
      }
    }
  },
  {
    provider: 'micu',
    baseUrl: 'https://www.micuapi.ai',
    model: 'claude-opus-4-8',
    apiProtocol: 'anthropic-messages',
    models: ['claude-opus-4-8'],
    settingsConfig: {
      baseUrl: 'https://www.micuapi.ai',
      apiKey: '',
      api: 'anthropic-messages',
      models: [
        {
          id: 'claude-opus-4-8',
          name: 'Claude Opus 4.8',
          contextWindow: 1000000,
          cost: { input: 5, output: 25 }
        }
      ]
    },
    suggestedDefaults: {
      model: { primary: 'micu/claude-opus-4-8' },
      modelCatalog: { 'micu/claude-opus-4-8': { alias: 'Opus' } }
    }
  },
  {
    provider: 'rightcode',
    baseUrl: 'https://www.right.codes/claude',
    model: 'claude-opus-4-8',
    apiProtocol: 'anthropic-messages',
    models: ['claude-opus-4-8', 'claude-sonnet-5'],
    settingsConfig: {
      baseUrl: 'https://www.right.codes/claude',
      apiKey: '',
      api: 'anthropic-messages',
      models: [
        {
          id: 'claude-opus-4-8',
          name: 'Claude Opus 4.8',
          contextWindow: 1000000,
          cost: { input: 5, output: 25 }
        },
        {
          id: 'claude-sonnet-5',
          name: 'Claude Sonnet 5',
          contextWindow: 1000000,
          cost: { input: 3, output: 15 }
        }
      ]
    },
    suggestedDefaults: {
      model: { primary: 'rightcode/claude-opus-4-8', fallbacks: ['rightcode/claude-sonnet-5'] },
      modelCatalog: {
        'rightcode/claude-opus-4-8': { alias: 'Opus' },
        'rightcode/claude-sonnet-5': { alias: 'Sonnet' }
      }
    }
  },
  {
    provider: 'etok_ai',
    baseUrl: 'https://api.etok.ai',
    model: 'claude-opus-4-8',
    apiProtocol: 'anthropic-messages',
    models: ['claude-opus-4-8'],
    settingsConfig: {
      baseUrl: 'https://api.etok.ai',
      apiKey: '',
      api: 'anthropic-messages',
      models: [
        {
          id: 'claude-opus-4-8',
          name: 'Claude Opus 4.8',
          contextWindow: 1000000,
          cost: { input: 5, output: 25 }
        }
      ]
    },
    suggestedDefaults: {
      model: { primary: 'etok/claude-opus-4-8' },
      modelCatalog: { 'etok/claude-opus-4-8': { alias: 'Opus' } }
    }
  },
  {
    provider: 'cubence',
    baseUrl: 'https://api.cubence.com',
    model: 'claude-opus-4-8',
    apiProtocol: 'anthropic-messages',
    models: ['claude-opus-4-8', 'claude-sonnet-5'],
    settingsConfig: {
      baseUrl: 'https://api.cubence.com',
      apiKey: '',
      api: 'anthropic-messages',
      models: [
        {
          id: 'claude-opus-4-8',
          name: 'Claude Opus 4.8',
          contextWindow: 1000000,
          cost: { input: 5, output: 25 }
        },
        {
          id: 'claude-sonnet-5',
          name: 'Claude Sonnet 5',
          contextWindow: 1000000,
          cost: { input: 3, output: 15 }
        }
      ]
    },
    suggestedDefaults: {
      model: { primary: 'cubence/claude-opus-4-8', fallbacks: ['cubence/claude-sonnet-5'] },
      modelCatalog: {
        'cubence/claude-opus-4-8': { alias: 'Opus' },
        'cubence/claude-sonnet-5': { alias: 'Sonnet' }
      }
    }
  },
  {
    provider: 'crazyrouter',
    baseUrl: 'https://cn.crazyrouter.com/v1',
    model: 'claude-opus-4-8',
    apiProtocol: 'anthropic-messages',
    models: ['claude-opus-4-8', 'claude-sonnet-5'],
    settingsConfig: {
      baseUrl: 'https://cn.crazyrouter.com/v1',
      apiKey: '',
      api: 'anthropic-messages',
      models: [
        {
          id: 'claude-opus-4-8',
          name: 'Claude Opus 4.8',
          contextWindow: 1000000,
          cost: { input: 5, output: 25 }
        },
        {
          id: 'claude-sonnet-5',
          name: 'Claude Sonnet 5',
          contextWindow: 1000000,
          cost: { input: 3, output: 15 }
        }
      ]
    },
    suggestedDefaults: {
      model: { primary: 'crazyrouter/claude-opus-4-8', fallbacks: ['crazyrouter/claude-sonnet-5'] },
      modelCatalog: {
        'crazyrouter/claude-opus-4-8': { alias: 'Opus' },
        'crazyrouter/claude-sonnet-5': { alias: 'Sonnet' }
      }
    }
  },
  {
    provider: 'dmxapi',
    baseUrl: 'https://www.dmxapi.cn',
    model: 'claude-opus-4-8',
    apiProtocol: 'anthropic-messages',
    models: ['claude-opus-4-8', 'claude-sonnet-5'],
    settingsConfig: {
      baseUrl: 'https://www.dmxapi.cn',
      apiKey: '',
      api: 'anthropic-messages',
      models: [
        {
          id: 'claude-opus-4-8',
          name: 'Claude Opus 4.8',
          contextWindow: 1000000,
          cost: { input: 5, output: 25 }
        },
        {
          id: 'claude-sonnet-5',
          name: 'Claude Sonnet 5',
          contextWindow: 1000000,
          cost: { input: 3, output: 15 }
        }
      ]
    },
    suggestedDefaults: {
      model: { primary: 'dmxapi/claude-opus-4-8', fallbacks: ['dmxapi/claude-sonnet-5'] },
      modelCatalog: {
        'dmxapi/claude-opus-4-8': { alias: 'Opus' },
        'dmxapi/claude-sonnet-5': { alias: 'Sonnet' }
      }
    }
  },
  {
    provider: 'qiniu',
    baseUrl: 'https://api.qnaigc.com/v1',
    model: 'gpt-5.5',
    models: ['gpt-5.5'],
    settingsConfig: {
      baseUrl: 'https://api.qnaigc.com/v1',
      apiKey: '',
      api: 'openai-completions',
      models: [{ id: 'gpt-5.5', name: 'GPT-5.5', contextWindow: 400000 }]
    },
    suggestedDefaults: {
      model: { primary: 'qiniu/gpt-5.5' },
      modelCatalog: { 'qiniu/gpt-5.5': { alias: 'GPT-5.5' } }
    }
  },
  {
    provider: 'sudocode_chat',
    baseUrl: 'https://api.sudocode.chat/v1',
    model: 'gpt-5.6-sol',
    apiProtocol: 'openai-responses',
    models: ['gpt-5.6-sol'],
    settingsConfig: {
      baseUrl: 'https://api.sudocode.chat/v1',
      apiKey: '',
      api: 'openai-responses',
      models: [{ id: 'gpt-5.6-sol', name: 'GPT-5.6 Sol' }]
    },
    suggestedDefaults: { model: { primary: 'sudocode/gpt-5.6-sol' } }
  },
  {
    provider: 'sudocode_us',
    baseUrl: 'https://sudocode.us/v1',
    model: 'gpt-5.5',
    apiProtocol: 'openai-responses',
    models: ['gpt-5.5'],
    settingsConfig: {
      baseUrl: 'https://sudocode.us/v1',
      apiKey: '',
      api: 'openai-responses',
      models: [{ id: 'gpt-5.5', name: 'GPT-5.5' }]
    },
    suggestedDefaults: { model: { primary: 'sudocode-us/gpt-5.5' } }
  },
  {
    provider: 'amux',
    baseUrl: 'https://api.amux.ai/v1',
    model: 'gpt-5.5',
    models: ['gpt-5.5'],
    settingsConfig: {
      baseUrl: 'https://api.amux.ai/v1',
      apiKey: '',
      api: 'openai-completions',
      models: [{ id: 'gpt-5.5', name: 'GPT-5.5', contextWindow: 400000 }]
    },
    suggestedDefaults: {
      model: { primary: 'amux/gpt-5.5' },
      modelCatalog: { 'amux/gpt-5.5': { alias: 'GPT-5.5' } }
    }
  },
  {
    provider: 'deepseek',
    baseUrl: 'https://api.deepseek.com/v1',
    model: 'deepseek-v4-pro',
    models: ['deepseek-v4-pro', 'deepseek-v4-flash'],
    settingsConfig: {
      baseUrl: 'https://api.deepseek.com/v1',
      apiKey: '',
      api: 'openai-completions',
      models: [
        {
          id: 'deepseek-v4-pro',
          name: 'DeepSeek V4 Pro',
          contextWindow: 1000000,
          cost: { input: 0.435, output: 0.87, cacheRead: 0.003625 }
        },
        {
          id: 'deepseek-v4-flash',
          name: 'DeepSeek V4 Flash',
          contextWindow: 1000000,
          cost: { input: 0.14, output: 0.28 }
        }
      ]
    },
    suggestedDefaults: {
      model: { primary: 'deepseek/deepseek-v4-flash', fallbacks: ['deepseek/deepseek-v4-pro'] },
      modelCatalog: {
        'deepseek/deepseek-v4-flash': { alias: 'Flash' },
        'deepseek/deepseek-v4-pro': { alias: 'Pro' }
      }
    }
  },
  {
    provider: 'zhipu_glm',
    baseUrl: 'https://open.bigmodel.cn/api/coding/paas/v4',
    model: 'glm-5.1',
    models: ['glm-5.1'],
    settingsConfig: {
      baseUrl: 'https://open.bigmodel.cn/api/coding/paas/v4',
      apiKey: '',
      api: 'openai-completions',
      models: [
        {
          id: 'glm-5.1',
          name: 'GLM-5.1',
          contextWindow: 128000,
          cost: { input: 1.4, output: 4.4, cacheRead: 0.26 }
        }
      ]
    },
    suggestedDefaults: {
      model: { primary: 'zhipu/glm-5.1' },
      modelCatalog: { 'zhipu/glm-5.1': { alias: 'GLM' } }
    }
  },
  {
    provider: 'zhipu_glm_en',
    baseUrl: 'https://api.z.ai/api/coding/paas/v4',
    model: 'glm-5.1',
    models: ['glm-5.1'],
    settingsConfig: {
      baseUrl: 'https://api.z.ai/api/coding/paas/v4',
      apiKey: '',
      api: 'openai-completions',
      models: [
        {
          id: 'glm-5.1',
          name: 'GLM-5.1',
          contextWindow: 128000,
          cost: { input: 1.4, output: 4.4, cacheRead: 0.26 }
        }
      ]
    },
    suggestedDefaults: {
      model: { primary: 'zhipu-en/glm-5.1' },
      modelCatalog: { 'zhipu-en/glm-5.1': { alias: 'GLM' } }
    }
  },
  {
    provider: 'qwen_coder',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    model: 'qwen3.5-plus',
    models: ['qwen3.5-plus'],
    settingsConfig: {
      baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
      apiKey: '',
      api: 'openai-completions',
      models: [
        {
          id: 'qwen3.5-plus',
          name: 'Qwen3.5 Plus',
          contextWindow: 32000,
          cost: { input: 0.26, output: 1.56, cacheRead: 0.052 }
        }
      ]
    },
    suggestedDefaults: {
      model: { primary: 'qwen/qwen3.5-plus' },
      modelCatalog: { 'qwen/qwen3.5-plus': { alias: 'Qwen' } }
    }
  },
  {
    provider: 'bailian_token_plan',
    baseUrl: 'https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1',
    model: 'qwen3.8-max',
    models: ['qwen3.8-max'],
    settingsConfig: {
      baseUrl: 'https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1',
      apiKey: '',
      api: 'openai-completions',
      models: [{ id: 'qwen3.8-max', name: 'Qwen3.8 Max' }]
    },
    suggestedDefaults: {
      model: { primary: 'bailian-token-plan/qwen3.8-max' },
      modelCatalog: { 'bailian-token-plan/qwen3.8-max': { alias: 'Qwen' } }
    }
  },
  {
    provider: 'stepfun',
    baseUrl: 'https://api.stepfun.com/step_plan/v1',
    model: 'step-3.5-flash-2603',
    models: ['step-3.5-flash-2603', 'step-3.5-flash'],
    settingsConfig: {
      baseUrl: 'https://api.stepfun.com/step_plan/v1',
      apiKey: '',
      api: 'openai-completions',
      models: [
        { id: 'step-3.5-flash-2603', name: 'Step 3.5 Flash 2603', contextWindow: 262144 },
        { id: 'step-3.5-flash', name: 'Step 3.5 Flash', contextWindow: 262144 }
      ]
    },
    suggestedDefaults: {
      model: { primary: 'stepfun/step-3.5-flash-2603' },
      modelCatalog: {
        'stepfun/step-3.5-flash-2603': { alias: 'StepFun' },
        'stepfun/step-3.5-flash': { alias: 'StepFun Flash' }
      }
    }
  },
  {
    provider: 'stepfun_en',
    baseUrl: 'https://api.stepfun.ai/step_plan/v1',
    model: 'step-3.5-flash-2603',
    models: ['step-3.5-flash-2603', 'step-3.5-flash'],
    settingsConfig: {
      baseUrl: 'https://api.stepfun.ai/step_plan/v1',
      apiKey: '',
      api: 'openai-completions',
      models: [
        { id: 'step-3.5-flash-2603', name: 'Step 3.5 Flash 2603', contextWindow: 262144 },
        { id: 'step-3.5-flash', name: 'Step 3.5 Flash', contextWindow: 262144 }
      ]
    },
    suggestedDefaults: {
      model: { primary: 'stepfun-en/step-3.5-flash-2603' },
      modelCatalog: {
        'stepfun-en/step-3.5-flash-2603': { alias: 'StepFun' },
        'stepfun-en/step-3.5-flash': { alias: 'StepFun Flash' }
      }
    }
  },
  {
    provider: 'minimax',
    baseUrl: 'https://api.minimaxi.com/v1',
    model: 'MiniMax-M2.7',
    models: ['MiniMax-M2.7'],
    settingsConfig: {
      baseUrl: 'https://api.minimaxi.com/v1',
      apiKey: '',
      api: 'openai-completions',
      models: [
        {
          id: 'MiniMax-M2.7',
          name: 'MiniMax M2.7',
          contextWindow: 200000,
          cost: { input: 0.3, output: 1.2, cacheRead: 0.06, cacheWrite: 0.375 }
        }
      ]
    },
    suggestedDefaults: {
      model: { primary: 'minimax/MiniMax-M2.7' },
      modelCatalog: { 'minimax/MiniMax-M2.7': { alias: 'MiniMax' } }
    }
  },
  {
    provider: 'minimax_en',
    baseUrl: 'https://api.minimax.io/v1',
    model: 'MiniMax-M2.7',
    models: ['MiniMax-M2.7'],
    settingsConfig: {
      baseUrl: 'https://api.minimax.io/v1',
      apiKey: '',
      api: 'openai-completions',
      models: [
        {
          id: 'MiniMax-M2.7',
          name: 'MiniMax M2.7',
          contextWindow: 200000,
          cost: { input: 0.3, output: 1.2, cacheRead: 0.06, cacheWrite: 0.375 }
        }
      ]
    },
    suggestedDefaults: {
      model: { primary: 'minimax-en/MiniMax-M2.7' },
      modelCatalog: { 'minimax-en/MiniMax-M2.7': { alias: 'MiniMax' } }
    }
  },
  {
    provider: 'kat_coder',
    baseUrl: 'https://vanchin.streamlake.ai/api/gateway/v1/endpoints/${ENDPOINT_ID}/openai',
    model: 'KAT-Coder-Pro',
    models: ['KAT-Coder-Pro'],
    settingsConfig: {
      baseUrl: 'https://vanchin.streamlake.ai/api/gateway/v1/endpoints/${ENDPOINT_ID}/openai',
      apiKey: '',
      api: 'openai-completions',
      models: [
        {
          id: 'KAT-Coder-Pro',
          name: 'KAT-Coder Pro',
          contextWindow: 128000,
          cost: { input: 0.3, output: 1.2, cacheRead: 0.06 }
        }
      ]
    },
    suggestedDefaults: {
      model: { primary: 'katcoder/KAT-Coder-Pro' },
      modelCatalog: { 'katcoder/KAT-Coder-Pro': { alias: 'KAT-Coder' } }
    }
  },
  {
    provider: 'longcat',
    baseUrl: 'https://api.longcat.chat/openai/v1',
    model: 'LongCat-2.0',
    models: ['LongCat-2.0'],
    settingsConfig: {
      baseUrl: 'https://api.longcat.chat/openai/v1',
      apiKey: '',
      api: 'openai-completions',
      authHeader: true,
      models: [
        {
          id: 'LongCat-2.0',
          name: 'LongCat 2.0',
          reasoning: false,
          input: ['text'],
          contextWindow: 1048576,
          maxTokens: 131072,
          compat: { maxTokensField: 'max_tokens' },
          cost: { input: 0.75, output: 2.95, cacheRead: 0.015 }
        }
      ]
    },
    suggestedDefaults: {
      model: { primary: 'longcat/LongCat-2.0' },
      modelCatalog: { 'longcat/LongCat-2.0': { alias: 'LongCat' } }
    }
  },
  {
    provider: 'bailing',
    baseUrl: 'https://api.tbox.cn/v1',
    model: 'Ling-2.5-1T',
    models: ['Ling-2.5-1T'],
    settingsConfig: {
      baseUrl: 'https://api.tbox.cn/v1',
      apiKey: '',
      api: 'openai-completions',
      models: [
        {
          id: 'Ling-2.5-1T',
          name: 'Ling 2.5 1T',
          contextWindow: 128000,
          cost: { input: 0.56, output: 2.24 }
        }
      ]
    },
    suggestedDefaults: {
      model: { primary: 'bailing/Ling-2.5-1T' },
      modelCatalog: { 'bailing/Ling-2.5-1T': { alias: 'BaiLing' } }
    }
  },
  {
    provider: 'xiaomi_mimo',
    baseUrl: 'https://api.xiaomimimo.com/v1',
    model: 'mimo-v2.5-pro',
    models: ['mimo-v2.5-pro'],
    settingsConfig: {
      baseUrl: 'https://api.xiaomimimo.com/v1',
      apiKey: '',
      api: 'openai-completions',
      models: [
        {
          id: 'mimo-v2.5-pro',
          name: 'MiMo V2.5 Pro',
          reasoning: true,
          input: ['text'],
          contextWindow: 1048576,
          maxTokens: 131072,
          cost: { input: 1, output: 3, cacheRead: 0.2, cacheWrite: 0 }
        }
      ]
    },
    suggestedDefaults: {
      model: { primary: 'xiaomimimo/mimo-v2.5-pro' },
      modelCatalog: { 'xiaomimimo/mimo-v2.5-pro': { alias: 'MiMo' } }
    }
  },
  {
    provider: 'xiaomi_mimo_token_plan_china',
    baseUrl: 'https://token-plan-cn.xiaomimimo.com/v1',
    model: 'mimo-v2.5-pro',
    models: ['mimo-v2.5-pro', 'mimo-v2.5'],
    settingsConfig: {
      baseUrl: 'https://token-plan-cn.xiaomimimo.com/v1',
      apiKey: '',
      api: 'openai-completions',
      models: [
        {
          id: 'mimo-v2.5-pro',
          name: 'MiMo V2.5 Pro',
          reasoning: true,
          input: ['text'],
          contextWindow: 1048576,
          maxTokens: 131072
        },
        {
          id: 'mimo-v2.5',
          name: 'MiMo V2.5',
          reasoning: true,
          input: ['text', 'image'],
          contextWindow: 1048576,
          maxTokens: 131072
        }
      ]
    },
    suggestedDefaults: {
      model: { primary: 'xiaomi-mimo-token-plan/mimo-v2.5-pro' },
      modelCatalog: {
        'xiaomi-mimo-token-plan/mimo-v2.5-pro': { alias: 'MiMo Token Plan (China)' },
        'xiaomi-mimo-token-plan/mimo-v2.5': { alias: 'MiMo Token Plan (China) Multimodal' }
      }
    }
  },
  {
    provider: 'aihubmix',
    baseUrl: 'https://aihubmix.com',
    model: 'claude-opus-4-8',
    apiProtocol: 'anthropic-messages',
    models: ['claude-opus-4-8', 'claude-sonnet-5'],
    settingsConfig: {
      baseUrl: 'https://aihubmix.com',
      apiKey: '',
      api: 'anthropic-messages',
      models: [
        {
          id: 'claude-opus-4-8',
          name: 'Claude Opus 4.8',
          contextWindow: 1000000,
          cost: { input: 5, output: 25 }
        },
        {
          id: 'claude-sonnet-5',
          name: 'Claude Sonnet 5',
          contextWindow: 1000000,
          cost: { input: 3, output: 15 }
        }
      ]
    },
    suggestedDefaults: {
      model: { primary: 'aihubmix/claude-opus-4-8', fallbacks: ['aihubmix/claude-sonnet-5'] },
      modelCatalog: {
        'aihubmix/claude-opus-4-8': { alias: 'Opus' },
        'aihubmix/claude-sonnet-5': { alias: 'Sonnet' }
      }
    }
  },
  {
    provider: 'cherryin',
    baseUrl: 'https://open.cherryin.net',
    model: 'anthropic/claude-opus-4.8',
    apiProtocol: 'anthropic-messages',
    models: ['anthropic/claude-opus-4.8', 'anthropic/claude-sonnet-5'],
    settingsConfig: {
      baseUrl: 'https://open.cherryin.net',
      apiKey: '',
      api: 'anthropic-messages',
      models: [
        { id: 'anthropic/claude-opus-4.8', name: 'Claude Opus 4.8', contextWindow: 1000000 },
        { id: 'anthropic/claude-sonnet-5', name: 'Claude Sonnet 5', contextWindow: 1000000 }
      ]
    },
    suggestedDefaults: {
      model: {
        primary: 'cherryin/anthropic/claude-opus-4.8',
        fallbacks: ['cherryin/anthropic/claude-sonnet-5']
      },
      modelCatalog: {
        'cherryin/anthropic/claude-opus-4.8': { alias: 'Opus' },
        'cherryin/anthropic/claude-sonnet-5': { alias: 'Sonnet' }
      }
    }
  },
  {
    provider: 'openrouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    model: 'anthropic/claude-opus-4.8',
    models: ['anthropic/claude-opus-4.8', 'anthropic/claude-sonnet-5'],
    settingsConfig: {
      baseUrl: 'https://openrouter.ai/api/v1',
      apiKey: '',
      api: 'openai-completions',
      models: [
        {
          id: 'anthropic/claude-opus-4.8',
          name: 'Claude Opus 4.8',
          contextWindow: 1000000,
          cost: { input: 5, output: 25 }
        },
        {
          id: 'anthropic/claude-sonnet-5',
          name: 'Claude Sonnet 5',
          contextWindow: 1000000,
          cost: { input: 3, output: 15 }
        }
      ]
    },
    suggestedDefaults: {
      model: {
        primary: 'openrouter/anthropic/claude-opus-4.8',
        fallbacks: ['openrouter/anthropic/claude-sonnet-5']
      },
      modelCatalog: {
        'openrouter/anthropic/claude-opus-4.8': { alias: 'Opus' },
        'openrouter/anthropic/claude-sonnet-5': { alias: 'Sonnet' }
      }
    }
  },
  {
    provider: 'therouter',
    baseUrl: 'https://api.therouter.ai/v1',
    model: 'anthropic/claude-sonnet-5',
    models: [
      'anthropic/claude-sonnet-5',
      'openai/gpt-5.3-codex',
      'openai/gpt-5.2',
      'google/gemini-3.5-flash',
      'qwen/qwen3-coder-480b'
    ],
    settingsConfig: {
      baseUrl: 'https://api.therouter.ai/v1',
      apiKey: '',
      api: 'openai-completions',
      models: [
        {
          id: 'anthropic/claude-sonnet-5',
          name: 'Claude Sonnet 5',
          contextWindow: 1000000,
          cost: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 }
        },
        {
          id: 'openai/gpt-5.3-codex',
          name: 'GPT-5.3 Codex',
          contextWindow: 400000,
          cost: { input: 5, output: 40, cacheRead: 0.5 }
        },
        {
          id: 'openai/gpt-5.2',
          name: 'GPT-5.2',
          contextWindow: 400000,
          cost: { input: 1.75, output: 14, cacheRead: 0.175 }
        },
        {
          id: 'google/gemini-3.5-flash',
          name: 'Gemini 3.5 Flash',
          contextWindow: 1000000,
          cost: { input: 1.5, output: 9, cacheRead: 0.15 }
        },
        {
          id: 'qwen/qwen3-coder-480b',
          name: 'Qwen3 Coder 480B',
          contextWindow: 262144,
          cost: { input: 0.6, output: 2.35 }
        }
      ]
    },
    suggestedDefaults: {
      model: {
        primary: 'therouter/anthropic/claude-sonnet-5',
        fallbacks: ['therouter/openai/gpt-5.2', 'therouter/google/gemini-3.5-flash']
      },
      modelCatalog: {
        'therouter/anthropic/claude-sonnet-5': { alias: 'Sonnet' },
        'therouter/openai/gpt-5.2': { alias: 'GPT-5.2' },
        'therouter/google/gemini-3.5-flash': { alias: 'Gemini Flash' },
        'therouter/openai/gpt-5.3-codex': { alias: 'Codex' },
        'therouter/qwen/qwen3-coder-480b': { alias: 'Qwen Coder' }
      }
    }
  },
  {
    provider: 'modelscope',
    baseUrl: 'https://api-inference.modelscope.cn/v1',
    model: 'ZhipuAI/GLM-5.1',
    models: ['ZhipuAI/GLM-5.1'],
    settingsConfig: {
      baseUrl: 'https://api-inference.modelscope.cn/v1',
      apiKey: '',
      api: 'openai-completions',
      models: [
        {
          id: 'ZhipuAI/GLM-5.1',
          name: 'GLM-5.1',
          contextWindow: 128000,
          cost: { input: 1.4, output: 4.4, cacheRead: 0.26 }
        }
      ]
    },
    suggestedDefaults: {
      model: { primary: 'modelscope/ZhipuAI/GLM-5.1' },
      modelCatalog: { 'modelscope/ZhipuAI/GLM-5.1': { alias: 'GLM' } }
    }
  },
  {
    provider: 'novita_ai',
    baseUrl: 'https://api.novita.ai/openai',
    model: 'zai-org/glm-5.1',
    models: ['zai-org/glm-5.1'],
    settingsConfig: {
      baseUrl: 'https://api.novita.ai/openai',
      apiKey: '',
      api: 'openai-completions',
      models: [
        {
          id: 'zai-org/glm-5.1',
          name: 'GLM-5.1',
          contextWindow: 202800,
          cost: { input: 1, output: 3.2, cacheRead: 0.2 }
        }
      ]
    },
    suggestedDefaults: {
      model: { primary: 'novita/zai-org/glm-5.1' },
      modelCatalog: { 'novita/zai-org/glm-5.1': { alias: 'GLM-5.1' } }
    }
  },
  {
    provider: 'nvidia',
    baseUrl: 'https://integrate.api.nvidia.com/v1',
    model: 'moonshotai/kimi-k2.5',
    models: ['moonshotai/kimi-k2.5'],
    settingsConfig: {
      baseUrl: 'https://integrate.api.nvidia.com/v1',
      apiKey: '',
      api: 'openai-completions',
      models: [
        {
          id: 'moonshotai/kimi-k2.5',
          name: 'Kimi K2.5',
          contextWindow: 131072,
          cost: { input: 0.6, output: 3, cacheRead: 0.1 }
        }
      ]
    },
    suggestedDefaults: {
      model: { primary: 'nvidia/moonshotai/kimi-k2.5' },
      modelCatalog: { 'nvidia/moonshotai/kimi-k2.5': { alias: 'Kimi' } }
    }
  },
  {
    provider: 'pipellm',
    baseUrl: 'https://cc-api.pipellm.ai',
    model: 'claude-opus-4-8',
    apiProtocol: 'anthropic-messages',
    models: ['claude-opus-4-8', 'claude-sonnet-5', 'claude-haiku-4-5-20251001'],
    settingsConfig: {
      baseUrl: 'https://cc-api.pipellm.ai',
      apiKey: '',
      api: 'anthropic-messages',
      models: [
        {
          id: 'claude-opus-4-8',
          name: 'claude-opus-4-8',
          contextWindow: 1000000,
          cost: { input: 5, output: 25 }
        },
        {
          id: 'claude-sonnet-5',
          name: 'claude-sonnet-5',
          contextWindow: 1000000,
          cost: { input: 3, output: 15 }
        },
        {
          id: 'claude-haiku-4-5-20251001',
          name: 'claude-haiku-4-5-20251001',
          contextWindow: 200000,
          cost: { input: 0.8, output: 4 }
        }
      ]
    },
    suggestedDefaults: {
      model: { primary: 'pipellm/claude-opus-4-8', fallbacks: ['pipellm/claude-sonnet-5'] },
      modelCatalog: {
        'pipellm/claude-opus-4-8': { alias: 'Opus' },
        'pipellm/claude-sonnet-5': { alias: 'Sonnet' },
        'pipellm/claude-haiku-4-5-20251001': { alias: 'Haiku' }
      }
    }
  },
  {
    provider: 'e_flowcode',
    baseUrl: 'https://e-flowcode.cc/v1',
    model: 'gpt-5.3-codex',
    apiProtocol: 'openai-responses',
    models: ['gpt-5.3-codex', 'gpt-5.5', 'gpt-5.2-codex', 'gpt-5.2'],
    settingsConfig: {
      api: 'openai-responses',
      apiKey: '',
      baseUrl: 'https://e-flowcode.cc/v1',
      headers: { 'User-Agent': 'codex_cli_rs/0.77.0 (Windows 10.0.26100; x86_64) WindowsTerminal' },
      models: [
        {
          contextWindow: 200000,
          cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0 },
          id: 'gpt-5.3-codex',
          maxTokens: 32000,
          name: 'gpt-5.3-codex'
        },
        { id: 'gpt-5.5', name: 'gpt-5.5' },
        { id: 'gpt-5.2-codex', name: 'gpt-5.2-codex' },
        { id: 'gpt-5.2', name: 'gpt-5.2' }
      ]
    },
    suggestedDefaults: {
      model: {
        primary: 'eflowcode/gpt-5.3-codex',
        fallbacks: ['eflowcode/gpt-5.5', 'eflowcode/gpt-5.2-codex']
      },
      modelCatalog: {
        'eflowcode/gpt-5.3-codex': { alias: 'gpt-5.3-codex' },
        'eflowcode/gpt-5.5': { alias: 'gpt-5.5' },
        'eflowcode/gpt-5.2-codex': { alias: 'gpt-5.2-codex' },
        'eflowcode/gpt-5.2': { alias: 'gpt-5.2' }
      }
    }
  },
  {
    provider: 'aws_bedrock',
    baseUrl: 'https://bedrock-runtime.us-west-2.amazonaws.com',
    model: 'anthropic.claude-opus-4-8',
    apiProtocol: 'bedrock-converse-stream',
    models: [
      'anthropic.claude-opus-4-8',
      'anthropic.claude-sonnet-5',
      'anthropic.claude-haiku-4-5-20251022-v1:0'
    ],
    settingsConfig: {
      baseUrl: 'https://bedrock-runtime.us-west-2.amazonaws.com',
      apiKey: '',
      api: 'bedrock-converse-stream',
      models: [
        {
          id: 'anthropic.claude-opus-4-8',
          name: 'Claude Opus 4.8',
          contextWindow: 1000000,
          cost: { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 }
        },
        {
          id: 'anthropic.claude-sonnet-5',
          name: 'Claude Sonnet 5',
          contextWindow: 1000000,
          cost: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 }
        },
        {
          id: 'anthropic.claude-haiku-4-5-20251022-v1:0',
          name: 'Claude Haiku 4.5',
          contextWindow: 200000,
          cost: { input: 0.8, output: 4, cacheRead: 0.08, cacheWrite: 1 }
        }
      ]
    }
  }
];
