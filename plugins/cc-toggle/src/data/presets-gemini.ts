// Gemini presets - only diff from defaults; merged with providers.js at runtime
export default [
  { provider: 'google_official' },
  {
    provider: 'packycode',
    baseUrl: 'https://www.packyapi.com',
    model: 'gemini-3.5-flash',
    endpointCandidates: ['https://api-slb.packyapi.com', 'https://www.packyapi.com'],
    settingsConfig: {
      env: { GOOGLE_GEMINI_BASE_URL: 'https://www.packyapi.com', GEMINI_MODEL: 'gemini-3.5-flash' }
    }
  },
  {
    provider: 'apinebula',
    baseUrl: 'https://apinebula.com',
    model: 'gemini-3.5-flash',
    endpointCandidates: ['https://apinebula.com'],
    settingsConfig: {
      env: {
        GOOGLE_GEMINI_BASE_URL: 'https://apinebula.com',
        GEMINI_API_KEY: '',
        GEMINI_MODEL: 'gemini-3.5-flash'
      }
    }
  },
  {
    provider: 'aicodemirror',
    baseUrl: 'https://api.aicodemirror.com/api/gemini',
    model: 'gemini-3.5-flash',
    endpointCandidates: [
      'https://api.aicodemirror.com/api/gemini',
      'https://api.claudecode.net.cn/api/gemini'
    ],
    settingsConfig: {
      env: {
        GOOGLE_GEMINI_BASE_URL: 'https://api.aicodemirror.com/api/gemini',
        GEMINI_MODEL: 'gemini-3.5-flash'
      }
    }
  },
  {
    provider: 'unity2_ai',
    baseUrl: 'https://api.unity2.ai',
    model: 'gemini-3.1-pro',
    settingsConfig: {
      env: { GOOGLE_GEMINI_BASE_URL: 'https://api.unity2.ai', GEMINI_MODEL: 'gemini-3.1-pro' }
    }
  },
  {
    provider: 'shengsuanyun',
    baseUrl: 'https://router.shengsuanyun.com/api',
    model: 'google/gemini-3.5-flash',
    settingsConfig: {
      env: {
        GOOGLE_GEMINI_BASE_URL: 'https://router.shengsuanyun.com/api',
        GEMINI_MODEL: 'google/gemini-3.5-flash'
      }
    }
  },
  {
    provider: 'aigocode',
    baseUrl: 'https://api.aigocode.com',
    model: 'gemini-3.5-flash',
    endpointCandidates: ['https://api.aigocode.com'],
    settingsConfig: {
      env: { GOOGLE_GEMINI_BASE_URL: 'https://api.aigocode.com', GEMINI_MODEL: 'gemini-3.5-flash' }
    }
  },
  {
    provider: 'subrouter',
    baseUrl: 'https://subrouter.ai/v1beta',
    model: 'gemini-3.5-flash',
    endpointCandidates: ['https://subrouter.ai/v1beta'],
    settingsConfig: {
      env: {
        GOOGLE_GEMINI_BASE_URL: 'https://subrouter.ai/v1beta',
        GEMINI_MODEL: 'gemini-3.5-flash'
      }
    }
  },
  {
    provider: 'apikey_fun',
    baseUrl: 'https://api.apikey.fun',
    model: 'gemini-3.5-flash',
    endpointCandidates: ['https://api.apikey.fun', 'https://slb.apikey.fun'],
    settingsConfig: {
      env: {
        GOOGLE_GEMINI_BASE_URL: 'https://api.apikey.fun',
        GEMINI_API_KEY: '',
        GEMINI_MODEL: 'gemini-3.5-flash'
      }
    }
  },
  {
    provider: 'code0',
    baseUrl: 'https://code0.ai',
    model: 'gemini-3.1-pro-preview',
    settingsConfig: {
      env: { GOOGLE_GEMINI_BASE_URL: 'https://code0.ai', GEMINI_MODEL: 'gemini-3.1-pro-preview' }
    }
  },
  {
    provider: 'sssaicode',
    baseUrl: 'https://node-hk.sssaicodeapi.com/api',
    model: 'gemini-3.5-flash',
    endpointCandidates: [
      'https://node-hk.sssaicodeapi.com/api',
      'https://node-hk.sssaiapi.com/api',
      'https://node-cf.sssaicodeapi.com/api'
    ],
    settingsConfig: {
      env: {
        GOOGLE_GEMINI_BASE_URL: 'https://node-hk.sssaicodeapi.com/api',
        GEMINI_MODEL: 'gemini-3.5-flash'
      }
    }
  },
  {
    provider: 'etok_ai',
    baseUrl: 'https://api.etok.ai/v1beta',
    model: 'gemini-3.5-flash',
    endpointCandidates: ['https://api.etok.ai/v1beta'],
    settingsConfig: {
      env: {
        GOOGLE_GEMINI_BASE_URL: 'https://api.etok.ai/v1beta',
        GEMINI_MODEL: 'gemini-3.5-flash'
      }
    }
  },
  {
    provider: 'cubence',
    baseUrl: 'https://api.cubence.com',
    model: 'gemini-3.5-flash',
    endpointCandidates: [
      'https://api.cubence.com/v1',
      'https://api-cf.cubence.com/v1',
      'https://api-dmit.cubence.com/v1',
      'https://api-bwg.cubence.com/v1'
    ],
    settingsConfig: {
      env: { GOOGLE_GEMINI_BASE_URL: 'https://api.cubence.com', GEMINI_MODEL: 'gemini-3.5-flash' }
    }
  },
  {
    provider: 'crazyrouter',
    baseUrl: 'https://cn.crazyrouter.com',
    model: 'gemini-3.5-flash',
    endpointCandidates: ['https://cn.crazyrouter.com'],
    settingsConfig: {
      env: {
        GOOGLE_GEMINI_BASE_URL: 'https://cn.crazyrouter.com',
        GEMINI_MODEL: 'gemini-3.5-flash'
      }
    }
  },
  {
    provider: 'qiniu',
    baseUrl: 'https://api.qnaigc.com/bypass/vertex',
    model: 'gemini-3.1-pro-preview',
    endpointCandidates: [
      'https://api.qnaigc.com/bypass/vertex',
      'https://api.modelink.ai/bypass/vertex'
    ],
    settingsConfig: {
      env: {
        GOOGLE_GEMINI_BASE_URL: 'https://api.qnaigc.com/bypass/vertex',
        GEMINI_MODEL: 'gemini-3.1-pro-preview'
      }
    }
  },
  {
    provider: 'sudocode_us',
    baseUrl: 'https://sudocode.us',
    model: 'gemini-3.1-flash-lite',
    endpointCandidates: ['https://sudocode.us', 'https://sudocode.run'],
    settingsConfig: {
      env: {
        GOOGLE_GEMINI_BASE_URL: 'https://sudocode.us',
        GEMINI_API_KEY: '',
        GEMINI_MODEL: 'gemini-3.1-flash-lite'
      }
    }
  },
  {
    provider: 'e_flowcode',
    baseUrl: 'https://e-flowcode.cc',
    model: 'gemini-3.5-flash',
    endpointCandidates: ['https://e-flowcode.cc'],
    settingsConfig: {
      env: {
        GOOGLE_GEMINI_BASE_URL: 'https://e-flowcode.cc',
        GEMINI_API_KEY: '',
        GEMINI_MODEL: 'gemini-3.5-flash'
      },
      config: {
        general: {
          previewFeatures: true,
          sessionRetention: { enabled: true, maxAge: '30d', warningAcknowledged: true }
        },
        mcpServers: {},
        security: { auth: { selectedType: 'gemini-api-key' } }
      }
    }
  },
  {
    provider: 'cherryin',
    baseUrl: 'https://open.cherryin.net',
    model: 'google/gemini-3.5-flash',
    endpointCandidates: ['https://open.cherryin.net'],
    settingsConfig: {
      env: {
        GOOGLE_GEMINI_BASE_URL: 'https://open.cherryin.net',
        GEMINI_API_KEY: '',
        GEMINI_MODEL: 'google/gemini-3.5-flash'
      }
    }
  },
  {
    provider: 'openrouter',
    baseUrl: 'https://openrouter.ai/api',
    model: 'gemini-3.5-flash',
    settingsConfig: {
      env: { GOOGLE_GEMINI_BASE_URL: 'https://openrouter.ai/api', GEMINI_MODEL: 'gemini-3.5-flash' }
    }
  },
  {
    provider: 'therouter',
    baseUrl: 'https://api.therouter.ai',
    model: 'gemini-3.5-flash',
    endpointCandidates: ['https://api.therouter.ai'],
    settingsConfig: {
      env: { GOOGLE_GEMINI_BASE_URL: 'https://api.therouter.ai', GEMINI_MODEL: 'gemini-3.5-flash' }
    }
  },
  {
    provider: '自定义',
    model: 'gemini-3.5-flash',
    settingsConfig: { env: { GOOGLE_GEMINI_BASE_URL: '', GEMINI_MODEL: 'gemini-3.5-flash' } }
  }
];
