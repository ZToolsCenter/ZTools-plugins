<script setup>
import { ref } from 'vue';
import Dialog from '../components/Dialog/index.vue';
import Preference from '../components/Preference/index.vue';
import ImagePreview from '../components/ImagePreview/index.vue';
import showToast from '../utils/toast';
import { getAutoOpenConfig } from '../utils/config';

defineProps({
  enterAction: {
    type: Object,
    default: () => ({})
  }
})

const currentTab = ref('video') // 默认显示视频
const imageTab = ref('pic'); // pic live

const content = ref('');

const detailInfo = ref(null);
const loading = ref(false);

const previewImage = ref('');
const switchTab = (tab) => {
  currentTab.value = tab
}

const switchImageTab = (tab) => {
  if (tab === 'live' && detailInfo.value.pics[0].livePhotoUrl === '') {
    return;
  } 
  if (tab === 'pic' && detailInfo.value.pics[0].url === '') {
    return;
  }
  imageTab.value = tab;
}

const type = ref('pic');
const current = ref(0);
const previewList = ref([]);
const visible = ref(false);

const imageLoading = ref({});
const coverLoading = ref(false);

const open = (mode, index) => {
  if (mode === 'pic') {
    previewList.value = detailInfo.value.pics.map(item => item.url);
  }
  if (mode === 'cover') {
    previewList.value = [detailInfo.value.cover];
  }
  if (mode === 'live') {
    previewList.value = detailInfo.value.pics.map(item => item.livePhotoUrl);
  }
  if (mode === 'video') {
    previewList.value = [detailInfo.value.downloadUrl];
  }
  visible.value = true;
  type.value = mode;
  current.value = index;
}

const platformList = [
  {
    id: 'douyin',
    name: '抖音',
    content: '1.53 L@J.II 08/21 TlP:/ 📍changsha长沙 “湘江北去，橘子洲头”# 旅行推荐官 # 长沙 # 橘子洲头  https://v.douyin.com/6Spq1X9ay0o/ 复制此链接，打开Dou音搜索，直接观看视频！',
  },
  {
    id: 'xiaohongshu',
    name: '小红书',
    content: '估计后面会搓个手书吧 @RURU_茹. http://xhslink.com/o/9JV5cmmuOzg 复制后打开【小红书】查看笔记！【PS: 给妹妹个引流🐒】'
  },
  {
    id: 'jimeng',
    name: '即梦',
    content: 'https://jimeng.jianying.com/s/59q6OoJtnok/'
  },
  // {
  //   id: 'doubao',
  //   name: '豆包',
  //   content: 'https://www.doubao.com/thread/w92d2f8434076e159'
  // },
  {
    id: 'zuiyou',
    name: '最右',
    content: '#最右#分享一条有趣的内容给你，不好看算我输。请戳链接>>https://share.xiaochuankeji.cn/hybrid/share/post?pid=413110582'
  },
  {
    id: 'kuaishou',
    name: '快手',
    content: 'https://www.kuaishou.com/f/X-6S79G8Kibq018N'
  },
  {
    id: 'bilibili',
    name: '哔哩哔哩',
    content: '【淀粉肠包蛋 暂时不考虑收徒】 https://www.bilibili.com/video/BV1HD27BNETV/?share_source=copy_web&vd_source=78607971dc08a56a924ddc1a0786ef5f'
  }
]

const parseInfo = async () => {
  if (!content.value) return;
  // 解析出content中的url
  const urlMatch = content.value.match(/http[s]?:\/\/[^\s]+/);
  if (!urlMatch) {
    showError('未找到有效的链接');
    return;
  }
  const url = urlMatch[0];
  if (!url) return;
  loading.value = true;
  try {
    const info = await window.services.parseInfo(url);
    console.log(info);
    detailInfo.value = info;
    currentTab.value = info.downloadUrl ? 'video' : 'pic';
    loading.value = false;
    setImageLoading(info);
    setHistory(content.value, info);
  } catch (e) {
    console.log(e.message);
    loading.value = false;
    showError(e.message);
  }
}

