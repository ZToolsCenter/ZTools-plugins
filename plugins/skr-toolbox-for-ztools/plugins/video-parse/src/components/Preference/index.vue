<script setup>
import { onMounted, ref, watch } from 'vue';
import showToast from '../../utils/toast';
import packageJson from '../../../package';
import { getAutoOpenConfig, setAutoOpenConfig } from '../../utils/config';

const props = defineProps({
  showState: {
    type: Boolean,
    default: false
  }
});

const emit = defineEmits(['loadData']);

const currentMenu = ref('setting');

const defaultPath = window.utools.getPath('downloads');

const downloadPath = ref('');

const autoOpen = ref(true);

const currentTheme = ref('#0f172a');

const chooseMenu = (menu) => {
  if (menu === currentMenu.value) return;
  if (menu === 'history') setHistory();
  currentMenu.value = menu;
  showConfirmPopover.value = false;
};

const onChange = () => {
  console.log(downloadPath.value);
  window.utools.dbStorage.setItem('downloadPath', downloadPath.value);
};

const autoOpenChange = () => {
  console.log(autoOpen.value);
  setAutoOpenConfig(autoOpen.value);
  showToast(autoOpen.value ? '已开启自动打开下载目录' : '已关闭自动打开下载目录');
};

const selectFolder = () => {
  const path = window.utools.showOpenDialog({
    title: '选择下载路径',
    defaultPath: downloadPath.value,
    properties: ['openDirectory'],
  });
  if (path) {
    downloadPath.value = path[0];
    onChange();
    showToast('已选择新的下载路径');
  }
};

const changeTheme = (color) => {
  if (validateColor(color) === false) {
    showToast('颜色格式不正确，请选择有效的颜色值');
    return;
  }
  currentTheme.value = color;
  document.documentElement.style.setProperty('--primary-color', color);
  window.utools.dbStorage.setItem('theme', color);
  showToast('主题已切换');
};

// 校验颜色
const validateColor = (color) => {
  const reg = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
  return reg.test(color);
};

const history = ref([]);

const themeList = [
  { name: '深空黑夜', color: '#0f172a' },
  { name: '超级猛男', color: '#ff69b4' },
  { name: '紫颜悦色', color: '#743ee4' },
  { name: '青翠森林', color: '#43946c' },
  { name: '科技深蓝', color: '#2455EB' },
  { name: '橘橙之火', color: '#ff7e5f' }
]

const deleteHistory = (index) => {
  console.log(history.value);

  history.value.splice(index, 1);
  window.utools.dbStorage.setItem(
    'history',
    JSON.parse(JSON.stringify(history.value))
  );
};

const clearHistory = () => {
  window.utools.dbStorage.setItem('history', []);
  history.value = [];
  showToast('已清空解析记录');
};

watch(() => props.showState, (newValue) => {
  if (newValue && currentMenu.value === 'history') {
    setHistory();
  }
})

const setHistory = () => {
  history.value = window.utools.dbStorage.getItem('history') || [];
}

const copyContent = (content) => {
  window.utools.copyText(content);
  showToast('已复制到剪贴板');
};

const showConfirmPopover = ref(false);

const version = ref(packageJson.version);

const allPlatform = [
  '抖音',
  '小红书',
  '即梦',
  '最右',
  '快手',
  '哔哩哔哩',
  '豆包',
  '公众号',
  '皮皮虾'
];

