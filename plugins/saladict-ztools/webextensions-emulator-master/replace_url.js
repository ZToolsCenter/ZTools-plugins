const replace = require('replace-in-file')
const options = [
  // === runtime.js 路径修复 ===
  // 修复 webpack 公共路径：绝对路径 → 相对路径
  {
    files: '../ext-saladic/assets/runtime*.js',
    from: /n\.p="\/"/g,
    to: 'n.p="./"'
  },
  // v7.21: runtime.js 中 n.p+"assets/" 保留（./assets/xxx.js 是正确的相对路径）
  // v7.19 旧版需要删除 assets/ 前缀，新版不需要

  // === background.js 路径修复 ===
  {
    files: '../ext-saladic/assets/background*.js',
    from: /\/options\.html/g,
    to: 'options.html'
  },

  // === JS 文件中的绝对路径修复 ===
  // antd CSS 加载路径
  {
    files: '../ext-saladic/assets/*.js',
    from: /a="\/assets\/"\+`antd/g,
    to: 'a="./assets/"+`antd'
  },
  // browser.runtime.getURL 中的绝对路径 → 去掉前导 /
  {
    files: '../ext-saladic/assets/*.js',
    from: /browser\.runtime\.getURL\("\/audio-control\.html"/g,
    to: 'browser.runtime.getURL("audio-control.html"'
  },
  // 通用：browser.runtime.getURL("/xxx") → browser.runtime.getURL("xxx")
  {
    files: '../ext-saladic/assets/*.js',
    from: /browser\.runtime\.getURL\("\/([^"]*)"\)/g,
    to: 'browser.runtime.getURL("$1")'
  },

  // === axios 替换 ===
  {
    files: '../ext-saladic/assets/*.js',
    from: /[\w]\(596\)/g,
    to: 'window.axios'
  },
  // responseType:"document" 返回值需要 DOM 解析
  {
    files: '../ext-saladic/assets/*.js',
    from: 'responseType:"document"}).then(({data:e})=>e)',
    to: 'responseType:"document"}).then(({data:e})=>new DOMParser().parseFromString(e,"text/html"))'
  },

  // === 快捷查词配置 ===
  // v7.21 可能不再有 qsAuto，保留容错
  {
    files: '../ext-saladic/assets/*.js',
    from: /qsAuto:!1/g,
    to: 'qsAuto:!0'
  },
  {
    files: '../ext-saladic/assets/*.js',
    from: /qsPreload:"selection"/g,
    to: 'qsPreload:"clipboard"'
  },

  // === HTML 文件路径修复 ===
  // 绝对路径 → 相对路径
  {
    files: '../ext-saladic/*.html',
    from: /src="\//g,
    to: 'src="./'
  },
  {
    files: '../ext-saladic/*.html',
    from: /href="\//g,
    to: 'href="./'
  },
  // browser-polyfill.min.js → webextensions-emulator background.js
  {
    files: '../ext-saladic/*.html',
    from: '<script src="./assets/browser-polyfill.min.js"></script>',
    to:
        '<script src="../webextensions-emulator-master/dist/background.js"></script>'
  },

  // === iframe fetch 代理注入 ===
  // v7.21 词典引擎在 iframe 中直接使用 fetch，受 CORS 限制
  // 注入脚本将 fetch 请求转发到父窗口的 axios（Node.js 网络，不受 CORS 限制）
  {
    files: '../ext-saladic/*.html',
    from: /<head>/g,
    to: `<head><script>
(function(){
  var _pAxios=null;
  try{_pAxios=window.parent&&window.parent.axios}catch(e){}
  if(_pAxios){window.axios=_pAxios;console.log('[iframe-proxy] axios from parent OK')}
  else{console.log('[iframe-proxy] WARNING: no parent axios')}

  // === XMLHttpRequest prototype patch ===
  if(_pAxios){
    var _oOpen=XMLHttpRequest.prototype.open;
    var _oSend=XMLHttpRequest.prototype.send;
    var _oSetH=XMLHttpRequest.prototype.setRequestHeader;
    XMLHttpRequest.prototype.open=function(m,u,a){this.__m=m;this.__u=u;this.__h={};return _oOpen.apply(this,arguments)};
    XMLHttpRequest.prototype.setRequestHeader=function(n,v){if(this.__h)this.__h[n]=v;return _oSetH.apply(this,arguments)};
    XMLHttpRequest.prototype.send=function(b){
      var u=this.__u;
      if(!u||(!u.startsWith('http://')&&!u.startsWith('https://'))){return _oSend.apply(this,arguments)}
      var s=this,m=(s.__m||'GET').toUpperCase(),h=Object.assign({},s.__h||{});
      console.log('[iframe-xhr]',m,u);
      var c={url:u,method:m,headers:h,responseType:'text',withCredentials:s.withCredentials};
      if(b&&!['GET','HEAD'].includes(m)){c.data=typeof b==='object'?(b.toString?b.toString():JSON.stringify(b)):b}
      _pAxios(c).then(function(r){
        var t=typeof r.data==='object'?JSON.stringify(r.data):String(r.data);
        try{Object.defineProperty(s,'status',{writable:true,value:r.status})}catch(e){}
        try{Object.defineProperty(s,'statusText',{writable:true,value:r.statusText})}catch(e){}
        try{Object.defineProperty(s,'readyState',{writable:true,value:4})}catch(e){}
        try{Object.defineProperty(s,'responseText',{writable:true,value:t})}catch(e){}
        try{Object.defineProperty(s,'response',{writable:true,value:t})}catch(e){}
        s.__rh=r.headers||{};s.__rhs=Object.keys(s.__rh).map(function(k){return k+': '+s.__rh[k]}).join('\\r\\n');
        console.log('[iframe-xhr] OK',r.status,u);
        var e1=new Event('readystatechange'),e2=new Event('load');
        if(s.onreadystatechange)s.onreadystatechange(e1);if(s.onload)s.onload(e2);
        s.dispatchEvent(e1);s.dispatchEvent(e2);
      }).catch(function(e){
        try{Object.defineProperty(s,'readyState',{writable:true,value:4})}catch(x){}
        if(e.response){try{Object.defineProperty(s,'status',{writable:true,value:e.response.status})}catch(x){}try{Object.defineProperty(s,'statusText',{writable:true,value:e.response.statusText})}catch(x){}var t=typeof e.response.data==='object'?JSON.stringify(e.response.data):String(e.response.data);try{Object.defineProperty(s,'responseText',{writable:true,value:t})}catch(x){}try{Object.defineProperty(s,'response',{writable:true,value:t})}catch(x){}}
        else{try{Object.defineProperty(s,'status',{writable:true,value:0})}catch(x){}try{Object.defineProperty(s,'statusText',{writable:true,value:e.message||'Error'})}catch(x){}}
        console.log('[iframe-xhr] ERR',s.status,u);
        var er=new ProgressEvent('error');if(s.onerror)s.onerror(er);s.dispatchEvent(er);
      });
    };
    var _oGRH=XMLHttpRequest.prototype.getResponseHeader;
    XMLHttpRequest.prototype.getResponseHeader=function(n){if(this.__rh){return this.__rh[n]||this.__rh[n.toLowerCase()]||null}return _oGRH.apply(this,arguments)};
    var _oGARH=XMLHttpRequest.prototype.getAllResponseHeaders;
    XMLHttpRequest.prototype.getAllResponseHeaders=function(){if(this.__rhs!==undefined)return this.__rhs;return _oGARH.apply(this,arguments)};
    console.log('[iframe-proxy] XHR prototype patched');
  }

  // === fetch proxy ===
  var _oFetch=window.fetch;
  window.fetch=function(input,init){
    var url=typeof input==='string'?input:input.url;
    if(!url||(!url.startsWith('http://')&&!url.startsWith('https://'))){return _oFetch.call(this,input,init)}
    var p=_pAxios;if(!p)return _oFetch.call(this,input,init);
    var m=((init&&init.method)||'GET').toUpperCase(),h={};
    if(init&&init.headers){if(init.headers instanceof Headers)init.headers.forEach(function(v,k){h[k]=v});else if(typeof init.headers==='object')Object.assign(h,init.headers)}
    var c={url:url,method:m,headers:h,responseType:'text',withCredentials:init&&(init.credentials==='include'||init.credentials==='same-origin')};
    if(init&&init.body&&!['GET','HEAD'].includes(m)){if(typeof init.body==='string')c.data=init.body;else if(init.body instanceof URLSearchParams){c.data=init.body.toString();c.headers['Content-Type']=c.headers['Content-Type']||'application/x-www-form-urlencoded'}else c.data=init.body}
    return p(c).then(function(r){var b=typeof r.data==='object'?JSON.stringify(r.data):String(r.data);return new Response(b,{status:r.status,statusText:r.statusText,headers:new Headers(r.headers)})}).catch(function(e){if(e.response){var b=typeof e.response.data==='object'?JSON.stringify(e.response.data):String(e.response.data);return new Response(b,{status:e.response.status,statusText:e.response.statusText,headers:new Headers(e.response.headers)})}return Promise.reject(e)});
  };
  console.log('[iframe-proxy] fetch patched');

  // === postMessage 搜索词监听 ===
  // 接收父窗口发来的搜索词，设置搜索框并触发搜索
  window.addEventListener('message', function(evt) {
    if (!evt.data || evt.data.type !== 'saladict-search') return;
    var text = evt.data.text;
    if (!text) return;
    console.log('[iframe-proxy] received search:', text);
    // 等待搜索框出现（React 渲染需要时间）
    function trySetSearch(attempt) {
      var searchBox = document.querySelector('.menuBar-SearchBox');
      if (searchBox) {
        var nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        nativeSetter.call(searchBox, text);
        searchBox.dispatchEvent(new Event('input', { bubbles: true }));
        searchBox.dispatchEvent(new Event('change', { bubbles: true }));
        searchBox.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
        console.log('[iframe-proxy] search box set:', text);
      } else if (attempt < 20) {
        setTimeout(function() { trySetSearch(attempt + 1); }, 100);
      }
    }
    trySetSearch(0);
  });
})();
</script>`
  },

  // === manifest.json 绝对路径修复 ===
  // content_scripts 和 background.scripts 中的 /assets/ → assets/
  {
    files: '../ext-saladic/manifest.json',
    from: /"\/assets\//g,
    to: '"assets/'
  }
]

function run (options) {
  try {
    const results = replace.sync(options)
    console.log('Replacement results:', results)
  } catch (error) {
    console.error('Error occurred:', error)
  }
}
options.forEach((it) => {
  //   it.dry = true
  it.numReplacements = true
  it.numMatches = true
  run(it)
})
