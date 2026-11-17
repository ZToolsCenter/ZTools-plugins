<script lang="ts" setup>
defineProps({
  enterAction: {
    type: Object,
    required: true
  }
})
</script>

<template>
  <div class="hello">
    <h1>你好，Hello</h1>
    <h2>插件应用进入参数</h2>
    <pre>
        {{ JSON.stringify(enterAction, undefined, 2) }}
      </pre
    >
  </div>
</template>

<style>
.hello {
  padding: 10px 28px;
}
</style>