onMounted(() => {
  downloadPath.value =
    window.utools.dbStorage.getItem('downloadPath') || defaultPath;
  setHistory();
  currentTheme.value = window.utools.dbStorage.getItem('theme') || '#0f172a';
  document.documentElement.style.setProperty('--primary-color', currentTheme.value);
  autoOpen.value = getAutoOpenConfig();
});
</script>
<template>
  <div class="preference-content">
    <div class="menu">
      <div
        class="menu-item"
        :class="{ active: currentMenu === 'setting' }"
        @click="chooseMenu('setting')"
      >
        偏好设置
      </div>
      <div
        class="menu-item"
        :class="{ active: currentMenu === 'about' }"
        @click="chooseMenu('about')"
      >
        关于应用
      </div>
      <div
        class="menu-item"
        :class="{ active: currentMenu === 'platform' }"
        @click="chooseMenu('platform')"
      >
        支持平台
      </div>
      <div
        class="menu-item"
        :class="{ active: currentMenu === 'history' }"
        @click="chooseMenu('history')"
      >
        解析记录
      </div>
    </div>
    <div class="menu-content">
      <!-- 设置 -->
      <div v-if="currentMenu === 'setting'" class="setting">
        <div class="setting-item download-path">
          <label for="downloadPath">下载路径</label>
          <input
            type="text"
            id="downloadPath"
            placeholder="选择下载路径"
            v-model="downloadPath"
            @change="onChange"
          />
          <div class="folder-icon" @click="selectFolder" title="选择文件夹">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="18"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="#0f172a"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <path
                d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7l-2-2H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2z"
              />
            </svg>
          </div>
        </div>
        <div class="setting-item">
          <label for="theme">主题配色</label>
          <div class="theme-dots">
            <div class="dot" v-for="(item, index) in themeList" :key="index" :class="{ active: currentTheme === item.color }" :style="{ background: item.color }" :title="item.name" @click="changeTheme(item.color)">
              {{ currentTheme === item.color ? '✓' : '' }}
            </div>
            <input class="color-picker dot" type="color" :value="currentTheme" @change="changeTheme($event.target.value)" title="自定义颜色" />
          </div>
        </div>
        <div class="setting-item auto-open">
          <!-- 自动打开目录 -->
          <label for="autoOpen">自动打开下载目录</label>
          <input v-model="autoOpen" type="checkbox" id="autoOpen" @change="autoOpenChange" />
        </div>
      </div>
      <!-- 关于 -->
      <div v-if="currentMenu === 'about'" class="about">
        <h3>轻溪去水印</h3>
        <p>版本: {{ version }}</p>
        <p>本工具仅用于学习交流，请勿用于商业用途。</p>
        <p>注意：频繁解析可能导致平台限制，建议合理使用哦。</p>
        <div class="popover-container">
          <span class="popover-title">
            <svg
              t="1765890115390"
              class="icon"
              viewBox="0 0 1024 1024"
              version="1.1"
              xmlns="http://www.w3.org/2000/svg"
              p-id="4655"
              width="14"
              height="14"
            >
              <path
                d="M626.176 279.552c74.24 0 134.656 55.808 134.656 124.928 0 21.504-6.144 42.496-17.408 61.44-16.896 27.648-44.032 48.128-76.8 57.856-8.704 2.56-15.36 3.584-21.504 3.584-14.336 0-25.6-11.264-25.6-25.6s11.264-25.6 25.6-25.6c1.024 0 3.072 0 5.632-1.024 22.016-6.144 39.424-18.944 49.152-35.84 6.656-10.752 9.728-22.528 9.728-34.816 0-40.448-37.376-73.728-82.944-73.728-15.872 0-31.232 4.096-45.056 11.776-24.064 13.824-38.4 36.864-38.4 61.952v214.528c0 43.52-24.064 83.456-64 105.984-21.504 12.288-45.568 18.432-70.144 18.432-74.24 0-134.656-55.808-134.656-124.928 0-21.504 6.144-42.496 17.408-61.44 16.896-27.648 44.032-48.128 76.8-57.856 9.216-2.56 15.36-3.584 21.504-3.584 14.336 0 25.6 11.264 25.6 25.6s-11.264 25.6-25.6 25.6c-1.024 0-3.072 0-5.632 1.024-22.016 6.656-39.424 19.456-49.152 35.84-6.656 10.752-9.728 22.528-9.728 34.816 0 40.448 37.376 73.728 83.456 73.728 15.872 0 31.232-4.096 45.056-11.776 24.064-13.824 38.4-36.864 38.4-61.952V404.48c0-43.52 24.064-83.456 64-105.984 20.992-12.8 45.056-18.944 69.632-18.944z m-520.704 230.4c0 226.304 183.296 409.6 409.6 409.6s409.6-183.296 409.6-409.6-183.296-409.6-409.6-409.6-409.6 183.296-409.6 409.6z m-51.2 0c0-254.464 206.336-460.8 460.8-460.8s460.8 206.336 460.8 460.8-206.336 460.8-460.8 460.8-460.8-206.336-460.8-460.8z m0 0"
                fill="currentColor"
                p-id="4656"
              ></path>
            </svg>
            小程序
          </span>
          <div class="popover-content">
            <img class="img" src="/miniprogram.png" alt="小程序" />
          </div>
        </div>
      </div>
      <div v-if="currentMenu === 'platform'" class="platform">
        <h3>支持平台</h3>
        <div class="platform-list">
          <div class="platform-item" v-for="(item, index) in allPlatform" :key="index">
            {{ item }}
          </div>
        </div>
      </div>

      <div v-if="currentMenu === 'history'" class="history">
        <!-- 清空 -->
        <div class="no-data" v-if="history.length === 0">暂无解析记录</div>
        <div class="history-item" v-for="(item, index) in history" :key="index">
          <div class="history-index">{{ index + 1 }}</div>
          <div class="item-top">
            <div class="item-title" title="点击复制分享链接" @click="copyContent(item.content)">
              {{ item.data.title || item.content }}
            </div>
            <div class="content-tooltip">
              <div class="content-tooltip-content">{{ item.content }}</div>
            </div>
            <div class="btn" @click="emit('loadData', item)">查看</div>
          </div>
          <div class="item-bottom">
            <div class="item-time">{{ item.time }}</div>
            <div
              class="delete-btn"
              title="删除当前记录"
              @click="deleteHistory(index)"
            >
              ×
            </div>
          </div>
        </div>
      </div>
      <div class="history-toolbar">
        <div
          class="confirm-popover"
          v-if="currentMenu === 'history' && history.length > 0"
        >
          <div
            class="clear-btn"
            @click="showConfirmPopover = true"
            title="一键清空"
          >
            清空
          </div>
          <div
            class="confirm-popover-content"
            :class="showConfirmPopover ? 'confirm-popover-show' : ''"
          >
            <div class="confirm-title">💬 确认清空解析记录？</div>
            <div class="confirm-btn-group">
              <div class="cancel-btn" @click="showConfirmPopover = false">
                取消
              </div>
              <div class="confirm-btn" @click="clearHistory">确认</div>
            </div>
          </div>
        </div>
        <span v-if="currentMenu === 'history'" class="history-tip"
          >只显示最近50条记录</span
        >
      </div>
    </div>
  </div>
