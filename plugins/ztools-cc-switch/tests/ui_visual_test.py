from pathlib import Path
from playwright.sync_api import sync_playwright

MOCK = r"""
window.ccSwitch = {
  _routes:{},
  getThemePreference:()=> 'light',setThemePreference:x=>x,
  _visibleClients:['claude','codex','gemini','opencode','openclaw','hermes','grokbuild','claude-desktop'],
  getVisibleClients(){return [...this._visibleClients]},setVisibleClients(ids){if(!ids.length)throw new Error('请至少保留一个 AI 客户端菜单');this._visibleClients=[...ids];return [...ids]},
  listProviders: async () => ({
    clients: [
      {id:'claude',name:'Claude Code',accent:'#E8A66A'}, {id:'codex',name:'Codex',accent:'#5EEAD4'},
      {id:'gemini',name:'Gemini CLI',accent:'#79A7FF'}, {id:'opencode',name:'OpenCode',accent:'#A78BFA'},
      {id:'openclaw',name:'OpenClaw',accent:'#FB7185'}, {id:'hermes',name:'Hermes Agent',accent:'#FBBF24'},
      {id:'grokbuild',name:'GrokBuild',accent:'#93C5FD'}, {id:'claude-desktop',name:'Claude Desktop',accent:'#D97757'}
    ],
    active: {claude:'anthropic',codex:'openrouter'},
    providers: [
      {id:'anthropic',name:'Anthropic API',apiKey:'sk-test-123456789',baseUrl:'https://api.anthropic.com',model:'claude-sonnet-4-5',clients:['claude'],color:'#E69B62',source:'preset',apiType:'anthropic',costMultiplier:'1.2',pricingModelSource:'response',limitDailyUsd:'2',limitMonthlyUsd:'40'},
      {id:'kimi',name:'Kimi for Claude',apiKey:'sk-test-987654321',baseUrl:'https://api.moonshot.cn/anthropic',model:'kimi-k2.5',clients:['claude'],color:'#F4B55F',source:'preset',apiType:'anthropic'},
      {id:'openrouter',name:'OpenRouter',apiKey:'sk-or-test',baseUrl:'https://openrouter.ai/api/v1',model:'openai/gpt-5',clients:['codex','opencode','openclaw','hermes','grokbuild'],color:'#9B8AFB',source:'preset',failoverPriority:1}
      ,{id:'claude-desktop-official',name:'Claude Desktop Official',apiKey:'',baseUrl:'',model:'',clients:['claude-desktop'],color:'#D97757',source:'preset',apiType:'anthropic',claudeDesktopMode:'direct',claudeDesktopRoutes:[]}
    ]
  }),
  getClientStatus: async function() { return {...(this._routes.claude?{claude:{routed:true}}:{}),...(this._routes.codex?{codex:{routed:true}}:{}),...(this._routes.gemini?{gemini:{routed:true}}:{}),...(this._routes.grokbuild?{grokbuild:{routed:true}}:{}),opencode:{routed:!!this._routes.opencode,liveProviderIds:['openrouter']},openclaw:{routed:!!this._routes.openclaw,liveProviderIds:['openrouter']},hermes:{routed:!!this._routes.hermes,liveProviderIds:['openrouter']},'claude-desktop':{desktopStatus:{supported:true,configured:false,appliedId:null,actualBaseUrl:null,proxyRunning:false,profilePath:'/Users/demo/Library/Application Support/Claude-3p/configLibrary/profile.json'}}} }, getRuntimeInfo: async () => ({sidecar:{available:true},dataDir:'/Users/demo/Library/Application Support/ztools/ztools-cc-switch'}),
  removeProviderFromLiveConfig:async(client,id)=>({client,id,removed:true}),
  getHostStartupSettings:()=>({autoStartRouter:true,restoreOnPluginEnter:true}),saveHostStartupSettings:x=>x,
  getLogConfig:async()=>({enabled:true,level:'info',retentionDays:30,maxFileSizeMb:20,maxRequestEntries:50000}),saveLogConfig:async x=>x,maintainLogs:async()=>({changed:false,kept:128}),listLogFiles:async()=>[{name:'plugin.log.jsonl',sizeBytes:18420,modifiedAt:new Date().toISOString()},{name:'request-logs.jsonl',sizeBytes:92010,modifiedAt:new Date(Date.now()-60000).toISOString()}],clearAllLogs:async()=>({cleared:2,backups:[]}),openLogDirectory:async()=>true,
  getCodexHistoryUnifyStatus:async()=>({enabled:true,migrateExisting:true,hasBackup:true,liveUnified:true,codexDir:'/Users/demo/.codex',lastMigration:{migratedJsonlFiles:12,migratedStateRows:8}}),enableCodexHistoryUnify:async()=>({migratedJsonlFiles:0,migratedStateRows:0}),disableCodexHistoryUnify:async()=>({restoredJsonlFiles:0,restoredStateRows:0}),
  getAppConfigDirOverride:async()=>({path:'/Volumes/Shared/cc-switch',activePath:'/Users/demo/Library/Application Support/ztools/ztools-cc-switch',defaultPath:'/Users/demo/Library/Application Support/ztools/ztools-cc-switch',restartRequired:true}),chooseAppConfigDirectory:async()=>null,setAppConfigDirOverride:async path=>({path,activePath:'/tmp/current',defaultPath:'/tmp/default',restartRequired:true}),openClientConfigDirectory:async()=>true,openAppDataDirectory:async()=>true,
  getLocalBackupSettings:async()=>({intervalHours:24,retainCount:10}),saveLocalBackupSettings:async x=>x,listLocalBackups:async()=>[{filename:'db_backup_20260722_143000.snapshot.json',sizeBytes:48210,createdAt:new Date().toISOString()},{filename:'release_baseline.snapshot.json',sizeBytes:42100,createdAt:new Date(Date.now()-86400000).toISOString()}],createLocalBackup:async()=>({filename:'new.snapshot.json'}),restoreLocalBackup:async()=>({safetyBackup:'safety.snapshot.json'}),renameLocalBackup:async()=>'',deleteLocalBackup:async()=>true,
  getCommonConfigSnippet:async client=>client==='codex'?'approval_policy = "on-request"\n[tui]\nnotifications = false':'{\n  "permissions": { "defaultMode": "acceptEdits" }\n}',setCommonConfigSnippet:async(c,s)=>s,extractCommonConfigSnippet:async()=>'{\n  "permissions": { "allow": ["Read"] }\n}',
  listUniversalProviders:async()=>[{id:'newapi-main',name:'NewAPI Gateway',providerType:'newapi',baseUrl:'https://gateway.example.com',apiKey:'',hasApiKey:true,apps:{claude:true,codex:true,gemini:true},models:{claude:{model:'claude-sonnet-5',haikuModel:'claude-haiku-4-5',sonnetModel:'claude-sonnet-5',opusModel:'claude-opus-4-8'},codex:{model:'gpt-5.5',reasoningEffort:'high'},gemini:{model:'gemini-3.5-flash'}},iconColor:'#5EEAD4',createdAt:Date.now()}],
  saveUniversalProvider:async x=>({...x,id:x.id||'gateway-new',hasApiKey:true,apiKey:''}),syncUniversalProvider:async()=>({}),deleteUniversalProvider:async()=>true,
  getToolVersions:async()=>['claude','codex','gemini','grok','opencode','openclaw','hermes'].map((name,index)=>({name,version:index===6?null:`1.${index}.0`,latestVersion:`1.${index}.1`,error:index===6?'未安装':null,installedButBroken:false,envType:'macos',executablePath:index===6?null:`/opt/homebrew/bin/${name}`,source:index%2?'homebrew':'native'})),
  probeToolInstallations:async tools=>tools.map((tool,index)=>({tool,label:({claude:'Claude Code',codex:'Codex',gemini:'Gemini CLI',grok:'Grok Build',opencode:'OpenCode',openclaw:'OpenClaw',hermes:'Hermes'})[tool],installs:index===1?[{path:`/opt/homebrew/bin/${tool}`,version:'1.1.0',runnable:true,source:'homebrew',isPathDefault:true},{path:`/Users/demo/.nvm/bin/${tool}`,version:'1.0.0',runnable:true,source:'nvm',isPathDefault:false}]:index===6?[]:[{path:`/opt/homebrew/bin/${tool}`,version:`1.${index}.0`,runnable:true,source:index%2?'homebrew':'native',isPathDefault:true}],isConflict:index===1,needsConfirmation:index===1,command:index===6?'official installer':`${tool} update`,anchored:index!==6})),runToolLifecycleAction:async tools=>tools.map(tool=>({tool,success:true,anchored:true})),
  chooseProviderTerminalDirectory:async()=>'/Users/demo/work',openProviderTerminal:async(client,providerId,cwd)=>({launched:true,client,providerId,cwd}),
  getClaudeOnboardingStatus:async()=>({enabled:true,configured:true,path:'/Users/demo/.claude.json'}),setClaudeOnboardingSkip:async enabled=>({enabled,changed:true,path:'/Users/demo/.claude.json'}),
  getClaudePluginIntegrationStatus:async()=>({enabled:true,exists:true,path:'/Users/demo/.claude/config.json'}),setClaudePluginIntegration:async enabled=>({enabled,changed:true,exists:true,path:'/Users/demo/.claude/config.json'}),
  listProfiles:async()=>({profiles:[{id:'profile-1',name:'Signal Desk',payload:{providers:{claude:'anthropic'},mcp:{claude:[]},skills:{claude:['pdf']},prompts:{claude:null}},createdAt:Date.now()-86400000,updatedAt:Date.now()}],currentIds:{claude:'profile-1',codex:null}}),
  createProfile:async()=>({}),updateProfile:async()=>({}),deleteProfile:async()=>true,applyProfile:async()=>({warnings:[]}),clearCurrentProfile:async()=>true,
  listExtensions: async () => ({mcpServers:[],prompts:[]}),
  getClaudeMcpStatus:async()=>({userConfigExists:true,serverCount:2,userConfigPath:'/Users/demo/.claude.json'}),
  readClaudeMcpConfig:async()=>'{\n  "mcpServers": {\n    "filesystem": { "command": "npx", "env": { "API_TOKEN": "••••••••" } }\n  }\n}\n',
  importMcpFromApps:async()=>({imported:['claude:filesystem'],updated:[],errors:[]}),validateMcpCommand:async()=>true,
  getCurrentPromptFileContent:async()=> '# Current instructions\n\nKeep changes focused and verify every edit.',
  importPromptFromFile:async()=>({id:'imported-1',name:'导入的 Prompt',content:'Current instructions',apps:{}}),
  confirmDeepLinkImport:async()=>({type:'provider',id:'deep-provider',name:'Deep Provider',app:'claude',enabled:false}),cancelDeepLinkImport:async()=>true,
  listSkills: async () => ({skills:[
    {id:'anthropics/skills:skills/pdf',directory:'pdf',name:'PDF',description:'Read, create and inspect PDF files',repoOwner:'anthropics',repoName:'skills',repoBranch:'main',readmeUrl:'https://github.com/anthropics/skills',apps:{claude:true,codex:true,gemini:false}},
    {id:'local:frontend-design',directory:'frontend-design',name:'Frontend Design',description:'Production-grade interface design workflow',repoOwner:null,repoName:null,apps:{claude:true,codex:false,gemini:true,opencode:true}}
  ],storage:'plugin',syncMode:'symlink',storePath:'/tmp/ztools-data/skills'}),
  scanUnmanagedSkills:async()=>[{directory:'legacy-skill',name:'Legacy Skill',description:'Existing client skill',apps:{claude:true}}],
  listSkillRepos:async()=>[{owner:'anthropics',name:'skills',branch:'main',enabled:true},{owner:'JimLiu',name:'baoyu-skills',branch:'main',enabled:true}],
  listSkillBackups:async()=>[{backupId:'1720000000000-pdf-abc123',createdAt:Date.now()-3600000,reason:'before-update',skill:{directory:'pdf',name:'PDF',repoOwner:'anthropics',repoName:'skills'}}],
  getSkillUiPreferences:async()=>({tab:'installed',query:''}),setSkillUiPreferences:async x=>x,
  installSkillsFromZip:async()=>[],
  discoverSkills:async()=>({skills:[{key:'anthropics/skills:skills/slides',name:'Slides',description:'Create and edit slide decks',directory:'skills/slides',installDirectory:'slides',repoOwner:'anthropics',repoName:'skills',repoBranch:'main',installed:false}],errors:[]}),
  searchSkillsSh:async()=>({skills:[],totalCount:0,query:''}),checkSkillUpdates:async()=>[],
  addSkillRepo:async()=>[],removeSkillRepo:async()=>[],importUnmanagedSkills:async()=>[],installDiscoveredSkill:async x=>x,
  setSkillEnabled:async()=>({}),updateSkillSettings:async()=>({skills:[],storage:'plugin',syncMode:'symlink',storePath:'/tmp/skills'}),
  removeSkill:async()=>({}),updateSkill:async()=>({}),restoreSkillBackup:async()=>({name:'PDF'}),deleteSkillBackup:async()=>true,
  getRouterStatus: async () => ({running:false,url:'http://127.0.0.1:15721',circuitBreakers:[{client:'claude',providerId:'anthropic',state:'open',totalRequests:12,failedRequests:5,errorRate:.42,consecutiveFailures:4,openedAt:Date.now()-10000,retryAt:Date.now()+50000},{client:'codex',providerId:'openrouter',state:'open',totalRequests:8,failedRequests:4,errorRate:.5,consecutiveFailures:3,openedAt:Date.now()-8000,retryAt:Date.now()+52000}],config:{host:'127.0.0.1',port:15721,routes:{},rectifier:{},optimizer:{enabled:true,thinkingOptimizer:true,cacheInjection:true},copilotOptimizer:{enabled:true,requestClassification:true,toolResultMerging:true,compactDetection:true,deterministicRequestId:true,subagentDetection:true,warmupDowngrade:true,warmupModel:'gpt-5-mini',stripThinking:true},failover:{enabled:{claude:true,codex:true,gemini:true,opencode:true,openclaw:true,hermes:true,grokbuild:true},circuitBreaker:{failureThreshold:4,successThreshold:2,timeoutSeconds:60,errorRateThreshold:.6,minRequests:10}}}}),
  stopRouter:async()=>({running:false,url:'http://127.0.0.1:15721',config:{host:'127.0.0.1',port:15721,routes:{},rectifier:{},optimizer:{},copilotOptimizer:{},failover:{enabled:{},circuitBreaker:{}}}}),setRouterRoute:async function(client,enabled){this._routes[client]=enabled;return {client,enabled,autoStarted:enabled,autoStopped:!enabled,status:{running:enabled,url:'http://127.0.0.1:15721',config:{host:'127.0.0.1',port:15721,routes:{...this._routes},rectifier:{},optimizer:{},copilotOptimizer:{},failover:{enabled:{},circuitBreaker:{}}}}}},saveRouterConfig:async patch=>({host:'127.0.0.1',port:15721,routes:{...(patch.routes||{})},rectifier:{},optimizer:{},copilotOptimizer:{},failover:{enabled:{},circuitBreaker:{}}}),
  getFailoverQueue:async client=>client==='claude'?[{providerId:'anthropic',name:'Anthropic API',client,priority:1,model:'claude-sonnet-4-5',color:'#E69B62',authConfigured:true}]:client==='codex'?[{providerId:'openrouter',name:'OpenRouter',client,priority:1,model:'openai/gpt-5',color:'#9B8AFB',authConfigured:true}]:[],getAvailableProvidersForFailover:async()=>[{providerId:'kimi',name:'Kimi for Claude',model:'kimi-k2.5',color:'#F4B55F',authConfigured:true}],addToFailoverQueue:async()=>[],removeFromFailoverQueue:async()=>[],setAutoFailoverEnabled:async(client,enabled)=>({client,enabled,queue:[],config:(await window.ccSwitch.getRouterStatus()).config}),getAutoFailoverEnabled:async()=>true,
  resetCircuitBreaker:async()=>true,
  getUsageSummary: async () => ({requests:24,totalRequests:24,totalCost:'1.2845',realTotalTokens:842000,successRate:.958,cacheHitRate:.42,averageLatencyMs:612}),
  getRequestLogs: async () => ([
    {id:'req-1',createdAt:Date.now()-120000,client:'claude',providerId:'anthropic',providerName:'Anthropic',model:'claude-sonnet-4-5-20250929',requestModel:'claude-sonnet',pricingModel:'claude-sonnet-4-5-20250929',costMultiplier:'1',inputTokens:12500,outputTokens:2400,cacheReadTokens:8200,cacheCreationTokens:1000,inputCostUsd:'0.0375',outputCostUsd:'0.036',cacheReadCostUsd:'0.00246',cacheCreationCostUsd:'0.00375',totalCostUsd:'0.07971',latencyMs:842,firstTokenMs:162,statusCode:200,streaming:true,dataSource:'proxy'},
    {id:'req-2',createdAt:Date.now()-3600000,client:'codex',providerId:'openai',providerName:'OpenAI',model:'gpt-5.4',requestModel:'gpt-5.4',pricingModel:'gpt-5.4',costMultiplier:'1',inputTokens:9100,outputTokens:1800,cacheReadTokens:4300,cacheCreationTokens:0,inputCostUsd:'0.012',outputCostUsd:'0.027',cacheReadCostUsd:'0.001',cacheCreationCostUsd:'0',totalCostUsd:'0.04',latencyMs:530,firstTokenMs:110,statusCode:200,streaming:true,dataSource:'codex_session'}
  ]),
  getRequestDetail:async id=>(await window.ccSwitch.getRequestLogs()).find(x=>x.id===id),
  checkProviderLimits:async()=>({providerId:'anthropic',dailyUsage:'1.25',dailyLimit:'2',dailyExceeded:false,monthlyUsage:'18.7',monthlyLimit:'40',monthlyExceeded:false}),
  getUsageTrends:async()=>Array.from({length:7},(_,i)=>({date:new Date(Date.now()-(6-i)*86400000).toISOString(),requestCount:3+i,totalCost:String(.1*i),totalTokens:50000+i*18000,totalInputTokens:30000+i*10000,totalOutputTokens:10000+i*5000,totalCacheCreationTokens:2000,totalCacheReadTokens:8000+i*3000})),
  getProviderStats:async()=>[{providerId:'anthropic',providerName:'Anthropic',requestCount:15,totalTokens:520000,totalCost:'0.92',successRate:.97,avgLatencyMs:620},{providerId:'openai',providerName:'OpenAI',requestCount:9,totalTokens:322000,totalCost:'.36',successRate:.93,avgLatencyMs:580}],
  getModelStats:async()=>[{model:'claude-sonnet-4-5-20250929',requestCount:15,totalTokens:520000,totalCost:'.92',avgCostPerRequest:'.061'},{model:'gpt-5.4',requestCount:9,totalTokens:322000,totalCost:'.36',avgCostPerRequest:'.04'}],
  getUsageSummaryByApp:async()=>[],
  getModelPricing:async()=>[{modelId:'claude-sonnet-4-5-20250929',displayName:'Claude Sonnet 4.5',inputCostPerMillion:'3',outputCostPerMillion:'15',cacheReadCostPerMillion:'.3',cacheCreationCostPerMillion:'3.75',builtin:true},{modelId:'gpt-5.4',displayName:'GPT-5.4',inputCostPerMillion:'2.5',outputCostPerMillion:'15',cacheReadCostPerMillion:'.25',cacheCreationCostPerMillion:'0',builtin:true}],updateModelPricing:async x=>({...x,backfilled:0}),deleteModelPricing:async()=>true,
  getBillingDefaults:async()=>({claude:{multiplier:'1.2',source:'response'},codex:{multiplier:'1',source:'request'},gemini:{multiplier:'0.9',source:'response'},grokbuild:{multiplier:'1.1',source:'request'}}),saveBillingDefaults:async x=>x,
  getUsageImportStatus:async()=>({sources:[{dataSource:'proxy',requestCount:12},{dataSource:'session_log',requestCount:28},{dataSource:'codex_session',requestCount:16}]}),syncSessionUsage:async()=>({imported:0,errors:[]}),confirmCodexUsageRebuild:async()=>true,rebuildCodexUsage:async()=>({removed:16,imported:15,backupsCreated:2,errors:[]}),
  getAllSubscriptionQuotas: async () => ([
    {tool:'claude',credentialStatus:'valid',success:true,tiers:[{name:'five_hour',utilization:42.5,resetsAt:new Date(Date.now()+3600000).toISOString()},{name:'seven_day',utilization:78,resetsAt:new Date(Date.now()+86400000).toISOString()}],extraUsage:{isEnabled:true,usedCredits:8,monthlyLimit:100,currency:'USD'}},
    {tool:'codex',credentialStatus:'not_found',credentialMessage:null,success:false,tiers:[],extraUsage:null},
    {tool:'gemini',credentialStatus:'valid',success:true,tiers:[{name:'gemini_pro',utilization:55,resetsAt:null},{name:'gemini_flash',utilization:12,resetsAt:null}],extraUsage:null},
    {tool:'codex_oauth',accountId:'acct-1',accountLabel:'dev@example.com',credentialStatus:'valid',success:true,tiers:[{name:'five_hour',utilization:18,resetsAt:null}],extraUsage:null}
  ]),
  listCodingPlanProviders:async()=>[{id:'kimi-plan',name:'Kimi Coding',baseUrl:'https://api.kimi.com/coding/v1',type:'kimi',hasApiKey:true,codingPlanProvider:'auto',secureStorage:true},{id:'volc-plan',name:'Volcengine Ark',baseUrl:'https://ark.cn-beijing.volces.com/api/coding',type:'volcengine',hasApiKey:true,codingPlanProvider:'auto',hasAccessKeyId:true,hasSecretAccessKey:true,secureStorage:true}],
  queryCodingPlanQuota:async id=>({tool:'coding_plan',credentialStatus:'valid',credentialMessage:id==='volc-plan'?'Agent Plan Pro':'Coding Pro',success:true,tiers:[{name:'five_hour',utilization:id==='volc-plan'?25:41,resetsAt:new Date(Date.now()+3600000).toISOString()},{name:'weekly_limit',utilization:62,resetsAt:new Date(Date.now()+86400000).toISOString()}],extraUsage:null,error:null,queriedAt:Date.now()}),saveCodingPlanCredentials:async()=>({hasAccessKeyId:true,hasSecretAccessKey:true,secureStorage:true}),
  getConnectivityCheckConfig:async()=>({timeoutSecs:8,maxRetries:1,degradedThresholdMs:6000}),saveConnectivityCheckConfig:async x=>x,
  checkAllProviderReachability:async client=>[['anthropic',{providerId:'anthropic',providerName:'Anthropic API',client,status:'operational',success:true,message:'Reachable',responseTimeMs:128,httpStatus:401,testedAt:Date.now(),retryCount:0}],['kimi',{providerId:'kimi',providerName:'Kimi for Claude',client,status:'degraded',success:true,message:'Reachable',responseTimeMs:6820,httpStatus:403,testedAt:Date.now(),retryCount:1}]],
  testEndpoints: async urls => urls.map((url,index)=>({url,status:index?401:200,latency:120+index*330,error:null})),
  listBalanceProviders:async()=>[{id:'openrouter',name:'OpenRouter',providerType:'openrouter',hasCredential:true}],queryProviderBalance:async()=>({success:true,data:[{planName:'OpenRouter',remaining:12.75,total:20,used:7.25,unit:'USD',isValid:true}],error:null}),
  getUsageScriptTemplates:()=>({custom:'({request:{url:"",method:"GET",headers:{}},extractor:function(response){return {remaining:0,unit:"USD"}}})',general:'({request:{url:"{{baseUrl}}/user/balance",method:"GET",headers:{}},extractor:function(response){return {remaining:response.balance,unit:"USD"}}})',new_api:'({request:{url:"{{baseUrl}}/api/user/self",method:"GET",headers:{}},extractor:function(response){return {remaining:response.data.quota,unit:"USD"}}})'}),
  getProviderUsageScript:async()=>({enabled:true,templateType:'general',code:'({request:{url:"{{baseUrl}}/user/balance",method:"GET",headers:{}},extractor:function(response){return {remaining:response.balance,unit:"USD"}}})',baseUrl:'',timeout:10,autoQueryInterval:30,hasApiKey:true,hasAccessToken:false,hasUserId:false,secureStorage:true}),
  saveProviderUsageScript:async(_id,x)=>x,testProviderUsageScript:async()=>({success:true,data:[{planName:'Developer',remaining:8.5,total:20,used:11.5,unit:'USD'}],queriedAt:Date.now()}),
  listConfiguredUsageScripts:async()=>[{id:'anthropic',name:'Anthropic API',clients:['claude'],enabled:true,templateType:'general',autoQueryInterval:30,hasApiKey:true,secureStorage:true}],queryProviderUsage:async()=>({success:true,data:[{planName:'Developer',remaining:8.5,total:20,used:11.5,unit:'USD'}],queriedAt:Date.now()}),
  getCustomEndpoints:async()=>[{url:'https://edge.openrouter.ai/api/v1',addedAt:Date.now()-86400000,lastUsed:null}],addCustomEndpoint:async(c,p,url)=>[{url,addedAt:Date.now(),lastUsed:null}],removeCustomEndpoint:async()=>true,selectCustomEndpoint:async()=>({applied:true}),
  listSessions: async () => ([
    {providerId:'claude',sessionId:'claude-1',title:'重构认证中心',summary:'检查 OAuth 多账号切换与安全存储',projectDir:'/Users/demo/work/signal-desk',createdAt:Date.now()-7200000,lastActiveAt:Date.now()-3600000,sourcePath:'/mock/claude-1.jsonl',resumeCommand:'claude --resume claude-1',storageType:'file'},
    {providerId:'claude',sessionId:'claude-2',title:'修复路由流式转换',summary:'验证 SSE 首 Token 与工具调用参数',projectDir:'/Users/demo/work/signal-desk',createdAt:Date.now()-9000000,lastActiveAt:Date.now()-8000000,sourcePath:'/mock/claude-2.jsonl',resumeCommand:'claude --resume claude-2',storageType:'file'},
    {providerId:'codex',sessionId:'codex-1',title:'实现 S3 快照同步',summary:'SigV4、manifest 和冲突处理',projectDir:'/Users/demo/work/ztools',createdAt:Date.now()-500000,lastActiveAt:Date.now()-100000,sourcePath:'/mock/codex-1.jsonl',resumeCommand:'codex resume codex-1',storageType:'file'},
    {providerId:'opencode',sessionId:'ses_sql',title:'OpenCode SQLite session',summary:'数据库格式的会话记录',projectDir:'/Users/demo/work/open',createdAt:Date.now()-500000,lastActiveAt:Date.now()-200000,sourcePath:'sqlite:/mock/opencode.db:ses_sql',resumeCommand:'opencode -s ses_sql',storageType:'sqlite'}
    ,{providerId:'grokbuild',sessionId:'grok-1',title:'Grok Build session',summary:'原生 summary 与 chat history',projectDir:'/Users/demo/work/grok',createdAt:Date.now()-400000,lastActiveAt:Date.now()-100000,sourcePath:'/mock/grok/summary.json',resumeCommand:'grok --resume grok-1',storageType:'file'}
  ]),
  getSessionMessages: async () => ([{role:'user',content:'请实现 Sessions 管理',ts:Date.now()-2000},{role:'assistant',content:'正在扫描 Claude、Codex 与 Gemini 会话。',ts:Date.now()-1000},{role:'tool',content:'[Tool: read]',ts:Date.now()}]),
  deleteSessions:async items=>items.map(x=>({...x,success:true})),launchSession:async()=>({launched:true,command:'codex resume codex-1'}),
  listSessionTrash:async()=>[{trashId:'trash-session-1',providerId:'claude',sessionId:'old-1',title:'已删除会话',deletedAt:Date.now()-3600000}],restoreSessionTrash:async()=>({restored:true}),
  listWorkspaceFiles:async()=>['AGENTS.md','SOUL.md','USER.md','IDENTITY.md','TOOLS.md','MEMORY.md','HEARTBEAT.md','BOOTSTRAP.md','BOOT.md'].map((filename,index)=>({filename,exists:index<6,sizeBytes:1200+index*80,modifiedAt:Date.now()-index*3600000})),
  listDailyMemoryFiles:async()=>[{filename:'2026-07-22.md',date:'2026-07-22',sizeBytes:2048,modifiedAt:Date.now(),preview:'完成了 Workspace 与 Daily Memory 的 ZTools 迁移。'},{filename:'2026-07-21.md',date:'2026-07-21',sizeBytes:1540,modifiedAt:Date.now()-86400000,preview:'检查本地路由和 Provider 切换。'}],
  listDailyMemoryTrash:async()=>[{trashId:'trash-1',filename:'2026-07-19.md',deletedAt:Date.now()-7200000}],
  readWorkspaceFile:async filename=>`# ${filename}\n\nWorkspace mock content.`,readDailyMemoryFile:async filename=>`# ${filename}\n\nDaily memory mock content.`,
  writeWorkspaceFile:async()=>({}),writeDailyMemoryFile:async()=>({}),searchDailyMemoryFiles:async()=>[],deleteDailyMemoryFile:async()=>({}),restoreDailyMemoryTrash:async()=>({}),openWorkspaceDirectory:async()=>true,
  scanEnvConflicts:async()=>[{id:'process:ANTHROPIC_API_KEY',varName:'ANTHROPIC_API_KEY',maskedValue:'sk-••••ret',sourceType:'process',sourcePath:'当前 ZTools 进程环境',lineNumber:null,fixable:false},{id:'file:.zshrc:18:ANTHROPIC_BASE_URL',varName:'ANTHROPIC_BASE_URL',maskedValue:'htt••••com',sourceType:'file',sourcePath:'/Users/demo/.zshrc',lineNumber:18,fixable:true}],
  getOpenClawAgentsDefaults:async()=>({model:{primary:'openrouter/claude-sonnet-4.5',fallbacks:['anthropic/claude-sonnet-4.5']},workspace:'~/workspace',timeoutSeconds:300,contextTokens:120000,maxConcurrent:4}),
  getOpenClawDefaultModel:async()=>({primary:'openrouter/claude-sonnet-4.5',fallbacks:['anthropic/claude-sonnet-4.5'],reasoning:'high'}),setOpenClawDefaultModel:async()=>({warnings:[]}),
  getOpenClawModelCatalog:async()=>({'openrouter/claude-sonnet-4.5':{alias:'Sonnet',temperature:.2},'anthropic/claude-sonnet-4.5':{alias:'Direct'}}),setOpenClawModelCatalog:async()=>({warnings:[]}),
  setOpenClawAgentsDefaults:async()=>({warnings:[]}),getOpenClawTools:async()=>({profile:'coding',allow:['read','exec'],deny:['browser']}),setOpenClawTools:async()=>({warnings:[]}),
  getOpenClawEnv:async()=>({vars:{NODE_ENV:'production'},shellEnv:{enabled:true}}),setOpenClawEnv:async()=>({warnings:[]}),scanOpenClawHealth:async()=>[],
  getHermesMemory:async kind=>kind==='memory'?'# Agent Memory\n\nRemember project conventions.':'# User Profile\n\nPrefers concise answers.',setHermesMemory:async()=>({}),
  getHermesModelConfig:async()=>({default:'claude-sonnet-4.5',provider:'openrouter',context_length:200000,max_tokens:8192}),probeHermesWebUi:async()=>({online:true,statusCode:401,baseUrl:'http://127.0.0.1:9119',error:null}),openHermesWebUi:async()=>({online:true,opened:true}),launchHermesDashboard:async()=>({launched:true,command:'hermes dashboard'}),
  getHermesMemoryLimits:async()=>({memory:2200,user:1375,memoryEnabled:true,userEnabled:true}),setHermesMemoryEnabled:async(kind,enabled)=>({memory:2200,user:1375,memoryEnabled:kind==='memory'?enabled:true,userEnabled:kind==='user'?enabled:true}),
  listOmoProfiles:async()=>({profiles:[{id:'omo-standard-1',variant:'standard',name:'Research Team',settingsConfig:{agents:{sisyphus:{model:'anthropic/claude-sonnet-4.5'},oracle:{model:'openai/gpt-5.4'}},categories:{deep:{model:'openai/gpt-5.4'}},otherFields:{$schema:'https://example.com/omo.schema.json',disabled_agents:['explore']}},createdAt:Date.now()-86400000,updatedAt:Date.now()}],current:{standard:'omo-standard-1',slim:''},local:{standard:{exists:true,filePath:'/Users/demo/.config/opencode/oh-my-openagent.jsonc'},slim:{exists:false,filePath:'/Users/demo/.config/opencode/oh-my-opencode-slim.jsonc'}}}),
  readOmoLocalFile:async()=>({exists:true}),saveOmoProfile:async x=>({...x,id:x.id||'omo-new'}),activateOmoProfile:async()=>({}),disableOmo:async()=>true,importOmoLocal:async()=>({id:'omo-import',name:'Imported OMO'}),deleteOmoProfile:async()=>true,openOmoDirectory:async()=>true,
  listEnvBackups:async()=>[{id:'backup.json',app:'claude',createdAt:Date.now()-86400000,itemCount:1}],fixEnvConflicts:async()=>({fixed:1,backupId:'backup.json'}),restoreEnvBackup:async()=>({restored:1}),
  getWebdavConfig: async () => ({url:'https://dav.example.com/root',username:'demo',remotePath:'ai-provider-switch/backup.json',autoSync:true,intervalMinutes:30,conflictStrategy:'ask',includeLogs:true,hasPassword:true,secureStorage:true}),
  getOutboundProxyConfig:async()=>({enabled:true,url:'http://127.0.0.1:7890',username:'',hasPassword:false,secureStorage:true,effectiveMode:'explicit',systemProxy:null}),
  saveOutboundProxyConfig:async x=>({...x,hasPassword:false,secureStorage:true,effectiveMode:x.enabled?'explicit':'direct'}),testOutboundProxy:async()=>({success:true,latencyMs:48,status:200,error:null}),scanLocalProxies:async()=>[{url:'http://127.0.0.1:7890',proxyType:'http',port:7890},{url:'socks5://127.0.0.1:7890',proxyType:'socks5',port:7890}],
  getWebdavStatus: () => ({state:'synced',message:'本地与 WebDAV 已同步',lastSyncAt:new Date().toISOString()}), onWebdavStatus: () => () => {},
  getS3Config: async () => ({enabled:true,autoSync:false,intervalMinutes:30,region:'auto',bucket:'signal-desk',accessKeyId:'AKIDEXAMPLE',endpoint:'https://account.r2.cloudflarestorage.com',remoteRoot:'cc-switch-sync',profile:'default',includeLogs:true,conflictStrategy:'ask',hasSecretAccessKey:true,secureStorage:true}),
  getS3Status: () => ({state:'synced',message:'S3 快照已同步',lastSyncAt:new Date().toISOString()}), onS3Status: () => () => {},
  testS3Connection:async()=>({ok:true,message:'S3 连接成功'}),getS3RemoteInfo:async()=>null,syncS3:async()=>({state:'synced',message:'已同步'}),uploadS3:async()=>({state:'synced',message:'已上传'}),downloadS3:async()=>({state:'synced',message:'已下载'}),saveS3Config:async x=>x,
  listAuthProviders: async () => ([
    {id:'codex_oauth',name:'ChatGPT / Codex',secureStorage:true,defaultAccountId:'acct-1',authenticated:true,accounts:[{id:'acct-1',label:'dev@example.com',email:'dev@example.com',domain:'chatgpt.com',isDefault:true,requiresReauth:false}]},
    {id:'xai_oauth',name:'xAI / Grok',secureStorage:true,defaultAccountId:'',authenticated:false,accounts:[]},
    {id:'github_copilot',name:'GitHub Copilot',secureStorage:true,defaultAccountId:'gh:42',authenticated:true,accounts:[{id:'gh:42',label:'octocat',email:'',domain:'github.com',isDefault:true,requiresReauth:false}]}
  ]),
  startAuthLogin: async id => ({flowId:'flow-1',providerId:id,userCode:'ABCD-EFGH',verificationUri:'https://example.com/device',expiresIn:900,interval:5}),copyText:async()=>true,
  pollAuthLogin: async () => ({state:'pending',retryAfterMs:5000,message:'等待浏览器授权'}),
  setDefaultAuthAccount: async()=>({}), removeAuthAccount:async()=>true, openExternal:async()=>true,
  saveProvider: async x => x, deleteProvider:async()=>true, updateProviderSortOrder:async(c,ids)=>ids, switchProvider:async()=>({}), testProvider:async()=>({ok:true,latency:42,message:'连接成功'}),
  fetchModelsForConfig:async()=>[{id:'claude-sonnet-4-5',ownedBy:'anthropic'},{id:'deepseek-chat',ownedBy:'deepseek'},{id:'gpt-5.4',ownedBy:'openai'},{id:'gpt-5.4-mini',ownedBy:'openai'}],fetchManagedModels:async()=>[{id:'gpt-5.4',ownedBy:'Codex'}],
  importLiveProviders:async()=>({imported:[],skipped:[]}),importClaudeDesktopProvidersFromClaude:async()=>({imported:['anthropic'],skipped:[]}),openClaudeDesktopConfigLibrary:async()=>true
}
"""

