<script setup lang="ts">
import { computed, onMounted } from "vue";
import { useRoute, useRouter } from "vue-router";
import Help from "./components/Help.vue";
import Layerout from "./components/Layerout.vue";
import NavBar from "./components/NavBar.vue";
import ProvideMessage from "./components/ProvideMessage.vue";
import { useCurrentColor } from "./utils/current-color";
import zToolsApi from "./utils/ztoolsapi";

const router = useRouter();
const currentColorStore = useCurrentColor();

zToolsApi.onPluginEnter((parm) => {
  switch (parm.code) {
    case "预览颜色":
      router.push({ path: "/" });
      currentColorStore.setCurrentColor(parm.payload);
      break;
  }
});
</script>

<template>
  <Help>
    <Layerout>
      <template #header>
        <NavBar />
      </template>

      <RouterView />
    </Layerout>
    <!-- 消息通知组件 -->
    <ProvideMessage />
  </Help>
</template>

<style scoped></style>
