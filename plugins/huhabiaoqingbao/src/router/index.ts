import { createRouter, createWebHashHistory, RouteRecordRaw } from 'vue-router'
import AboutAuthor from '../components/AboutAuthor.vue'
import EmoticonWorkshop from '../components/workshop/EmoticonWorkshop.vue'
import KaomojiPicker from '../components/emoji/KaomojiPicker.vue'
import EmojiPicker from '../components/emoji/EmojiPicker.vue'
import EmoticonList from '../components/emoticon/EmoticonGrid.vue'
import OnlineSearch from '../components/online/OnlineSearch.vue'
import VideoPlayer from '../components/VideoPlayer.vue'
import WallpaperView from '../views/WallpaperView.vue'
import Settings from '../views/Settings.vue'
import VideoToGif from '../components/video/VideoToGif.vue'
import AiEmoticonGenerator from '../components/ai/AiEmoticonGenerator.vue'
import BeautyImages from '../components/beauty/BeautyImages.vue'
import HandsomeImages from '../components/handsome/HandsomeImages.vue'

const routes: Array<RouteRecordRaw> = [
  {
    path: '/',
    redirect: '/all'
  },
  {
    path: '/all',
    name: 'all',
    component: EmoticonList
  },
  {
    path: '/favorite',
    name: 'favorite',
    component: EmoticonList
  },
  {
    path: '/online',
    name: 'online',
    component: OnlineSearch
  },
  {
    path: '/workshop',
    name: 'workshop',
    component: EmoticonWorkshop
  },
  {
    path: '/emoji',
    name: 'emoji',
    component: EmojiPicker
  },
  {
    path: '/kaomoji',
    name: 'kaomoji',
    component: KaomojiPicker
  },
  {
    path: '/about',
    name: 'about',
    component: AboutAuthor
  },
  {
    path: '/girlvideo',
    name: 'girlvideo',
    component: VideoPlayer
  },
  {
    path: '/wallpaper',
    name: 'wallpaper',
    component: WallpaperView
  },
  {
    path: '/settings',
    name: 'settings',
    component: Settings
  },
  {
    path: '/videotogif',
    name: 'videotogif',
    component: VideoToGif
  },
  {
    path: '/ai',
    name: 'ai',
    component: AiEmoticonGenerator
  },
  {
    path: '/beauty',
    name: 'beauty',
    component: BeautyImages
  },
  {
    path: '/handsome',
    name: 'handsome',
    component: HandsomeImages
  }
]

const router = createRouter({
  history: createWebHashHistory(),
  routes
})

export default router 