// uTools 预加载脚本
// 用于提供 Node.js 环境访问能力

// 监听插件进入事件
utools.onPluginEnter(({ code, type, payload }) => {
  console.log('肉鸽射击游戏已启动');
});

// 监听插件退出事件
utools.onPluginOut(() => {
  console.log('肉鸽射击游戏已退出');
});

// 监听插件隐藏事件（用户切换到其他应用）
utools.onPluginDetach(() => {
  console.log('肉鸽射击游戏已隐藏');
});

// 监听插件显示事件（用户切换回本插件）
utools.onPluginAttach(() => {
  console.log('肉鸽射击游戏已显示');
});

// 监听插件关闭事件
window.onbeforeunload = () => {
  console.log('肉鸽射击游戏窗口即将关闭');
};

// 导出一些工具函数供主页面使用
window.utoolsAPI = {
  // 获取系统信息
  getSystemInfo: () => {
    return {
      platform: process.platform,
      arch: process.arch,
      version: process.version
    };
  },
  
  // 显示系统通知
  showNotification: (title, content) => {
    if (utools && utools.showNotification) {
      utools.showNotification(title, content);
    }
  },
  
  // 获取用户数据目录
  getUserDataPath: () => {
    return utools.getPath('userData');
  },
  
  // 复制文本到剪贴板
  copyToClipboard: (text) => {
    if (utools && utools.copyText) {
      utools.copyText(text);
    }
  }
};