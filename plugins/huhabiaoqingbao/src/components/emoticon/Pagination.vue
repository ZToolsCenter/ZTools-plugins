<template>
  <div class="pagination-wrapper" v-if="total > 0">
    <div class="pagination-content">
      <div class="pagination-info">
        共 {{ total }} 个表情包
      </div>
      <div class="pagination-container">
        <el-pagination
          v-model:current-page="currentPage"
          :page-size="pageSize"
          :total="total"
          :pager-count="5"
          layout="prev, pager, next"
          @current-change="handlePageChange"
          background
        />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'

const props = defineProps<{
  total: number
  pageSize: number
}>()

const emit = defineEmits<{
  (e: 'page-change', page: number): void
}>()

const currentPage = ref(1)

const handlePageChange = (page: number) => {
  emit('page-change', page)
}

// 当总数变化时重置页码
watch(() => props.total, () => {
  currentPage.value = 1
})
</script>

<style scoped lang="scss">
.pagination-wrapper {
  position: fixed;
  bottom: 0;
  left: 180px;
  right: 0;
  background: rgba(var(--el-bg-color-rgb), 0.8);
  padding: 12px 20px;
  z-index: 100;
  box-shadow: 0 -1px 6px rgba(0, 0, 0, 0.05);
  backdrop-filter: blur(10px);
  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
  
  &::before {
    content: '';
    position: absolute;
    top: -20px;
    left: 0;
    right: 0;
    height: 20px;
    background: linear-gradient(
      to top,
      rgba(var(--el-bg-color-rgb), 0.8),
      rgba(var(--el-bg-color-rgb), 0)
    );
    pointer-events: none;
  }

  .pagination-content {
    display: flex;
    align-items: center;
    justify-content: space-between;
    max-width: 1200px;
    margin: 0 auto;
    
    .pagination-info {
      font-size: 12px;
      color: var(--el-text-color-secondary);
      padding: 4px 12px;
      border-radius: 4px;
      background: rgba(var(--el-fill-color-light-rgb), 0.5);
      transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
      white-space: nowrap;
      
      &:hover {
        background: var(--el-fill-color-light);
        transform: translateY(-1px);
      }
    }
    
    .pagination-container {
      :deep(.el-pagination) {
        --el-pagination-font-size: 12px;
        --el-pagination-border-radius: 16px;
        padding: 0;
        
        .el-pager {
          li {
            min-width: 24px;
            height: 24px;
            line-height: 24px;
            border-radius: 3px;
            margin: 0 2px;
            
            &:not(.is-active):hover {
              color: var(--el-color-primary);
              background-color: rgba(var(--el-color-primary-rgb), 0.1);
            }
            
            &.is-active {
              font-weight: 600;
              background-color: var(--el-color-primary);
              transform: scale(1.02);
            }
          }
        }
        
        .btn-prev,
        .btn-next {
          min-width: 24px;
          height: 24px;
          line-height: 24px;
          border-radius: 3px;
          padding: 0;
          margin: 0 2px;
          
          &:hover:not(:disabled) {
            color: var(--el-color-primary);
            background-color: rgba(var(--el-color-primary-rgb), 0.1);
          }
        }
      }
    }
  }
}
</style>

<!-- 暗黑模式适配 -->
<style lang="scss">
html.dark {
  .pagination-wrapper {
    background: rgba(var(--el-bg-color-rgb), 0.85);
    box-shadow: 0 -1px 6px rgba(0, 0, 0, 0.15);

    &::before {
      background: linear-gradient(
        to top,
        rgba(var(--el-bg-color-rgb), 0.85),
        rgba(var(--el-bg-color-rgb), 0)
      );
    }

    .pagination-info {
      background: rgba(var(--el-fill-color-darker-rgb), 0.5);

      &:hover {
        background: var(--el-fill-color-dark);
      }
    }
  }
}
</style>