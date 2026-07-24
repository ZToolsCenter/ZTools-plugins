const shell = require("electron").shell;
const url = require('url').URL
//打开外部链接
window.openExternal = function (url) {
  shell.openExternal(url);
};

//处理请求自定义cookie问题
const adapter = require("axios/lib/adapters/http");
const axiosCookieJarSupport = require("axios-cookiejar-support").default;
const tough = require("tough-cookie");
const CookieJar = new tough.CookieJar();
const axios = require("axios").create({
  adapter,
  headers:{
    'User-Agent':'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_14_6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/86.0.4240.198 Safari/537.36'
  },
  jar: CookieJar,
  // proxy: {
  //   host: "localhost",
  //   port: 8888,
  // },
  withCredentials:true
});
tough._CookieJar = CookieJar;
// function setCookie(cookieStr, url){
//   return new Promise((res, rej)=>{
//     CookieJar.setCookie(cookieStr, url)
//   })
// }
axiosCookieJarSupport(axios);
axios.interceptors.request.use(
  (config) => {
    //处理腾讯翻译君bug
    let targetURl = new url(config.url)
    let urlOrigin = targetURl.origin
    config.headers.referer = urlOrigin;
    // config.headers.origin = urlOrigin;
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);
axios.interceptors.response.use(
  async (response) => {
    // console.log("🚀 ~ file: preload.js ~ line 36 ~ response", response)
    //处理有道翻译bug
    let {headers, config} = response
    let resSetCookie = headers['set-cookie']
    if(resSetCookie && resSetCookie.length){
      cookies = resSetCookie.map(tough.Cookie.parse);
      for (let i of cookies){
        await CookieJar.setCookie(i, config.url)
      }
    }
    return response;
  },
  (error) => {
    // console.log("🚀 ~ file: preload.js ~ line 40 ~ error", error)
    return Promise.reject(error);
  }
);

window.axios = axios;
window.tough = tough;

// 拦截 window.fetch，让请求走 Node.js 网络（绕过 CORS 限制）
// v7.21 大量词典引擎直接使用 fetch 而非 axios，在 Electron 渲染进程中受 CORS 限制
const _originalFetch = window.fetch;
window.fetch = function(input, init = {}) {
  const requestUrl = typeof input === 'string' ? input : input.url;
  const requestInit = typeof input === 'string' ? init : input;

  // 只拦截 http/https 请求，其他（如 chrome-extension://、blob: 等）走原始 fetch
  if (!requestUrl || (!requestUrl.startsWith('http://') && !requestUrl.startsWith('https://'))) {
    return _originalFetch.call(this, input, init);
  }

  // 将 fetch 请求转为 axios 请求（走 Node.js http adapter，不受 CORS 限制）
  const method = (requestInit.method || 'GET').toUpperCase();
  const headers = {};
  if (requestInit.headers) {
    if (requestInit.headers instanceof Headers) {
      requestInit.headers.forEach((v, k) => { headers[k] = v; });
    } else if (typeof requestInit.headers === 'object') {
      Object.assign(headers, requestInit.headers);
    }
  }

  const axiosConfig = {
    url: requestUrl,
    method: method,
    headers: headers,
    responseType: 'text',
    withCredentials: requestInit.credentials === 'include' || requestInit.credentials === 'same-origin',
  };

  if (requestInit.body && !['GET', 'HEAD'].includes(method)) {
    if (typeof requestInit.body === 'string') {
      axiosConfig.data = requestInit.body;
    } else if (requestInit.body instanceof URLSearchParams) {
      axiosConfig.data = requestInit.body.toString();
      axiosConfig.headers['Content-Type'] = axiosConfig.headers['Content-Type'] || 'application/x-www-form-urlencoded';
    } else if (typeof requestInit.body === 'object') {
      axiosConfig.data = requestInit.body;
    }
  }

  return axios(axiosConfig).then(response => {
    // 返回 Response 对象，兼容 fetch API
    const responseBody = typeof response.data === 'object' ? JSON.stringify(response.data) : String(response.data);
    return new Response(responseBody, {
      status: response.status,
      statusText: response.statusText,
      headers: new Headers(response.headers),
    });
  }).catch(error => {
    if (error.response) {
      const responseBody = typeof error.response.data === 'object' ? JSON.stringify(error.response.data) : String(error.response.data);
      return new Response(responseBody, {
        status: error.response.status,
        statusText: error.response.statusText,
        headers: new Headers(error.response.headers),
      });
    }
    return Promise.reject(error);
  });
};

window.navigator.product === "NativeScript";
