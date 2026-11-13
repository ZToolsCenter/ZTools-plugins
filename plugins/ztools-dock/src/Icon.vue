<script setup lang="ts">
import { computed } from 'vue';
import { Folder, BriefcaseBusiness, FilePenLine, CodeXml, Bot, SlidersHorizontal, Zap, House, Monitor, Download, FileText, Image, Music, Video, AppWindow, Globe, Box, Search, Plus, Settings, Pin, X, ChevronRight, ChevronUp, ChevronDown, GripVertical, Pencil, Trash2, Upload, ArrowUpRight, Check, Copy, RotateCcw, ArrowLeft, Power, ExternalLink, Package, Ellipsis, Sun, Moon, Keyboard, LayoutGrid, Info, CircleAlert } from 'lucide-vue-next';
const props = withDefaults(defineProps<{ name?: string; size?: number; image?: string }>(), { name: 'Box', size: 20 });
const icons: Record<string, any> = { Folder, BriefcaseBusiness, FilePenLine, CodeXml, Bot, SlidersHorizontal, Zap, House, Monitor, Download, FileText, Image, Music, Video, AppWindow, Globe, Box, Search, Plus, Settings, Pin, X, ChevronRight, ChevronUp, ChevronDown, GripVertical, Pencil, Trash2, Upload, ArrowUpRight, Check, Copy, RotateCcw, ArrowLeft, Power, ExternalLink, Package, Ellipsis, Sun, Moon, Keyboard, LayoutGrid, Info, CircleAlert };
const component = computed(() => icons[props.name] || Box);
</script>
<template><img v-if="image" class="entry-image" :src="image" alt="" :width="size" :height="size"><component v-else :is="component" :size="size" :stroke-width="1.9" aria-hidden="true" /></template>
