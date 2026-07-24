export default {
  common: {
    save: 'Save',
    cancel: 'Cancel',
    delete: 'Delete',
    export: 'Export',
    create: 'Create',
    add: 'Add',
    enabled: 'Enabled',
    disabled: 'Disabled',
    noData: 'No data',
    select: 'Select',
    copy: 'Copy',
    copied: 'Copied!',
    confirm: 'Confirm',
    settings: 'Settings',
    edit: 'Edit'
  },

  app: {
    title: 'ZapApi',
    env: 'Environment',
    noEnv: 'No environment',
    manageEnv: 'Manage Environments',
    code: 'Code',
    cookies: 'Cookies',
    collections: 'Collections',
    newRequest: 'New Request',
    saved: 'Saved',
    envManagerTitle: 'Environment Manager',
    codeGeneratorTitle: 'Generate Code',
    collectionManagerTitle: 'Collection Manager',
    cookieManagerTitle: 'Cookie Manager'
  },

  sidebar: {
    collections: 'Collections',
    history: 'History',
    newCollection: 'New Collection',
    expand: 'Expand',
    collapse: 'Collapse',
    addRequest: '+ Add Request',
    noCollections: 'No collections',
    createCollection: 'Create Collection',
    manageCollections: 'Manage Collections',
    tabCollections: 'Collections',
    tabHistory: 'History',
    deleteHistoryItem: 'Delete this record',
    clearHistory: 'Clear History',
    noHistory: 'No history yet'
  },

  request: {
    urlPlaceholder: "Enter request URL, supports {'{{'}variables{'}}'}",
    send: 'Send',
    sending: 'Sending...',
    saveRequest: 'Save Request',
    params: 'Params',
    headers: 'Headers',
    auth: 'Auth',
    authorization: 'Authorization',
    body: 'Body',
    paramName: 'Parameter name',
    value: 'Value',
    type: 'Type',
    paramKeyPlaceholder: 'page',
    paramValuePlaceholder: '1',
    addParam: 'Add Parameter',
    addHeader: 'Add Header',
    authType: 'Auth Type',
    urlMenu: {
      setVar: 'Set as variable',
      newTab: 'Open request in new tab',
      encode: 'Encode URL component',
      decode: 'Decode URL component'
    },
    none: 'None',
    bearer: 'Bearer Token',
    basic: 'Basic Auth',
    apikey: 'API Key',
    jwtBearer: 'JWT Bearer',
    digest: 'Digest Auth',
    bearerToken: 'Enter Bearer Token',
    token: 'Token',
    username: 'Username',
    password: 'Password',
    key: 'Key',
    apiKeyValue: 'API Key value',
    apiKeyHeaderPlaceholder: 'X-API-Key',
    addTo: 'Add to',
    headerName: 'Header Name',
    bodyType: 'Body Type',
    bodyNone: 'none',
    bodyJson: 'JSON',
    bodyRaw: 'Raw',
    bodyFormdata: 'form-data',
    bodyUrlencoded: 'x-www-form-urlencoded',
    bodyKindNone: 'None',
    bodyKindText: 'Text',
    bodyKindStructured: 'Structured',
    bodyKindBinary: 'Binary',
    bodyKindOther: 'Other',
    contentTypeShort: 'CT',
    contentTypeOverridden: 'Overridden',
    bodyPlaceholder: 'Enter request body',
    fieldName: 'Field name',
    fieldKeyPlaceholder: 'field',
    fieldValuePlaceholder: 'value',
    addField: 'Add Field',
    formText: 'Text',
    formFile: 'File',
    selectFile: 'Select File',
    replaceFile: 'Replace File',
    binaryDropTitle: 'Drop a binary file here',
    binaryDropHint: 'or click to browse local files',
    fileSize: 'Size',
    fileType: 'Type',
    unknown: 'Unknown',
    clearFile: 'Clear',
    noFileSelected: 'No file selected',
    headerPlaceholder: 'Header name',
    headerKeyPlaceholder: 'Content-Type',
    headerValuePlaceholder: 'application/json',
    noAuth: 'This request does not use authentication',
    authDescNone: 'No authentication information will be sent with this request.',
    authDescBearer: 'Use a Bearer token, typically sent via the Authorization header.',
    authDescBasic: 'Use Basic auth with username and password. The client encodes credentials automatically.',
    authDescApiKey: 'Send API Key via Header or Query to identify the caller.',
    authDescJwtBearer: 'Generate a JWT token with selected HMAC algorithm from header/payload and send it in Authorization header.',
    authDescDigest: 'Use HTTP Digest challenge-response authentication with username and password.',
    jwtAlgorithm: 'JWT Algorithm',
    jwtSecret: 'JWT Secret',
    jwtHeaderPrefix: 'Header Prefix',
    jwtHeaderPrefixPlaceholder: 'Bearer',
    jwtHeader: 'JWT Header (JSON)',
    jwtPayload: 'JWT Payload (JSON)',
    jwtHeaderPlaceholder: '{"alg":"HS256","typ":"JWT"}',
    jwtPayloadPlaceholder: '{"sub":"user-1"}',
    jwtAdvanced: 'Advanced Settings',
    jwtAutoIat: 'Auto add iat claim',
    jwtAutoExp: 'Auto add exp claim',
    jwtExpSeconds: 'exp seconds (e.g. 3600)',
    jwtPreview: 'JWT Preview',
    invalidJwt: 'Invalid JWT config',
    digestUsername: 'Digest Username',
    digestPassword: 'Digest Password',
    digestAlgorithm: 'Digest Algorithm',
    cookiePolicy: 'Cookie Policy',
    cookieHint: 'Cookie Jar follows Postman-style behavior. Manual Cookie header takes priority for current request.',
    cookiePolicyInherit: 'Inherit global settings',
    cookiePolicyEnable: 'Always enable cookie jar',
    cookiePolicyDisable: 'Disable for this request',
    cookiePolicyInheritDesc: 'Use global cookie settings from Settings panel.',
    cookiePolicyEnableDesc: 'Force-enable cookie jar for this request.',
    cookiePolicyDisableDesc: 'Do not send or store cookies for this request.',
    noBody: 'This request does not have a body',
    invalidHttpUrl: 'Invalid request URL. Enter a valid host or URL.',
    invalidHttpProtocol: 'Only HTTP/HTTPS URLs are supported',
    cancel: 'Cancel Request',
    methodGroupHttp: 'HTTP',
    methodGroupSocket: 'Socket'
  },

  socket: {
    messages: 'Messages',
    connect: 'Connect',
    connecting: 'Connecting...',
    disconnect: 'Disconnect',
    send: 'Send',
    emptyMessages: 'No messages yet. Connect to send and receive messages.',
    messagePlaceholder: 'Enter message to send...',
    sendHint: 'Ctrl+Enter / Cmd+Enter to send',
    newMessages: '{count} new messages',
    typeSent: 'Sent',
    typeReceived: 'Received',
    typeSystem: 'System',
    system: {
      connectedWs: 'Connected to {url}',
      connectedTcp: 'Connected to TCP {host}:{port}',
      disconnected: 'Disconnected',
      wsError: 'WebSocket Error',
      error: 'Error: {error}',
      invalidTcpAddress: 'Invalid TCP address. Use host:port, e.g. 127.0.0.1:9001',
      invalidUdpAddress: 'Invalid UDP address. Use host:port, e.g. 127.0.0.1:9001',
      tcpNotSupported: 'TCP is not supported in browser environment',
      udpNotSupported: 'UDP is not supported in browser environment',
      udpReady: 'UDP Ready: {host}:{port}',
      connectionFailure: 'Connection failure: {error}'
    }
  },

  tabs: {
    newTab: 'New Tab',
    untitledRequest: 'New Request',
    renameTitle: 'Rename Tab',
    renamePlaceholder: 'Enter tab name',
    resizeDialog: 'Resize rename dialog',
    scrollLeft: 'Scroll tabs left',
    scrollRight: 'Scroll tabs right',
    closeCurrent: 'Close Tab',
    closeOthers: 'Close Other Tabs',
    closeRight: 'Close Tabs to the Right',
    duplicate: 'Duplicate Tab',
    copySuffix: 'Copy',
    unsavedTitle: 'Unsaved changes',
    unsavedMsgSingle: 'This tab has unsaved changes. Close anyway?',
    unsavedMsgBatch: '{count} tabs have unsaved changes. Close anyway?',
    closeAnyway: 'Close Anyway',
    saveNeedCollection: 'Create or select a collection before saving',
    savedAsNewRequest: 'Saved as a new request'
  },

  response: {
    title: 'Response',
    waiting: 'Waiting for response...',
    failed: 'Request failed',
    empty: 'Send a request to see the response',
    emptyBody: '(Empty response)',
    body: 'Body',
    headers: 'Headers',
    raw: 'Raw',
    statusLabel: 'Status',
    timeLabel: 'Time',
    sizeLabel: 'Size',
    searchPlaceholder: 'Search JSON key/value/path',
    copyField: 'Copy field',
    copyKey: 'Copy key',
    copyPath: 'Copy path',
    copyValue: 'Copy value',
    toggleNode: 'Toggle node',
    binaryDetected: 'Binary response detected',
    imagePreview: 'Image preview',
    noInlinePreview: 'Inline preview is not supported for this binary type. Download to view.',
    noSearchResult: 'No matching JSON result',
    cookies: 'Cookies',
    modeJson: 'JSON',
    modeXml: 'XML',
    modeHtml: 'HTML',
    modeJs: 'JavaScript',
    modeRaw: 'Raw',
    modeHex: 'Hex',
    modeBase64: 'Base64',
    collapse: 'Collapse Response',
    expand: 'Expand Response',
    preview: 'Preview',
    filter: 'Filter',
    search: 'Search',
    filterPlaceholder: 'Filter',
    copy: 'Copy',
    noCookies: 'No cookies',
    addCookiesToJar: 'Add to Cookie Jar'
  },

  env: {
    title: 'Environments',
    new: 'New',
    variables: 'Variables',
    addVariable: 'Add Variable',
    varName: 'Variable name',
    value: 'Value',
    selectEnv: 'Select an environment to edit',
    defaultName: 'Environment'
  },

  collection: {
    title: 'Collections',
    new: 'New Collection',
    requests: 'requests',
    noCollections: 'No collections, click the button above to create one',
    defaultName: 'Collection',
    confirmDelete: 'Are you sure you want to delete this collection?'
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
    copy: 'Copy',
    copied: 'Copied!'
  },

  kv: {
    add: 'Add',
    noData: 'No data, click the button above to add',
    delete: 'Delete'
  },

  settings: {
    title: 'Settings',
    theme: 'Theme',
    language: 'Language',
    accessibility: 'Guidance & Shortcuts',
    cookiesEnabled: 'Enable cookie jar',
    persistSessionCookies: 'Persist session cookies',
    clearCookies: 'Clear all cookies',
    clearCookiesHint: 'Remove all persisted cookies from local jar',
    openShortcuts: 'View Shortcuts',
    replayOnboarding: 'Replay Onboarding',
    shortcutsEnabled: 'Enable global shortcuts',
    about: 'About',
    techStack: 'Tech Stack',
    systemTheme: 'System',
    darkTheme: 'Dark',
    lightTheme: 'Light',
    projectTitle: 'ZapApi',
    projectDesc: 'A modern API debugging tool that supports request building, environment management, collection management, and code generation, providing developers with an efficient and intuitive API testing experience.',
    langSystem: 'System',
    langZhCN: '简体中文',
    langZhTW: '繁體中文',
    langEn: 'English'
  },

  cookies: {
    searchPlaceholder: 'Search cookies by domain/name/value/path',
    refresh: 'Refresh',
    clearAll: 'Clear all',
    clearAllConfirm: 'This will remove all cookies from the local jar. Continue?',
    clearDomain: 'Clear domain',
    empty: 'No cookies in jar',
    session: 'Session',
    copy: 'Copy',
    copied: 'Copied!',
    add: 'Add Cookie',
    addTitle: 'Add Cookie',
    name: 'Name',
    namePlaceholder: 'cookie_name',
    value: 'Value',
    valuePlaceholder: 'cookie_value',
    domain: 'Domain',
    domainPlaceholder: 'example.com',
    path: 'Path',
    sameSite: 'SameSite'
  },

  shortcuts: {
    title: 'Keyboard Shortcuts',
    intro: 'Common actions are available via global shortcuts for faster debugging.',
    groups: {
      global: 'Global',
      tabs: 'Tabs',
      request: 'Request Actions',
      layout: 'Layout & Navigation'
    },
    items: {
      openHelp: 'Open shortcuts help',
      openSettings: 'Open settings',
      replayGuide: 'Replay onboarding',
      newTab: 'Open a new tab',
      closeTab: 'Close current tab',
      duplicateTab: 'Duplicate current tab',
      nextTab: 'Switch to next tab',
      prevTab: 'Switch to previous tab',
      sendRequest: 'Send request / connect socket',
      saveRequest: 'Save current request',
      cancelRequest: 'Cancel current send',
      toggleSidebar: 'Toggle sidebar',
      focusUrl: 'Focus URL input',
      toggleResponse: 'Toggle response panel'
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
    next: 'Next',
    prev: 'Previous',
    done: 'Done',
    steps: {
      env: {
        title: 'Environment Switching',
        desc: 'Choose the active environment here. Variables are injected automatically into requests.'
      },
      sidebar: {
        title: 'Collections & History',
        desc: 'Manage collections, requests, and history. Double-click a request to open it in a new tab.'
      },
      tabs: {
        title: 'Multi-tab Workflow',
        desc: 'Each tab has independent request state, ideal for parallel endpoint debugging.'
      },
      url: {
        title: 'Request URL',
        desc: 'Enter a URL with variable interpolation support. Press Ctrl/Cmd + Enter to send quickly.'
      },
      send: {
        title: 'Send Request',
        desc: 'Use Send to execute HTTP requests. In Socket mode, this button connects/disconnects.'
      },
      save: {
        title: 'Save Request',
        desc: 'Save the current request into a collection for reuse and team collaboration.'
      },
      response: {
        title: 'Response Panel',
        desc: 'Inspect status, headers, and body with search, filtering, and copy actions.'
      },
      shortcuts: {
        title: 'Shortcuts Entry',
        desc: 'Click here anytime to view all shortcuts. You can also press ? to open it instantly.'
      },
      code: {
        title: 'Code Generator',
        desc: 'One click to generate cURL, Node.js, Python, or Go snippets regardless of how complex your request might be.'
      },
      method: {
        title: 'Method & Socket',
        desc: 'Select standard HTTP methods here. It natively supports WS, TCP, and UDP Socket testing as well!'
      },
      config: {
        title: 'Request Configuration',
        desc: 'Use forms here to configure parameters, headers, Auth mechanisms, and structured request bodies.'
      },
      settings: {
        title: 'Global Settings',
        desc: 'Access global preferences here to manage theme options, shortcuts, and global Cookie strategy.'
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
    noData: 'No data'
  },

  select: {
    placeholder: 'Select'
  },

  confirm: {
    deleteCollection: 'Delete this collection?',
    deleteCollectionMsg: 'This action cannot be undone. All requests in this collection will also be deleted.',
    deleteRequest: 'Delete this request?',
    deleteRequestMsg: 'This action cannot be undone.',
    clearHistory: 'Clear all history?',
    clearHistoryMsg: 'This action cannot be undone. All history records will be permanently removed.'
  },

  history: {
    justNow: 'Just now',
    minutesAgo: '{count}m ago',
    hoursAgo: '{count}h ago',
    daysAgo: '{count}d ago'
  }
}