def verify(page, width, height, screenshot):
    page.set_viewport_size({"width": width, "height": height})
    page.goto("http://127.0.0.1:5179")
    page.wait_for_load_state("networkidle")
    assert page.evaluate("document.documentElement.dataset.theme") == "light"
    assert page.locator(".rail-brand").is_visible()
    assert page.locator('.client-node .node-status.routed').count() == 0
    assert page.evaluate("document.documentElement.scrollWidth <= document.documentElement.clientWidth")
    page.screenshot(path=screenshot.replace(".png", "-main.png"), full_page=True)
    page.locator('.provider-card .terminal-button').first.click()
    page.wait_for_selector('.toast-item')
    assert '终端已打开' in page.locator('.toast-item').last.inner_text()
    page.locator('.toast-item').last.click()
    page.get_by_role("button", name="添加 Provider").click()
    modal = page.locator(".provider-modal").bounding_box()
    assert modal and modal["width"] <= width * .95 and modal["height"] <= height * .93
    assert page.locator(".provider-modal form").evaluate("el => el.scrollHeight >= el.clientHeight")
    page.screenshot(path=screenshot, full_page=True)
    page.locator(".modal-close").click()
    page.locator('.profile-trigger').click()
    page.wait_for_selector('.profile-popover')
    page.locator('.profile-popover footer button').last.click()
    page.wait_for_selector('.profile-manage-modal')
    page.wait_for_timeout(200)
    profile_modal = page.locator('.profile-manage-modal').bounding_box()
    if width > 820:
        assert profile_modal and width * .8 <= profile_modal['width'] <= width * .83 and height * .78 <= profile_modal['height'] <= height * .81, profile_modal
    else:
        assert profile_modal and width * .9 <= profile_modal['width'] <= width * .95 and height * .88 <= profile_modal['height'] <= height * .93, profile_modal
    page.screenshot(path=screenshot.replace('.png', '-profiles.png'), full_page=True)
    page.locator('.profile-manage-modal .modal-header .icon-button').click()

