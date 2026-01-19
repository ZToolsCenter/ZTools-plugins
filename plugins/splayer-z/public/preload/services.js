const path = require('node:path');
const { spawn } = require('node:child_process');
let apiServer = null;
let apiServerProcess = null;

/**
 * 启动 Fastify API 服务器
 */
async function startApiServer() {
  if (apiServer) {
    console.log('✅ API server already running');
    return;
  }
  
  try {
    console.log('🚀 Starting API server...');
    
    const fastify = require('fastify');
    const NeteaseCloudMusicApi = require('@neteasecloudmusicapienhanced/api');
    
    const server = fastify({ 
      logger: false,
      trustProxy: true,
    });
    
    // 注册插件
    server.register(require('@fastify/cookie'));
    server.register(require('@fastify/multipart'));
    
    // CORS 支持
    server.addHook('onRequest', async (request, reply) => {
      reply.header('Access-Control-Allow-Origin', '*');
      reply.header('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
      reply.header('Access-Control-Allow-Headers', '*');
      if (request.method === 'OPTIONS') {
        reply.code(200).send();
      }
    });
    
    // 注册所有网易云音乐 API
    Object.entries(NeteaseCloudMusicApi).forEach(([name, handler]) => {
      // 转换驼峰命名为下划线命名：playlistDetail -> playlist_detail
      const snakeCaseName = name.replace(/([A-Z])/g, '_$1').toLowerCase().replace(/^_/, '');
      // 同时支持两种路由格式
      const route1 = `/api/netease/${snakeCaseName}`;
      const route2 = `/api/netease/${snakeCaseName.replace(/_/g, '/')}`;
      
      const handleRequest = async (req, reply) => {
        try {
          // 合并所有参数
          const params = {
            ...req.query,
            ...req.body,
          };
          
          // 处理 Cookie（从 query 参数中获取，避免浏览器警告）
          if (params.cookie) {
            // cookie 参数已经在 query 中，直接使用
          } else if (req.cookies && Object.keys(req.cookies).length > 0) {
            // 从 fastify cookies 中获取
            params.cookie = req.cookies;
          }
          
          const result = await handler(params);
          reply.send(result.body);
        } catch (error) {
          console.error(`❌ API error [${name}]:`, error.message);
          reply.code(500).send({ 
            code: 500, 
            error: error.message 
          });
        }
      };
      
      server.all(route1, handleRequest);
      if (route1 !== route2) {
        server.all(route2, handleRequest);
      }
    });
    
    // 健康检查
    server.get('/health', async () => ({ status: 'ok', service: 'SPlayer API' }));
    
    // API 列表
    server.get('/api', async () => ({
      name: 'SPlayer API',
      description: 'SPlayer API service for ZTools',
      author: '@imsyy',
      list: [
        { name: 'NeteaseCloudMusicApi', url: '/api/netease' },
      ],
    }));
    
    // 启动服务器
    await server.listen({ 
      port: 25884, 
      host: '127.0.0.1' 
    });
    
    apiServer = server;
    console.log('✅ API server started: http://127.0.0.1:25884');
    
  } catch (error) {
    console.error('❌ API server startup failed:', error);
    throw error;
  }
}

/**
 * 停止 API 服务器
 */
async function stopApiServer() {
  if (apiServer) {
    await apiServer.close();
    apiServer = null;
    console.log('🛑 API server stopped');
  }
}

// 向渲染进程注入服务
window.services = {
  startApiServer,
  stopApiServer,
};

// 插件导出配置
window.exports = {
  music: {
    mode: 'list',
    args: {
      enter: async (action, callbackSetList) => {
        await startApiServer();
        window.ztools.showMainWindow();
      },
    },
  },
};

// 检测是否在开发模式（Vite 已经启动了服务器）
const isDevelopment = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';

/**
 * 启动独立的 API 服务器进程
 */
function startApiServerProcess() {
  if (apiServerProcess) {
    console.log('✅ API server process already running');
    return;
  }
  
  try {
    const serverPath = path.join(__dirname, 'api-server.js');
    console.log('🚀 Starting API server process:', serverPath);
    
    apiServerProcess = spawn('node', [serverPath], {
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: false,
      cwd: __dirname,
    });
    
    // 捕获标准输出,并检测端口信息
    apiServerProcess.stdout.on('data', (data) => {
      const output = data.toString().trim();
      console.log(`[API Server] ${output}`);
      
      // 检测端口信息并更新 localStorage
      const portMatch = output.match(/started on http:\/\/127\.0\.0\.1:(\d+)/);
      if (portMatch) {
        const port = portMatch[1];
        localStorage.setItem('api_server_port', port);
        console.log(`✅ API server port saved: ${port}`);
      }
    });
    
    // 捕获错误输出
    apiServerProcess.stderr.on('data', (data) => {
      console.error(`[API Server Error] ${data.toString().trim()}`);
    });
    
    apiServerProcess.on('error', (error) => {
      console.error('❌ Failed to start API server process:', error);
      apiServerProcess = null;
    });
    
    apiServerProcess.on('exit', (code) => {
      console.log(`🛑 API server process exited with code ${code}`);
      apiServerProcess = null;
      // 清除端口信息
      localStorage.removeItem('api_server_port');
    });
    
    console.log('✅ API server process started (PID:', apiServerProcess.pid, ')');
  } catch (error) {
    console.error('❌ Error starting API server:', error);
  }
}

/**
 * 停止 API 服务器进程
 */
function stopApiServerProcess() {
  if (apiServerProcess) {
    console.log('🛑 Stopping API server process...');
    apiServerProcess.kill();
    apiServerProcess = null;
  }
}

// 插件加载时自动启动
window.addEventListener('DOMContentLoaded', async () => {
  console.log('🎵 SPlayer plugin loaded');
  
  if (!isDevelopment) {
    console.log('📦 Production mode: Starting local API server...');
    startApiServerProcess();
  } else {
    console.log('✅ Development mode: API server running in Vite plugin');
  }
});

// 插件卸载时停止服务器
window.addEventListener('beforeunload', async () => {
  if (!isDevelopment) {
    stopApiServerProcess();
  }
});
