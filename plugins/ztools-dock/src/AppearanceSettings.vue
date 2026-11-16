<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import type { State, Settings as DockSettings, Config } from './types';
import Icon from './Icon.vue';
import TriggerArt from './TriggerArt.vue';
import SettingSection from './SettingSection.vue';
import DimensionField from './DimensionField.vue';
import TileMaterialPicker from './TileMaterialPicker.vue';
import { command } from './bridge';
const props = defineProps<{ state: State }>();
const emit = defineEmits<{ reset: [] }>();
const config = computed(() => props.state.config);
const scaleDraft = ref(config.value.settings.cardScale);
watch(() => config.value.settings.cardScale, scale => { scaleDraft.value = scale; });
const pickingTrigger = ref(false);
const clone = (): Config => JSON.parse(JSON.stringify(config.value));
const value = (event: Event) => (event.target as HTMLInputElement).value;
async function save(next: Config) { return Boolean(await command('save', next)); }
async function setting(key: keyof DockSettings, val: any) { const next=clone(); (next.settings as any)[key]=val; return save(next); }
const sections = [{"id":"position","title":"停靠位置","icon":"Monitor"},{"id":"trigger","title":"边缘触发区","icon":"Zap"},{"id":"navigation","title":"菜单导航","icon":"LayoutGrid"},{"id":"cards","title":"卡片弹窗","icon":"AppWindow"},{"id":"material","title":"材质与颜色","icon":"Sun"},{"id":"behavior","title":"展开与收起","icon":"SlidersHorizontal"}];
const preferences = ref<HTMLElement>();
function jump(id: string) { preferences.value?.querySelector<HTMLElement>('#preference-'+id)?.scrollIntoView({block:'start'}); }
const pickingBackground = ref(false);
async function pickBackground() {
 if(pickingBackground.value)return; pickingBackground.value=true;
 try {const image=await command('background-image');if(image){const next=clone();next.settings.backgroundImage=image;next.settings.material='solid';await save(next);}}finally{pickingBackground.value=false;}
}
async function removeBackground() {const next=clone();next.settings.backgroundImage='';next.settings.material='solid';await save(next);}
async function pickTrigger() { pickingTrigger.value=true;try{const image=await command('trigger-image');if(image){const next=clone();next.settings.triggerImage=image;next.settings.triggerTheme='custom';await save(next);}}finally{pickingTrigger.value=false;} }
async function removeTrigger() { const next=clone();next.settings.triggerImage='';if(next.settings.triggerTheme==='custom')next.settings.triggerTheme='bar';await save(next); }
</script>
<template>
 <section ref="preferences" class="preferences">

  <nav class="preference-jumps" aria-label="外观设置分组"><button v-for="section in sections" :key="section.id" @click="jump(section.id)"><Icon :name="section.icon" :size="15" />{{section.title}}</button></nav>
  <div class="preference-sections">
   <SettingSection id="position" title="停靠位置" icon="Monitor">
    <label class="setting-row"><span><strong>显示器</strong><small>在选定显示屏的工作区内停靠；断开后回到主屏</small></span><select :value="config.settings.displayId" @change="setting('displayId', value($event))"><option value="primary">主显示器</option><option v-for="display in state.displays" :key="display.id" :value="display.id">{{ display.label }} · {{ display.width }} × {{ display.height }}</option></select></label>
    <label class="setting-row"><span><strong>停靠方向</strong><small>面板始终向屏幕内侧展开</small></span><select aria-label="停靠方向" :value="config.settings.dockEdge" @change="setting('dockEdge', value($event))"><option value="top">上</option><option value="bottom">下</option><option value="left">左</option><option value="right">右</option></select></label>
    <label class="setting-row"><span><strong>位置方式</strong><small>{{['top','bottom'].includes(config.settings.dockEdge)?'沿左右方向调整':'沿上下方向调整'}}；超出当前屏幕的距离会自动限制</small></span><select aria-label="位置方式" :value="config.settings.positionMode" @change="setting('positionMode', value($event))"><option value="ratio">按比例</option><option value="distance">按距离</option></select></label>
    <label v-if="config.settings.positionMode === 'ratio'" class="setting-row"><span><strong>位置比例</strong><small>{{['top','bottom'].includes(config.settings.dockEdge)?'0% 靠左，50% 居中，100% 靠右':'0% 靠上，50% 居中，100% 靠下'}}</small></span><div class="position-controls"><input aria-label="位置比例滑块" type="range" min="0" max="100" step="0.5" :value="config.settings.positionRatio" @change="setting('positionRatio', +value($event))"><input aria-label="位置比例" type="number" min="0" max="100" step="0.5" :value="config.settings.positionRatio" @change="setting('positionRatio', +value($event))"><span>%</span></div></label>
    <label v-else class="setting-row"><span><strong>距离边缘</strong><small>从所选边缘开始计算</small></span><div class="position-controls"><select aria-label="距离参考边" :value="config.settings.positionAnchor" @change="setting('positionAnchor', value($event))"><option value="start">{{['top','bottom'].includes(config.settings.dockEdge)?'距左边':'距上边'}}</option><option value="end">{{['top','bottom'].includes(config.settings.dockEdge)?'距右边':'距下边'}}</option></select><input aria-label="位置距离" type="number" min="0" max="20000" step="1" :value="config.settings.positionDistance" @change="setting('positionDistance', +value($event))"><span>px</span></div></label>
   </SettingSection>
   <SettingSection id="trigger" title="边缘触发区" icon="Zap">
    <div class="setting-row"><span><strong>触发条主题</strong></span><div class="trigger-theme-options"><button v-for="item in [{key:'bar',label:'经典细条'},{key:'worm',label:'虫仔'},{key:'snail',label:'蜗牛'}]" class="trigger-theme-choice" :class="{selected:config.settings.triggerTheme===item.key}" :aria-pressed="config.settings.triggerTheme===item.key" @click="setting('triggerTheme', item.key as DockSettings['triggerTheme'])"><span :style="{color:config.settings.accent}"><TriggerArt :theme="item.key as DockSettings['triggerTheme']" /></span>{{item.label}}</button><button v-if="config.settings.triggerImage" class="trigger-theme-choice" :class="{selected:config.settings.triggerTheme==='custom'}" @click="setting('triggerTheme','custom')"><span><TriggerArt theme="custom" :image="config.settings.triggerImage" /></span>自定义 PNG</button></div></div>
    <div class="setting-row"><span><strong>自定义触发图案</strong><small>PNG，≤2MB</small></span><div class="position-controls"><button class="button" aria-label="上传PNG触发图案" :disabled="pickingTrigger" @click="pickTrigger">{{pickingTrigger?'读取中…':config.settings.triggerImage?'更换 PNG':'上传 PNG'}}</button><button v-if="config.settings.triggerImage" class="button danger-text" @click="removeTrigger">移除 PNG</button></div></div>
    <label class="setting-row"><span><strong>{{['left','right'].includes(config.settings.dockEdge)?'长度':'宽度'}}</strong></span><div class="range-control"><input type="range" min="24" max="400" step="4" :value="config.settings.triggerWidth" @change="setting('triggerWidth', +value($event))"><output>{{ config.settings.triggerWidth }} px</output></div></label>
    <label class="setting-row"><span><strong>底部距屏幕边缘</strong><small>正值向内，负值向外</small></span><div class="position-controls"><input aria-label="底部距屏幕边缘" type="number" min="-400" max="400" step="1" :value="config.settings.triggerEdgeDistance" @change="setting('triggerEdgeDistance', +value($event))"><span>px</span></div></label>
    <label class="setting-row"><span><strong>不透明度</strong></span><div class="range-control"><input type="range" min="0.1" max="1" step="0.05" :value="config.settings.triggerOpacity" @change="setting('triggerOpacity', +value($event))"><output>{{ Math.round(config.settings.triggerOpacity * 100) }}%</output></div></label>
   </SettingSection>
   <SettingSection id="navigation" title="菜单导航" icon="LayoutGrid">
    <DimensionField label="导航条宽度" :min="80" :max="2000" :value="config.settings.dockWidth" @change="setting('dockWidth', $event)" />
    <DimensionField label="导航条高度" :min="40" :max="1200" :value="config.settings.dockHeight" @change="setting('dockHeight', $event)" />
    <label class="setting-row"><span><strong>显示菜单栏名称</strong></span><input class="switch" type="checkbox" aria-label="显示菜单栏名称" :checked="config.settings.showCategoryNames" @change="setting('showCategoryNames', ($event.target as HTMLInputElement).checked)"></label>
    <label class="setting-row"><span><strong>启用钉住功能</strong></span><input class="switch" type="checkbox" aria-label="启用钉住功能" :checked="config.settings.pinEnabled" @change="setting('pinEnabled', ($event.target as HTMLInputElement).checked)"></label>
   </SettingSection>
   <SettingSection id="cards" title="卡片弹窗" icon="AppWindow">
    <label class="setting-row"><span><strong>卡片缩放</strong><small>卡片、图标和间距同比缩放</small></span><div class="range-control"><input aria-label="卡片缩放" type="range" min="50" max="150" step="1" :value="scaleDraft" @input="scaleDraft = +value($event)" @change="setting('cardScale', +value($event))"><output>{{ scaleDraft }}%</output></div></label>
    <label class="setting-row"><span><strong>每行最多列数</strong></span><select aria-label="每行最多列数" :value="config.settings.columns" @change="setting('columns', +value($event))"><option v-for="n in [2,3,4,5,6]" :value="n">{{ n }} 列</option></select></label>
    <DimensionField label="卡片弹窗宽度" :min="160" :max="2000" :value="config.settings.popupWidth" @change="setting('popupWidth', $event)" />
    <DimensionField label="卡片弹窗高度" :min="100" :max="1200" :value="config.settings.popupHeight" @change="setting('popupHeight', $event)" />
    <label class="setting-row"><span><strong>显示入口名称</strong></span><input class="switch" type="checkbox" aria-label="显示入口名称" :checked="config.settings.showEntryNames" @change="setting('showEntryNames', ($event.target as HTMLInputElement).checked)"></label>
    <label class="setting-row"><span><strong>显示搜索框</strong><small>搜索所有入口</small></span><input class="switch" type="checkbox" :checked="config.settings.searchEnabled" aria-label="显示搜索框" @change="setting('searchEnabled', ($event.target as HTMLInputElement).checked)"></label>
   </SettingSection>
   <SettingSection id="material" title="材质与颜色" icon="Sun">
    <TileMaterialPicker :model-value="config.settings.tileMaterial" :strength="config.settings.tileStrength" @select="setting('tileMaterial', $event)" @strength="setting('tileStrength', $event)" />
    <label class="setting-row"><span><strong>颜色模式</strong></span><select aria-label="颜色模式" :value="config.settings.theme" @change="setting('theme', value($event))"><option value="system">跟随系统</option><option value="light">浅色</option><option value="dark">深色</option></select></label>
    <div class="setting-row background-image-setting"><span><strong>背景图片</strong><small>PNG、JPG、WebP，≤5MB；居中铺满</small></span><div class="background-image-actions"><img v-if="config.settings.backgroundImage" :src="config.settings.backgroundImage" alt="当前背景图片" class="background-image-preview"><button class="button" aria-label="上传背景图片" :disabled="pickingBackground" @click="pickBackground">{{pickingBackground?'读取中…':config.settings.backgroundImage?'更换图片':'上传图片'}}</button><button v-if="config.settings.backgroundImage" class="button danger-text" :disabled="pickingBackground" @click="removeBackground">移除背景</button></div></div>
    <label class="setting-row"><span><strong>背景不透明度</strong></span><div class="range-control"><input aria-label="背景不透明度" type="range" min="0.1" max="1" step="0.05" :value="config.settings.panelOpacity" @change="setting('panelOpacity', +value($event))"><output>{{Math.round(config.settings.panelOpacity * 100)}}%</output></div></label>
    <label class="setting-row"><span><strong>主题色</strong></span><input type="color" :value="config.settings.accent" @change="setting('accent', value($event))"></label>
   </SettingSection>
   <SettingSection id="behavior" title="展开与收起" icon="SlidersHorizontal">
    <label class="setting-row"><span><strong>展开延迟</strong></span><div class="range-control"><input type="range" min="0" max="2000" step="20" :value="config.settings.openDelay" @change="setting('openDelay', +value($event))"><output>{{ config.settings.openDelay }} ms</output></div></label>
    <label class="setting-row"><span><strong>收起延迟</strong></span><div class="range-control"><input type="range" min="100" max="3000" step="50" :value="config.settings.closeDelay" @change="setting('closeDelay', +value($event))"><output>{{ config.settings.closeDelay }} ms</output></div></label>
   </SettingSection>
  </div>
  <div class="reset-row appearance-reset"><div><strong>恢复默认外观</strong><p>仅重置本页设置，分类和快捷入口会保留。</p></div><button class="button danger-text" @click="emit('reset')"><Icon name="RotateCcw" :size="15" />重置外观与行为</button></div>
 </section>
</template>