</template>
<style lang="scss" scoped>
.preference-content {
  display: flex;
  height: 300px;
  border-radius: 8px;
  overflow: hidden;
}

.menu {
  width: 120px;
  // background-color: #f8f9fa;
  padding: 20px 0;
  border-right: 1px solid #e9ecef;
  padding-top: 0;
}

.menu-item {
  padding: 12px 20px;
  cursor: pointer;
  font-size: 14px;
  color: #495057;
  transition: background-color 0.3s, color 0.3s;
  border-radius: 4px;
  margin: 5px 10px;
}

.menu-item:hover {
  background-color: #e9ecef;
  color: #212529;
}

.menu-item.active {
  background-color: var(--primary-color);
  color: white;
}

.menu-content {
  flex: 1;
  padding: 20px;
  padding-top: 0;
  background-color: #ffffff;
  position: relative;
}

.setting-item {
  margin-bottom: 20px;
  position: relative;

  .folder-icon {
    position: absolute;
    right: 8px;
    bottom: 8px;
    cursor: pointer;
  }

  // 主题圆点
  .theme-dots {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin-top: 5px;
  }
  .dot {
    width: 20px;
    height: 20px;
    border-radius: 50%;
    cursor: pointer;
    border: 2px solid #fff;
    box-shadow: 0 2px 5px rgba(0, 0, 0, 0.1);
    transition: transform 0.2s;
    text-align: center;
  }
  .dot:hover {
    transform: scale(1.2);
  }
  .dot.active {
    border-color: var(--primary-color);
  }

  // 定制颜色选择器
  .color-picker {
    width: 25px;
    height: 25px;
    overflow: hidden;
    padding: 0;
    margin: 0;
    border: none;
    background: none;
    cursor: pointer;
    opacity: 0.8;
    backdrop-filter: invert(0.1);

    &::-webkit-color-swatch-wrapper {
      padding: 0;
      margin: 0;
      border: 2px solid #fff;
      border-radius: 50%;
      box-shadow: 0 2px 5px rgba(0, 0, 0, 0.1);
    }

    &::-webkit-color-swatch {
      border: none;
      border-radius: 50%;
      padding: 0;
      margin: 0;
    }

    &::-moz-color-swatch {
      border: none;
      border-radius: 50%;
    }
  }
}

.auto-open {
  display: flex;
  align-items: center;
  gap: 5px;
}

.setting-item.download-path label {
  display: block;
  margin-bottom: 8px;
  font-weight: 500;
  color: #495057;
  font-size: 14px;
}

.setting-item.download-path input {
  width: 100%;
  padding: 10px;
  border: 1px solid #ced4da;
  border-radius: 4px;
  font-size: 14px;
  transition: border-color 0.3s, box-shadow 0.3s;
  box-sizing: border-box;
  padding-right: 30px;
}

.setting-item.download-path input:focus {
  outline: none;
  border: 1px solid var(--primary-color);
  // 黑色阴影
  box-shadow: 0 0 0 1px var(--primary-color);
}

.about, .platform {
  h3 {
    margin-bottom: 15px;
    color: #495057;
    margin-top: 0;
  }
  p {
    margin-bottom: 10px;
    color: #6c757d;
    line-height: 1.5;
  }
}

.platform {
  .platform-list {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
  }

  .platform-item {
    padding: 8px 10px;
    background-color: #f8f9fa;
    border-radius: 4px;
    color: #495057;
    font-size: 12px;
    transition: background-color 0.3s;
    display: flex;
    align-items: center;
    user-select: none;

    .img {
      width: 20px;
      height: 20px;
      margin-right: 5px;
      border-radius: 4px;
    }
  }

  .platform-item:hover {
    background-color: #e9ecef;
  }
}

