<template>
  <div class="root1">
    <h3>所有项目</h3>
    <!-- 添加了 axis 属性以支持自由拖拽 -->
    <SlickList
        class="big-grid"
        v-model="allItems"
        @input="onChange"
        axis="xy"
    >
      <SlickItem
          class="grid-item"
          v-for="(item, index) in allItems"
          :index="index"
          :key="index"
      >
        {{ item }}
      </SlickItem>
    </SlickList>
  </div>
</template>

<script>
// 1. 从 vue-slicksort 导入所需组件
import {SlickItem, SlickList} from 'vue-slicksort';

export default {
  name: 'GenerateTestData', // 建议加上 name，便于调试和递归组件
  // 2. 在 components 选项中注册组件
  components: {
    SlickList,
    SlickItem
  },
  data() {
    return {
      allItems: [
        'Item1', 'Item2', 'Item3', 'Item4',
        'Item5', 'Item6', 'Item7', 'Item8', 'Item9'
      ]
    }
  },
  methods: {
    onChange(val) {
      // v-model 已经帮你更新了 allItems，这里主要用于调试或执行其他逻辑
    }
  }
}
</script>

<style scoped>
.big-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
  gap: 15px;
  background-color: #f3f3f3;
  border-radius: 8px;
  width: 100%;
  max-width: 1200px;
  margin: 0 auto;
  /* 确保列表有明确的高度，这对拖拽很重要 */
  min-height: 300px;
}

.grid-item {
  background-color: white;
  padding: 20px;
  border-radius: 8px;
  text-align: center;
  box-shadow: 0 1px 3px rgba(0,0,0,0.1);
  cursor: grab;
  user-select: none; /* 防止拖拽时选中文本 */
}

/* 拖拽时的样式反馈 */
.grid-item:active {
  cursor: grabbing;
  background-color: #e0e0e0;
}
</style>
