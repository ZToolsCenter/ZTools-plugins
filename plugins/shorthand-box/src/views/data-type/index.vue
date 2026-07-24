<script setup>
import { ref, onMounted, onUnmounted, computed, h } from 'vue';
import {
  NButton,
  NInput,
  NSpace,
  NDivider,
  NCard,
  NIcon,
  NPopconfirm,
  NEllipsis,
  useMessage,
} from 'naive-ui';
import { Add, SwapVertical, CreateOutline, TrashOutline, ReorderFour } from '@vicons/ionicons5';
import { generatePrefixedUUID } from '@/utils';
import { copyContent } from '@/utils/copy-content';
import DataTypesForm from './components/DataTypesForm.vue';
import { VueDraggable } from 'vue-draggable-plus';
import { usePageActions } from '@/composables/usePageActions';
import { useSettings } from '@/composables/useSettings';

defineProps({
  enterAction: {
    type: Object,
    required: true,
  },
});

const { setActions, clearActions } = usePageActions();
const { settings, closePlugin } = useSettings();
const message = useMessage();

const dataTypes = ref([]);
const loading = ref(false);
const searchName = ref('');
const searchDescription = ref('');
const showFormModal = ref(false);
const currentEditItem = ref(null);

const maxOrder = computed(() => Math.max(0, ...dataTypes.value.map((item) => item.order)));

const filteredData = computed(() => {
  const keywordName = searchName.value.toLowerCase();
  const keywordDesc = searchDescription.value.toLowerCase();

  return dataTypes.value.filter((item) => {
    if (!item.name) return false;
    if (keywordName && !item.name.toLowerCase().includes(keywordName)) return false;
    if (keywordDesc && !item.description?.toLowerCase().includes(keywordDesc)) return false;
    return true;
  });
});

const dragList = ref([]);

const syncDragList = () => {
  dragList.value = [...filteredData.value];
};

const initData = async () => {
  loading.value = true;
  try {
    const data = await window.ztools.db.promises.allDocs('data-type-');
    dataTypes.value = data.filter(Boolean).sort((a, b) => a.order - b.order);
    syncDragList();
  } catch (error) {
    console.error('获取数据类型失败:', error);
  } finally {
    loading.value = false;
  }
};

const handleDragEnd = async (evt) => {
  const { oldIndex, newIndex } = evt;
  if (oldIndex === newIndex) return;

  loading.value = true;
  try {
    const latestList = await Promise.all(
      dragList.value.map((item) => window.ztools.db.promises.get(item._id))
    );
    await Promise.all(
      latestList.map((latest, index) =>
        window.ztools.db.promises.put({ ...latest, order: index + 1 })
      )
    );
    const newOrderMap = {};
    dragList.value.forEach((item, idx) => {
      newOrderMap[item._id] = idx + 1;
    });
    dataTypes.value = dataTypes.value
      .map((item) => ({
        ...item,
        order: newOrderMap[item._id],
      }))
      .sort((a, b) => a.order - b.order);
    dragList.value = dragList.value.map((item) => ({
      ...item,
      order: newOrderMap[item._id],
    }));
  } catch (error) {
    console.error('更新排序失败:', error);
    await initData();
  } finally {
    loading.value = false;
  }
};

const handleAdd = () => {
  currentEditItem.value = null;
  showFormModal.value = true;
};

const handleEdit = (item) => {
  currentEditItem.value = { ...item };
  showFormModal.value = true;
};

const saveFormData = async (formData) => {
  if (!formData.name?.trim()) return alert('请输入数据类型名称');

  loading.value = true;
  try {
    if (currentEditItem.value) {
      await window.ztools.db.promises.put({
        ...currentEditItem.value,
        name: formData.name,
        description: formData.description,
        order: formData.order,
      });
    } else {
      await window.ztools.db.promises.put({
        _id: generatePrefixedUUID('data-type'),
        name: formData.name,
        description: formData.description,
        order: formData.order,
      });
    }
    await initData();
  } catch (error) {
    console.error('保存数据失败:', error);
    alert('保存失败，请重试');
  } finally {
    loading.value = false;
  }
};

const handleDelete = async (item) => {
  loading.value = true;
  try {
    const entries = await window.ztools.db.promises.allDocs('entry-');
    const hasRelatedData = entries.some((entry) => entry && entry.dataTypeId === item._id);
    if (hasRelatedData) {
      message.warning('该数据类型正在被使用，无法删除');
      loading.value = false;
      return;
    }
    await window.ztools.db.promises.remove(item._id);
    await initData();
  } catch (error) {
    console.error('删除数据失败:', error);
    alert('删除失败，请重试');
  } finally {
    loading.value = false;
  }
};

