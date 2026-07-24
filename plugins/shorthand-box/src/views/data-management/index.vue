<script setup>
import { ref, onMounted, onUnmounted, computed, h, watch, nextTick } from 'vue';
import {
  NButton,
  NInput,
  NSpace,
  NDivider,
  NCard,
  NIcon,
  NPopconfirm,
  NSelect,
  NEllipsis,
  useMessage,
} from 'naive-ui';
import {
  Add,
  SwapVertical,
  CreateOutline,
  TrashOutline,
  ReorderFour,
  List,
  CopyOutline,
} from '@vicons/ionicons5';
import { generatePrefixedUUID } from '@/utils';
import { copyContent } from '@/utils/copy-content';
import DataEntryForm from './components/DataEntryForm.vue';
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

const projects = ref([]);
const dataEntries = ref([]);
const dataTypes = ref([]);
const loading = ref(false);
const selectedProjectId = ref(null);

const searchKeyword = ref('');
const filterDataTypeId = ref(null);
const projectSearchKeyword = ref('');

const showFormModal = ref(false);
const currentEditItem = ref(null);

const filteredProjects = computed(() => {
  const keyword = projectSearchKeyword.value.toLowerCase();
  if (!keyword) return projects.value;
  return projects.value.filter((p) => p.name.toLowerCase().includes(keyword));
});

const dataTypeOptions = computed(() =>
  dataTypes.value.map((t) => ({ label: t.name, value: t._id }))
);

const filteredData = computed(() => {
  let result = dataEntries.value;
  const keyword = searchKeyword.value.toLowerCase();
  if (keyword) {
    result = result.filter(
      (item) =>
        (item.name && item.name.toLowerCase().includes(keyword)) ||
        (item.value && String(item.value).toLowerCase().includes(keyword)) ||
        (item.description && item.description.toLowerCase().includes(keyword))
    );
  }
  if (filterDataTypeId.value) {
    result = result.filter((item) => item.dataTypeId === filterDataTypeId.value);
  }
  return result;
});

const dragList = ref([]);

const syncDragList = () => {
  dragList.value = [...filteredData.value];
};

watch(filteredData, () => {
  syncDragList();
});

const initProjects = async () => {
  try {
    const data = await window.ztools.db.promises.allDocs('project-');
    projects.value = data.filter(Boolean).sort((a, b) => a.order - b.order);
    if (projects.value.length > 0 && !selectedProjectId.value) {
      selectedProjectId.value = projects.value[0]._id;
    }
  } catch (error) {
    console.error('获取项目列表失败:', error);
  }
};

const initDataTypes = async () => {
  try {
    const data = await window.ztools.db.promises.allDocs('data-type-');
    dataTypes.value = data.filter(Boolean).sort((a, b) => a.order - b.order);
  } catch (error) {
    console.error('获取数据类型失败:', error);
  }
};

const initDataEntries = async () => {
  if (!selectedProjectId.value) return;
  loading.value = true;
  try {
    const data = await window.ztools.db.promises.allDocs('entry-');
    dataEntries.value = data
      .filter(Boolean)
      .filter((item) => item.projectId === selectedProjectId.value)
      .sort((a, b) => a.order - b.order);
    syncDragList();
  } catch (error) {
    console.error('获取数据失败:', error);
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
    dataEntries.value = dataEntries.value
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
    await initDataEntries();
  } finally {
    loading.value = false;
  }
};

