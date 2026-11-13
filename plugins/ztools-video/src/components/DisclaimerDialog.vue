<script setup lang="ts">
defineEmits<{ accept: [] }>()
</script>

<template>
  <div class="disclaimer-mask" role="dialog" aria-modal="true" aria-labelledby="disclaimer-title">
    <section class="disclaimer">
      <h2 id="disclaimer-title">使用前请阅读</h2>
      <div class="disclaimer-body">
        <p>本插件只做聚合检索与播放，<strong>不存储、不制作、不分发任何视频内容</strong>。</p>
        <ul>
          <li>所有影片与播放地址均来自第三方站点，版权归各自权利人所有。</li>
          <li>请仅将本插件用于个人学习与测试，勿用于任何商业用途。</li>
          <li>内容的合法性与可用性由来源站点负责，与本插件无关。</li>
          <li>如果权利人认为内容侵权，请直接联系来源站点处理。</li>
        </ul>
        <p>继续使用即表示你已理解并同意以上说明，并自行承担使用风险。</p>
      </div>
      <button type="button" class="primary disclaimer-accept" @click="$emit('accept')">我已阅读并同意</button>
    </section>
  </div>
</template>
