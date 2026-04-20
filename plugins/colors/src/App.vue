<script setup lang="ts">
import { onPluginEnter, onPluginOut } from "@ztools-center/ztools-api-types";
import { onMounted, ref } from "vue";

let enterAction = ref<{
  code: string;
  type: string;
  payload: any;
  option: any;
  from?: PluginEnterFrom;
} | null>();
let route = ref("");
onMounted(() => {
  onPluginEnter((action) => {
    route.value = action.code;
    enterAction.value = action;
  });
  onPluginOut(() => {
    route.value = "";
  });
});
</script>

<template>
  <h1 class="text-3xl font-bold underline bg-red-200">You did it!</h1>
  <p class="bg-red-900">
    Visit
    <a href="https://vuejs.org/" target="_blank" rel="noopener">vuejs.org</a>
    to read the documentation
  </p>
</template>

<style scoped></style>