with sync_playwright() as p:
    browser_candidates = [
        Path.home() / "Library/Caches/ms-playwright/chromium_headless_shell-1223/chrome-headless-shell-mac-arm64/chrome-headless-shell",
        Path("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"),
        Path("/Applications/Chromium.app/Contents/MacOS/Chromium"),
    ]
    installed = next((candidate for candidate in browser_candidates if candidate.exists()), None)
    browser = p.chromium.launch(headless=True, executable_path=str(installed) if installed else None)
    page = browser.new_page()
    page.add_init_script(MOCK)
    verify(page, 1440, 900, "/tmp/ztools-cc-switch-wide.png")
    verify(page, 640, 540, "/tmp/ztools-cc-switch-narrow.png")
    page.set_viewport_size({"width": 800, "height": 487})
    page.goto("http://127.0.0.1:5179"); page.wait_for_load_state("networkidle")
    assert page.locator('.rail-brand-copy').is_visible()
    assert page.locator('.client-node .nav-label').first.is_visible()
    assert page.locator('.rail-tools button em').first.is_visible()
    assert page.evaluate("document.documentElement.scrollWidth <= document.documentElement.clientWidth")
    status_box = page.locator('.status-header').bounding_box()
    assert status_box and status_box['height'] <= 150, status_box
    cards = page.locator('.provider-card')
    assert cards.count() >= 2
    assert page.locator('.sort-buttons').count() == 0
    first_card, second_card = cards.nth(0).bounding_box(), cards.nth(1).bounding_box()
    assert first_card and second_card and abs(first_card['y'] - second_card['y']) < 2 and second_card['x'] > first_card['x']
    assert first_card['height'] <= 225, first_card
    cards.nth(0).drag_to(cards.nth(1), target_position={"x": 30, "y": second_card["height"] - 6})
    page.wait_for_timeout(120)
    assert 'Kimi' in page.locator('.provider-card').first.inner_text()
    page.screenshot(path="/tmp/ztools-cc-switch-ztools-retina-viewport.png", full_page=True)
    page.set_viewport_size({"width": 1440, "height": 900})
    page.goto("http://127.0.0.1:5179"); page.wait_for_load_state("networkidle")
    page.locator('.client-node[title="OpenCode"]').click()
    page.wait_for_selector('.live-config-badge')
    assert page.locator('.live-remove-button').count() == 1
    assert 'live' in page.locator('.live-config-badge').inner_text().lower()
    page.screenshot(path="/tmp/ztools-cc-switch-opencode-live-provider.png", full_page=True)
    page.locator('.client-node[title="Claude Desktop"]').click()
    page.wait_for_selector('.desktop-status-strip')
    assert '官方 1P 模式' in page.locator('.desktop-status-strip').inner_text()
    page.get_by_role("button", name="添加 Provider").click()
    page.wait_for_selector('.desktop-route-console')
    page.wait_for_timeout(300)
    desktop_modal = page.locator('.provider-modal').bounding_box()
    assert desktop_modal and desktop_modal['width'] <= 1440 * .86 and desktop_modal['height'] <= 900 * .88
    assert page.locator('.desktop-route-list article').count() == 3
    page.screenshot(path="/tmp/ztools-cc-switch-claude-desktop-wide.png", full_page=True)
    page.locator('.desktop-route-console').scroll_into_view_if_needed(); page.wait_for_timeout(100)
    page.screenshot(path="/tmp/ztools-cc-switch-claude-desktop-routes-wide.png", full_page=True)
    page.set_viewport_size({"width": 640, "height": 540}); page.wait_for_timeout(150)
    desktop_modal = page.locator('.provider-modal').bounding_box()
    assert desktop_modal and desktop_modal['width'] <= 640 * .95 and desktop_modal['height'] <= 540 * .93
    assert page.evaluate("document.documentElement.scrollWidth <= document.documentElement.clientWidth")
    page.screenshot(path="/tmp/ztools-cc-switch-claude-desktop-narrow.png", full_page=True)
    page.locator('.provider-modal .modal-close').click()
    page.set_viewport_size({"width": 1440, "height": 900})
    page.goto("http://127.0.0.1:5179"); page.wait_for_load_state("networkidle")
    page.evaluate("""window.dispatchEvent(new CustomEvent('cc-switch:deeplink',{detail:{pendingId:'pending-1',preview:{resource:'provider',app:'claude',name:'Deep Provider',endpoint:['https://api.example.com/v1'],model:'claude-sonnet',maskedApiKey:'sk-t************',enabled:false}}}))""")
    page.wait_for_selector('.deeplink-modal'); page.wait_for_timeout(300)
    deeplink_modal = page.locator('.deeplink-modal').bounding_box()
    assert deeplink_modal and 1440 * .6 <= deeplink_modal['width'] <= 1440 * .77 and 900 * .75 <= deeplink_modal['height'] <= 900 * .8, deeplink_modal
    assert 'sk-t************' in page.locator('.deeplink-modal').inner_text()
    page.screenshot(path="/tmp/ztools-cc-switch-deeplink-wide.png", full_page=True)
    page.set_viewport_size({"width": 640, "height": 540}); page.wait_for_timeout(100)
    deeplink_modal = page.locator('.deeplink-modal').bounding_box()
    assert deeplink_modal and 640 * .915 <= deeplink_modal['width'] <= 640 * .95 and 540 * .895 <= deeplink_modal['height'] <= 540 * .93, deeplink_modal
    page.screenshot(path="/tmp/ztools-cc-switch-deeplink-narrow.png", full_page=True)
    page.locator('.deeplink-modal .modal-header .icon-button').click()
    page.set_viewport_size({"width": 1440, "height": 900})
    page.goto("http://127.0.0.1:5179"); page.wait_for_load_state("networkidle")
    page.get_by_role("button", name="添加 Provider").click()
    page.locator('#provider-base-url').fill('https://api.example.com/v1')
    page.locator('#provider-api-key').fill('sk-model-test')
    page.get_by_role('button', name='获取模型').click()
    page.wait_for_selector('.model-picker')
    assert page.locator('.model-picker > div button').count() == 4
    page.locator('.model-picker header input').fill('gpt')
    assert page.locator('.model-picker > div button').count() == 2
    page.locator('.model-picker > div button').first.click()
    assert page.locator('#provider-model').input_value() == 'gpt-5.4'
    page.screenshot(path='/tmp/ztools-cc-switch-model-picker-wide.png', full_page=True)
    page.set_viewport_size({"width": 640, "height": 540}); page.wait_for_timeout(100)
    assert page.evaluate("document.documentElement.scrollWidth <= document.documentElement.clientWidth")
    narrow_provider_modal = page.locator('.provider-modal').bounding_box()
    assert narrow_provider_modal and narrow_provider_modal['width'] <= 640 * .95 and narrow_provider_modal['height'] <= 540 * .93, narrow_provider_modal
    model_picker = page.locator('.model-picker')
    model_picker.scroll_into_view_if_needed()
    page.wait_for_timeout(100)
    assert model_picker.is_visible()
    assert model_picker.locator('> div button').first.is_enabled()
    page.screenshot(path='/tmp/ztools-cc-switch-model-picker-narrow.png', full_page=True)
    page.locator('.provider-modal .modal-close').click()
    page.set_viewport_size({"width": 1440, "height": 900})
    page.locator('.rail-tools button[title="MCP 与 Prompts"]').click()
    page.wait_for_selector("h1:has-text('MCP 与 Prompts')")
    page.wait_for_selector('.mcp-import-toolbar')
    assert page.locator('.mcp-import-toolbar button').count() == 2
    page.screenshot(path="/tmp/ztools-cc-switch-extensions.png", full_page=True)
    page.get_by_role('button', name='查看脱敏配置').click()
    page.wait_for_selector('.mcp-preview-modal')
    page.wait_for_timeout(200)
    assert '••••••••' in page.locator('.mcp-preview-modal textarea').input_value()
    page.screenshot(path="/tmp/ztools-cc-switch-mcp-preview-wide.png", full_page=True)
    page.locator('.mcp-preview-modal .modal-close').click()
    page.get_by_role('button', name='Prompts 0').click()
    page.wait_for_selector('.prompt-live-toolbar')
    assert page.locator('.prompt-live-toolbar button').count() == 2
    page.get_by_role('button', name='查看当前文件').click()
    page.wait_for_selector('.prompt-preview-modal')
    page.wait_for_timeout(200)
    prompt_modal = page.locator('.prompt-preview-modal').bounding_box()
    assert prompt_modal and 1440 * .84 <= prompt_modal['width'] <= 1440 * .89 and 900 * .84 <= prompt_modal['height'] <= 900 * .88, prompt_modal
    page.screenshot(path="/tmp/ztools-cc-switch-prompt-preview-wide.png", full_page=True)
    page.set_viewport_size({"width": 640, "height": 540}); page.wait_for_timeout(100)
    prompt_modal = page.locator('.prompt-preview-modal').bounding_box()
    assert prompt_modal and 640 * .915 <= prompt_modal['width'] <= 640 * .95 and 540 * .895 <= prompt_modal['height'] <= 540 * .93, prompt_modal
    assert page.evaluate("document.documentElement.scrollWidth <= document.documentElement.clientWidth")
    page.screenshot(path="/tmp/ztools-cc-switch-prompt-preview-narrow.png", full_page=True)
    page.locator('.prompt-preview-modal .modal-close').click()
    page.set_viewport_size({"width": 1440, "height": 900})
    page.locator('.rail-settings').click()
    page.wait_for_selector('.settings-tabbar')
    assert page.locator('.settings-tabbar button').count() == 5
    assert page.locator('.theme-options button').count() == 3
    assert page.locator('.client-visibility-grid > article').count() == 8
    page.get_by_role('button', name='只显示 Codex', exact=True).click()
    assert page.locator('.client-node').count() == 1
    assert page.locator('.client-node').first.get_attribute('title') == 'Codex'
    page.get_by_role('button', name='全部显示').click()
    assert page.locator('.client-node').count() == 8
    page.get_by_role('radio', name='深色 夜间').click()
    assert page.evaluate("document.documentElement.dataset.theme") == "dark"
    assert page.evaluate("document.documentElement.scrollWidth <= document.documentElement.clientWidth")
    page.screenshot(path="/tmp/ztools-cc-switch-settings-dark-optional.png", full_page=True)
    page.get_by_role('radio', name='浅色 默认').click()
    assert page.evaluate("document.documentElement.dataset.theme") == "light"
    page.locator('.toast-item').evaluate_all("els => els.forEach(el => el.click())")
    page.wait_for_timeout(250)
    page.get_by_role('tab', name='客户端 配置与工具').click()
    page.wait_for_selector("text=跳过初次安装确认", state='visible')
    page.wait_for_selector('.tool-runtime-row')
    assert page.locator('.tool-runtime-row:not(.tool-runtime-head)').count() == 7
    assert page.locator('.onboarding-card .toggle-switch').first.get_attribute('aria-checked') == 'true'
    assert page.locator('.onboarding-card .claude-plugin-toggle').get_attribute('aria-checked') == 'true'
    assert page.locator('.path-open-button').count() == 4
    page.get_by_role('tab', name='高级 宿主与网络').click()
    page.wait_for_selector("text=宿主启动策略", state='visible')
    page.wait_for_selector("text=Codex History Unify", state='visible')
    page.wait_for_selector("text=路由引擎应急控制", state='visible')
    assert page.get_by_role('button', name='停止并恢复全部路由').is_disabled()
    page.get_by_role('tab', name='数据 日志与备份').click()
    page.wait_for_selector("text=日志级别与保留", state='visible')
    assert page.locator('.log-policy-grid input').count() == 3
    assert page.get_by_role('button', name='在 ZTools 中打开数据目录').is_visible()
    page.get_by_role('tab', name='同步 WebDAV / S3').click()
    page.wait_for_selector("text=WebDAV 云同步", state='visible')
    page.wait_for_selector("text=S3 快照同步", state='visible')
    assert page.evaluate("document.documentElement.scrollWidth <= document.documentElement.clientWidth")
    page.screenshot(path="/tmp/ztools-cc-switch-webdav-settings.png", full_page=True)
    page.set_viewport_size({"width": 640, "height": 540})
    assert page.evaluate("document.documentElement.scrollWidth <= document.documentElement.clientWidth")
    page.screenshot(path="/tmp/ztools-cc-switch-s3-settings-narrow.png", full_page=True)
    page.set_viewport_size({"width": 1440, "height": 900})
    page.locator('.client-node[title="Codex"]').click()
    route_control = page.locator('.client-route-control')
    assert route_control.is_visible()
    route_control_box = route_control.bounding_box()
    assert route_control_box and route_control_box['width'] >= 210 and route_control_box['height'] >= 46, route_control_box
    route_control.locator('input[type="checkbox"]').check()
    page.wait_for_selector('.client-route-control.active')
    assert page.locator('.client-node[title="Codex"] .node-status.routed').count() == 1
    assert 'local route active' in page.locator('.status-copy .eyebrow').inner_text().lower()
    assert page.locator('.provider-card.route-active').count() == 1
    assert 'routed' in page.locator('.provider-card.route-active .active-badge').inner_text().lower()
    page.get_by_role('button', name='打开路由设置').click()
    page.wait_for_selector("h1:has-text('Codex 路由')")
    assert page.get_by_role('button', name='停止路由引擎').count() == 0
    assert page.get_by_role('button', name='启动路由引擎').count() == 0
    assert page.locator('.router-engine-state').is_visible()
    assert page.locator('.client-route-card').count() == 0
    assert page.locator('.router-client-toggle').is_visible()
    assert 'codex' in page.locator('.router-client-toggle').inner_text().lower()
    assert page.locator('.breaker-config-card input').count() == 5
    assert page.locator('.breaker-health-list em.open').count() == 1
    assert page.locator('.failover-queue-row').count() == 1
    page.screenshot(path="/tmp/ztools-cc-switch-router-health.png", full_page=True)
    page.set_viewport_size({"width": 640, "height": 540})
    assert page.evaluate("document.documentElement.scrollWidth <= document.documentElement.clientWidth")
    page.screenshot(path="/tmp/ztools-cc-switch-router-health-narrow.png", full_page=True)
    page.set_viewport_size({"width": 1440, "height": 900})
    page.locator('.rail-tools button[title="用量与日志"]').click()
    page.wait_for_selector("h1:has-text('用量与健康')")
    page.wait_for_selector('.usage-trend-card')
    assert page.locator('.usage-stat-board').count() == 2
    assert page.locator('.provider-limit-grid article').count() == 1
    assert 'Anthropic API' in page.locator('.provider-limit-grid').inner_text()
    assert page.get_by_role('button', name='重建 Codex').is_visible()
    page.screenshot(path="/tmp/ztools-cc-switch-usage-overview.png", full_page=True)
    page.get_by_role('button', name='重建 Codex').click()
    page.wait_for_selector('.toast-item')
    assert '移除 16 条，导入 15 条' in page.locator('.toast-item').last.inner_text()
    page.locator('.toast-item').last.click()
    page.set_viewport_size({"width": 640, "height": 540}); page.wait_for_timeout(100)
    assert page.evaluate("document.documentElement.scrollWidth <= document.documentElement.clientWidth")
    assert page.get_by_role('button', name='重建 Codex').is_visible()
    page.screenshot(path="/tmp/ztools-cc-switch-usage-rebuild-narrow.png", full_page=True)
    page.set_viewport_size({"width": 1440, "height": 900})
    page.get_by_role('button', name='请求日志 2').click()
    page.locator('.request-table.detail-enabled .request-row').nth(1).click()
    page.wait_for_selector('.request-detail-modal')
    page.wait_for_timeout(300)
    detail_modal = page.locator('.request-detail-modal').bounding_box()
    assert detail_modal and 1440 * .8 <= detail_modal['width'] <= 1440 * .85 and 900 * .84 <= detail_modal['height'] <= 900 * .87, detail_modal
    page.screenshot(path="/tmp/ztools-cc-switch-request-detail.png", full_page=True)
    page.locator('.request-detail-modal .modal-header .icon-button').click()
    page.get_by_role('button', name='模型定价 2').click()
    page.wait_for_selector('.app-billing-defaults')
    assert page.locator('.app-billing-row').count() == 4
    page.screenshot(path="/tmp/ztools-cc-switch-app-billing.png", full_page=True)
    page.get_by_role('button', name='添加模型定价').click()
    page.wait_for_selector('.pricing-modal')
    page.wait_for_timeout(300)
    pricing_modal = page.locator('.pricing-modal').bounding_box()
    assert pricing_modal and pricing_modal['width'] <= 1440 * .73 and pricing_modal['height'] <= 900 * .86, pricing_modal
    page.screenshot(path="/tmp/ztools-cc-switch-pricing-modal.png", full_page=True)
    page.set_viewport_size({"width": 640, "height": 540})
    page.wait_for_timeout(100)
    pricing_modal = page.locator('.pricing-modal').bounding_box()
    assert pricing_modal and 640 * .915 <= pricing_modal['width'] <= 640 * .95 and pricing_modal['height'] <= 540 * .92, pricing_modal
    assert page.locator('.pricing-modal').is_visible()
    page.screenshot(path="/tmp/ztools-cc-switch-pricing-modal-narrow.png", full_page=True)
    page.locator('.pricing-modal .modal-header .icon-button').click()
    page.get_by_role('button', name='请求日志 2').click()
    page.locator('.request-table.detail-enabled button.request-row').first.click()
    page.wait_for_selector('.request-detail-modal')
    page.wait_for_timeout(300)
    detail_modal = page.locator('.request-detail-modal').bounding_box()
    assert detail_modal and 640 * .915 <= detail_modal['width'] <= 640 * .95 and 540 * .895 <= detail_modal['height'] <= 540 * .93, detail_modal
    assert page.locator('.request-detail-modal').is_visible()
    page.screenshot(path="/tmp/ztools-cc-switch-request-detail-narrow.png", full_page=True)
    page.locator('.request-detail-modal .modal-header .icon-button').click()
    page.set_viewport_size({"width": 1440, "height": 900})
    page.get_by_role('button', name='订阅额度').click()
    page.wait_for_selector('.quota-card')
    page.wait_for_selector('.coding-plan-card')
    assert page.locator('.coding-plan-card').count() == 2
    page.wait_for_selector('.balance-card')
    assert '12.75' in page.locator('.balance-card').inner_text()
    page.wait_for_selector('.usage-script-card')
    assert '8.5' in page.locator('.usage-script-card').inner_text()
    page.screenshot(path="/tmp/ztools-cc-switch-quota.png", full_page=True)
    page.locator('.usage-script-card').get_by_role('button', name='编辑').click()
    page.wait_for_selector('.usage-script-modal')
    usage_script_modal = page.locator('.usage-script-modal').bounding_box()
    assert usage_script_modal and usage_script_modal['width'] <= 1440 * .9 and usage_script_modal['height'] <= 900 * .9, usage_script_modal
    page.screenshot(path="/tmp/ztools-cc-switch-usage-script-modal.png", full_page=True)
    page.set_viewport_size({"width": 640, "height": 540}); page.wait_for_timeout(100)
    usage_script_modal = page.locator('.usage-script-modal').bounding_box()
    assert usage_script_modal and usage_script_modal['width'] <= 640 * .95 and usage_script_modal['height'] <= 540 * .93, usage_script_modal
    assert page.evaluate("document.documentElement.scrollWidth <= document.documentElement.clientWidth")
    page.screenshot(path="/tmp/ztools-cc-switch-usage-script-modal-narrow.png", full_page=True)
    page.locator('.usage-script-modal .modal-header .icon-button').click()
    page.set_viewport_size({"width": 1440, "height": 900})
    page.locator('.coding-plan-card').nth(1).get_by_role('button', name='凭据设置').click()
    page.wait_for_selector('.coding-plan-modal')
    page.wait_for_timeout(150)
    coding_modal = page.locator('.coding-plan-modal').bounding_box()
    assert coding_modal and coding_modal['width'] <= 1440 * .65 and coding_modal['height'] <= 900 * .84, coding_modal
    page.screenshot(path="/tmp/ztools-cc-switch-coding-plan-modal.png", full_page=True)
    page.set_viewport_size({"width": 640, "height": 540})
    page.wait_for_timeout(100)
    coding_modal = page.locator('.coding-plan-modal').bounding_box()
    assert coding_modal and 640 * .915 <= coding_modal['width'] <= 640 * .95 and coding_modal['height'] <= 540 * .92, coding_modal
    assert page.evaluate("document.documentElement.scrollWidth <= document.documentElement.clientWidth")
    page.screenshot(path="/tmp/ztools-cc-switch-coding-plan-modal-narrow.png", full_page=True)
    page.locator('.coding-plan-modal .modal-header .icon-button').click()
    page.set_viewport_size({"width": 640, "height": 540})
    assert page.evaluate("document.documentElement.scrollWidth <= document.documentElement.clientWidth")
    page.screenshot(path="/tmp/ztools-cc-switch-quota-narrow.png", full_page=True)
    page.set_viewport_size({"width": 1440, "height": 900})
    page.get_by_role('button', name='端点测速').click()
    page.locator('.reachability-actions select').select_option('codex')
    page.locator('.endpoint-console select').select_option('openrouter')
    page.get_by_role('button', name='双请求测速').click()
    page.wait_for_selector('.endpoint-list em:has-text("ms")')
    page.get_by_role('button', name='检测 Provider').click()
    page.wait_for_selector('.speed-row code')
    page.screenshot(path="/tmp/ztools-cc-switch-speed.png", full_page=True)
    if page.locator('.toast-item').count(): page.locator('.toast-item').last.click()
    page.set_viewport_size({"width": 640, "height": 540})
    assert page.evaluate("document.documentElement.scrollWidth <= document.documentElement.clientWidth")
    page.screenshot(path="/tmp/ztools-cc-switch-speed-narrow.png", full_page=True)
    page.set_viewport_size({"width": 1440, "height": 900})
    page.locator('.rail-tools button[title="认证中心"]').click()
    page.wait_for_selector("h1:has-text('认证中心')")
    assert page.locator('.auth-account').count() == 2
    page.screenshot(path="/tmp/ztools-cc-switch-auth-wide.png", full_page=True)
    page.locator('.auth-provider-card').nth(1).get_by_role('button', name='连接账号').click()
    page.wait_for_selector('.device-modal')
    page.wait_for_timeout(300)
    device = page.locator('.device-modal').bounding_box()
    assert device and device['width'] <= 1440 * .75 and device['height'] <= 900 * .86
    page.screenshot(path="/tmp/ztools-cc-switch-auth-device-wide.png", full_page=True)
    page.locator('.modal-close').click()
    page.set_viewport_size({"width": 640, "height": 540})
    assert page.evaluate("document.documentElement.scrollWidth <= document.documentElement.clientWidth")
    page.screenshot(path="/tmp/ztools-cc-switch-auth-narrow.png", full_page=True)
    page.set_viewport_size({"width": 1440, "height": 900})
    page.locator('.rail-tools button[title="Sessions"]').click()
    page.wait_for_selector("h1:has-text('Sessions')")
    assert page.locator('.session-row').count() == 5
    page.screenshot(path="/tmp/ztools-cc-switch-sessions.png", full_page=True)
    page.locator('.session-copy').first.click()
    page.wait_for_selector('.session-modal')
    page.wait_for_timeout(300)
    transcript = page.locator('.session-modal').bounding_box()
    assert transcript and transcript['width'] <= 1440 * .9 and transcript['height'] <= 900 * .92
    page.screenshot(path="/tmp/ztools-cc-switch-session-detail.png", full_page=True)
    page.locator('.modal-close').click()
    page.get_by_role('button', name='回收站 1').click()
    page.wait_for_selector('.session-trash-list')
    page.screenshot(path="/tmp/ztools-cc-switch-session-trash.png", full_page=True)
    page.get_by_role('button', name='会话索引 5').click()
    page.set_viewport_size({"width": 640, "height": 540})
    assert page.evaluate("document.documentElement.scrollWidth <= document.documentElement.clientWidth")
    page.screenshot(path="/tmp/ztools-cc-switch-sessions-narrow.png", full_page=True)
    page.set_viewport_size({"width": 1440, "height": 900})
    page.locator('.rail-tools button[title="OpenClaw Workspace"]').click()
    page.wait_for_selector("h1:has-text('Workspace')")
    assert page.locator('.workspace-file-card').count() == 9
    page.screenshot(path="/tmp/ztools-cc-switch-workspace.png", full_page=True)
    page.locator('.workspace-file-card').first.click()
    page.wait_for_selector('.workspace-editor-modal')
    page.wait_for_timeout(300)
    editor = page.locator('.workspace-editor-modal').bounding_box()
    assert editor and 1440 * .75 <= editor['width'] <= 1440 * .9 and 900 * .8 <= editor['height'] <= 900 * .9
    page.screenshot(path="/tmp/ztools-cc-switch-workspace-editor.png", full_page=True)
    page.locator('.modal-close').click()
    page.set_viewport_size({"width": 640, "height": 540})
    assert page.evaluate("document.documentElement.scrollWidth <= document.documentElement.clientWidth")
    page.screenshot(path="/tmp/ztools-cc-switch-workspace-narrow.png", full_page=True)
    page.locator('.workspace-file-card').first.click()
    page.wait_for_selector('.workspace-editor-modal')
    page.wait_for_timeout(300)
    narrow_editor = page.locator('.workspace-editor-modal').bounding_box()
    assert narrow_editor and 640 * .9 <= narrow_editor['width'] <= 640 * .93 and 540 * .88 <= narrow_editor['height'] <= 540 * .91, narrow_editor
    page.screenshot(path="/tmp/ztools-cc-switch-workspace-editor-narrow.png", full_page=True)
    page.locator('.modal-close').click()
    page.locator('.rail-tools button[title="环境诊断"]').click()
    page.wait_for_selector("h1:has-text('环境诊断')")
    assert page.locator('.env-conflicts article').count() == 2
    assert page.evaluate("document.documentElement.scrollWidth <= document.documentElement.clientWidth")
    page.screenshot(path="/tmp/ztools-cc-switch-env-narrow.png", full_page=True)
    page.set_viewport_size({"width": 1440, "height": 900})
    page.locator('.rail-tools button[title="Skills"]').click()
    page.wait_for_selector("h1:has-text('Skills 控制台')")
    assert page.locator('.signal-card').count() == 2
    assert page.locator('.skills-heading-actions button').count() == 3
    assert page.evaluate("document.documentElement.scrollWidth <= document.documentElement.clientWidth")
    page.screenshot(path="/tmp/ztools-cc-switch-skills-wide.png", full_page=True)
    page.set_viewport_size({"width": 640, "height": 540})
    page.wait_for_timeout(200)
    assert page.locator('.skills-heading-actions button').count() == 3
    assert page.get_by_role('button', name='从 ZIP 安装').is_visible()
    assert page.evaluate("document.documentElement.scrollWidth <= document.documentElement.clientWidth")
    page.screenshot(path="/tmp/ztools-cc-switch-skills-narrow.png", full_page=True)
    page.set_viewport_size({"width": 1440, "height": 900})
    page.get_by_role('button', name='仓库管理').click()
    page.wait_for_selector('.skill-repo-modal')
    page.wait_for_timeout(300)
    repo_modal = page.locator('.skill-repo-modal').bounding_box()
    assert repo_modal and 1440 * .8 <= repo_modal['width'] <= 1440 * .87 and 900 * .8 <= repo_modal['height'] <= 900 * .85, repo_modal
    page.screenshot(path="/tmp/ztools-cc-switch-skill-repos-wide.png", full_page=True)
    page.set_viewport_size({"width": 640, "height": 540})
    page.wait_for_timeout(200)
    narrow_repo_modal = page.locator('.skill-repo-modal').bounding_box()
    assert narrow_repo_modal and 640 * .9 <= narrow_repo_modal['width'] <= 640 * .95 and 540 * .88 <= narrow_repo_modal['height'] <= 540 * .93, narrow_repo_modal
    assert page.evaluate("document.documentElement.scrollWidth <= document.documentElement.clientWidth")
    page.screenshot(path="/tmp/ztools-cc-switch-skill-repos-narrow.png", full_page=True)
    page.locator('.skill-repo-modal .modal-header .icon-button').click()
    page.set_viewport_size({"width": 1440, "height": 900})
    page.locator('.rail-tools button[title="Agent 配置中心"]').click()
    page.wait_for_selector("h1:has-text('Agent 配置中心')")
    assert page.locator('.agent-section-card').count() == 2
    assert page.evaluate("document.documentElement.scrollWidth <= document.documentElement.clientWidth")
    page.screenshot(path="/tmp/ztools-cc-switch-agent-config.png", full_page=True)
    page.get_by_role('button', name='Model Catalog').click()
    page.wait_for_selector('.model-catalog-layout')
    assert page.locator('.catalog-row').count() == 2
    page.screenshot(path="/tmp/ztools-cc-switch-model-catalog.png", full_page=True)
    page.get_by_role('button', name='Hermes', exact=True).click()
    page.wait_for_selector('.memory-console')
    assert page.locator('.hermes-runtime-card').count() == 1
    page.screenshot(path="/tmp/ztools-cc-switch-hermes-memory.png", full_page=True)
    page.set_viewport_size({"width": 640, "height": 540})
    assert page.evaluate("document.documentElement.scrollWidth <= document.documentElement.clientWidth")
    page.screenshot(path="/tmp/ztools-cc-switch-hermes-memory-narrow.png", full_page=True)
    page.set_viewport_size({"width": 1440, "height": 900})
    page.get_by_role('button', name='OMO Profiles').click()
    page.wait_for_selector('.omo-console')
    assert page.locator('.omo-profile-card').count() == 1
    assert page.locator('.omo-profile-card.active').count() == 1
    assert page.evaluate("document.documentElement.scrollWidth <= document.documentElement.clientWidth")
    page.screenshot(path="/tmp/ztools-cc-switch-omo-wide.png", full_page=True)
    page.get_by_role('button', name='新建 OMO Profile').click()
    page.wait_for_selector('.omo-modal')
    page.wait_for_timeout(200)
    omo_modal = page.locator('.omo-modal').bounding_box()
    assert omo_modal and 1440 * .84 <= omo_modal['width'] <= 1440 * .89 and 900 * .83 <= omo_modal['height'] <= 900 * .87, omo_modal
    assert page.locator('.omo-editor-grid textarea').count() == 3
    page.screenshot(path="/tmp/ztools-cc-switch-omo-modal-wide.png", full_page=True)
    page.set_viewport_size({"width": 640, "height": 540})
    page.wait_for_timeout(150)
    omo_modal = page.locator('.omo-modal').bounding_box()
    assert omo_modal and 640 * .915 <= omo_modal['width'] <= 640 * .95 and 540 * .895 <= omo_modal['height'] <= 540 * .93, omo_modal
    assert page.evaluate("document.documentElement.scrollWidth <= document.documentElement.clientWidth")
    page.locator('.omo-editor-grid').scroll_into_view_if_needed()
    assert page.locator('.omo-editor-grid').is_visible()
    assert page.locator('.omo-editor-grid textarea').first.bounding_box()['height'] >= 200
    page.screenshot(path="/tmp/ztools-cc-switch-omo-modal-narrow.png", full_page=True)
    page.locator('.universal-modal .modal-close').click() if page.locator('.universal-modal').count() else None
    page.set_viewport_size({"width": 1440, "height": 900})
    page.goto("http://127.0.0.1:5179"); page.wait_for_load_state("networkidle")
    page.get_by_role('button', name='统一 Provider').click()
    page.wait_for_selector('.universal-card')
    assert page.evaluate("document.documentElement.scrollWidth <= document.documentElement.clientWidth")
    page.screenshot(path='/tmp/ztools-cc-switch-universal-wide.png', full_page=True)
    page.get_by_role('button', name='添加统一 Provider').click()
    page.wait_for_selector('.universal-modal'); page.wait_for_timeout(150)
    universal_modal = page.locator('.universal-modal').bounding_box()
    assert universal_modal and 1440 * .85 <= universal_modal['width'] <= 1440 * .89 and 900 * .85 <= universal_modal['height'] <= 900 * .9, universal_modal
    page.screenshot(path='/tmp/ztools-cc-switch-universal-modal-wide.png', full_page=True)
    page.set_viewport_size({"width": 640, "height": 540}); page.wait_for_timeout(150)
    universal_modal = page.locator('.universal-modal').bounding_box()
    assert universal_modal and 640 * .915 <= universal_modal['width'] <= 640 * .925 and 540 * .895 <= universal_modal['height'] <= 540 * .91, universal_modal
    assert page.evaluate("document.documentElement.scrollWidth <= document.documentElement.clientWidth")
    page.screenshot(path='/tmp/ztools-cc-switch-universal-modal-narrow.png', full_page=True)
    browser.close()
print("UI visual checks passed", flush=True)