const setImageLoading = (data) => {
  const pics = data.pics;
  if (pics) {
    imageLoading.value = {};
    imageTab.value = data.pics[0]?.livePhotoUrl ? 'live' : 'pic';
    pics.forEach((_, index) => {
      imageLoading.value[index] = true;
    });
  }
  if (data.cover) {
    coverLoading.value = true;
  }
}

const pasteClipboard = () => {
  // js读取剪贴板
  navigator.clipboard.readText().then(text => {
    content.value = text;
  });
}

const MAX_HISTORY = 50;

const setHistory = (content, info) => {
  let list = window.utools.dbStorage.getItem('history') || [];
  // content 去重
  list = list.filter(item => item.content !== content);
  // 新的放最前
  list.unshift({
    content: content,
    data: info,
    time: new Date().toLocaleString()
  });
  if (list.length > MAX_HISTORY) {
    list = list.slice(0, MAX_HISTORY);
  }
  window.utools.dbStorage.setItem('history', list);
}

const showError = (message) => {
  showToast(message, 'error');
}

const copyLink = (livePhoto) => {
  copyText(livePhoto);
  showToast('已复制到剪贴板');
}

const copyText = (text) => {
  navigator.clipboard.writeText(text);
  showToast('已复制到剪贴板');
}

const testPlatform = (index) => { 
  content.value = platformList[index].content;
}

const playLivePhoto = (index) => {
  document.querySelector('#livePhoto' + index).play();
}

// 下载加载
const picLoading = ref(false);
const livePhotoLoading = ref(false);

const download = async (livePhoto) => {
  let url;
  let type = livePhoto ? 'video' : 'pic';
  if (livePhoto) {
    livePhotoLoading.value = true;
    url = livePhoto;
  } else {
    picLoading.value = true;
    url = previewImage.value;
  }
  try {
    const res = await window.services.downloadVideo(url, type, (downloaded, total) => {
      const progress = (downloaded / total) * 100;
      showToast(`下载进度: ${progress.toFixed(0)}%`);
    });
    console.log(res);
    if (res) {
      showToast('下载成功');
      if (livePhoto) {
        livePhotoLoading.value = false;
      } else {
        picLoading.value = false;
      }
      if (getAutoOpenConfig()) {
        window.utools.shellShowItemInFolder(res);
      }
    } else {
      showToast('下载失败', 'error');
      if (livePhoto) {
        livePhotoLoading.value = false;
      } else {
        picLoading.value = false;
      }
    }
  } catch(e) {
    showToast('下载失败' + e.message, 'error');
    if (livePhoto) {
      livePhotoLoading.value = false;
    } else {
      picLoading.value = false;
    }
  }
}

const loadingAll = ref(false);

const downloadAll = async () => {
  let type = imageTab.value;
  let list = [];
  if (imageTab.value === 'live') {
    list = detailInfo.value.pics.map(item => item.livePhotoUrl);
  } else {
    list = detailInfo.value.pics.map(item => item.url);
  }
  loadingAll.value = true;
  let lastPic = '';
  for (let i = 0; i < list.length; i++) {
    lastPic = await window.services.downloadVideo(list[i], type === 'live' ? 'video' : 'pic', (downloaded, total) => {
      const progress = (downloaded / total) * 100;
      showToast(`${type === 'live' ? 'Live图片' : '图片'} ${i + 1} 下载进度: ${progress.toFixed(0)}%`);
    }, i + 1);
  }
  showToast('下载成功');
  loadingAll.value = false;
  if (getAutoOpenConfig()) {
    window.utools.shellShowItemInFolder(lastPic);
  }
}

const copyAuthorUrl = () => {
  const platform = detailInfo.value.platform;
  if (platform !== 'default') {
    if (platform === 'xiaohongshu') {
      navigator.clipboard.writeText('https://www.xiaohongshu.com/user/profile/' + detailInfo.value.author.id);
      showToast('已复制到剪贴板');
    }
  }
}

const showDialog = ref(false);

