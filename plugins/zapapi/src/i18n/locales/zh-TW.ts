export default {
  common: {
    save: '儲存',
    cancel: '取消',
    delete: '刪除',
    export: '匯出',
    create: '建立',
    add: '新增',
    enabled: '已啟用',
    disabled: '已停用',
    noData: '尚無資料',
    select: '請選擇',
    copy: '複製',
    copied: '已複製!',
    confirm: '確定',
    settings: '設定',
    edit: '編輯'
  },

  app: {
    title: 'ZapApi',
    env: '環境',
    noEnv: '無環境',
    manageEnv: '管理環境',
    code: '程式碼',
    cookies: 'Cookies',
    collections: '集合',
    newRequest: '新請求',
    saved: '已儲存',
    envManagerTitle: '環境管理',
    codeGeneratorTitle: '產生程式碼',
    collectionManagerTitle: '集合管理',
    cookieManagerTitle: 'Cookie 管理'
  },

  sidebar: {
    collections: '集合',
    history: '歷史',
    newCollection: '建立集合',
    expand: '展開',
    collapse: '收合',
    addRequest: '+ 新增請求',
    noCollections: '尚無集合',
    createCollection: '建立集合',
    manageCollections: '管理集合',
    tabCollections: '集合',
    tabHistory: '歷史',
    deleteHistoryItem: '刪除此記錄',
    clearHistory: '清除歷史',
    noHistory: '尚無歷史記錄'
  },

  request: {
    urlPlaceholder: "輸入請求 URL，支援 {'{{'}變數{'}}'}",
    send: '發送',
    sending: '發送中',
    saveRequest: '儲存請求',
    params: '參數',
    headers: '請求標頭',
    auth: '認證',
    authorization: '認證',
    body: '請求主體',
    paramName: '參數名',
    value: '值',
    type: '類型',
    paramKeyPlaceholder: 'page',
    paramValuePlaceholder: '1',
    addParam: '新增參數',
    addHeader: '新增 Header',
    authType: '認證類型',
    urlMenu: {
      setVar: '設定為變數',
      newTab: '在新標籤頁中打開請求',
      encode: '編碼 URL 組件',
      decode: '解碼 URL 組件'
    },
    none: '無認證',
    bearer: 'Bearer Token',
    basic: 'Basic Auth',
    apikey: 'API Key',
    jwtBearer: 'JWT Bearer',
    digest: 'Digest Auth',
    bearerToken: '輸入 Bearer Token',
    token: '權杖',
    username: '使用者名稱',
    password: '密碼',
    key: '鍵',
    apiKeyValue: 'API Key 值',
    apiKeyHeaderPlaceholder: 'X-API-Key',
    addTo: '新增到',
    headerName: '標頭名稱',
    bodyType: '請求主體類型',
    bodyNone: 'none',
    bodyJson: 'JSON',
    bodyRaw: 'Raw',
    bodyFormdata: 'form-data',
    bodyUrlencoded: 'x-www-form-urlencoded',
    bodyKindNone: '無',
    bodyKindText: '文字',
    bodyKindStructured: '結構化',
    bodyKindBinary: '二進位',
    bodyKindOther: '其他',
    contentTypeShort: 'CT',
    contentTypeOverridden: '已覆蓋',
    bodyPlaceholder: '輸入請求本體',
    fieldName: '欄位名',
    fieldKeyPlaceholder: '欄位',
    fieldValuePlaceholder: '值',
    addField: '新增欄位',
    formText: '文字',
    formFile: '檔案',
    selectFile: '選擇檔案',
    replaceFile: '替換檔案',
    binaryDropTitle: '拖曳二進位檔案到此處',
    binaryDropHint: '或點擊選擇本機檔案',
    fileSize: '大小',
    fileType: '類型',
    unknown: '未知',
    clearFile: '清除',
    noFileSelected: '尚未選擇檔案',
    headerPlaceholder: '標頭名',
    headerKeyPlaceholder: 'Content-Type',
    headerValuePlaceholder: 'application/json',
    noAuth: '此請求未使用認證',
    authDescNone: '目前請求不攜帶認證資訊。',
    authDescBearer: '使用 Bearer Token 進行認證，通常透過 Authorization Header 傳送。',
    authDescBasic: '使用使用者名稱與密碼進行 Basic 認證，客戶端會自動編碼後傳送。',
    authDescApiKey: '透過 Header 或 Query 傳遞 API Key，用於服務端識別呼叫方身份。',
    authDescJwtBearer: '使用所選 HMAC 演算法根據 Header/Payload 產生 JWT，並透過 Authorization Header 傳送。',
    authDescDigest: '使用使用者名稱與密碼進行 HTTP Digest 挑戰回應認證。',
    jwtAlgorithm: 'JWT 演算法',
    jwtSecret: 'JWT 密鑰',
    jwtHeaderPrefix: 'Header 前綴',
    jwtHeaderPrefixPlaceholder: 'Bearer',
    jwtHeader: 'JWT Header (JSON)',
    jwtPayload: 'JWT Payload (JSON)',
    jwtHeaderPlaceholder: '{"alg":"HS256","typ":"JWT"}',
    jwtPayloadPlaceholder: '{"sub":"user-1"}',
    jwtAdvanced: '進階設定',
    jwtAutoIat: '自動加入 iat 聲明',
    jwtAutoExp: '自動加入 exp 聲明',
    jwtExpSeconds: 'exp 秒數（例如 3600）',
    jwtPreview: 'JWT 預覽',
    invalidJwt: 'JWT 設定無效',
    digestUsername: 'Digest 使用者名稱',
    digestPassword: 'Digest 密碼',
    digestAlgorithm: 'Digest 演算法',
    cookiePolicy: 'Cookie 策略',
    cookieHint: 'Cookie Jar 採用 Postman 風格行為。手動設定的 Cookie Header 會在目前請求中優先。',
    cookiePolicyInherit: '繼承全域設定',
    cookiePolicyEnable: '一律啟用 Cookie Jar',
    cookiePolicyDisable: '此請求停用',
    cookiePolicyInheritDesc: '使用設定面板中的全域 Cookie 設定。',
    cookiePolicyEnableDesc: '強制為此請求啟用 Cookie Jar。',
    cookiePolicyDisableDesc: '此請求不傳送也不儲存 Cookie。',
    noBody: '此請求未使用請求體',
    invalidHttpUrl: '請求 URL 無效，請輸入有效位址或主機名稱',
    invalidHttpProtocol: '僅支援 HTTP/HTTPS 協議',
    cancel: '取消請求',
    methodGroupHttp: 'HTTP',
    methodGroupSocket: 'Socket'
  },

  socket: {
    messages: '訊息',
    connect: '連線',
    connecting: '連線中...',
    disconnect: '中斷',
    send: '發送',
    emptyMessages: '尚無訊息。連線後可收發訊息。',
    messagePlaceholder: '輸入要發送的訊息...',
    sendHint: 'Ctrl+Enter / Cmd+Enter 發送',
    newMessages: '有 {count} 則新訊息',
    typeSent: '發送',
    typeReceived: '接收',
    typeSystem: '系統',
    system: {
      connectedWs: '已連線至 {url}',
      connectedTcp: '已連線至 TCP {host}:{port}',
      disconnected: '已中斷連線',
      wsError: 'WebSocket 錯誤',
      error: '錯誤: {error}',
      invalidTcpAddress: 'TCP 位址無效。請使用 host:port，例如 127.0.0.1:9001',
      invalidUdpAddress: 'UDP 位址無效。請使用 host:port，例如 127.0.0.1:9001',
      tcpNotSupported: '目前環境不支援 TCP',
      udpNotSupported: '目前環境不支援 UDP',
      udpReady: 'UDP 已就緒: {host}:{port}',
      connectionFailure: '連線失敗: {error}'
    }
  },

  tabs: {
    newTab: '新建分頁',
    untitledRequest: '新請求',
    renameTitle: '重新命名分頁',
    renamePlaceholder: '輸入分頁名稱',
    resizeDialog: '調整重新命名彈窗大小',
    scrollLeft: '向左捲動分頁',
    scrollRight: '向右捲動分頁',
    closeCurrent: '關閉分頁',
    closeOthers: '關閉其他分頁',
    closeRight: '關閉右側分頁',
    duplicate: '複製分頁',
    copySuffix: '副本',
    unsavedTitle: '有未儲存的修改',
    unsavedMsgSingle: '此分頁有未儲存內容，確定仍要關閉嗎？',
    unsavedMsgBatch: '即將關閉 {count} 個有未儲存修改的分頁，確定繼續嗎？',
    closeAnyway: '仍要關閉',
    saveNeedCollection: '請先建立或選擇一個集合再儲存',
    savedAsNewRequest: '已儲存為新請求'
  },

  response: {
    title: '回應',
    waiting: '等待回應...',
    failed: '請求失敗',
    empty: '發送請求以查看回應',
    emptyBody: '(空回應)',
    body: '回應主體',
    headers: '回應標頭',
    raw: '原始',
    statusLabel: '狀態',
    timeLabel: '時間',
    sizeLabel: '大小',
    searchPlaceholder: '搜尋 JSON 欄位/值/路徑',
    copyField: '複製欄位',
    copyKey: '複製鍵名',
    copyPath: '複製路徑',
    copyValue: '複製值',
    toggleNode: '展開或摺疊節點',
    binaryDetected: '偵測到二進位回應',
    imagePreview: '圖片預覽',
    noInlinePreview: '此二進位類型不支援內嵌預覽，請下載查看',
    noSearchResult: '沒有符合的 JSON 結果',
    cookies: 'Cookies',
    modeJson: 'JSON',
    modeXml: 'XML',
    modeHtml: 'HTML',
    modeJs: 'JavaScript',
    modeRaw: 'Raw',
    modeHex: 'Hex',
    modeBase64: 'Base64',
    collapse: '收合回應',
    expand: '展開回應',
    preview: '預覽',
    filter: '篩選',
    search: '搜尋',
    filterPlaceholder: '篩選',
    copy: '複製',
    noCookies: '暫無 Cookies',
    addCookiesToJar: '添加到 Cookie Jar'
  },

  env: {
    title: '環境列表',
    new: '建立',
    variables: '變數',
    addVariable: '新增變數',
    varName: '變數名',
    value: '值',
    selectEnv: '選擇一個環境進行編輯',
    defaultName: '環境'
  },

  collection: {
    title: '集合列表',
    new: '建立集合',
    requests: '請求',
    noCollections: '尚無集合，點擊上方按鈕建立',
    defaultName: '集合',
    confirmDelete: '確定要刪除這個集合嗎？'
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
    copy: '複製',
    copied: '已複製!'
  },

  kv: {
    add: '新增',
    noData: '尚無資料，點擊上方按鈕新增',
    delete: '刪除'
  },

  settings: {
    title: '設定',
    theme: '主題模式',
    language: '語言',
    accessibility: '引導與快捷鍵',
    cookiesEnabled: '啟用 Cookie Jar',
    persistSessionCookies: '持久化工作階段 Cookie',
    clearCookies: '清除全部 Cookie',
    clearCookiesHint: '移除本機 Jar 中所有持久化 Cookie',
    openShortcuts: '檢視快捷鍵',
    replayOnboarding: '重新播放新手引導',
    shortcutsEnabled: '啟用全域快捷鍵',
    about: '關於專案',
    techStack: '技術堆疊',
    systemTheme: '跟隨系統',
    darkTheme: '深色模式',
    lightTheme: '淺色模式',
    projectTitle: 'ZapApi',
    projectDesc: '一款現代化的 API 介面除錯工具，支援請求構建、環境管理、集合管理和程式碼產生等功能，為開發者提供高效、直觀的介面測試體驗。',
    langSystem: '跟隨系統',
    langZhCN: '简体中文',
    langZhTW: '繁體中文',
    langEn: 'English'
  },

  cookies: {
    searchPlaceholder: '依網域/名稱/值/路徑搜尋 Cookie',
    refresh: '重新整理',
    clearAll: '清除全部',
    clearAllConfirm: '將從本機 Jar 移除所有 Cookie，是否繼續？',
    clearDomain: '清除此網域',
    empty: 'Cookie Jar 為空',
    session: '工作階段',
    copy: '複製',
    copied: '已複製!',
    add: '新增 Cookie',
    addTitle: '新增 Cookie',
    name: '名稱',
    namePlaceholder: 'cookie_name',
    value: '值',
    valuePlaceholder: 'cookie_value',
    domain: '網域',
    domainPlaceholder: 'example.com',
    path: '路徑',
    sameSite: 'SameSite'
  },

  shortcuts: {
    title: '快捷鍵',
    intro: '常用操作支援全域快捷鍵，可大幅提升除錯效率。',
    groups: {
      global: '全域',
      tabs: '分頁',
      request: '請求操作',
      layout: '版面與導覽'
    },
    items: {
      openHelp: '開啟快捷鍵說明',
      openSettings: '開啟設定',
      replayGuide: '重新播放新手引導',
      newTab: '新建分頁',
      closeTab: '關閉目前分頁',
      duplicateTab: '複製目前分頁',
      nextTab: '切換到下一個分頁',
      prevTab: '切換到上一個分頁',
      sendRequest: '發送請求 / 連線 Socket',
      saveRequest: '儲存目前請求',
      cancelRequest: '取消目前發送',
      toggleSidebar: '收合/展開側欄',
      focusUrl: '聚焦 URL 輸入框',
      toggleResponse: '收合/展開回應面板'
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
        title: '環境切換',
        desc: '在此選擇目前啟用環境，變數會自動注入請求。'
      },
      sidebar: {
        title: '集合與歷史',
        desc: '左側可管理集合、請求與歷史記錄，雙擊請求可在新分頁開啟。'
      },
      tabs: {
        title: '多分頁除錯',
        desc: '每個分頁都保有獨立請求狀態，方便同時除錯多個介面。'
      },
      url: {
        title: '請求位址',
        desc: '輸入 URL，支援變數插值。按 Ctrl/Cmd + Enter 可快速發送。'
      },
      send: {
        title: '發送請求',
        desc: '點擊發送可送出請求；Socket 模式下此按鈕用於連線/中斷。'
      },
      save: {
        title: '儲存請求',
        desc: '將目前請求儲存到集合，便於重用與團隊協作。'
      },
      response: {
        title: '回應面板',
        desc: '查看狀態碼、回應標頭與回應主體，並支援搜尋、篩選與複製。'
      },
      shortcuts: {
        title: '快捷鍵入口',
        desc: '點擊此處可隨時查看完整快捷鍵清單。輸入 ? 也能快速開啟。'
      },
      code: {
        title: '程式碼產生器',
        desc: '不論設定多複雜的請求頭和請求體，一鍵即可產生 cURL、Node.js、Python、Go 等多語言程式碼。'
      },
      method: {
        title: '請求方法與 Socket',
        desc: '在此選擇常見的 HTTP 請求方法。同時也支援原生 WS、TCP、UDP Socket 測試！'
      },
      config: {
        title: '請求設定區',
        desc: '透過清晰的表單在此設定 URL 參數、Headers、Auth 驗證機制以及結構化的請求體。'
      },
      settings: {
        title: '系統設定',
        desc: '點擊進入系統設定，管理主題模式、快捷鍵開關及全域 Cookie 策略等偏好。'
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
    noData: '尚無資料'
  },

  select: {
    placeholder: '請選擇'
  },

  confirm: {
    deleteCollection: '確定要刪除這個集合嗎？',
    deleteCollectionMsg: '此操作不可撤銷，集合內的所有請求也將被刪除。',
    deleteRequest: '確定要刪除這個請求嗎？',
    deleteRequestMsg: '此操作不可撤銷。',
    clearHistory: '確定要清空歷史記錄嗎？',
    clearHistoryMsg: '此操作不可撤銷，所有歷史記錄將被永久刪除。'
  },

  history: {
    justNow: '剛剛',
    minutesAgo: '{count} 分鐘前',
    hoursAgo: '{count} 小時前',
    daysAgo: '{count} 天前'
  }
}
