<template>
    <div class="notification-container">
        <!-- 左侧列表 -->
        <div class="notification-list">
            <!-- 固定头部 -->
            <div class="list-wrapper">
                <div class="list-header">
                    <a-checkbox v-model:checked="allSelected" @change="handleSelectAll">全选</a-checkbox>
                    <a-space class="batch-actions">
                        <a-button type="primary" size="small" @click="handleBatchRead"
                                  :disabled="!selectedItems.length">
                            标记已读
                        </a-button>
                        <a-button type="primary" danger size="small" @click="handleBatchDelete"
                                  :disabled="!selectedItems.length">
                            批量删除
                        </a-button>
                    </a-space>
                </div>

                <!-- 可滚动的列表内容 -->
                <div class="list-content">
                    <a-list>
                        <a-list-item v-for="item in notifications" :key="item.id"
                                     class="notification-item"
                                     :class="{
                'unread': !item.isRead, 
                'selected': selectedItems.includes(item.id),
                'active': currentNotification?.id === item.id 
              }"
                                     @click="handleSelectNotification(item)"
                        >
                            <div class="item-wrapper">
                                <a-checkbox :checked="item.checked" @change="handleItemSelect(item)"
                                            @click.stop></a-checkbox>
                                <div class="item-content">
                                    <div class="item-title">
                                        <a-badge status="error" v-if="!item.isRead"/>
                                        <span>{{ item.title }}</span>
                                    </div>
                                    <div class="item-time">
                                        <a-typography-text type="secondary">{{
                                                formatTime(item.time)
                                            }}
                                        </a-typography-text>
                                    </div>
                                </div>
                            </div>
                        </a-list-item>
                    </a-list>
                </div>
            </div>
        </div>

        <!-- 右侧详情 -->
        <div class="notification-detail" v-if="currentNotification">
            <div class="detail-content">
                <div class="detail-title">
                    {{ currentNotification.title }}
                </div>
                <div class="detail-meta">
                    <a-typography-text type="secondary">
                        {{ formatTime(currentNotification.time) }}
                    </a-typography-text>
                    <a-button type="link" danger @click="handleDelete(currentNotification)">
                        <template #icon>
                            <delete-outlined/>
                        </template>
                        删除
                    </a-button>
                </div>
                <div class="detail-body" v-html="currentNotification.content"></div>
            </div>
        </div>
    </div>
</template>

<script setup>
import {ref, computed, onMounted, getCurrentInstance} from 'vue'
import {message, theme} from 'ant-design-vue'
import {
    getAllNotification,
    deleteNotification,
    batchDeleteNotifications,
    markAsRead,
    batchMarkAsRead
} from '@/utils/notification';
import {DeleteOutlined} from '@ant-design/icons-vue'

const {useToken} = theme
const {token} = useToken()

const notifications = ref([])

const refreshNotifications = () => {
    notifications.value = getAllNotification().map(item => ({
        ...item,
        checked: false  // 重置选择状态
    }))
}

const currentNotification = ref(null)
const selectedItems = computed(() => notifications.value.filter(item => item.checked).map(item => item.id))
const allSelected = computed({
    get: () => notifications.value.length > 0 && notifications.value.every(item => item.checked),
    set: (val) => notifications.value.forEach(item => item.checked = val)
})

const handleSelectAll = (e) => {
    notifications.value.forEach(item => item.checked = e.target.checked)
}

const handleItemSelect = (item) => {
    item.checked = !item.checked
}

const handleSelectNotification = (item) => {
    currentNotification.value = item
    if (!item.isRead) {
        markAsRead(item.id)
        refreshNotifications()
        proxy.$eventBus.emit('notification-updated');
    }
}

const handleDelete = (item) => {
    deleteNotification(item.id)
    refreshNotifications()
    currentNotification.value = null
    message.success('删除成功')
    proxy.$eventBus.emit('notification-updated');
}

const handleBatchDelete = () => {
    if (!selectedItems.value.length) return
    batchDeleteNotifications(selectedItems.value)
    refreshNotifications()
    currentNotification.value = null
    message.success('批量删除成功')
    proxy.$eventBus.emit('notification-updated');
}

const handleBatchRead = () => {
    if (!selectedItems.value.length) return
    batchMarkAsRead(selectedItems.value)
    refreshNotifications()
    message.success('标记已读成功')
    proxy.$eventBus.emit('notification-updated');
}

const formatTime = (time) => {
    return time // 这里可以添加更复杂的时间格式化逻辑
}

const {proxy} = getCurrentInstance();

const handleAddNotification = () => {
    // ... 添加消息的代码 ...
    proxy.$eventBus.emit('notification-updated');
};

