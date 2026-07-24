<template>
  <img class="carousel-img" :src="em['fileSrc']"
       v-on:click.exact="()=>handleCopy(em)"
       v-on:dblclick.exact="()=>handlePaste(em)"
       @click.alt.exact="()=>openLocal(em)"
       @click.shift.exact="()=>openRemote(em)"
       @click.right.exact="()=>saveOrRemove(em)">
</template>

<script>
import useImageStarList from "../js/useImageStarList.js";
import {useMessage} from "naive-ui";

export default {
  name: "ImageItem",
  props: {
    em: {
      type: Object,
      default: {}
    },
    emoticons: {
      type: Array,
      default: []
    }
  },
  setup() {
    const {switchCollectedStatus, starEmojiList} = useImageStarList()

    //  检查表情包是否已存在
    const checkIfExist = (checkImgSrc) => {
      for (let icon of starEmojiList.value) {
        if (checkImgSrc === icon.imgSrc) {
          return true
        }
      }
      return false
    }

    const {success, warning, info} = useMessage()
    // 删除任务的映射关系
    const removeTaskMap = {}
    const saveOrRemove = (em) => {
      // 表情包不存在，直接添加
      if (!checkIfExist(em.imgSrc)) {
        switchCollectedStatus(em)
        return
      }

      // 表情包存在,进行取消
      const removeTask = removeTaskMap[em.imgSrc]
      // 正在等待删除中，取消删除
      if (!!removeTask) {
        clearTimeout(removeTask)
        info("已取消删除")
        delete removeTaskMap[em.imgSrc]
        return
      }

      warning("即将删除，10s内右键可以取消删除哦~", {duration: 3000})
      removeTaskMap[em.imgSrc] = setTimeout(() => switchCollectedStatus(em), 10000)
    }

    let timer = null
    // 单击图片进行复制
    const handleCopy = (em) => {
      if (timer) {
        clearTimeout(timer)
      }
      // 设置延时器 超过300ms为单击 300ms内点击则为双击事件
      timer = setTimeout(() => {
        // 需要执行的逻辑代码 执行复制操作,400毫秒之内没有再次点击,就执行,如果400毫秒之内再次点击,则设定为粘贴操作...
        window.copyImage(em, () => success('复制成功~'))
      }, 400)
    }

    // 双击图片进行复制和粘贴(这是一个动作,utools框架会先复制再进行粘贴,无法拆分)
    const handlePaste = (em) => {
      if (timer) {
        // 清除延时器
        clearTimeout(timer)
      }
      // 需要执行的逻辑代码,粘贴路径的时候,不能加 file:// 这个前缀...
      ztools.hideMainWindowPasteFile(em['fileSrc'].replace("file://", ""))
    }

    return {
      saveOrRemove,
      openLocal: (em) => window.openLink(em.fileSrc),
      openRemote: (em) => window.openLink(em.imgSrc),
      handleCopy,
      handlePaste,
    }
  }
}
</script>

<style scoped>
.carousel-img {
  margin: 0 auto;
  width: 99%;
  height: 99%;
  object-fit: fill;
  cursor: pointer;
  border-radius: 5px;
}
</style>