const handlerLoadData = (e) => {
  const { content: ctx, data } = e;
  detailInfo.value = data;
  currentTab.value = data.downloadUrl ? 'video' : 'pic';
  content.value = ctx;
  showDialog.value = false;
  setImageLoading(data);
}

// 判断数组对象内的某个属性和属性值是否不为空
const isNotEmpty = (arr, key) => {
  if (!Array.isArray(arr)) return false;
  return arr.some(item => (item[key] !== '' && item[key] !== null && item[key] !== undefined));
}
</script>
<template>
  <div class="main">
    <div class="main-card">
      <div class="left">
        <div class="main-card-title">
          轻溪去水印
        </div>
        <!-- 声明 -->
        <div class="main-card-desc">本工具仅用于学习交流，请勿用于商业用途。</div>
        <textarea v-model="content" name="ipt" id="input" placeholder="右键粘贴视频分享链接..." @keydown.enter.prevent="parseInfo" @contextmenu="pasteClipboard"></textarea>
        <button v-show="content !== ''" class="clear-btn" @click="content = ''" title="清空输入框">×</button>
        <button class="parse-btn" :disabled="loading" @click="parseInfo">
          <svg v-if="!loading" xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-search w-4 h-4" aria-hidden="true"><path d="m21 21-4.34-4.34"></path><circle cx="11" cy="11" r="8"></circle></svg>
          <svg v-else t="1765683055654" class="icon loading" viewBox="0 0 1024 1024" fill="currentColor" version="1.1" xmlns="http://www.w3.org/2000/svg" p-id="12849" width="15" height="15"><path d="M469.333333 128a42.666667 42.666667 0 0 1 42.666667-42.666667c235.648 0 426.666667 191.018667 426.666667 426.666667a42.666667 42.666667 0 1 1-85.333334 0 341.333333 341.333333 0 0 0-341.333333-341.333333 42.666667 42.666667 0 0 1-42.666667-42.666667z" p-id="12850"></path></svg>
          {{ loading ? '解析中...' : '开始解析' }}
        </button>
        <div class="platform">
          <div v-for="(item, index) in platformList" :key="index" class="platform-item" @click="testPlatform(index)">
            {{ item.name }}
          </div>
        </div>
        <div class="parse-info" v-if="detailInfo">
          <!-- 头像、名字 -->
          <div class="user-info">
            <img v-if="detailInfo?.author?.avatar" class="avatar" :src="detailInfo?.author?.avatar" alt="头像"></img>
            <div class="released-info-item-name">{{ detailInfo?.author?.name }}</div>
            <!-- 复制 -->
            <div class="copy-icon" v-if="detailInfo?.platform !== 'default'" title="复制作者主页链接" @click="copyAuthorUrl">
              <svg xmlns="http://www.w3.org/2000/svg"  width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <rect width="14" height="14" x="8" y="8" rx="2" ry="2"/>
                <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>
              </svg>
            </div>
          </div>
          <!-- 文案 -->
          <div class="title-text">
            {{ detailInfo.title }}
            <span style="cursor: pointer;" title="复制文案" @click="copyText(detailInfo.title)">
              <svg xmlns="http://www.w3.org/2000/svg"  width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <rect width="14" height="14" x="8" y="8" rx="2" ry="2"/>
                <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>
              </svg>
            </span>
          </div>
        </div>
        <button class="setting-btn" @click="showDialog = true">
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-settings w-5 h-5" aria-hidden="true"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"></path><circle cx="12" cy="12" r="3"></circle></svg>
        </button>
        <div class="left-top">
          <button v-if="isNotEmpty(detailInfo?.pics, 'url') || isNotEmpty(detailInfo?.pics, 'livePhotoUrl')" :disabled="loadingAll" class="left-top-item" @click="downloadAll()" title="下载全部图片/Live照片">
            <svg v-if="!loadingAll" xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
              <polyline points="7,10 12,15 17,10"/>
              <line x1="12" x2="12" y1="15" y2="3"/>
            </svg>
            <svg v-else t="1765683055654" class="icon loading" viewBox="0 0 1024 1024" fill="currentColor" version="1.1" xmlns="http://www.w3.org/2000/svg" p-id="12849" width="15" height="15"><path d="M469.333333 128a42.666667 42.666667 0 0 1 42.666667-42.666667c235.648 0 426.666667 191.018667 426.666667 426.666667a42.666667 42.666667 0 1 1-85.333334 0 341.333333 341.333333 0 0 0-341.333333-341.333333 42.666667 42.666667 0 0 1-42.666667-42.666667z" p-id="12850"></path></svg>
            {{ loadingAll ? '下载中...' : '下载全部' }}
          </button>
        </div>
      </div>
      <div class="right">
        <div class="detail-info" v-if="detailInfo">
          <div v-show="currentTab === 'video'" class="video-wrapper">
            <video v-if="detailInfo.downloadUrl" class="video" controls :src="detailInfo.downloadUrl"></video>
            <div class="full" @click="open('video', 0)">
              <svg t="1766170170744" class="icon" viewBox="0 0 1024 1024" fill="currentColor" version="1.1" xmlns="http://www.w3.org/2000/svg" p-id="2793" width="14" height="14"><path d="M181 357.5V181.2h176.4c14.3 0 25.9-11.6 25.9-25.9v-31.1c0-14.3-11.6-25.9-25.9-25.9H118c-11 0-20 9-20 20v239.4c0 14.3 11.6 25.9 25.9 25.9H155c14.4-0.1 26-11.7 26-26.1zM668.6 181.2H845v176.4c0 14.3 11.6 25.9 25.9 25.9H902c14.3 0 25.9-11.6 25.9-25.9V118.2c0-11-9-20-20-20H668.6c-14.3 0-25.9 11.6-25.9 25.9v31.1c0 14.3 11.6 26 25.9 26zM357.4 845.2H181V668.8c0-14.3-11.6-25.9-25.9-25.9H124c-14.3 0-25.9 11.6-25.9 25.9v239.4c0 11 9 20 20 20h239.4c14.3 0 25.9-11.6 25.9-25.9v-31.1c-0.1-14.4-11.7-26-26-26zM845 668.8v176.4H668.6c-14.3 0-25.9 11.6-25.9 25.9v31.1c0 14.3 11.6 25.9 25.9 25.9H908c11 0 20-9 20-20V668.8c0-14.3-11.6-25.9-25.9-25.9H871c-14.4 0-26 11.6-26 25.9z" p-id="2794"></path></svg>
            </div>
          </div>
          <div v-show="currentTab === 'pic'" class="pic-list">
            <div class="pic-item-wrapper" v-for="(item, index) in detailInfo.pics" :key="index">
              <div v-if="imageLoading[index]" class="loading-overlay">
                <svg t="1765683055654" class="icon loading" viewBox="0 0 1024 1024" fill="currentColor" version="1.1" xmlns="http://www.w3.org/2000/svg" p-id="12849" width="20" height="20"><path d="M469.333333 128a42.666667 42.666667 0 0 1 42.666667-42.666667c235.648 0 426.666667 191.018667 426.666667 426.666667a42.666667 42.666667 0 1 1-85.333334 0 341.333333 341.333333 0 0 0-341.333333-341.333333 42.666667 42.666667 0 0 1-42.666667-42.666667z" p-id="12850"></path></svg>
                加载中...
              </div>
              <video v-show="item.livePhotoUrl && imageTab === 'live'" autoplay :id="'livePhoto' + index" class="pic-item" :src="item.livePhotoUrl" @click="open('live', index)" @loadeddata="imageLoading[index] = false" @error="imageLoading[index] = false"></video>
              <img v-show="item.url && imageTab === 'pic'" class="pic-item" :src="item.url" alt="图集" @click="open('pic', index)" @load="imageLoading[index] = false" @error="imageLoading[index] = false">
              <div class="live-photo-tip" v-if="item.livePhotoUrl && imageTab === 'live'" @click="playLivePhoto(index)">
                Live
              </div>
              <!-- 保存、复制 -->
              <div v-if="item.livePhotoUrl && imageTab === 'live'" class="save-and-copy">
                <div class="save-btn" :class="livePhotoLoading ? 'save-btn-disabled' : ''" @click="download(item.livePhotoUrl)">
                  <span v-if="!livePhotoLoading">保存</span>
                  <svg v-else t="1765683055654" class="icon loading" viewBox="0 0 1024 1024" fill="currentColor" version="1.1" xmlns="http://www.w3.org/2000/svg" p-id="12849" width="15" height="15"><path d="M469.333333 128a42.666667 42.666667 0 0 1 42.666667-42.666667c235.648 0 426.666667 191.018667 426.666667 426.666667a42.666667 42.666667 0 1 1-85.333334 0 341.333333 341.333333 0 0 0-341.333333-341.333333 42.666667 42.666667 0 0 1-42.666667-42.666667z" p-id="12850"></path></svg>
                </div>
                <div class="copy-btn" @click="copyLink(item.livePhotoUrl)">复制</div>
              </div>
            </div>
            <div class="left-top">
              <div class="live-photo">
                <div v-show="imageTab === 'live' && isNotEmpty(detailInfo.pics, 'url')" class="live-photo-item" @click="switchImageTab('pic')">Live</div>
                <div v-show="imageTab === 'pic' && isNotEmpty(detailInfo.pics, 'livePhotoUrl')" class="live-photo-item" @click="switchImageTab('live')">Photo</div>
              </div>
            </div>
          </div>
          <!-- 封面 -->
          <div v-show="currentTab === 'cover'" class="cover-wrapper">
            <div v-if="coverLoading" class="loading-overlay">
              <svg t="1765683055654" class="icon loading" viewBox="0 0 1024 1024" fill="currentColor" version="1.1" xmlns="http://www.w3.org/2000/svg" p-id="12849" width="20" height="20"><path d="M469.333333 128a42.666667 42.666667 0 0 1 42.666667-42.666667c235.648 0 426.666667 191.018667 426.666667 426.666667a42.666667 42.666667 0 1 1-85.333334 0 341.333333 341.333333 0 0 0-341.333333-341.333333 42.666667 42.666667 0 0 1-42.666667-42.666667z" p-id="12850"></path></svg>
              加载中...
            </div>
            <img class="cover" :src="detailInfo.cover" alt="封面" @click="open('cover', 0)" @load="coverLoading = false" @error="coverLoading = false">
          </div>
        </div>
        <div class="right-tip" v-else>
          <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-play w-10 h-10 mb-2 opacity-20" aria-hidden="true"><polygon points="6 3 20 12 6 21 6 3"></polygon></svg>
          预览区域
        </div>
        <div class="tab" v-if="detailInfo">
          <div class="tab-item" v-if="detailInfo.downloadUrl" :class="{ active: currentTab === 'video' }" @click="switchTab('video')">视频预览</div>
          <div class="tab-item" v-if="detailInfo.pics && detailInfo.pics.length !== 0" :class="{ active: currentTab === 'pic' }" @click="switchTab('pic')">图片预览</div>
          <div class="tab-item" v-if="detailInfo.cover" :class="{ active: currentTab === 'cover' }" @click="switchTab('cover')">封面预览</div>
        </div>
      </div>
    </div>
  </div>
  <!-- 图片预览模态框 -->
  <ImagePreview :visible="visible" :list="previewList" :type="type" :current="current" @next="$event => { current = $event }" @prev="$event => { current = $event }" @close="visible = false" />
  <Dialog width="360px" title="设置" v-model:visible="showDialog" @confirm="showDialog = false" confirm-text="关闭">
    <Preference @load-data="handlerLoadData" :show-state="showDialog" />
  </Dialog>
