<template>
  <n-space justify="start" align="center" :size="[3,10]">
    <template v-for="source in imageSources">
      <n-tag round checkable :checked="config['imageSource']===source['key']" size="medium"
             @click="()=>switchImageSource(source['key'])" @click.middle="()=>openLink(source['host'])">
        {{ source['label'] }}
      </n-tag>
    </template>
  </n-space>
</template>

<script>
import {fetchConfig, updateConfig} from "../js/useConfig.js";
import {useMessage} from "naive-ui";
import {computed, ref} from "vue";

export default {
  name: "ImageSourceSwitcher",
  props: {
    reload: {type: Function},
    loading: {type: Boolean, default: false}
  },
  setup(props) {
    const {reload} = props
    const config = ref({})
    config.value = fetchConfig()

    const imageSources = computed(
        () => [
          {
            label: '搜狗',
            key: '搜狗',
            disabled: config.value['imageSource'] === '搜狗',
            host: 'https://pic.sogou.com/pic/emo/index.jsp'
          },
          {
            label: '发表情',
            key: '发表情',
            disabled: config.value['imageSource'] === '发表情',
            host: 'https://fabiaoqing.com'
          },
          {
            label: '斗图啦',
            key: '斗图啦',
            disabled: config.value['imageSource'] === '斗图啦',
            host: 'https://www.doutupk.com'
          },

          // {
          //   label: '斗图吧',
          //   key: '斗图吧',
          //   disabled: config.value['imageSource'] === '斗图吧',
          //   host: 'https://doutub.com'
          // },
          // {
          //   label: '斗图王',
          //   key: '斗图王',
          //   disabled: config.value['imageSource'] === '斗图王',
          //   host: 'https://www.doutuwang.com'
          // },
          // {
          //   label: '斗图',
          //   key: '斗图',
          //   disabled: config.value['imageSource'] === '去斗图',
          //   host: 'https://doutu.lccyy.com/static/view.html'
          // },
          // {
          //   label: '去斗图',
          //   key: '去斗图',
          //   disabled: config.value['imageSource'] === '去斗图',
          //   host: 'http://www.godoutu.com'
          // },
          {
            label: '爱斗图',
            key: '爱斗图',
            disabled: config.value['imageSource'] === '爱斗图',
            host: 'http://www.adoutu.com'
          },
          // {
          //   label: '逗比表情包',
          //   key: '逗比表情包',
          //   disabled: config.value['imageSource'] === '逗比表情包',
          //   host: 'https://www.dbbqb.com'
          // },
          {
            label: '百度',
            key: '百度',
            disabled: config.value['imageSource'] === '百度',
            host: 'https://image.baidu.com'
          },
          {
            label: '斗了个图',
            key: '斗了个图',
            disabled: config.value['imageSource'] === '斗了个图',
            host: 'https://www.dogetu.com'
          },
        ]
    )

    const message = useMessage()

    // 切换图源
    const switchImageSource = (value) => {
      // 图源没变，不做任何处理
      if (config.value['imageSource'] === value) {
        return;
      }
      config.value['imageSource'] = value
      updateConfig(config.value)
      message.success(`切换到图源-${value}`)
      reload()
    }

    const currentSource = imageSources.value.filter(s => s.key === config.value['imageSource'])
    // 当前表情包源不可用，切换到第一个表情包源
    if (!currentSource.length) {
      switchImageSource(imageSources.value[0]['key'])
    }

    return {
      config,
      imageSources,
      switchImageSource,
      openLink: window.openLink
    }
  }
}
</script>

<style scoped>

</style>
