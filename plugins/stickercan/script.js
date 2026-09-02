/**
 * script.js - ZTools 客户端入口脚本
 *
 * 职责：
 * 1. 构造平台适配器
 * 2. 注入到 core 层创建应用实例
 * 3. 初始化 UI 管理器
 * 4. 暴露全局对象供 HTML onclick 使用
 */

// [browser] 上述模块已通过 <script> 标签全局加载
// [browser] 上述模块已通过 <script> 标签全局加载
// [browser] 上述模块已通过 <script> 标签全局加载
// [browser] 上述模块已通过 <script> 标签全局加载
// [browser] 上述模块已通过 <script> 标签全局加载
// [browser] 上述模块已通过 <script> 标签全局加载
// [browser] 上述模块已通过 <script> 标签全局加载
// [browser] 上述模块已通过 <script> 标签全局加载
// [browser] 上述模块已通过 <script> 标签全局加载
// 添加动画样式
const style = document.createElement('style');
style.textContent = `
  @keyframes slideInRight {
    from { transform: translateX(100%); opacity: 0; }
    to { transform: translateX(0); opacity: 1; }
  }
  @keyframes slideOutRight {
    from { transform: translateX(0); opacity: 1; }
    to { transform: translateX(100%); opacity: 0; }
  }
`;
document.head.appendChild(style);

function initUserInfo() {
  const userAvatar = document.getElementById('userAvatar');
  const userNickname = document.getElementById('userNickname');

  if (typeof ztools !== 'undefined') {
    const user = ztools.getUser ? ztools.getUser() : null;
    if (user) {
      userAvatar.src = user.avatar;
      userNickname.textContent = user.nickname;
    } else {
      userNickname.textContent = '未登录';
    }
  } else {
    userNickname.textContent = '表情罐头';
  }
}