.active {
  background-color: var(--primary-color);
  color: #fff;
}

.popover-container {
  position: relative;
  display: inline-block;
  color: #6c757d;

  .popover-title {
    cursor: pointer;
    display: flex;
    align-items: center;
    gap: 4px;

    .icon {
      margin-top: 2px;
    }
  }

  .popover-content {
    position: absolute;
    bottom: 20px;
    left: 50%;
    transform: translateX(-50%);
    background-color: #fff;
    border-radius: 4px;
    z-index: 1;
    transition: opacity 0.3s;
  }

  &:hover .popover-content {
    opacity: 1;
    padding: 10px;
    box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
    border: 1px solid #e9ecef;

    .img {
      width: 120px;
      height: 120px;
    }
  }

  .img {
    width: 0;
    height: 0;
    object-fit: cover;
    transition: width 0.3s, height 0.3s;
  }
}

.history-toolbar {
  position: absolute;
  top: 0;
  display: flex;
  align-items: center;
  gap: 5px;

  .history-tip {
    color: #6c757d;
    font-size: 12px;
  }
}

.clear-btn {
  text-align: left;
  background-color: #dc3545;
  padding: 5px 10px;
  color: white;
  cursor: pointer;
  border-radius: 3px;
  font-size: 10px;
  transition: transform 0.1s;

  &:active {
    transform: scale(0.98);
  }
}

.history {
  height: 280px;
  overflow-y: auto;
  margin-top: 30px;

  .no-data {
    text-align: center;
    color: #6c757d;
    font-size: 14px;
    margin-bottom: 10px;
  }

  .history-item {
    border: 1px solid #e9ecef;
    border-radius: 4px;
    padding: 10px;
    margin-bottom: 10px;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    position: relative;

    .history-index {
      font-size: 10px;
      margin-bottom: 5px;
      color: #6c757d;
      font-weight: 500;
      position: absolute;
      top: 2px;
      left: 5px;
    }

    .item-title {
      width: 100px;
      font-weight: 500;
      color: #495057;
      // 溢出省略
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      cursor: pointer;
    }

    .content-tooltip {
      display: block;
      position: fixed;
      bottom: 5px;
      right: 5px;
      background-color: #fff;
      border-radius: 4px;
      z-index: 1;
      transition: transform 0.3s, padding 0.3s;
      box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
      border: 1px solid #e9ecef;
      word-wrap: break-word;
      transform: scale(0);
      max-width: 180px;
    }

    .item-top {
      display: flex;
      justify-content: space-between;
      align-items: center;
      position: relative;
      &:hover .content-tooltip {
        padding: 10px;
        transform: scale(1);
      }

      .btn {
        background-color: var(--primary-color);
        color: #fff;
        padding: 6px 12px;
        border-radius: 3px;
        cursor: pointer;
        font-size: 10px;
        transition: opacity 0.3s, transform 0.1s;

        &:hover {
          opacity: 0.9;
        }

        &:active {
          transform: scale(0.98);
        }
      }
    }

    .item-bottom {
      display: flex;
      justify-content: space-between;
      align-items: center;
      font-size: 12px;
      margin-top: 6px;
      .delete-btn {
        cursor: pointer;
        display: flex;
        padding: 2px;
        transition: color 0.3s;
        font-size: 14px;
      }

      .delete-btn:hover {
        color: red;
      }

      .item-time {
        color: #6c757d;
        font-size: 12px;
      }
    }
  }
}

.history::-webkit-scrollbar {
  display: none;
}

.confirm-popover-content {
  width: 150px;
  position: absolute;
  left: -50%;
  top: 30px;
  background-color: #ffffff;
  border-radius: 4px;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
  transform: scale(0);
  padding: 10px;
  transition: transform 0.3s;
  .confirm-title {
    font-size: 14px;
    color: #606266;
    transition: display 0.3s;
  }

  .confirm-btn-group {
    display: flex;
    gap: 10px;
    margin-top: 10px;
    justify-content: flex-end;
    transition: display 0.3s;

    .confirm-btn {
      background-color: var(--primary-color);
      color: #fff;
    }

    .confirm-btn,
    .cancel-btn {
      padding: 5px 10px;
      border-radius: 3px;
      cursor: pointer;
      transition: opacity 0.3s;
      font-size: 12px;
    }

    .cancel-btn:hover {
      background-color: #e9ecef;
    }

    .confirm-btn:hover {
      opacity: 0.9;
    }
  }
}

.confirm-popover-show {
  transform: scale(1);
}
</style>
