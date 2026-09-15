<template>
  <div class="about-container">
    <div class="profile-card" :class="{ 'animate': showAnimation }">
      <div class="content-wrapper">
        <!-- 左侧个人信息 -->
        <div class="personal-info">
          <div class="avatar-container">
            <div class="avatar-wrapper" :class="{ 'loaded': avatarLoaded, 'error': avatarError }">
              <div class="avatar-skeleton"></div>
              <img class="avatar" 
                   :src="avatarSrc" 
                   alt="HUHA" 
                   @load="handleImageLoad"
                   @error="handleImageError" />
            </div>
          </div>
          
          <div class="info-content">
            <h2 class="author-name">HUHA</h2>
            <p class="author-title">菜鸟开发者 / 表情包爱好者</p>
            
            <div class="contact-info">
              <a href="#" 
                 @click.prevent="openUrl('https://www.huhage.fun/')" 
                 class="contact-item">
                <i class="fas fa-home"></i>
                <span>我的主页</span>
              </a>
              <a href="mailto:wsyhok@126.com" class="contact-item">
                <i class="fas fa-envelope"></i>
                <span>wsyhok@126.com</span>
              </a>
            </div>
          </div>
        </div>

        <!-- 右侧项目信息 -->
        <div class="project-section">
          <div class="about-text">
            <h3>关于我</h3>
            <p>👋 你好！我是HUHA，一个热爱编程和表情包的开发者。</p>
            <p>🎯 开发这个工具的初衷是为了让表情包的管理变得更加简单有趣。</p>
            <p>🌟 希望这个小工具能给你带来便利和快乐！</p>
          </div>

          <div class="my-works">
            <h3>我的作品</h3>
            <div class="works-grid">
              <a href="#" 
                 v-for="work in works"
                 :key="work.url"
                 @click.prevent="openUrl(work.url)"
                 class="work-card">
                <div class="work-icon">
                  <img :src="work.icon" :alt="work.title">
                </div>
                <div class="work-info">
                  <h4>{{ work.title }}</h4>
                  <p>{{ work.description }}</p>
                </div>
              </a>
            </div>
          </div>

          <div class="project-links">
            <h3>项目相关</h3>
            <div class="links-wrapper">
              <a href="https://gitee.com/huhage/baoqingbao_utools"
                 target="_blank"
                 rel="noopener noreferrer"
                 class="project-link">
                <i class="fab fa-git-alt"></i>
                <span>开源仓库</span>
              </a>
              <a href="https://gitee.com/huhage/baoqingbao_utools/issues"
                 target="_blank"
                 rel="noopener noreferrer"
                 class="project-link">
                <i class="fas fa-bug"></i>
                <span>问题反馈</span>
              </a>
            </div>
          </div>

          <div class="cursor-info">
            <i class="fas fa-robot"></i>
            本项目由 <span class="highlight">Cursor AI</span> 辅助开发完成
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import defaultAvatar from '../assets/default-avatar.svg'

// 导入静态图片服务
import { getStaticImageUrl } from '@/services/staticImages'

// 定义作品数据
interface Work {
  url: string;
  title: string;
  description: string;
  icon: string;
}

const works = ref<Work[]>([
  {
    url: 'https://www.huhage.fun',
    title: '呼哈开发者工具箱',
    description: '一站式在线开发工具集合',
    icon: getStaticImageUrl('工具箱.png')
  },
  {
    url: 'https://markly-style-craft.netlify.app',
    title: 'MDtoIMG',
    description: 'AI生成结果分享工具',
    icon: getStaticImageUrl('Markdown.png')
  },
  {
    url: 'https://v0-html-content-sharing-site.vercel.app',
    title: 'HTML分享工具',
    description: '安全、便捷地分享您的HTML内容',
    icon: getStaticImageUrl('HTML.png')
  },
  {
    url: 'https://www.huhawall.fun',
    title: '呼哈留言墙',
    description: '分享你的想法和心情',
    icon: getStaticImageUrl('留言墙.png')
  }
])

const showAnimation = ref(false)
const avatarLoaded = ref(false)
const avatarError = ref(false)
const avatarSrc = ref(defaultAvatar)

// 预加载头像
const preloadAvatar = () => {
  const img = new Image()
  const avatarUrl = getStaticImageUrl('huha-avatar.png')
  img.src = avatarUrl
  
  img.onload = () => {
    avatarSrc.value = avatarUrl
  }
  
  img.onerror = () => {
    handleImageError()
  }
}

onMounted(() => {
  showAnimation.value = true
  preloadAvatar()
})

const handleImageLoad = () => {
  avatarLoaded.value = true
  avatarError.value = false
}

const handleImageError = () => {
  avatarLoaded.value = true
  avatarError.value = true
  avatarSrc.value = defaultAvatar
}

// 使用 ZTools API 打开链接
const openUrl = (url: string) => {
  window.ztools?.shellOpenExternal(url)
}
</script>

<style scoped>
.about-container {
  display: flex;
  justify-content: center;
  align-items: center;
  min-height: 100%;
  padding: 2rem;
  background: var(--el-bg-color);
}

.profile-card {
  background: var(--el-bg-color-overlay);
  border-radius: 24px;
  box-shadow: 0 20px 40px rgba(0, 0, 0, 0.1);
  padding: 3rem;
  width: 100%;
  max-width: 1000px;
  opacity: 0;
  transform: translateY(20px);
  transition: all 0.6s cubic-bezier(0.4, 0, 0.2, 1);
}

.profile-card.animate {
  opacity: 1;
  transform: translateY(0);
}

.content-wrapper {
  display: flex;
  flex-direction: column;
  gap: 3rem;
  align-items: center;
}

