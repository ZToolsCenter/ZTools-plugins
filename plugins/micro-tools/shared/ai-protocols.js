// Shared provider presets, endpoint identity and wire formats for both clients.
const crypto=require('crypto');
const presets = {
    custom: { protocol: 'openai', baseUrl: '', guide: '从平台官方文档获取 API key、Base URL 与模型 ID。OpenAI 兼容地址通常以 /v1 结尾；不要填写网页聊天地址。', url: '' },
    deepseek: { protocol: 'openai', baseUrl: 'https://api.deepseek.com', url: 'https://api-docs.deepseek.com/', guide: '在 DeepSeek 开放平台创建 API key，填写可用的模型 ID。' },
    qwen: { protocol: 'openai', baseUrl: 'https://YOUR-WORKSPACE-ID.cn-beijing.maas.aliyuncs.com/compatible-mode/v1', url: 'https://help.aliyun.com/zh/model-studio/first-api-call-to-qwen', guide: '在阿里云百炼创建 API key，复制模型 ID 和业务空间 ID。将地址中的 YOUR-WORKSPACE-ID 替换为真实 ID；此模板为北京地域，其它地域请按官方文档修改。' },
    siliconflow: { protocol: 'openai', baseUrl: 'https://api.siliconflow.cn/v1', url: 'https://docs.siliconflow.cn/', guide: '在硅基流动控制台创建 API key，复制完整模型 ID（通常含厂商前缀）。' },
    moonshot: { protocol: 'openai', baseUrl: 'https://api.moonshot.cn/v1', url: 'https://platform.moonshot.cn/docs', guide: '在 Moonshot 开放平台创建 API key，选择支持文本对话的模型。' },
    openai: { protocol: 'openai', baseUrl: 'https://api.openai.com/v1', url: 'https://platform.openai.com/docs/api-reference/chat', guide: '在 OpenAI API 平台创建 key 并检查 API 额度。请填写支持 Chat Completions 的模型 ID。' },
    anthropic: { protocol: 'anthropic', baseUrl: 'https://api.anthropic.com/v1', url: 'https://platform.claude.com/docs/en/api/messages/create', guide: '在 Anthropic Console 创建标准 API key，填写支持 Messages 的 Claude 模型 ID。' },
    gemini: { protocol: 'gemini', baseUrl: 'https://generativelanguage.googleapis.com/v1beta', url: 'https://ai.google.dev/gemini-api/docs/api-key', guide: '在 Google AI Studio 创建 Gemini API key，模型 ID 不含 models/ 前缀。此预设不适用于 Vertex AI。' },
    ollama: { protocol: 'openai', baseUrl: 'http://127.0.0.1:11434/v1', url: 'https://docs.ollama.com/api/openai-compatibility', guide: '先启动本机 Ollama 并拉取模型，填写本机已有的模型名称。通常无需 key。请求在本机处理。' }
  };
const labels={"custom": "自定义接口", "deepseek": "DeepSeek", "qwen": "阿里百炼", "siliconflow": "硅基流动", "moonshot": "Moonshot", "openai": "OpenAI", "anthropic": "Anthropic", "gemini": "Google Gemini", "ollama": "本机 Ollama"};
for(const [id,p] of Object.entries(presets))p.label=labels[id];
function serviceURL(value,{allowLocal=false}={}) {
 let u;try{u=new URL(value)}catch{throw Error('请输入完整的 API 地址。')}
 const local=['localhost','127.0.0.1','[::1]'].includes(u.hostname);
 if(u.protocol!=='https:'&&!(allowLocal&&local&&u.protocol==='http:'))throw Error('远程 API 必须使用 HTTPS；本机 AI 服务可使用 HTTP。');
 if(u.username||u.password||u.search||u.hash)throw Error('API 地址不能包含账号、密码、查询参数或片段。');
 return u;
}
function endpoint(config){
 const u=serviceURL(config.baseUrl||config.endpoint,{allowLocal:true});
 if(/YOUR-WORKSPACE-ID|%7B|%7D/i.test(u.href))throw Error('请将 API 地址中的业务空间占位符替换为真实 ID。');
 const p=u.pathname.replace(/\/+$/,'');
 if(config.protocol==='openai')u.pathname=/\/chat\/completions$/.test(p)?p:p+'/chat/completions';
 else if(config.protocol==='anthropic')u.pathname=/\/messages$/.test(p)?p:p+'/messages';
 else if(config.protocol==='gemini')u.pathname=p+'/models/'+encodeURIComponent(config.model)+':generateContent';
 else throw Error('不支持的 API 协议。');
 return u;
}
function scope(config){
 let base=config.baseUrl||config.endpoint||'';
 try{const u=new URL(base);u.pathname=u.pathname.replace(/\/+$/,'');if(config.protocol==='openai')u.pathname=u.pathname.replace(/\/chat\/completions$/,'');if(config.protocol==='anthropic')u.pathname=u.pathname.replace(/\/messages$/,'');base=u.href.replace(/\/+$/,'')}catch{}
 return crypto.createHash('sha256').update(JSON.stringify([config.provider||'custom',config.protocol||'openai',base])).digest('hex');
}
function request(config,key,messages,{probe=false}={}){
 if(!Array.isArray(messages)||!messages.length)throw Error('请求内容为空。');
 const system=messages.filter(m=>m.role==='system').map(m=>m.content).join('\n');let payload,headers={'Content-Type':'application/json'};
 if(config.protocol==='openai'){payload={model:config.model,messages,stream:false};if(key)headers.Authorization='Bearer '+key}
 else if(config.protocol==='anthropic'){payload={model:config.model,system,messages:messages.filter(m=>m.role!=='system'),max_tokens:probe?64:8192};headers['x-api-key']=key;headers['anthropic-version']='2023-06-01'}
 else if(config.protocol==='gemini'){payload={systemInstruction:{parts:[{text:system}]},contents:messages.filter(m=>m.role!=='system').map(m=>({role:m.role==='assistant'?'model':'user',parts:[{text:m.content}]})),generationConfig:{responseMimeType:'application/json',...(probe?{maxOutputTokens:64}:{})}};headers['x-goog-api-key']=key}
 else throw Error('不支持的 API 协议。');
 return {url:endpoint(config).href,method:'POST',headers,body:JSON.stringify(payload)};
}
function read(config,data){
 let text;if(config.protocol==='openai')text=data.choices?.[0]?.message?.content;else if(config.protocol==='anthropic')text=(data.content||[]).filter(x=>x.type==='text').map(x=>x.text).join('\n');else text=(data.candidates?.[0]?.content?.parts||[]).map(x=>x.text||'').join('\n');
 if(typeof text!=='string'||!text.trim())throw Error('模型没有返回文本，请确认该模型支持对话请求。');return text;
}
module.exports={presets,serviceURL,endpoint,scope,request,read};