const handleCopy = (content) => {
  if (!settings.value.clickToCopy) return;
  copyContent(content);
  if (settings.value.showCopyTip) {
    message.success('已复制到剪贴板');
  }
  if (settings.value.copyAfterClose) {
    closePlugin();
  }
};

const reverseOrder = async () => {
  loading.value = true;
  try {
    const reversed = [...dataTypes.value].reverse();
    const latestList = await Promise.all(
      reversed.map((item) => window.ztools.db.promises.get(item._id))
    );
    await Promise.all(
      latestList.map((latest, index) =>
        window.ztools.db.promises.put({ ...latest, order: index + 1 })
      )
    );
    const newOrderMap = {};
    reversed.forEach((item, idx) => {
      newOrderMap[item._id] = idx + 1;
    });
    dataTypes.value = dataTypes.value
      .map((item) => ({ ...item, order: newOrderMap[item._id] }))
      .sort((a, b) => a.order - b.order);
    syncDragList();
  } catch (error) {
    console.error('反转排序失败:', error);
    alert('反转排序失败，请重试');
  } finally {
    loading.value = false;
  }
};

const actionNode = () =>
  h('div', { style: 'display:flex;align-items:center;gap:8px' }, [
    h(
      NButton,
      {
        type: 'primary',
        onClick: handleAdd,
        size: 'small',
      },
      {
        icon: () => h(NIcon, null, { default: () => h(Add) }),
        default: () => '添加',
      }
    ),
    h(
      NButton,
      {
        type: 'warning',
        onClick: reverseOrder,
        size: 'small',
      },
      {
        icon: () => h(NIcon, null, { default: () => h(SwapVertical) }),
        default: () => '反转排序',
      }
    ),
  ]);

onMounted(async () => {
  setActions(actionNode);
  await initData();
});

onUnmounted(() => {
  clearActions();
});
</script>

<template>
  <NCard class="page-card">
    <div class="card-body">
      <NSpace
        class="search-area"
        align="center"
      >
        <label>数据类型名称</label>
        <NInput
          v-model:value="searchName"
          placeholder="按数据类型名称关键字"
          style="width: 200px"
          size="small"
        />
        <label>数据类型描述</label>
        <NInput
          v-model:value="searchDescription"
          placeholder="按数据类型描述关键字"
          style="width: 200px"
          size="small"
        />
      </NSpace>

      <NDivider style="margin: 12px 0" />

      <div class="table-wrapper">
        <div class="table-scroll">
          <table>
            <colgroup>
              <col style="width: 50px" />
              <col style="width: 50px" />
              <col style="width: 200px" />
              <col style="width: 150px" />
              <col style="width: 50px" />
              <col style="width: 55px" />
            </colgroup>
            <thead>
              <tr>
                <th>排序</th>
                <th>序号</th>
                <th>数据类型名称</th>
                <th>数据类型描述</th>
                <th>排序</th>
                <th>操作</th>
              </tr>
            </thead>
            <VueDraggable
              v-model="dragList"
              tag="tbody"
              :animation="200"
              handle=".drag-handle"
              ghost-class="sortable-ghost"
              chosen-class="sortable-chosen"
              drag-class="sortable-drag"
              @end="handleDragEnd"
            >
              <tr
                v-for="(item, index) in dragList"
                :key="item._id"
              >
                <td style="text-align: center">
                  <span class="drag-handle"
                    ><NIcon :size="16"><ReorderFour /></NIcon
                  ></span>
                </td>
                <td style="text-align: center">{{ index + 1 }}</td>
                <td
                  :class="{ 'cell-copy': settings.clickToCopy }"
                  @click="handleCopy(item.name)"
                >
                  <NEllipsis>{{ item.name }}</NEllipsis>
                </td>
                <td
                  :class="{ 'cell-copy': settings.clickToCopy }"
                  @click="handleCopy(item.description || '-')"
                >
                  <NEllipsis>{{ item.description || '-' }}</NEllipsis>
                </td>
                <td style="text-align: center">{{ item.order }}</td>
                <td>
                  <div class="action-btns">
                    <NButton
                      size="small"
                      type="primary"
                      quaternary
                      @click="handleEdit(item)"
                    >
                      <template #icon
                        ><NIcon><CreateOutline /></NIcon
                      ></template>
                    </NButton>
                    <NPopconfirm @positive-click="handleDelete(item)">
                      <template #trigger>
                        <NButton
                          size="small"
                          type="error"
                          quaternary
                        >
                          <template #icon
                            ><NIcon><TrashOutline /></NIcon
                          ></template>
                        </NButton>
                      </template>
                      确定要删除这个数据类型吗？
                    </NPopconfirm>
                  </div>
                </td>
              </tr>
            </VueDraggable>
          </table>
        </div>
        <div
          v-if="!loading && dragList.length === 0"
          class="empty-state"
        >
          暂无数据
        </div>
      </div>
    </div>
  </NCard>

  <!-- 数据类型表单模态框 -->
  <DataTypesForm
    v-model:show="showFormModal"
    :edit-item="currentEditItem"
    :max-order="maxOrder"
    :existing-names="dataTypes"
    @save="saveFormData"
  />