.personal-info {
  padding: 0 0 2rem 0;
  border-bottom: 1px solid var(--el-border-color-lighter);
  border-right: none;
  width: 100%;
  max-width: 600px;
  text-align: center;
}

.avatar-container {
  margin-bottom: 2rem;
}

.avatar-wrapper {
  position: relative;
  width: 160px;
  height: 160px;
  margin: 0 auto;
}

.avatar-skeleton {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  border-radius: 50%;
  background: linear-gradient(90deg, var(--el-fill-color-light) 25%, var(--el-fill-color) 50%, var(--el-fill-color-light) 75%);
  background-size: 200% 100%;
  animation: shimmer 1.5s infinite;
}

.avatar {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  border-radius: 50%;
  border: 4px solid var(--el-color-primary-light-7);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.1);
  transition: all 0.3s ease;
  opacity: 0;
  object-fit: cover;
}

.avatar-wrapper.loaded .avatar {
  opacity: 1;
}

.avatar-wrapper.loaded .avatar-skeleton {
  display: none;
}

.info-content {
  text-align: center;
}

.author-name {
  font-size: 2rem;
  color: var(--el-text-color-primary);
  margin-bottom: 0.5rem;
  font-weight: 600;
}

.author-title {
  color: var(--el-text-color-regular);
  font-size: 1.1rem;
  margin-bottom: 2rem;
  font-weight: 500;
}

.contact-info {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.contact-item {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.75rem 1rem;
  background: var(--el-fill-color-light);
  border-radius: 12px;
  color: var(--el-text-color-regular);
  text-decoration: none;
  transition: all 0.3s ease;
  border: 1px solid var(--el-border-color-light);
}

.contact-item:hover {
  background: var(--el-color-primary-light-9);
  color: var(--el-color-primary);
  transform: translateX(5px);
  border-color: var(--el-color-primary-light-5);
}

.contact-item i {
  font-size: 1.2rem;
  color: var(--el-color-primary);
}

.project-section {
  width: 100%;
  max-width: 800px;
  display: flex;
  flex-direction: column;
  gap: 2.5rem;
}

.about-text {
  background: var(--el-fill-color-light);
  padding: 2rem;
  border-radius: 16px;
  border: 1px solid var(--el-border-color-light);
}

.about-text h3,
.my-works h3,
.project-links h3 {
  color: var(--el-text-color-primary);
  font-size: 1.5rem;
  margin-bottom: 1.5rem;
  font-weight: 600;
}

.about-text p {
  color: var(--el-text-color-regular);
  line-height: 1.8;
  margin-bottom: 1rem;
  font-size: 1.1rem;
}

.about-text p:last-child {
  margin-bottom: 0;
}

.works-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 1rem;
}

.work-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 1.5rem;
  background: var(--el-fill-color-light);
  border-radius: 12px;
  text-decoration: none;
  transition: all 0.3s ease;
  border: 1px solid var(--el-border-color-light);
  position: relative;
  overflow: hidden;
}

.work-card::before {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  background: linear-gradient(135deg, transparent 0%, rgba(var(--el-color-primary-rgb), 0.05) 100%);
  opacity: 0;
  transition: opacity 0.3s ease;
}

.work-card:hover {
  transform: translateY(-3px);
  border-color: var(--el-color-primary);
  box-shadow: 0 4px 12px rgba(var(--el-color-primary-rgb), 0.15);
}

.work-card:hover::before {
  opacity: 1;
}

.work-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  margin-bottom: 0.75rem;
  transition: all 0.3s ease;
}

.work-icon img {
  width: 100%;
  height: 100%;
  object-fit: contain;
  transition: transform 0.3s ease;
  filter: brightness(0.95);
}

.work-card:hover .work-icon img {
  transform: scale(1.1);
  filter: brightness(1);
}

.work-info {
  text-align: center;
}

.work-info h4 {
  color: var(--el-text-color-primary);
  font-size: 1.1rem;
  font-weight: 600;
  margin: 0 0 0.25rem;
}

.work-info p {
  color: var(--el-text-color-secondary);
  font-size: 0.9rem;
  margin: 0;
  line-height: 1.4;
}

.links-wrapper {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 1rem;
}

.project-link {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 1rem 1.5rem;
  background: var(--el-fill-color-light);
  border-radius: 12px;
  color: var(--el-text-color-regular);
  text-decoration: none;
  transition: all 0.3s ease;
  border: 1px solid var(--el-border-color-light);
  font-size: 1rem;
}

.project-link:hover {
  background: var(--el-color-primary);
  color: white;
  transform: translateY(-3px);
  border-color: transparent;
  box-shadow: 0 8px 16px rgba(var(--el-color-primary-rgb), 0.2);
}

.project-link i {
  font-size: 1.2rem;
}

.cursor-info {
  margin-top: auto;
  padding: 1.2rem;
  color: var(--el-color-primary);
  font-size: 1.1rem;
  background-color: var(--el-color-primary-light-9);
  border-radius: 12px;
  display: inline-flex;
  align-items: center;
  gap: 0.75rem;
  border: 1px solid var(--el-color-primary-light-5);
}

.cursor-info .highlight {
  font-weight: 600;
  color: var(--el-color-primary-dark-2);
}

.cursor-info i {
  font-size: 1.3rem;
  color: var(--el-color-primary);
}

@keyframes shimmer {
  0% {
    background-position: 200% 0;
  }
  100% {
    background-position: -200% 0;
  }
}

@media (max-width: 768px) {
  .content-wrapper {
    gap: 2rem;
  }

  .personal-info {
    padding-bottom: 2rem;
    margin-bottom: 0;
  }

  .profile-card {
    padding: 2rem;
  }

  .about-container {
    padding: 1rem;
  }

  .works-grid {
    grid-template-columns: 1fr;
  }
}
</style> 