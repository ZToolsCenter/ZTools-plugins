<template>
  <n-drawer v-model:show="isShow" style="height: 92%" placement="bottom">
    <n-drawer-content>
      <n-carousel :show-dots="false" dot-placement="top" keyboard
                  mousewheel centered-slides :default-index="currentIndex" effect="card" draggable show-arrow>
        <template v-for="image in images">
          <n-carousel-item style="width: 80%">
            <ImageItem class="carousel-img" :em="image" style="background-color: white"
                       :style="{...checkIfCollected(image.imgSrc)?{borderWidth:'2px',borderStyle:'solid',borderColor:'orange'}:{borderWidth:'2px',borderStyle:'solid',borderColor:'white'}}"
            />
          </n-carousel-item>
        </template>
      </n-carousel>
    </n-drawer-content>
  </n-drawer>
</template>

<script>
import {ref} from "vue";
import ImageItem from "./ImageItem.vue";
import useImageStarList from "../js/useImageStarList.js";
import {loadSettings} from "./setting/useSettings";
import {useMessage} from "naive-ui";

export default {
  name: "ImageCarousel",
  components: {ImageItem},
  setup() {
    const isShow = ref(false)
    const images = ref([])
    const currentIndex = ref(0)
    const {checkIfCollected,} = useImageStarList()
    const message = useMessage()
    return {
      isShow,
      show: (event, _images, _currentIndex = 0) => {
        // 按住中键的时候是否需要shift
        const {middleWithShift} = loadSettings()
        if (middleWithShift && !event.shiftKey) {
          message.info("记得按住shift噢")
          return
        }

        // 使用shift搭配/或者已经按下了shift
        if (!middleWithShift || (middleWithShift && event.shiftKey)) {
          images.value = _images
          currentIndex.value = _currentIndex
          isShow.value = true
        }
      },
      images,
      currentIndex,
      checkIfCollected,
    }
  }
}
</script>

<style scoped>

</style>

<style>
.n-carousel__arrow {
  background-color: rgba(123, 123, 123, 0.8) !important;
}
</style>