</template>

<style scoped>
.page-card {
  overflow: hidden;
}

.page-card :deep(.n-card__content) {
  padding: 12px;
  overflow: hidden;
}

.card-body {
  display: flex;
  flex-direction: column;
  height: calc(100vh - 107px);
  overflow: hidden;
}

.search-area {
  padding-bottom: 8px;
}

.table-wrapper {
  flex: 1;
  display: flex;
  flex-direction: column;
  border: 1px solid #e8e8e8;
  border-radius: 3px;
  overflow: hidden;
  min-height: 0;
}

.table-scroll {
  flex: 1;
  overflow-y: auto;
  overflow-x: hidden;
  background-color: #fff;
}

.table-scroll table {
  table-layout: fixed;
  width: 100%;
  border-collapse: collapse;
}

.table-scroll th {
  padding: 8px 12px;
  font-size: 13px;
  color: #333;
  font-weight: 600;
  text-align: left;
  border-bottom: 1px solid #e8e8e8;
  border-right: 1px solid #e8e8e8;
  background-color: #fafafa;
  position: sticky;
  top: 0;
  z-index: 1;
}

.table-scroll td {
  padding: 6px 12px;
  font-size: 13px;
  border-bottom: 1px solid #e8e8e8;
  border-right: 1px solid #e8e8e8;
  overflow: hidden;
  white-space: nowrap;
}

.cell-copy {
  cursor: pointer;
  transition: background-color 0.2s ease;
}

.cell-copy:hover {
  background-color: rgba(0, 0, 0, 0.04);
}

.table-scroll::-webkit-scrollbar {
  width: 6px;
}

.table-scroll::-webkit-scrollbar-track {
  background: transparent;
}

.table-scroll::-webkit-scrollbar-thumb {
  background-color: #c0c4cc;
  border-radius: 3px;
}

.table-scroll::-webkit-scrollbar-thumb:hover {
  background-color: #909399;
}

.drag-handle {
  cursor: move;
  color: #c0c4cc;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 2px 4px;
  border-radius: 4px;
  transition: all 0.25s ease;
}

.drag-handle:hover {
  color: #18a058;
  background-color: rgba(24, 160, 88, 0.12);
  transform: scale(1.15);
}

tr:hover .drag-handle {
  color: #888;
}

.action-btns {
  display: flex;
  align-items: center;
  gap: 8px;
  justify-content: center;
  .n-button {
    padding: 0px !important;
  }
}

.sortable-ghost > td {
  opacity: 0.4;
}

.sortable-chosen > td {
  background-color: rgba(24, 160, 88, 0.08);
}

.sortable-drag > td {
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
}

.empty-state {
  padding: 40px;
  text-align: center;
  color: #999;
}

@media (prefers-color-scheme: dark) {
  .table-wrapper {
    border-color: #3e3e3e;
  }

  .table-scroll {
    background-color: #1e1e1e;
  }

  .table-scroll th {
    color: #d0d0d0;
    border-bottom-color: #3e3e3e;
    border-right-color: #3e3e3e;
    background-color: #262626;
  }

  .table-scroll td {
    border-bottom-color: #3e3e3e;
    border-right-color: #3e3e3e;
  }

  .cell-copy:hover {
    background-color: rgba(255, 255, 255, 0.04);
  }

  .table-scroll::-webkit-scrollbar-thumb {
    background-color: #555;
  }

  .table-scroll::-webkit-scrollbar-thumb:hover {
    background-color: #666;
  }

  .drag-handle {
    color: #555;
  }

  .drag-handle:hover {
    color: #63e2b7;
    background-color: rgba(99, 226, 183, 0.12);
  }

  tr:hover .drag-handle {
    color: #999;
  }

  .sortable-chosen > td {
    background-color: rgba(99, 226, 183, 0.08);
  }

  .sortable-drag > td {
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
  }

  .empty-state {
    color: #666;
  }
}
.n-divider--no-title {
  display: none !important;
}
</style>
