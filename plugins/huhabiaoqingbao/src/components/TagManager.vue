<template>
  <el-dialog
    v-model="dialogVisible"
    title="分类管理"
    width="500px"
  >
    <div class="tag-manager">
      <!-- 添加新分类 -->
      <div class="add-tag">
        <el-input
          v-model="newTag"
          placeholder="输入新分类名称"
          @keyup.enter="handleAddTag"
        >
          <template #append>
            <el-button @click="handleAddTag">添加</el-button>
          </template>
        </el-input>
      </div>

      <!-- 分类列表 -->
      <div class="tag-list">
        <el-empty v-if="tags.length === 0" description="暂无分类" />
        <template v-else>
          <div v-for="tag in tags" :key="tag.id" class="tag-item">
            <el-tag
              :closable="true"
              @close="handleDeleteTag(tag.id)"
              class="tag"
            >
              <span v-if="!tag.isEditing">{{ tag.name }}</span>
              <el-input
                v-else
                v-model="tag.editingName"
                size="small"
                @blur="handleUpdateTag(tag)"
                @keyup.enter="handleUpdateTag(tag)"
                v-focus
              />
            </el-tag>
            <el-button
              type="primary"
              link
              @click="startEditing(tag)"
              v-if="!tag.isEditing"
            >
              编辑
            </el-button>
          </div>
        </template>
      </div>
    </div>
  </el-dialog>
</template>

<script setup lang="ts">
import { ref, onMounted, watch, defineComponent } from 'vue'
import { ElMessage } from 'element-plus'

interface Tag {
  id: number
  name: string
  isEditing?: boolean
  editingName?: string
}

const props = defineProps<{
  modelValue: boolean
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', value: boolean): void
  (e: 'tagsUpdated', tags: Tag[]): void
}>()

// 双向绑定对话框显示状态
const dialogVisible = ref(props.modelValue)
watch(() => props.modelValue, (val) => {
  dialogVisible.value = val
})
watch(dialogVisible, (val) => {
  emit('update:modelValue', val)
})

// 标签数据
const tags = ref<Tag[]>([])
const newTag = ref('')

// 自定义指令：自动聚焦
const vFocus = {
  mounted: (el: HTMLElement) => el.querySelector('input')?.focus()
}

// 从 localStorage 加载数据
onMounted(() => {
  const savedTags = localStorage.getItem('emoticon-tags')
  if (savedTags) {
    tags.value = JSON.parse(savedTags)
  }
})

// 保存数据到 localStorage
const saveTags = () => {
  localStorage.setItem('emoticon-tags', JSON.stringify(tags.value))
  emit('tagsUpdated', tags.value)
}

// 添加新标签
const handleAddTag = () => {
  const name = newTag.value.trim()
  if (!name) {
    ElMessage.warning({
      message: '请输入分类名称',
      showClose: true
    })
    return
  }
  
  if (tags.value.some(tag => tag.name === name)) {
    ElMessage.warning({
      message: '该分类已存在',
      showClose: true
    })
    return
  }
  
  tags.value.push({
    id: Date.now(),
    name
  })
  
  newTag.value = ''
  saveTags()
  ElMessage.success({
    message: '添加成功',
    showClose: true
  })
}

// 删除标签
const handleDeleteTag = (id: number) => {
  tags.value = tags.value.filter(tag => tag.id !== id)
  saveTags()
  ElMessage.success({
    message: '删除成功',
    showClose: true
  })
}

// 开始编辑标签
const startEditing = (tag: Tag) => {
  tag.isEditing = true
  tag.editingName = tag.name
}

// 更新标签
const handleUpdateTag = (tag: Tag) => {
  if (!tag.editingName?.trim()) {
    ElMessage.warning({
      message: '分类名称不能为空',
      showClose: true
    })
    return
  }
  
  if (tags.value.some(t => t.id !== tag.id && t.name === tag.editingName)) {
    ElMessage.warning({
      message: '该分类已存在',
      showClose: true
    })
    return
  }
  
  tag.name = tag.editingName.trim()
  tag.isEditing = false
  saveTags()
  ElMessage.success({
    message: '更新成功',
    showClose: true
  })
}

// 导出组件
defineComponent({
  name: 'TagManager'
})
</script>

<style scoped lang="scss">
.tag-manager {
  .add-tag {
    margin-bottom: 16px;
  }
  
  .tag-list {
    max-height: 300px;
    overflow-y: auto;
    
    .tag-item {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 8px;
      
      .tag {
        flex: 1;
        display: flex;
        align-items: center;
        max-width: 200px;
        
        :deep(.el-input) {
          width: 100%;
          .el-input__wrapper {
            padding: 0 8px;
          }
          .el-input__inner {
            height: 24px;
          }
        }
      }
    }
  }
}
</style> 