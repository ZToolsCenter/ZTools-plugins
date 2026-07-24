<template>
  <n-drawer v-model:show="isShow" style="height: 90%" placement="bottom">
    <n-drawer-content>
      <settings/>
      <n-result status="404" title="这里只是一个兴趣使然的开发者" description="生活总归需要点乐趣">
        <template #footer>
          <n-list show-divider clickable hoverable>
            <n-list-item>
              <div>声明:</div>
              <div>
                本插件所有功能<strong style="color: red">永久</strong> 免费,利用加完班的业余时间开发,欢迎大家使用和反馈,觉得好用欢迎点赞或打赏~
              </div>
              <div>
                所有数据来自互联网，本插件不存储任何原始数据；
              </div>
              <div>
                请遵守法律法规，请勿用于任何违法行为，用户的一切行为与作者无关。
              </div>
            </n-list-item>
            <n-list-item>
              <strong>新增快捷键操作: 按住shift单击打开远程图片,按住Alt/Option打开本地图片</strong>
            </n-list-item>
            <n-list-item>
              <n-space justify="space-around">
                <img width="200" height="300" src="/src/assets/alipay.jpg" alt="支付宝">
                <img width="200" height="300" src="/src/assets/wechat.jpg" alt="微信">
              </n-space>
            </n-list-item>
            <n-list-item>源码地址: <a :href="sourceLink" @click="()=>openLink(sourceLink)">{{ sourceLink }}</a>
            </n-list-item>
            <n-list-item>真心感谢以下表情包数据源,该插件开源免费,无任何商业属性,若有侵权请联系作者删除～</n-list-item>
          </n-list>
          <n-space justify="center">
            <a href="https://fabiaoqing.com" @click="()=>openLink('https://fabiaoqing.com')">发表情(失效)</a>
            <a href="https://doutub.com" @click="()=>openLink('https://doutub.com')">斗图吧(失效)</a>
            <a href="https://www.doutupk.com" @click="()=>openLink('https://www.doutupk.com')">斗图啦</a>
            <a href="https://www.doutuwang.com" @click="()=>openLink('https://www.doutuwang.com')">斗图王(失效)</a>
            <a href="http://www.godoutu.com" @click="()=>openLink('http://www.godoutu.com')">去斗图(失效)</a>
            <a href="http://www.adoutu.com" @click="()=>openLink('http://www.adoutu.com')">爱斗图</a>
            <a href="http://www.dbbqb.com"
               @click="()=>openLink('http://www.dbbqb.com')">逗比表情包(注意,图源非VIP有数量限制)</a>
            <a href="https://image.baidu.com/search/index?tn=baiduimage&word=表情包"
               @click="()=>openLink('https://image.baidu.com/search/index?tn=baiduimage&word=表情包')">百度搜图</a>
            <a href="https://pic.sogou.com/pic/emo/index.jsp"
               @click="()=>openLink('https://pic.sogou.com/pic/emo/index.jsp')">搜狗</a>
            <a href="https://doutu.lccyy.com/"
               @click="()=>openLink('https://doutu.lccyy.com/')">斗图在线(tools用户被封)</a>
            <a href="https://www.dogetu.com"
               @click="()=>openLink('https://www.dogetu.com')">斗了个图</a>
          </n-space>
        </template>
      </n-result>
    </n-drawer-content>
  </n-drawer>

</template>

<script>
import {ref} from "vue";
import Settings from "../setting/Settings.vue";

export default {
  name: "About",
  components: {Settings},
  setup() {
    const isShow = ref(false)
    const sourceLink = "https://github.com/diduweiwu/utools-emoticon"

    const openLink = (link) => ztools.shellOpenExternal(link)
    return {
      isShow,
      sourceLink,
      openLink,
      show: () => isShow.value = true,
    }
  }
}
</script>

<style scoped>

</style>
