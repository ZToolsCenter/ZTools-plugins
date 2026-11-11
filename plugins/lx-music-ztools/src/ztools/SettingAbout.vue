<template>
  <dt id="about">关于 LX Music · ZTools</dt>
  <dd>
    <p class="small">LX Music 的 ZTools 原生移植，由 jiang66-so 维护。插件免费开源，支持导入用户自己的 LX 自定义音源。</p>
    <p class="small gap-top">插件仓库：<a href="https://github.com/jiang66-so/lx-music-ztools" @click.prevent="openUrl('https://github.com/jiang66-so/lx-music-ztools')">jiang66-so/lx-music-ztools</a></p>
    <p class="small gap-top">插件下载与版本说明：<a href="https://github.com/jiang66-so/lx-music-ztools/releases" @click.prevent="openUrl('https://github.com/jiang66-so/lx-music-ztools/releases')">GitHub Releases</a>。也可通过 ZTools 安装本地插件包。</p>
    <p class="small gap-top">使用说明：<a href="https://github.com/jiang66-so/lx-music-ztools#readme" @click.prevent="openUrl('https://github.com/jiang66-so/lx-music-ztools#readme')">插件 README</a>；问题反馈：<a href="https://github.com/jiang66-so/lx-music-ztools/issues" @click.prevent="openUrl('https://github.com/jiang66-so/lx-music-ztools/issues')">提交 Issue</a>。</p>
    <p class="small gap-top">原项目：<a href="https://github.com/lyswhut/lx-music-desktop" @click.prevent="openUrl('https://github.com/lyswhut/lx-music-desktop')">lyswhut/lx-music-desktop</a>。感谢原作者落雪无痕及上游贡献者。</p>
    <p class="small gap-top">本插件保留原项目的许可协议及第三方声明。<base-btn min @click="handleShowPact">查看许可协议</base-btn>；<a href="https://github.com/jiang66-so/lx-music-ztools/blob/HEAD/LICENSE" @click.prevent="openUrl('https://github.com/jiang66-so/lx-music-ztools/blob/HEAD/LICENSE')">查看仓库许可</a>。</p>
    <p class="small gap-top">音源脚本由用户自行获取和导入，插件安装包不附带音源。请尊重音乐版权，支持正版。</p>
    <p class="gap-top attribution">By: <a href="https://github.com/jiang66-so" @click.prevent="openUrl('https://github.com/jiang66-so')"><strong>jiang66-so</strong></a> · From: <a href="https://github.com/lyswhut" @click.prevent="openUrl('https://github.com/lyswhut')"><strong>落雪无痕（lyswhut）</strong></a></p>
  </dd>
</template>
<script setup>
import { isShowPact } from '@renderer/store'
import { openUrl } from '@common/utils/electron'
const handleShowPact = () => { isShowPact.value = true }
</script>
<style scoped>
a { color: var(--color-primary); cursor: pointer; text-decoration: underline; }
.attribution { line-height: 1.8; }
</style>
