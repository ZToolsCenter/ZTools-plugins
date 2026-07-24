<template>
  <div class="kill-process">

    <!-- 进程列表 -->
    <div class="process-list-container">
      <table class="process-table">
        <tbody>
          <tr v-for="process in filteredProcesses" :key="process.pid" @click="selectProcess(process)"
            class="process-row">
            <td colspan="4">
              <div class="process-top">
                <div class="process-name">{{ process.name }}</div>
                <div class="process-tags">
                  <span class="tag mem-tag">pid {{ process.pid }}</span>
                  <span class="tag mem-tag">cpu {{ process.cpu }}</span>
                  <span class="tag mem-tag">mem {{ process.memUsage }}</span>
                  <span v-for="(port, index) in process.ports" :key="index" class="tag port-tag">port {{ port }}</span>
                </div>
              </div>
              <div class="process-bottom">
                <div class="process-cwd">{{ process.cwd || '' }}</div>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
      <div v-if="filteredProcesses.length === 0" class="no-data">
        {{ loading ? '加载中...' : '没有找到匹配的进程' }}
      </div>
    </div>

    <!-- 消息提示 -->
    <div v-if="message" class="message" :class="{ success: isSuccess, error: !isSuccess }">
      {{ message }}
    </div>

    <!-- 确认对话框 -->
    <div v-if="showDialog" class="dialog-overlay">
      <div class="dialog">
        <h3>结束进程</h3>
        <p>确定要结束进程 <strong>{{ selectedProcess?.name }}</strong> (PID: {{ selectedProcess?.pid }}) 吗？</p>
        <div class="dialog-buttons">
          <button @click="cancelKill" class="cancel-button">取消</button>
          <button @click="confirmKill" class="confirm-button">确定</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { onMounted, ref } from 'vue';

const props = defineProps({
  enterAction: Object
});

const processes = ref([]);
const filteredProcesses = ref([]);
const loading = ref(true);
const message = ref('');
const isSuccess = ref(false);
const showDialog = ref(false);
const selectedProcess = ref(null);

// 加载进程列表
const loadProcesses = async () => {
  console.log('加载进程列表')
  try {
    loading.value = true;
    const processList = await window.services.getProcessList();
    processes.value = processList;
    filteredProcesses.value = processList;
  } catch (error) {
    message.value = `错误: ${error.message}`;
    isSuccess.value = false;
  } finally {
    loading.value = false;
  }
};

// debounce 函数
const debounce = (func, delay) => {
  let timeoutId;
  return function (...args) {
    clearTimeout(timeoutId);
    timeoutId = setTimeout(() => func.apply(this, args), delay);
  };
};

// 过滤进程
const filterProcesses = debounce((input) => {
  if (input === '') {
    filteredProcesses.value = processes.value;
    return;
  }

  const term = input.toLowerCase();
  filteredProcesses.value = processes.value.filter(process =>
    process.name.toLowerCase().includes(term) ||
    process.ports.some(port => port.toString().includes(term))
  );
}, 300);

// 选择进程
const selectProcess = (process) => {
  selectedProcess.value = process;
  showDialog.value = true;
};

// 取消杀死进程
const cancelKill = () => {
  showDialog.value = false;
  selectedProcess.value = null;
};

// 确认杀死进程
const confirmKill = async () => {
  if (!selectedProcess.value) return;

  try {
    message.value = window.services.killProcess(selectedProcess.value.pid);
    isSuccess.value = true;
    showDialog.value = false;
    // 重新加载进程列表
    await loadProcesses();
  } catch (error) {
    message.value = `错误: ${error.message}`;
    isSuccess.value = false;
  }
};

window.ztools.setSubInput(input => {
  filterProcesses(input.text);
}, "输入进程名或端口号搜索", true)

// 组件挂载时加载进程列表
onMounted(() => {
  loadProcesses();
});
</script>

<style scoped>
.kill-process {
  padding: 10px;
  width: 100%;
  position: relative;
  background-color: #f5f5f5;
}

h2 {
  text-align: center;
  margin-bottom: 10px;
  color: #333;
}

.process-list-container {
  height: calc(100vh - 20px);
  overflow-y: auto;
  border: 1px solid #ddd;
  border-radius: 4px;
  background-color: white;
}

.process-table {
  width: 100%;
  border-collapse: collapse;
}

.process-table th,
.process-table td {
  padding: 8px 12px;
  text-align: left;
  border-bottom: 1px solid #ddd;
}

.process-table th {
  background-color: #f5f5f5;
  font-weight: bold;
}

.process-row {
  cursor: pointer;
  transition: background-color 0.2s;
}

.process-row:hover {
  background-color: #f0f0f0;
}

.process-top {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 3px;
}

.process-name {
  font-weight: bold;
  font-size: 14px;
  color: #333;
}

.process-tags {
  display: flex;
  gap: 6px;
}

.tag {
  padding: 1px 6px;
  border-radius: 10px;
  font-size: 11px;
  font-weight: 500;
}

.mem-tag {
  background-color: #e6f7ff;
  color: #1890ff;
  border: 1px solid #91d5ff;
}

.port-tag {
  background-color: #f6ffed;
  color: #52c41a;
  border: 1px solid #b7eb8f;
}

.process-bottom {
  font-size: 12px;
  color: #666;
  margin-top: 3px;
  padding-top: 3px;
  border-top: 1px solid #f0f0f0;
}

.no-data {
  padding: 40px;
  text-align: center;
  color: #999;
}

.message {
  padding: 10px;
  border-radius: 4px;
  margin-top: 10px;
  text-align: center;
}

.success {
  background-color: #f6ffed;
  border: 1px solid #b7eb8f;
  color: #52c41a;
}

.error {
  background-color: #fff2f0;
  border: 1px solid #ffccc7;
  color: #ff4d4f;
}

/* 对话框样式 */
.dialog-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background-color: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.dialog {
  background-color: white;
  padding: 20px;
  border-radius: 4px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
  max-width: 400px;
  width: 100%;
}

.dialog h3 {
  margin-top: 0;
  margin-bottom: 15px;
  color: #333;
}

.dialog p {
  margin-bottom: 20px;
  color: #666;
}

.dialog p strong {
  color: #333;
}

.dialog-buttons {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
}

.cancel-button {
  padding: 8px 16px;
  border: 1px solid #ff4d4f;
  border-radius: 4px;
  background-color: #ff4d4f;
  color: white;
  cursor: pointer;
  transition: all 0.3s;
}

.cancel-button:hover {
  background-color: #ff7875;
  border-color: #ff7875;
}

.confirm-button {
  padding: 8px 16px;
  border: 1px solid #1890ff;
  border-radius: 4px;
  background-color: #1890ff;
  color: white;
  cursor: pointer;
  transition: all 0.3s;
}

.confirm-button:hover {
  background-color: #40a9ff;
  border-color: #40a9ff;
}
</style>