document.addEventListener('DOMContentLoaded', () => {
  if (typeof ztools !== 'undefined') {
    // 构造适配器
    const storageProvider = new ZToolsStorageProvider();
    const clipboardProvider = new ZToolsClipboardProvider();
    const fileProvider = new ZToolsFileProvider();
    const httpProvider = new ZToolsHttpProvider();

    // 先创建 ThemeManager（NotificationProvider 依赖它）
    const settingsService = new (SettingsService)({
      storageProvider,
      fileProvider,
    });

    const themeManager = new ThemeManager({ settingsService });
    const notificationProvider = new ZToolsNotificationProvider({ themeManager });

    // 创建 core 应用
    const app = createApp({
      storageProvider,
      httpProvider,
      fileProvider,
      clipboardProvider,
      notificationProvider,
    });

    // 创建 UI 管理器
    const uiManager = new UIManager({
      emotionService: app.emotionService,
      settingsService: app.settingsService,
      searchService: app.searchService,
      themeManager,
      notification: notificationProvider,
    });

    // 暴露全局对象供 HTML onclick 使用
    window._emotionApp = uiManager;
    window.emotionManager = uiManager;

    // 初始化更新日志
    window.changelogManager = new ChangelogManager();

    // 启动
    uiManager.init();
    initUserInfo();

    // ZTools 子输入框必须在 onPluginEnter 回调中设置才能生效
    if (typeof ztools !== 'undefined' && ztools.onPluginEnter) {
      ztools.onPluginEnter(() => {
        uiManager.setupSubInput();
      });
    }

    // 添加表情包弹窗的标签页切换
    const sourceTabs = document.querySelectorAll('.source-tab');
    sourceTabs.forEach(tab => {
      tab.addEventListener('click', () => {
        const source = tab.dataset.source;
        sourceTabs.forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        document.querySelectorAll('.source-content').forEach(content => {
          content.style.display = 'none';
        });
        if (source === 'url') {
          document.querySelector('.url-source').style.display = 'block';
        } else {
          document.querySelector('.file-source').style.display = 'block';
        }
        if (uiManager && typeof uiManager.updateAddEmotionButtonText === 'function') {
          uiManager.updateAddEmotionButtonText(source);
        }
      });
    });
  } else {
    // 非 ZTools 环境的模拟（开发调试用）
    console.warn('不在ZTools环境中，使用localStorage模拟数据存储');

    window.ztools = {
      db: {
        async get(key) {
          const value = localStorage.getItem(key);
          return value ? JSON.parse(value) : null;
        },
        async put(doc) {
          localStorage.setItem(doc._id, JSON.stringify(doc));
        },
        async remove(key) {
          localStorage.removeItem(key);
        }
      },
      dbStorage: {
        getItem(key) {
          const value = localStorage.getItem(key);
          return value ? JSON.parse(value) : null;
        },
        setItem(key, value) {
          localStorage.setItem(key, JSON.stringify(value));
        },
        removeItem(key) {
          localStorage.removeItem(key);
        }
      },
      copyImage(imageData) {
        console.log('模拟复制图片:', imageData);
        alert('复制成功！（这是模拟环境）');
      },
      getUser() {
        return null;
      },
      getNativeId() {
        return 'mock-device';
      },
      showOpenDialog() {
        return null;
      },
      shellOpenExternal(url) {
        window.open(url, '_blank');
      },
      setSubInput(onChange, placeholder) {
        console.log('模拟 setSubInput:', placeholder);
        // 在非 ztools 环境中创建一个顶部搜索框来模拟子输入框
        if (!document.getElementById('mockSubInput')) {
          const container = document.createElement('div');
          container.style.cssText = 'position:fixed;top:0;left:0;right:0;padding:8px 16px;background:var(--bg-secondary);border-bottom:1px solid var(--border-color);z-index:9999;';
          const input = document.createElement('input');
          input.id = 'mockSubInput';
          input.type = 'text';
          input.placeholder = placeholder || '搜索...';
          input.style.cssText = 'width:100%;padding:8px 12px;border:1px solid var(--border-color);border-radius:8px;font-size:14px;background:var(--bg-primary);color:var(--text-primary);';
          input.addEventListener('input', () => {
            onChange({ text: input.value });
          });
          container.appendChild(input);
          document.body.insertBefore(container, document.body.firstChild);
        }
      }
    };

    window.emotionCan = {
      selectFolder: async () => prompt('请输入本地存储路径（例如：C:/表情罐头）'),
      saveFile: async (fileData, targetPath) => { console.log('模拟保存文件到:', targetPath); return targetPath; },
      fileExists: () => false,
      deleteFile: () => false,
      readFile: () => null,
      getDefaultDir: () => 'C:/表情罐头',
      nodeFetch: async () => null,
      downloadImage: async () => null,
      uploadToS3Node: async () => { throw new Error('模拟环境不支持S3上传'); },
    };

    // 使用与上面相同的初始化流程
    const storageProvider = new ZToolsStorageProvider();
    const clipboardProvider = new ZToolsClipboardProvider();
    const fileProvider = new ZToolsFileProvider();
    const httpProvider = new ZToolsHttpProvider();

    const settingsService = new (SettingsService)({
      storageProvider,
      fileProvider,
    });

    const themeManager = new ThemeManager({ settingsService });
    const notificationProvider = new ZToolsNotificationProvider({ themeManager });

    const app = createApp({
      storageProvider,
      httpProvider,
      fileProvider,
      clipboardProvider,
      notificationProvider,
    });

    const uiManager = new UIManager({
      emotionService: app.emotionService,
      settingsService: app.settingsService,
      searchService: app.searchService,
      themeManager,
      notification: notificationProvider,
    });

    window._emotionApp = uiManager;
    window.emotionManager = uiManager;
    window.changelogManager = new ChangelogManager();

    uiManager.init();
    initUserInfo();
    uiManager.setupSubInput();
  }
});