</template>
<style lang="scss" scoped>
  $radius: 10px;
  $card-height: calc(100vh - 40px - 40px);
  .main {
    height: calc(100vh - 40px);
    background-color: #F5F7FA;// #F9FAFB
    padding: 20px;
  }
  .main-card {
    display: flex;
    justify-content: space-between;
    align-items: center;
    border-radius: 5px;
    margin-bottom: 10px;
    box-shadow: 0 2px 12px 0 rgba(0, 0, 0, 0.1);
    .left {
      width: 50%;
      height: $card-height;
      background-color: #fff;
      border-top-left-radius: $radius;
      border-bottom-left-radius: $radius;
      border-right: 1px solid #EBEEF5;
      padding: 20px;
      position: relative;

      .main-card-title {
        font-size: 20px;
        font-weight: 600;
        margin-bottom: 10px;
        display: flex;
        align-items: center;
        gap: 10px;
      }

      .main-card-desc {
        font-size: 12px;
        color: #909399;
        margin-bottom: 12px;
      }

      .clear-btn {
        width: 15px;
        height: 15px;
        display: flex;
        justify-content: center;
        align-items: center;
        cursor: pointer;
        position: absolute;
        right: 22px;
        top: 188px;
        border-radius: 50%;
        border: none;
        font-size: 14px;
        background-color: transparent;
        transition: background-color 0.3s;
      }

      .clear-btn:hover {
        background-color: #E3E8EF;
      }

      .platform {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin: 5px 0;
        flex-wrap: wrap;

        .platform-item {
          padding: 5px 10px;
          background-color: #fff;
          border-radius: 5px;
          display: flex;
          justify-content: center;
          align-items: center;
          cursor: pointer;
          transition: background-color 0.3s;
        }

        .platform-item:hover {
          background-color: #F5F7FA;
        }
      }

      .parse-info {
        max-height: 190px;
        overflow: auto;

        .copy-icon {
          display: flex;
          cursor: pointer;
        }

        .user-info {
          display: flex;
          align-items: center;
          gap: 10px;
          margin-bottom: 10px;

          .avatar {
            width: 30px;
            height: 30px;
            border-radius: 50%;
          }
        }
      }

      .left-top {
        display: flex;
        align-items: center;
        margin-top: 10px;

        .left-top-item {
          background-color: var(--primary-color);
          color: #fff;
          border-radius: 4px;
          font-size: 12px;
          padding: 5px 8px;
          cursor: pointer;
          transition: all .3s;
          display: flex;
          align-items: center;
          gap: 5px;
          transition: opacity 0.3s;
          border: none;
        }

        .left-top-item:hover {
          opacity: 0.9;
        }

        .left-top-item:disabled {
          opacity: 0.7;
          cursor: not-allowed;
          color: rgba(255, 255, 255, 0.7);
        }
      }
    }
    .right {
      width: 50%;
      height: $card-height;
      background-color: #F5F7FA;
      border-top-right-radius: $radius;
      border-bottom-right-radius: $radius;
      padding: 20px;
      position: relative;
      overflow: hidden;

      .detail-info {
        height: 100%;
      }

      .right-tip {
        display: flex;
        flex-direction: column;
        justify-content: center;
        align-items: center;
        height: 100%;
        color: rgba(0, 0, 0, 0.5);
        gap: 10px;
      }

      .live-photo {
        display: flex;
        font-size: 12px;
        position: absolute;
        top: 5px;
        left: 5px;

        .live-photo-item {
          padding: 4px 8px;
          background-color: rgba(0, 0, 0, 1);
          color: #fff;
          border-radius: 4px;
          cursor: pointer;
        }
      }
    }
  }
  #input {
    width: 100%;
    height: 120px;
    padding: 10px;
    box-sizing: border-box;
    background-color: #F9FAFB;
    border: 1px solid #e5e7eb;
    border-radius: 5px;
    font-size: 14px;
    transition: all .3s;
  }
  #input::-webkit-scrollbar {
    display: none;
  }
  #input:focus {
    border: 1px solid var(--primary-color);
    background-color: #fff;
    // 黑色阴影
    box-shadow: 0 0 0 1px var(--primary-color);
  }
  .parse-btn {
    width: 100%;
    height: 40px;
    background-color: var(--primary-color);
    color: #fff;
    border-radius: 5px;
    font-size: 15px;
    margin-top: 10px;
    transition: all .3s;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 5px;
    transition: opacity 0.3s;
    border: none;
  }

  .parse-btn:hover {
    opacity: 0.9;
  }

  .parse-btn:disabled { 
    opacity: 0.7;
    cursor: not-allowed;
    color: rgba(255, 255, 255, 0.5);
  }

  .parse-btn:active {
    transform: scale(0.98);
  }

  .video-wrapper {
    width: 100%;
    height: 100%;
    .video {
      width: 100%;
      height: 100%;
      border-radius: 5px;
    }

    .full {
      position: absolute;
      top: 5px;
      left: 5px;
      color: #000;
      padding: 5px;
      border-radius: 50%;
      font-size: 12px;
      cursor: pointer;
      display: flex;
      transition: background-color 0.3s, color 0.3s;
    }

    .full:hover {
      background-color: #0F172A;
      color: #fff;
    }
  }

  .tab {
    width: 50%;
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-top: 10px;
    background-color: #fff;
    position: absolute;
    border-radius: 5px;
    top: 25px;
    left: 25%;

    .tab-item {
      width: 50%;
      height: 30px;
      border-radius: 5px;
      font-size: 14px;
      text-align: center;
      line-height: 30px;
      color: #1E293B;
      cursor: pointer;
      transition: all .3s;
      margin: 5px;
    }
    .active {
      background-color: var(--primary-color);
      color: #fff;
    }
  }

  .pic-list {
    height: calc($card-height - 80px);
    display: grid;
    grid-template-columns: repeat(auto-fill, 100px);
    gap: 10px;
    margin-top: 80px;
    overflow: auto;
    align-content: flex-start;
    .pic-item-wrapper {
      position: relative;

      .loading-overlay {
        position: absolute;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        display: flex;
        flex-direction: column;
        justify-content: center;
        align-items: center;
        background-color: rgba(255, 255, 255, 0.8);
        border-radius: 5px;
        color: #666;
        font-size: 12px;
        gap: 5px;
        z-index: 1;
      }

      .live-photo-tip {
        position: absolute;
        top: 2px;
        right: 2px;
        background-color: rgba(0, 0, 0, 1);
        border-radius: 10px;
        display: flex;
        justify-content: center;
        align-items: center;
        color: #fff;
        padding: 2px 5px;
        font-size: 10px;
        cursor: pointer;
      }

      .save-and-copy {
        width: 100%;
        position: absolute;
        bottom: 4px;
        left: 0;
        border-bottom-left-radius: 5px;
        border-bottom-right-radius: 5px;
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 5px;
        // 从上到下渐变
        background: linear-gradient(180deg, rgba(0, 0, 0, 0) 0%, rgba(0, 0, 0, 0.5) 100%);
        color: #fff;
        font-size: 12px;

        .save-btn, .copy-btn {
          padding: 2px 5px;
          cursor: pointer;
        }

        .save-btn-disabled { 
          cursor: not-allowed;
        }
      }
    }

    .pic-item {
      width: 100px;
      height: 100px;
      object-fit: cover;
      border-radius: 5px;
      transition: all .3s;
      cursor: pointer;
    }

    .pic-item:hover {
      opacity: 0.8;
    }
  }

  .cover-wrapper {
    position: relative;
    margin-top: 80px;

    .loading-overlay {
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      display: flex;
      flex-direction: column;
      justify-content: center;
      align-items: center;
      background-color: rgba(255, 255, 255, 0.8);
      border-radius: 5px;
      color: #666;
      font-size: 14px;
      gap: 5px;
      z-index: 1;
    }
  }

  .cover {
    width: 100%;
    height: 200px;
    object-fit: cover;
    border-radius: 5px;
    transition: all .3s;
    cursor: pointer;
  }

  .cover:hover {
    opacity: 0.8;
  }

  .setting-btn {
    background-color: transparent;
    border: none;
    display: flex;
    justify-content: center;
    align-items: center;
    padding: 5px;
    cursor: pointer;
    border-radius: 50%;
    transition: all 0.3s;
    color: #94a3b8;
    position: absolute;
    top: 20px;
    right: 20px;
  }

  .setting-btn:hover {
    background-color: #e5e7eb;
    color: var(--primary-color);
  }
</style>