const handleMarkAsRead = (id) => {
    markAsRead(id);
    proxy.$eventBus.emit('notification-updated');
};

const handleBatchMarkAsRead = (ids) => {
    batchMarkAsRead(ids);
    proxy.$eventBus.emit('notification-updated');
};

onMounted(() => {
    batchDeleteNotifications(["notification/20241211070735_z2HanB", "notification/20241211065510_iATGw8", "notification/20241211065902_ASwcWS"])
    refreshNotifications()
})
</script>

<style scoped>
.notification-container {
    display: flex;
    height: 100%;
    background: v-bind('token.colorBgContainer');
    border: 1px solid v-bind('token.colorBorderSecondary');
    border-radius: v-bind('token.borderRadius');
    overflow: hidden;
}

.notification-list {
    width: 320px;
    height: 100%;
    background: v-bind('token.colorBgContainer');
    box-shadow: 2px 0 8px rgba(0, 0, 0, 0.06);
    position: relative;
    z-index: 1;
}

.list-wrapper {
    display: flex;
    flex-direction: column;
    height: 100%;
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
}

.list-header {
    padding: 16px;
    background: v-bind('token.colorFillTertiary');
    border-bottom: 1px solid v-bind('token.colorBorderSecondary');
    display: flex;
    justify-content: space-between;
    align-items: center;
    flex-shrink: 0;
}

.list-content {
    flex: 1;
    overflow-y: auto;
    overflow-x: hidden;
}

.notification-detail {
    flex: 1;
    height: 100%;
    padding: 24px;
    background: v-bind('token.colorBgContainer');
    overflow-y: auto;
    overflow-x: hidden;
    position: relative;
    z-index: 0;
}

.notification-item {
    cursor: pointer;
    transition: all 0.3s;
    padding: 0 !important;
    border-bottom: 1px solid v-bind('token.colorBorderSecondary');
    background: v-bind('token.colorBgContainer');
}

.item-wrapper {
    padding: 16px;
    width: 100%;
    display: flex;
    align-items: flex-start;
    gap: 8px;
}

.notification-item:hover {
    background-color: v-bind('token.colorFillTertiary');
}

.notification-item.selected {
    background-color: v-bind('token.colorPrimaryBg');
}

.item-content {
    flex: 1;
    min-width: 0;
}

.item-title {
    display: flex;
    align-items: center;
    font-size: 14px;
    color: v-bind('token.colorText');
}

.item-title span {
    display: block;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

:deep(.ant-badge) {
    flex-shrink: 0;
    position: relative;
    z-index: 1;
}

:deep(.ant-badge .ant-badge-dot) {
    background: v-bind('token.colorError');
    width: 6px;
    height: 6px;
    box-shadow: 0 0 0 1px #fff;
}

:deep(.ant-checkbox-wrapper) {
    padding-top: 2px;
}

.item-time {
    margin-top: 4px;
    color: v-bind('token.colorTextSecondary');
}

.detail-content {
    max-width: 800px;
    margin: 0 auto;
}

.detail-title {
    font-size: 20px;
    font-weight: 500;
    color: v-bind('token.colorText');
    margin-bottom: 16px;
    line-height: 1.4;
}

.detail-meta {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 24px;
    padding-bottom: 16px;
    border-bottom: 1px solid v-bind('token.colorBorderSecondary');
}

.detail-body {
    font-size: 14px;
    line-height: 1.5715;
    color: v-bind('token.colorText');
}

.notification-item.active {
    background-color: v-bind('token.colorPrimaryBg');
    border-right: 3px solid v-bind('token.colorPrimary');
}

.notification-item:hover:not(.active) {
    background-color: v-bind('token.colorFillTertiary');
}

.notification-item.unread.active {
    background-color: v-bind('token.colorPrimaryBgHover');
}

.notification-item.selected {
    background-color: v-bind('token.colorPrimaryBg');
}

/* 暗黑模式特定样式 */
.dark {
    .notification-item:hover:not(.active) {
        background-color: v-bind('token.colorFillSecondary');
    }
}

/* 美化滚动条样式 */
.list-content::-webkit-scrollbar,
.notification-detail::-webkit-scrollbar {
    width: 6px;
}

.list-content::-webkit-scrollbar-thumb,
.notification-detail::-webkit-scrollbar-thumb {
    background-color: v-bind('token.colorBorderSecondary');
    border-radius: 3px;
}

.list-content::-webkit-scrollbar-track,
.notification-detail::-webkit-scrollbar-track {
    background-color: transparent;
}

/* 鼠标悬停时显示滚动条 */
.list-content,
.notification-detail {
    &::-webkit-scrollbar-thumb {
        visibility: hidden;
    }

    &:hover::-webkit-scrollbar-thumb {
        visibility: visible;
    }
}
</style> 