const handleSelectProject = (projectId) => {
  selectedProjectId.value = projectId;
  initDataEntries();
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
  if (!formData.name?.trim()) return alert('请输入名称');
  if (!formData.value !== undefined && formData.value === '') return alert('请输入值');
  if (!formData.dataTypeId) return alert('请选择数据类型');

  loading.value = true;
  try {
    if (currentEditItem.value) {
      await window.ztools.db.promises.put({
        ...currentEditItem.value,
        name: formData.name,
        value: formData.value,
        dataTypeId: formData.dataTypeId,
        description: formData.description,
      });
    } else {
      const maxOrder = Math.max(0, ...dataEntries.value.map((d) => d.order));
      await window.ztools.db.promises.put({
        _id: generatePrefixedUUID('entry'),
        projectId: selectedProjectId.value,
        name: formData.name,
        value: formData.value,
        dataTypeId: formData.dataTypeId,
        description: formData.description,
        order: maxOrder + 1,
      });
    }
    await initDataEntries();
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
    await window.ztools.db.promises.remove(item._id);
    await initDataEntries();
  } catch (error) {
    console.error('删除数据失败:', error);
    alert('删除失败，请重试');
  } finally {
    loading.value = false;
  }
};

const reverseOrder = async () => {
  loading.value = true;
  try {
    const reversed = [...dataEntries.value].reverse();
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
    dataEntries.value = dataEntries.value
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

const sortByDataType = async () => {
  loading.value = true;
  try {
    const typeOrderMap = {};
    dataTypes.value.forEach((t) => {
      typeOrderMap[t._id] = t.order;
    });
    const sorted = [...dataEntries.value].sort((a, b) => {
      const orderA = typeOrderMap[a.dataTypeId] ?? 999;
      const orderB = typeOrderMap[b.dataTypeId] ?? 999;
      if (orderA !== orderB) return orderA - orderB;
      return a.order - b.order;
    });
    const latestList = await Promise.all(
      sorted.map((item) => window.ztools.db.promises.get(item._id))
    );
    await Promise.all(
      latestList.map((latest, index) =>
        window.ztools.db.promises.put({ ...latest, order: index + 1 })
      )
    );
    const newOrderMap = {};
    sorted.forEach((item, idx) => {
      newOrderMap[item._id] = idx + 1;
    });
    dataEntries.value = dataEntries.value
      .map((item) => ({ ...item, order: newOrderMap[item._id] }))
      .sort((a, b) => a.order - b.order);
    syncDragList();
  } catch (error) {
    console.error('同类排序失败:', error);
    alert('同类排序失败，请重试');
  } finally {
    loading.value = false;
  }
};

const handleCopy = async (content) => {
  if (!settings.value.clickToCopy) return;
  await copyContent(content);
  if (settings.value.showCopyTip) {
    message.success('已复制到剪贴板');
  }
  if (settings.value.copyAfterClose) {
    closePlugin();
  }
};

const getDataTypeName = (dataTypeId) => {
  const dt = dataTypes.value.find((t) => t._id === dataTypeId);
  return dt ? dt.name : '-';
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
        type: 'info',
        onClick: sortByDataType,
        size: 'small',
      },
      {
        icon: () => h(NIcon, null, { default: () => h(List) }),
        default: () => '同类排序',
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
  await initProjects();
  await initDataTypes();
  if (selectedProjectId.value) {
    await initDataEntries();
  }
});

onUnmounted(() => {
  clearActions();
});
</script>

<template>
  <NCard class="page-card">
    <div class="card-body">
      <div class="main-layout">
        <div class="project-list">
          <div class="list-header">项目列表</div>
          <div class="list-search">
            <NInput
              v-model:value="projectSearchKeyword"
              placeholder="搜索项目名称"
              size="small"
              clearable
            />
          </div>
          <div class="list-items">
            <div
              v-for="project in filteredProjects"
              :key="project._id"
              :class="['project-item', { active: project._id === selectedProjectId }]"
              @click="handleSelectProject(project._id)"
            >
              {{ project.name }}
            </div>
          </div>
        </div>

        <div class="data-area">
          <NSpace
            class="search-area"
            align="center"
          >
            <label>模糊查询</label>
            <NInput
              v-model:value="searchKeyword"
              placeholder="按名称、值、描述"
              style="width: 200px"
              size="small"
              clearable
            />
            <label>数据类型</label>
            <NSelect
              v-model:value="filterDataTypeId"
              :options="dataTypeOptions"
              placeholder="数据类型"
              style="width: 150px"
              size="small"
              clearable
            />
          </NSpace>

          <NDivider style="margin: 12px 0" />

          <div class="table-wrapper">
            <div class="table-scroll">
              <table>
                <colgroup>
                  <col style="width: 55px" />
                  <col style="width: 55px" />
                  <col style="width: 95px" />
                  <col style="width: 95px" />
                  <col style="width: 95px" />
                  <col style="width: 95px" />
                  <col style="width: 60px" />
                </colgroup>
                <thead>
                  <tr>
                    <th>排序</th>
                    <th>序号</th>
                    <th>名称</th>
                    <th>值</th>
                    <th>描述</th>
                    <th>数据类型</th>
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
                      @click="handleCopy(item.value ?? '-')"
                    >
                      <NEllipsis>{{ item.value ?? '-' }}</NEllipsis>
                    </td>
                    <td
                      :class="{ 'cell-copy': settings.clickToCopy }"
                      @click="handleCopy(item.description || '-')"
                    >
                      <NEllipsis>{{ item.description || '-' }}</NEllipsis>
                    </td>
                    <td style="text-align: center">{{ getDataTypeName(item.dataTypeId) }}</td>
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
                          确定要删除这条数据吗？
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
              暂无数据，请切换左侧项目或添加数据
            </div>
          </div>
        </div>
      </div>
    </div>
  </NCard>

  <!-- 数据表单模态框 -->
  <DataEntryForm
    v-model:show="showFormModal"
    :edit-item="currentEditItem"
    :project-id="selectedProjectId"
    :existing-names="dataEntries"
    :data-type-options="dataTypeOptions"
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

.main-layout {
  flex: 1;
  display: flex;
  gap: 16px;
  min-height: 0;
}

.project-list {
  width: 150px;
  flex-shrink: 0;
  border: 1px solid #e8e8e8;
  border-radius: 3px;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.list-header {
  padding: 10px 12px;
  font-size: 14px;
  font-weight: 600;
  color: #333;
  background-color: #fafafa;
  border-bottom: 1px solid #e8e8e8;
}

.list-search {
  padding: 8px;
  border-bottom: 1px solid #e8e8e8;
}

.list-items {
  flex: 1;
  overflow-y: auto;
  background-color: #fff;
}

.list-items::-webkit-scrollbar {
  width: 4px;
}

.list-items::-webkit-scrollbar-thumb {
  background-color: #c0c4cc;
  border-radius: 2px;
}

.project-item {
  padding: 10px 12px;
  font-size: 13px;
  color: #666;
  cursor: pointer;
  transition: all 0.2s ease;
  border-bottom: 1px solid #e8e8e8;
}

.project-item:hover {
  background-color: rgba(0, 0, 0, 0.04);
  color: #18a058;
}

.project-item.active {
  background-color: rgba(24, 160, 88, 0.1);
  color: #18a058;
  font-weight: 500;
  border-left: 3px solid #18a058;
}

.data-area {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.search-area {
  padding-bottom: 4px;
}

.search-area label {
  font-size: 13px;
  color: #666;
  white-space: nowrap;
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
  .project-list {
    border-color: #3e3e3e;
  }

  .list-header {
    color: #d0d0d0;
    background-color: #262626;
    border-bottom-color: #3e3e3e;
  }

  .list-search {
    border-bottom-color: #3e3e3e;
  }

  .list-items {
    background-color: #1e1e1e;
  }

  .list-items::-webkit-scrollbar-thumb {
    background-color: #555;
  }

  .project-item {
    color: #b0b0b0;
    border-bottom-color: #3e3e3e;
  }

  .project-item:hover {
    background-color: rgba(255, 255, 255, 0.06);
    color: #63e2b7;
  }

  .project-item.active {
    background-color: rgba(99, 226, 183, 0.1);
    color: #63e2b7;
    border-left-color: #63e2b7;
  }

  .search-area label {
    color: #b0b0b0;
  }

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
