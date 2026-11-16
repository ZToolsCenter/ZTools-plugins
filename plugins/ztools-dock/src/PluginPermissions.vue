<script setup lang="ts">
import {onMounted,ref} from 'vue';
import {command} from './bridge';
import Icon from './Icon.vue';
const emit=defineEmits<{close:[];changed:[]}>();
const status=ref<any>(),busy=ref(false);
const names:Record<string,string>={'internal:get-plugins':'插件名称、指令和图标','internal:get-disabled-plugins':'插件停用状态'};
async function refresh(){status.value=await command('plugin-permissions');}
async function stop(){busy.value=true;try{if(await command('plugin-stop-reading')){emit('changed');await refresh();}}finally{busy.value=false;}}
onMounted(refresh);
</script>
<template>
 <div class="modal-overlay permission-overlay" @click.self="emit('close')" @keydown.esc.stop="emit('close')">
  <section class="confirm-modal permission-modal" role="dialog" aria-modal="true" aria-label="插件授权">
   <header class="modal-heading"><h2>插件授权</h2><button class="icon-button" title="关闭授权管理" @click="emit('close')"><Icon name="X" /></button></header>
   <div class="permission-body">
    <p v-if="!status">正在读取授权…</p>
    <template v-else>
     <p class="permission-summary">{{status.reading?'程序坞已允许读取':'程序坞已停止读取'}}</p>
     <div v-for="item in status.permissions" :key="item.id" class="permission-status"><span>{{names[item.id]}}</span><strong>{{item.granted?'宿主已授权':item.pending?'等待宿主确认':'未授权'}}</strong></div>
     <p v-if="status.fullAccess" class="subtle">ZTools 当前授予了全部高级权限，可在宿主设置中调整。</p>
     <button class="button danger-text" :disabled="busy || !status.reading" @click="stop">停止读取</button>
     <div class="host-permission-link"><strong>移除 ZTools 授权</strong><p>打开 ZTools 设置，在“高级权限 → 已授权”中找到“程序坞”，点击“移除全部”。</p><button class="button" @click="command('plugin-permissions-settings')">打开 ZTools 设置</button></div>
    </template>
   </div>
   <footer class="modal-footer"><button class="button" @click="refresh">刷新状态</button><span class="spacer"></span><button class="button" @click="emit('close')">关闭</button></footer>
  </section>
 </div>
</template>
