export default {
  common: {
    save: '保存',
    cancel: '取消',
    delete: '删除',
    export: '导出',
    create: '创建',
    add: '添加',
    enabled: '已启用',
    disabled: '已禁用',
    noData: '暂无数据',
    select: '请选择',
    copy: '复制',
    copied: '已复制!',
    confirm: '确定',
    settings: '设置',
    edit: '编辑'
  },

  app: {
    title: 'ZapApi',
    env: '环境',
    noEnv: '无环境',
    manageEnv: '管理环境',
    code: '代码',
    cookies: 'Cookies',
    collections: '集合',
    newRequest: '新请求',
    saved: '已保存',
    envManagerTitle: '环境管理',
    codeGeneratorTitle: '生成代码',
    collectionManagerTitle: '集合管理',
    cookieManagerTitle: 'Cookie 管理'
  },

  sidebar: {
    collections: '集合',
    history: '历史',
    newCollection: '新建集合',
    expand: '展开',
    collapse: '折叠',
    addRequest: '+ 添加请求',
    noCollections: '暂无集合',
    createCollection: '创建集合',
    manageCollections: '管理集合',
    tabCollections: '集合',
    tabHistory: '历史',
    deleteHistoryItem: '删除此记录',
    clearHistory: '清空历史',
    noHistory: '暂无历史记录'
  },

  request: {
    urlPlaceholder: "输入请求 URL，支持 {'{{'}变量{'}}'}",
    send: '发送',
    sending: '发送中',
    saveRequest: '保存请求',
    params: '参数',
    headers: '请求头',
    auth: '认证',
    authorization: '认证',
    body: '请求体',
    paramName: '参数名',
    value: '值',
    type: '类型',
    paramKeyPlaceholder: 'page',
    paramValuePlaceholder: '1',
    addParam: '添加参数',
    addHeader: '添加 Header',
    authType: '认证类型',
    urlMenu: {
      setVar: '设置为变量',
      newTab: '在新标签页中打开请求',
      encode: '编码 URL 组件',
      decode: '解码 URL 组件'
    },
    none: '无认证',
    bearer: 'Bearer Token',
    basic: 'Basic Auth',
    apikey: 'API Key',
    jwtBearer: 'JWT Bearer',
    digest: 'Digest Auth',
    bearerToken: '输入 Bearer Token',
    token: '令牌',
    username: '用户名',
    password: '密码',
    key: '键',
    apiKeyValue: 'API Key 值',
    apiKeyHeaderPlaceholder: 'X-API-Key',
    addTo: '添加到',
    headerName: '请求头名称',
    bodyType: '请求体类型',
    bodyNone: 'none',
    bodyJson: 'JSON',
    bodyRaw: 'Raw',
    bodyFormdata: 'form-data',
    bodyUrlencoded: 'x-www-form-urlencoded',
    bodyKindNone: '无',
    bodyKindText: '文本',
    bodyKindStructured: '结构化',
    bodyKindBinary: '二进制',
    bodyKindOther: '其他',
    contentTypeShort: 'CT',
    contentTypeOverridden: '已覆盖',
    bodyPlaceholder: '输入请求体',
    fieldName: '字段名',
    fieldKeyPlaceholder: '字段',
    fieldValuePlaceholder: '值',
    addField: '添加字段',
    formText: '文本',
    formFile: '文件',
    selectFile: '选择文件',
    replaceFile: '替换文件',
    binaryDropTitle: '拖拽二进制文件到此处',
    binaryDropHint: '或点击选择本地文件',
    fileSize: '大小',
    fileType: '类型',
    unknown: '未知',
    clearFile: '清除',
    noFileSelected: '未选择文件',
    headerPlaceholder: '请求头名',
    headerKeyPlaceholder: 'Content-Type',
    headerValuePlaceholder: 'application/json',
    noAuth: '此请求未使用认证',
    authDescNone: '当前请求不携带认证信息。',
    authDescBearer: '使用 Bearer Token 进行认证，通常通过 Authorization Header 发送。',
    authDescBasic: '使用用户名和密码进行 Basic 认证，客户端会自动进行编码后发送。',
    authDescApiKey: '通过 Header 或 Query 传递 API Key，用于服务端识别调用方身份。',
    authDescJwtBearer: '使用所选 HMAC 算法根据 Header/Payload 生成 JWT，并通过 Authorization Header 发送。',
    authDescDigest: '使用用户名和密码进行 HTTP Digest 挑战应答认证。',
    jwtAlgorithm: 'JWT 算法',
    jwtSecret: 'JWT 密钥',
    jwtHeaderPrefix: 'Header 前缀',
    jwtHeaderPrefixPlaceholder: 'Bearer',
    jwtHeader: 'JWT Header (JSON)',
    jwtPayload: 'JWT Payload (JSON)',
    jwtHeaderPlaceholder: '{"alg":"HS256","typ":"JWT"}',
    jwtPayloadPlaceholder: '{"sub":"user-1"}',
    jwtAdvanced: '高级设置',
    jwtAutoIat: '自动添加 iat 声明',
    jwtAutoExp: '自动添加 exp 声明',
    jwtExpSeconds: 'exp 秒数（例如 3600）',
    jwtPreview: 'JWT 预览',
    invalidJwt: 'JWT 配置无效',
    digestUsername: 'Digest 用户名',
    digestPassword: 'Digest 密码',
    digestAlgorithm: 'Digest 算法',
    cookiePolicy: 'Cookie 策略',
    cookieHint: 'Cookie Jar 遵循 Postman 风格行为。手动设置的 Cookie Header 会在当前请求中优先。',
    cookiePolicyInherit: '继承全局设置',
    cookiePolicyEnable: '总是启用 Cookie Jar',
    cookiePolicyDisable: '对此请求禁用',
    cookiePolicyInheritDesc: '使用设置面板中的全局 Cookie 配置。',
    cookiePolicyEnableDesc: '强制为当前请求启用 Cookie Jar。',
    cookiePolicyDisableDesc: '当前请求不发送也不存储 Cookie。',
    noBody: '此请求未使用请求体',
    invalidHttpUrl: '请求 URL 无效，请输入有效地址或主机名',
    invalidHttpProtocol: '仅支持 HTTP/HTTPS 协议',
    cancel: '取消请求',
    methodGroupHttp: 'HTTP',
    methodGroupSocket: 'Socket'
  },

  socket: {
    messages: '消息',
    connect: '连接',
    connecting: '连接中...',
    disconnect: '断开',
    send: '发送',
    emptyMessages: '暂无消息。连接后可收发消息。',
    messagePlaceholder: '输入要发送的消息...',
    sendHint: 'Ctrl+Enter / Cmd+Enter 发送',
    newMessages: '有 {count} 条新消息',
    typeSent: '发送',
    typeReceived: '接收',
    typeSystem: '系统',
    system: {
      connectedWs: '已连接到 {url}',
      connectedTcp: '已连接到 TCP {host}:{port}',
      disconnected: '已断开连接',
      wsError: 'WebSocket 错误',
      error: '错误: {error}',
      invalidTcpAddress: 'TCP 地址无效。请使用 host:port，例如 127.0.0.1:9001',
      invalidUdpAddress: 'UDP 地址无效。请使用 host:port，例如 127.0.0.1:9001',
      tcpNotSupported: '当前环境不支持 TCP',
      udpNotSupported: '当前环境不支持 UDP',
      udpReady: 'UDP 已就绪: {host}:{port}',
      connectionFailure: '连接失败: {error}'
    }
  },

  tabs: {
    newTab: '新建标签页',
    untitledRequest: '新请求',
    renameTitle: '重命名标签页',
    renamePlaceholder: '输入标签页名称',
    resizeDialog: '调整重命名弹窗大小',
    scrollLeft: '向左滚动标签',
    scrollRight: '向右滚动标签',
    closeCurrent: '关闭标签页',
    closeOthers: '关闭其他标签页',
    closeRight: '关闭右侧标签页',
    duplicate: '复制标签页',
    copySuffix: '副本',
    unsavedTitle: '存在未保存修改',
    unsavedMsgSingle: '该标签页有未保存内容，确定仍要关闭吗？',
    unsavedMsgBatch: '即将关闭 {count} 个有未保存修改的标签页，确定继续吗？',
    closeAnyway: '仍然关闭',
    saveNeedCollection: '请先创建或选择一个集合再保存',
    savedAsNewRequest: '已保存为新请求'
  },

  response: {
    title: '响应',
    waiting: '等待响应...',
    failed: '请求失败',
    empty: '发送请求以查看响应',
    emptyBody: '(空响应)',
    body: '响应体',
    headers: '响应头',
    raw: '原始',
    statusLabel: '状态',
    timeLabel: '时间',
    sizeLabel: '大小',
    searchPlaceholder: '搜索 JSON 字段/值/路径',
    copyField: '复制字段',
    copyKey: '复制键名',
    copyPath: '复制路径',
    copyValue: '复制值',
    copied: '已复制!',
    toggleNode: '展开或折叠节点',
    binaryDetected: '检测到二进制响应',
    imagePreview: '图片预览',
    noInlinePreview: '该二进制类型不支持内联预览，请下载查看',
    noSearchResult: '没有匹配的 JSON 结果',
    cookies: 'Cookies',
    modeJson: 'JSON',
    modeXml: 'XML',
    modeHtml: 'HTML',
    modeJs: 'JavaScript',
    modeRaw: 'Raw',
    modeHex: 'Hex',
    modeBase64: 'Base64',
    collapse: '折叠响应',
    expand: '展开响应',
    preview: '预览',
    filter: '过滤',
    search: '搜索',
    filterPlaceholder: '过滤',
    copy: '复制',
    noCookies: '暂无 Cookies',
    addCookiesToJar: '添加到 Cookie Jar'
  },

  env: {
    title: '环境列表',
    new: '新建',
    variables: '变量',
    addVariable: '添加变量',
    varName: '变量名',
    value: '值',
    selectEnv: '选择一个环境进行编辑',
    defaultName: '环境'
  },

  collection: {
    title: '集合列表',
    new: '新建集合',
    requests: '请求',
    noCollections: '暂无集合，点击上方按钮创建',
    defaultName: '集合',
    confirmDelete: '确定要删除这个集合吗？'
  },

  code: {
    curl: 'cURL',
    wget: 'wget',
    powershell: 'PowerShell',
    php: 'PHP',
    ruby: 'Ruby',
    c: 'C (libcurl)',
    cpp: 'C++ (libcurl)',
    csharp: 'C#',
    kotlin: 'Kotlin',
    rust: 'Rust',
    javascript: 'JavaScript',
    javascriptWs: 'JavaScript (WebSocket)',
    javascriptNode: 'JavaScript (Node)',
    javascriptAxios: 'JavaScript (Axios)',
    typescriptFetch: 'TypeScript (Fetch)',
    typescriptWs: 'TypeScript (WebSocket)',
    typescriptNode: 'TypeScript (Node)',
    python: 'Python',
    go: 'Go (net/http)',
    javaWs: 'Java (WebSocket)',
    javaSocket: 'Java (Socket)',
    javaOkHttp: 'Java (OkHttp)',
    copy: '复制',
    copied: '已复制!'
  },

  kv: {
    add: '添加',
    noData: '暂无数据，点击上方按钮添加',
    delete: '删除'
  },

  settings: {
    title: '设置',
    theme: '主题模式',
    language: '语言',
    accessibility: '引导与快捷键',
    cookiesEnabled: '启用 Cookie Jar',
    persistSessionCookies: '持久化会话 Cookie',
    clearCookies: '清空全部 Cookie',
    clearCookiesHint: '删除本地 Jar 中所有持久化 Cookie',
    openShortcuts: '查看快捷键',
    replayOnboarding: '重新播放新手引导',
    shortcutsEnabled: '启用全局快捷键',
    about: '关于项目',
    techStack: '技术栈',
    systemTheme: '跟随系统',
    darkTheme: '暗色模式',
    lightTheme: '亮色模式',
    projectTitle: 'ZapApi',
    projectDesc: '一款现代化的 API 接口调试工具，支持请求构建、环境管理、集合管理和代码生成等功能，为开发者提供高效、直观的接口测试体验。',
    langSystem: '跟随系统',
    langZhCN: '简体中文',
    langZhTW: '繁體中文',
    langEn: 'English'
  },

  cookies: {
    searchPlaceholder: '按域名/名称/值/路径搜索 Cookie',
    refresh: '刷新',
    clearAll: '清空全部',
    clearAllConfirm: '将从本地 Jar 删除所有 Cookie，是否继续？',
    clearDomain: '清空该域名',
    empty: 'Cookie Jar 为空',
    session: '会话',
    copy: '复制',
    copied: '已复制!',
    add: '添加 Cookie',
    addTitle: '添加 Cookie',
    name: '名称',
    namePlaceholder: 'cookie_name',
    value: '值',
    valuePlaceholder: 'cookie_value',
    domain: '域名',
    domainPlaceholder: 'example.com',
    path: '路径',
    sameSite: 'SameSite'
  },

  shortcuts: {
    title: '快捷键',
    intro: '常用操作支持全局快捷键，可显著提升调试效率。',
    groups: {
      global: '全局',
      tabs: '标签页',
      request: '请求操作',
      layout: '布局与导航'
    },
    items: {
      openHelp: '打开快捷键帮助',
      openSettings: '打开设置',
      replayGuide: '重新播放新手引导',
      newTab: '新建标签页',
      closeTab: '关闭当前标签页',
      duplicateTab: '复制当前标签页',
      nextTab: '切换到下一个标签页',
      prevTab: '切换到上一个标签页',
      sendRequest: '发送请求 / 连接 Socket',
      saveRequest: '保存当前请求',
      cancelRequest: '取消当前发送',
      toggleSidebar: '折叠/展开侧边栏',
      focusUrl: '聚焦 URL 输入框',
      toggleResponse: '折叠/展开响应面板'
    },
    keys: {
      help: '?',
      openSettings: 'Ctrl/Cmd + ,',
      replayGuide: 'Ctrl/Cmd + Shift + H',
      newTab: 'Ctrl/Cmd + Alt + T',
      closeTab: 'Ctrl/Cmd + Alt + W',
      duplicateTab: 'Ctrl/Cmd + D',
      nextTab: 'Ctrl/Cmd + Shift + ]',
      prevTab: 'Ctrl/Cmd + Shift + [',
      sendRequest: 'Ctrl/Cmd + Enter',
      saveRequest: 'Ctrl/Cmd + S',
      cancelRequest: 'Esc',
      toggleSidebar: 'Ctrl/Cmd + B',
      focusUrl: 'Ctrl/Cmd + K',
      toggleResponse: 'Ctrl/Cmd + Shift + R'
    }
  },

  onboarding: {
    next: '下一步',
    prev: '上一步',
    done: '完成',
    steps: {
      env: {
        title: '环境切换',
        desc: '在这里选择当前激活环境，变量会自动注入请求。'
      },
      sidebar: {
        title: '集合与历史',
        desc: '左侧可以管理集合、请求和历史记录，双击请求可在新标签页打开。'
      },
      tabs: {
        title: '多标签调试',
        desc: '每个标签页都有独立请求状态，适合并行调试多个接口。'
      },
      url: {
        title: '请求地址',
        desc: '输入 URL，支持变量插值。按 Ctrl/Cmd + Enter 可快速发送。'
      },
      send: {
        title: '发送请求',
        desc: '点击发送按钮发起请求；Socket 模式下该按钮用于连接/断开。'
      },
      save: {
        title: '保存请求',
        desc: '把当前请求保存到集合，便于复用和团队协作。'
      },
      response: {
        title: '响应面板',
        desc: '查看状态码、响应头与响应体，支持搜索、过滤和复制。'
      },
      shortcuts: {
        title: '快捷键入口',
        desc: '点击这里随时查看完整快捷键清单。输入 ? 也可以快速打开。'
      },
      code: {
        title: '代码生成器',
        desc: '无论配置了多复杂的请求头和请求体，一键即可生成 cURL、Node.js、Python、Go 等多语言代码。'
      },
      method: {
        title: '请求方法与 Socket',
        desc: '在这里选择常见的 HTTP 请求方法。同时这里也支持原生的 WS、TCP、UDP Socket 调试！'
      },
      config: {
        title: '请求配置区',
        desc: '通过清晰的表单在此配置 URL 参数、Headers、Auth 鉴权机制以及结构化的请求体。'
      },
      settings: {
        title: '系统设置',
        desc: '点击进入系统设置，管理主题模式、快捷键开关及全局 Cookie 策略等偏好。'
      }
    }
  },

  tech: {
    vue: 'Vue 3',
    typescript: 'TypeScript',
    vite: 'Vite',
    vueI18n: 'Vue I18n',
    compositionApi: 'Composition API',
    reactiveStore: 'Reactive Store',
    cssVariables: 'CSS Variables',
    glassmorphism: 'Glassmorphism UI'
  },

  empty: {
    noData: '暂无数据'
  },

  select: {
    placeholder: '请选择'
  },

  confirm: {
    deleteCollection: '确定要删除这个集合吗？',
    deleteCollectionMsg: '此操作不可撤销，集合内的所有请求也将被删除。',
    deleteRequest: '确定要删除这个请求吗？',
    deleteRequestMsg: '此操作不可撤销。',
    clearHistory: '确定要清空历史记录吗？',
    clearHistoryMsg: '此操作不可撤销，所有历史记录将被永久删除。'
  },

  history: {
    justNow: '刚刚',
    minutesAgo: '{count} 分钟前',
    hoursAgo: '{count} 小时前',
    daysAgo: '{count} 天前'
  }
}
