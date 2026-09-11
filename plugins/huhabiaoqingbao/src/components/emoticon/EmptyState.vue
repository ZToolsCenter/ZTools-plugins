<template>
  <div class="empty-state">
    <el-empty
      :image-size="200"
      description="还没有表情包哦"
    >
      <div class="empty-actions">
        <el-upload
          class="upload-button"
          :show-file-list="false"
          :accept="'.png,.jpg,.jpeg,.gif'"
          :before-upload="handleUpload">
          <el-button type="primary" size="large">
            <el-icon class="upload-icon"><Plus /></el-icon>
            <span>添加表情包</span>
          </el-button>
        </el-upload>
      </div>
    </el-empty>
  </div>
</template>

<script setup lang="ts">
import { Plus, Upload } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'

const emit = defineEmits<{
  (e: 'upload', file: File): void
}>()

const handleUpload = async (file: File) => {
  if (!file) {
    ElMessage.error('请选择文件')
    return false
  }
  
  // 验证文件类型
  const isValidType = ['image/png', 'image/jpeg', 'image/gif'].includes(file.type)
  if (!isValidType) {
    ElMessage.error('只支持PNG、JPEG和GIF格式的图片')
    return false
  }
  
  // 验证文件大小（5MB）
  const isLt5M = file.size / 1024 / 1024 < 5
  if (!isLt5M) {
    ElMessage.error('图片大小不能超过5MB')
    return false
  }
  
  emit('upload', file)
  return false
}
</script>

<style scoped lang="scss">
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-height: calc(100vh - 350px);
  padding: 20px;
  background: var(--el-bg-color-page);
}
</style> 