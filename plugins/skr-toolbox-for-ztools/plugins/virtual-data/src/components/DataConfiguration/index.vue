<template>
  <div class="data-configuration">
    <div class="action-bar">
      <n-space size="small">
        <n-input
          v-model:value="searchContent.name"
          type="text"
          placeholder="请输入数据名称"
          size="small"
          clearable
        />
        <n-input
          v-model:value="searchContent.code"
          type="text"
          placeholder="请输入执行代码"
          size="small"
          clearable
        />
        <n-button
          type="primary"
          @click="handleAdd"
          size="small"
        >
          添加数据
        </n-button>
      </n-space>

      <div class="table-container">
        <n-data-table
          :columns="columns"
          :data="filteredDataList"
          :row-key="(row: DataItem) => row._id"
          size="small"
          :max-height="tableMaxHeight"
        />
      </div>
    </div>

    <DataFormDrawer
      v-model:show="drawerVisible"
      :edit-item="editingItem"
      :max-sort="maxSort"
      :data-list="dataList"
      @success="handleFormSuccess"
    />
  </div>
</template>

<script setup>
import { ref, reactive, onMounted, computed, h, onUnmounted, nextTick } from 'vue';
import { useMessage, NButton, NSpace, NIcon, NPopconfirm } from 'naive-ui';
import { useDraggable } from 'vue-draggable-plus';
import { ReorderFour as ReorderIcon, CreateOutline, TrashOutline } from '@vicons/ionicons5';
import DataFormDrawer from './DataFormDrawer.vue';

const DB_PREFIX = 'virtual-data-';
const message = useMessage();
const tableMaxHeight = ref(500);
const dataList = ref([]);
const drawerVisible = ref(false);
const editingItem = ref(null);

const searchContent = reactive({
  name: '',
  code: '',
});

const maxSort = computed(() => {
  if (dataList.value.length === 0) return 0;
  return Math.max(...dataList.value.map((item) => item.sort));
});

const filteredDataList = computed(() => {
  let result = dataList.value;

  if (searchContent.name) {
    result = result.filter((item) =>
      item.name.toLowerCase().includes(searchContent.name.toLowerCase())
    );
  }

  if (searchContent.code) {
    result = result.filter((item) =>
      item.code.toLowerCase().includes(searchContent.code.toLowerCase())
    );
  }

  return result;
});

const columns = [
  {
    title: '排序',
    key: 'drag',
    width: 50,
    render: () =>
      h(
        NIcon,
        {
          size: 20,
          class: 'drag-handle',
          style: 'cursor: move; color: #999;',
        },
        {
          default: () => h(ReorderIcon),
        }
      ),
  },
  {
    title: '序号',
    key: 'index',
    width: 60,
    render: (row, index) => index + 1,
  },
  {
    title: '数据名称',
    key: 'name',
    width: 200,
    ellipsis: {
      tooltip: true,
    },
  },
  {
    title: '执行代码',
    key: 'code',
    ellipsis: {
      tooltip: true,
    },
  },
  {
    title: '排序',
    key: 'sort',
    width: 60,
  },
  {
    title: '操作',
    key: 'actions',
    width: 80,
    render: (row) => {
      return h(
        NSpace,
        { size: 'small' },
        {
          default: () => [
            h(
              NButton,
              {
                size: 'small',
                type: 'warning',
                class: 'actions-btn',
                quaternary: true,
                onClick: () => handleEdit(row),
              },
              {
                icon: () => h(NIcon, null, { default: () => h(CreateOutline) }),
              }
            ),
            h(
              NPopconfirm,
              {
                onPositiveClick: () => handleDelete(row),
              },
              {
                trigger: () =>
                  h(
                    NButton,
                    {
                      size: 'small',
                      type: 'error',
                      class: 'actions-btn',
                      quaternary: true,
                    },
                    {
                      icon: () => h(NIcon, null, { default: () => h(TrashOutline) }),
                    }
                  ),
                default: () => '确定要删除这个数据类型吗？',
              }
            ),
          ],
        }
      );
    },
  },
];

async function loadDataList() {
  try {
    const docs = await ztools.db.promises.allDocs(DB_PREFIX);
    dataList.value = (docs || [])
      .filter((doc) => doc._id !== 'virtual-data-settings-main')
      .sort((a, b) => a.sort - b.sort);
  } catch (error) {
    console.error('加载数据失败:', error);
    message.error('加载数据失败');
  }
}

function handleAdd() {
  editingItem.value = null;
  drawerVisible.value = true;
}

function handleEdit(row) {
  editingItem.value = row;
  drawerVisible.value = true;
}

async function handleDelete(row) {
  try {
    await ztools.db.promises.remove(row._id);
    message.success('删除成功！');
    await loadDataList();
  } catch (error) {
    console.error('删除失败:', error);
    message.error('删除失败');
  }
}

function handleFormSuccess() {
  loadDataList();
}

async function updateSortOrder() {
  try {
    for (let index = 0; index < dataList.value.length; index++) {
      const item = dataList.value[index];
      const doc = await ztools.db.promises.get(item._id);

      if (doc) {
        const updatedDoc = {
          ...doc,
          name: item.name,
          code: item.code,
          sort: index + 1,
          updatedAt: Date.now(),
        };

        const result = await ztools.db.promises.put(updatedDoc);

        if (result.ok && result.rev) {
          dataList.value[index]._rev = result.rev;
          dataList.value[index].sort = index + 1;
        } else {
          throw new Error(`更新文档 ${item._id} 失败`);
        }
      }
    }
  } catch (error) {
    console.error('更新排序失败:', error);
    message.error('更新排序失败');
    await loadDataList();
  }
}

function calculateTableHeight() {
  const viewportHeight = window.innerHeight;
  tableMaxHeight.value = viewportHeight - 150;
}

const tableBodyRef = ref();

onMounted(async () => {
  await loadDataList();
  calculateTableHeight();
  window.addEventListener('resize', calculateTableHeight);

  await nextTick();
  setTimeout(() => {
    const tableEl = document.querySelector('.n-data-table-tbody');
    if (tableEl) {
      tableBodyRef.value = tableEl;
      useDraggable(tableBodyRef, dataList, {
        animation: 150,
        handle: '.drag-handle',
        onSort: async (event) => {
          const { oldIndex, newIndex } = event;
          if (oldIndex !== undefined && newIndex !== undefined && oldIndex !== newIndex) {
            await updateSortOrder();
          }
        },
      });
    }
  }, 500);
});

onUnmounted(() => {
  window.removeEventListener('resize', calculateTableHeight);
});

defineExpose({
  handleAdd,
});
</script>

<style scoped>
.data-configuration {
  height: 100%;
  background: #fff;
  box-shadow: 0 2px 12px 0 rgba(0, 0, 0, 0.1);
  padding: 16px;
  height: calc(100vh - 71px);
}

.action-bar {
  padding: 0;
}

.table-container {
  margin-top: 16px;
  overflow: hidden;
}

:deep(.actions-btn) {
  padding: 0 4px !important;
}

:deep(.n-data-table-wrapper) {
  overflow: visible;
}

:deep(.n-data-table-thead) {
  position: sticky;
  top: 0;
  z-index: 1;
  background: var(--n-th-color);
}

:deep(.n-data-table-tbody) {
  overflow-y: auto;
}

.drag-handle:hover {
  color: #18a058 !important;
}
</style>
