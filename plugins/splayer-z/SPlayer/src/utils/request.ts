import axios, { AxiosError, AxiosInstance, AxiosRequestConfig, AxiosResponse } from "axios";
import axiosRetry from "axios-retry";
import { isLogin } from "./auth";
import { getCookie } from "./cookie";
import { isDev, isElectron } from "./env";

// 获取 API 服务器地址
// 开发模式: 使用 Vite 代理到本地 Fastify 服务器
// 生产模式: 使用本地 API 服务器 (由 preload 启动的子进程,端口动态分配)
function getBaseURL(): string {
  if (isDev) {
    return "/api/netease";
  }

  // 从 localStorage 读取动态端口,如果没有则使用默认端口
  const savedPort = localStorage.getItem('api_server_port');
  const port = savedPort || '36524';
  return `http://127.0.0.1:${port}/api/netease`;
}

// 基础配置
const server: AxiosInstance = axios.create({
  // 允许跨域
  withCredentials: true,
  // 超时时间
  timeout: 15000,
});

// 请求重试
axiosRetry(server, {
  // 重试次数
  retries: 3,
});

// 请求拦截器
server.interceptors.request.use(
  (request) => {
    // 动态设置 baseURL (支持端口变化)
    request.baseURL = getBaseURL();

    // 直接从 localStorage 获取设置,避免 Vue inject() 上下文问题
    const setting = JSON.parse(localStorage.getItem("setting") || "{}");
    if (!request.params) request.params = {};
    // Cookie
    if (!request.params.noCookie && (isLogin() || getCookie("MUSIC_U") !== null)) {
      const cookie = `MUSIC_U=${getCookie("MUSIC_U")};`;
      request.params.cookie = cookie;
    }
    // 自定义 realIP
    if (setting.useRealIP) {
      if (setting.realIP) {
        request.params.realIP = setting.realIP;
      } else {
        request.params.randomCNIP = true;
      }
    }
    // proxy
    if (setting.proxyProtocol && setting.proxyProtocol !== "off") {
      const protocol = setting.proxyProtocol.toLowerCase();
      const server = setting.proxyServe;
      const port = setting.proxyPort;
      const proxy = `${protocol}://${server}:${port}`;
      if (proxy) request.params.proxy = proxy;
    }
    // 发送请求
    return request;
  },
  (error: AxiosError) => {
    console.error("请求发送失败：", error);
    return Promise.reject(error);
  },
);

// 响应拦截器
server.interceptors.response.use(
  (response: AxiosResponse) => response,
  (error: AxiosError) => {
    const { response } = error;
    // 状态码处理
    switch (response?.status) {
      case 400:
        console.error("客户端错误：", response.status, response.statusText);
        // 执行客户端错误的处理逻辑
        break;
      case 401:
        console.error("未授权：", response.status, response.statusText);
        // 执行未授权的处理逻辑
        break;
      case 403:
        console.error("禁止访问：", response.status, response.statusText);
        // 执行禁止访问的处理逻辑
        break;
      case 404:
        console.error("未找到资源：", response.status, response.statusText);
        // 执行未找到资源的处理逻辑
        break;
      case 500:
        console.error("服务器错误：", response.status, response.statusText);
        // 执行服务器错误的处理逻辑
        break;
      default:
        // 处理其他状态码或错误条件
        console.error("未处理的错误：", error.message);
    }
    // 返回错误
    return Promise.reject(error);
  },
);

// 请求
const request = async <T = any>(config: AxiosRequestConfig): Promise<T> => {
  // 返回请求数据
  const { data } = await server.request(config);
  return data as T;
};

export default request;
