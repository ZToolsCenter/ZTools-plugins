<script setup>
import {onMounted, ref, h, nextTick, reactive, getCurrentInstance, computed} from 'vue';
import {theme} from 'ant-design-vue';
import {
    DeleteOutlined,
    TagOutlined,
    SyncOutlined,
    MonitorOutlined,
    EditOutlined,
    SafetyCertificateOutlined
} from '@ant-design/icons-vue';
import {getAllSslMonitor, batchAddSslMonitor, batchAddSslMonitorLogic} from "@/utils/sslMonitor";
import dayjs from 'dayjs';
import {message, Modal} from 'ant-design-vue';
import {addSslMonitor} from '@/utils/sslMonitor';

const {useToken} = theme;
const {token} = useToken();

const sslMonitorRecords = ref([]);
const loading = ref(false);
const tableLoading = ref(false);
const editableData = reactive({});
const batchAddVisible = ref(false);
const batchDomains = ref('');
const batchAddLoading = ref(false);
const searchText = ref('');

const filteredRecords = computed(() => {
    if (!searchText.value) {
        return sslMonitorRecords.value;
    }
    const keyword = searchText.value.toLowerCase();
    return sslMonitorRecords.value.filter(record =>
        record.uri.toLowerCase().includes(keyword) ||
        (record.remark && record.remark.toLowerCase().includes(keyword))
    );
});

const getRecords = () => {
    tableLoading.value = true;
    try {
        let records = getAllSslMonitor();
        records.sort((a, b) => {
            return dayjs(a.expire_time).diff(dayjs(b.expire_time));
        });
        sslMonitorRecords.value = records;
    } finally {
        // 添加一个小延迟，让loading效果更明显
        setTimeout(() => {
            tableLoading.value = false;
        }, 300);
    }
}

const columns = [
    {
        title: '监控地址',
        dataIndex: 'uri',
        key: 'uri',
        ellipsis: true
    },
    // {
    //     title: '解析地址',
    //     dataIndex: 'resolve_address',
    //     key: 'resolve_address',
    //     ellipsis: true
    // },
    {
        title: '备注',
        dataIndex: 'remark',
        key: 'remark',
        // width: 180,
    },
    {
        title: '有效期',
        dataIndex: 'expire_time',
        key: 'expire_time',
        width: 150,
        align: 'center'
    },
    {
        title: '操作',
        key: 'action',
        width: 130,
        align: 'center'
    }
];

const getExpiryStatus = (expireTime) => {
    const now = dayjs();
    const expiry = dayjs(expireTime);
    const daysToExpiry = expiry.diff(now, 'day');

    if (daysToExpiry < 0) return {color: 'error'};
    if (daysToExpiry <= 10) return {color: 'error'};
    if (daysToExpiry <= 30) return {color: 'warning'};
    return {color: 'success'};
}

const getExpiryText = (expireTime) => {
    const now = dayjs();
    const expiry = dayjs(expireTime);
    const daysToExpiry = expiry.diff(now, 'day');

    if (daysToExpiry < 0) {
        return `已过期 ${Math.abs(daysToExpiry)} 天`;
    }
    return `${daysToExpiry} 天`;
}

// 添加选择相关的状态
const selectedRowKeys = ref([]);

// 表格选择配置
const rowSelection = {
    selectedRowKeys: selectedRowKeys,
    onChange: (keys) => {
        selectedRowKeys.value = keys;
    }
};

// 批量删除方法
const batchDelete = async () => {
    if (selectedRowKeys.value.length === 0) {
        message.warning('请先选择要删除的记录');
        return;
    }

    const hide = message.loading('正在删除...', 0);
    try {
        let successCount = 0;
        let errorCount = 0;
        let errorMessages = [];

        for (const id of selectedRowKeys.value) {
            try {
                utools.dbStorage.removeItem(id);
                successCount++;
            } catch (error) {
                errorCount++;
                errorMessages.push(`ID ${id}: ${error.message || '未知错误'}`);
            }
        }

        // 显示成功信息
        if (successCount > 0) {
            message.success(`成功删除 ${successCount} 条记录`);
        }

        // 如果有错误，显示错误详情
        if (errorCount > 0) {
            Modal.error({
                title: `${errorCount} 条记录删除失败`,
                content: h('div', {
                    style: {
                        maxHeight: '300px',
                        overflow: 'auto'
                    }
                }, [
                    h('pre', {
                        style: {
                            whiteSpace: 'pre-wrap',
                            wordBreak: 'break-all'
                        }
                    }, errorMessages.join('\n'))
                ])
            });
        }

        selectedRowKeys.value = [];
        getRecords(); // 刷新列表
    } catch (error) {
        message.error('删除失败：' + error.message);
    } finally {
        hide();
    }
};
const addNewSslMonitor = () => {
    batchAddVisible.value = true
    // 输入框自动获取焦点
    nextTick(() => {
        const input = document.querySelector('.ant-modal-body textarea');
        if (input) {
            input.focus();
        }
    });
}

// 批量更新方法
const batchUpdate = async () => {
    if (selectedRowKeys.value.length === 0) {
        message.warning('请先选择要更新的记录');
        return;
    }

    loading.value = true;

    try {
        const selectedRecords = sslMonitorRecords.value.filter(
            record => selectedRowKeys.value.includes(record._id)
        );
        await batchAddSslMonitorLogic(selectedRecords, true);
        getRecords();
    } catch (error) {
        message.error('更新失败：' + error.message);
    } finally {
        loading.value = false;
        selectedRowKeys.value = [];
    }
};

// 添加单个记录删除方法
const deleteSslRecord = (record) => {
    Modal.confirm({
        title: '删除监控项',
        content: h('div', null, [
            h('p', null, '确定要删除以下监控项吗？'),
            h('p', {style: {color: '#ff4d4f'}}, record.full_domain),
            // h('p', { style: { color: '#999', fontSize: '12px' } }, '删除后不可恢复')
        ]),
        okText: '确定',
        okType: 'danger',
        cancelText: '取消',
        async onOk() {
            try {
                utools.dbStorage.removeItem(record._id || record.id);
                message.success('删除成功');
                getRecords();
            } catch (error) {
                message.error('删除失败：' + error.message);
            }
        }
    });
};

// 添加单个记录更新方法
const updateSslRecord = async (record) => {
    console.log(record)
    const hide = message.loading('正在更新...', 0);
    try {
        await addSslMonitor(
            record,
            true
        )
        message.success('更新成功');
        getRecords();
    } catch (error) {
        message.error('更新失败：' + error.message);
    } finally {
        hide();
    }
};

// 记录原始备注
const originRemark = ref("");
const editRemark = (key) => {
    editableData[key] = {...sslMonitorRecords.value.find(item => item._id === key)};
    originRemark.value = editableData[key].remark || '';
    // 备注输入框自动获取焦点
    nextTick(() => {
        const input = document.querySelector(`.editable-cell-input-wrapper input`);
        if (input) {
            input.focus();
        }
    });
};

const saveRemark = async (key) => {
    // 如果备注没有变化，则不进行更新
    if (editableData[key].remark === undefined) {
        editableData[key].remark = ""
    }
    if (editableData[key].remark === originRemark.value) {
        delete editableData[key];
        return;
    }
    try {
        const record = editableData[key];
        delete editableData[key];
        await addSslMonitor(record, true)
        getRecords();
        message.success('备注更新成功');
    } catch (error) {
        message.error('备注更新失败：' + error.message);
    }
};
const {proxy} = getCurrentInstance();

const createSsl = (record) => {
    proxy.$eventBus.emit("open-ssl-apply", {
        domain: record.domain,
        sub: record.sub,
        cloud: record.cloud,
        account_key: record.account_key
    })
};

const handleBatchAdd = async () => {
    const domains = batchDomains.value.split('\n')
        .map(d => d.trim())
        .filter(d => d);

    if (domains.length === 0) {
        message.warning('请输入要监控的域名');
        return;
    }

    if (domains.length > 20) {
        message.warning('单次最多添加20个域名');
        return;
    }

    batchAddLoading.value = true;
    try {
        const addRes = await batchAddSslMonitor(domains);

        // 根据结果显示适当的消息
        if (addRes.successCount > 0 && addRes.errorCount === 0) {
            message.success(`成功添加 ${addRes.successCount} 个域名监控`);
            batchAddVisible.value = false;
            batchDomains.value = '';
        } else if (addRes.successCount > 0 && addRes.errorCount > 0) {
            Modal.info({
                title: '部分域名添加成功',
                content: h('div', null, [
                    h('div', {
                        style: {
                            padding: '12px 16px',
                            backgroundColor: '#f6ffed',
                            border: '1px solid #b7eb8f',
                            borderRadius: '4px',
                            marginBottom: '12px'
                        }
                    }, [
                        h('div', {style: {display: 'flex', alignItems: 'center'}}, [
                            h('span', {
                                style: {
                                    color: '#52c41a',
                                    fontSize: '16px',
                                    marginRight: '8px',
                                    fontWeight: 'bold'
                                }
                            }, '✓'),
                            h('span', {style: {color: '#52c41a', fontWeight: 'bold'}},
                                `成功添加 ${addRes.successCount} 个域名监控`
                            )
                        ])
                    ]),
                    h('p', null, `${addRes.errorCount} 个域名添加失败`),
                    h('div', {style: {maxHeight: '200px', overflow: 'auto', marginTop: '10px'}},
                        h('div', {style: {border: '1px solid #f0f0f0', borderRadius: '4px'}},
                            addRes.errorUrls.map((item, index) =>
                                h('div', {
                                    style: {
                                        padding: '8px 12px',
                                        borderBottom: index < addRes.errorUrls.length - 1 ? '1px solid #f0f0f0' : 'none',
                                        backgroundColor: index % 2 === 0 ? '#fafafa' : '#fff'
                                    }
                                }, [
                                    h('div', {style: {fontWeight: 'bold', marginBottom: '4px'}}, item.uri),
                                    h('div', {style: {color: '#ff4d4f', fontSize: '13px'}},
                                        item.error.message || '无法连接或证书无效'
                                    )
                                ])
                            )
                        )
                    )
                ]),
                onOk() {
                    batchAddVisible.value = false;
                    batchDomains.value = '';
                }
            });
        } else if (addRes.errorCount > 0) {
            Modal.error({
                title: '添加失败',
                content: h('div', null, [
                    h('p', null, `${addRes.errorCount} 个域名添加失败`),
                    h('div', {style: {maxHeight: '200px', overflow: 'auto', marginTop: '10px'}},
                        h('div', {style: {border: '1px solid #f0f0f0', borderRadius: '4px'}},
                            addRes.errorUrls.map((item, index) =>
                                h('div', {
                                    style: {
                                        padding: '8px 12px',
                                        borderBottom: index < addRes.errorUrls.length - 1 ? '1px solid #f0f0f0' : 'none',
                                        backgroundColor: index % 2 === 0 ? '#fafafa' : '#fff'
                                    }
                                }, [
                                    h('div', {style: {fontWeight: 'bold', marginBottom: '4px'}}, item.uri),
                                    h('div', {style: {color: '#ff4d4f', fontSize: '13px'}},
                                        item.error.message || '无法连接或证书无效'
                                    )
                                ])
                            )
                        )
                    )
                ])
            });
        }

        getRecords();
    } catch (error) {
        message.error('添加失败：' + error.message);
    } finally {
        batchAddLoading.value = false;
    }
};

onMounted(() => {
    getRecords();
});
</script>

<template>
    <div class="monitor-container">
        <div class="header" :style="{ backgroundColor: token.colorBgElevated }">
            <a-space>
                <div class="title" :style="{ color: token.colorText }">
                    SSL监控
                </div>
                <div class="desc" :style="{ color: token.colorTextTertiary }">
                    监控证书到期时间
                </div>
            </a-space>
            <a-space>
                <a-input
                    v-model:value="searchText"
                    placeholder="搜索域名或备注"
                    allowClear
                    style="width: 140px"
                />
                <a-tooltip title="刷新">
                    <a-button @click="getRecords" :icon="h(SyncOutlined)"/>
                </a-tooltip>
                <a-tooltip title="批量删除">
                    <a-button :disabled="selectedRowKeys.length === 0" danger @click="batchDelete"
                              :icon="h(DeleteOutlined)"/>
                </a-tooltip>
                <a-tooltip title="更新SSL信息">
                    <a-button :disabled="selectedRowKeys.length === 0" @click="batchUpdate" :loading="loading"
                              :icon="h(MonitorOutlined)"/>
                </a-tooltip>
                <a-button type="primary" class="addBtn" @click="addNewSslMonitor">
                    监控新域名
                </a-button>
            </a-space>
        </div>
        <div class="content">
            <a-table :columns="columns" :data-source="filteredRecords" :pagination="false"
                     :row-selection="rowSelection" :row-key="record => record._id || record.id"
                     :scroll="{ y: 'calc(100vh - 60px)' }" :sticky="{ offsetHeader: 0 }" :loading="tableLoading">
                <template #emptyText>
                    <div class="empty-text">
                        <a-empty description="暂无监控域名"/>
                        <p>
                            域名列表页添加监控、或者解析记录页面添加监控
                        </p>
                        <p>
                            点击右上角按钮，添加监控域名
                        </p>
                    </div>
                </template>
                <template #bodyCell="{ column, record }">
                    <template v-if="column.key === 'uri'">
                        <a-space>
                            <a-tooltip v-if="record.is_wildcard" title="泛域名证书">
                                <TagOutlined style="color: #1890ff"/>
                            </a-tooltip>
                            {{ record.uri }}
                        </a-space>
                    </template>
                    <template v-if="column.key === 'remark'">
                        <div class="editable-cell">
                            <div v-if="editableData[record._id]" class="editable-cell-input-wrapper">
                                <a-input v-model:value="editableData[record._id].remark"
                                         @blur="saveRemark(record._id)"/>
                            </div>
                            <div v-else class="editable-cell-text-wrapper">
                                <a-tooltip title="点击编辑备注，回车保存">
                                    <span v-if="record.remark" @click="editRemark(record._id)">
                                        {{ record.remark }}
                                    </span>
                                    <!-- <span v-else class="editable-cell-icon">
                                        
                                    </span> -->
                                    <EditOutlined v-else class="editable-cell-icon" @click="editRemark(record._id)"/>
                                </a-tooltip>
                            </div>
                        </div>
                    </template>
                    <template v-if="column.key === 'address'">
                        {{ record.type }} / {{ record.address }}
                    </template>
                    <template v-if="column.key === 'expire_time'">
                        <a-tooltip :title="`截止日期: ${dayjs(record.expire_time).format('YYYY-MM-DD')}`">
                            <a-tag :color="getExpiryStatus(record.expire_time).color">
                                {{ getExpiryText(record.expire_time) }}
                            </a-tag>
                        </a-tooltip>
                    </template>
                    <template v-if="column.key === 'action'">
                        <a-space>
                            <a-tooltip title="更新SSL证书过期时间">
                                <a-button type="text" @click="updateSslRecord(record)">
                                    <template #icon>
                                        <MonitorOutlined/>
                                    </template>
                                </a-button>
                            </a-tooltip>
                            <a-tooltip title="申请证书" v-if="record.cloud">
                                <a-button type="text" @click="createSsl(record)">
                                    <template #icon>
                                        <SafetyCertificateOutlined/>
                                    </template>
                                </a-button>
                            </a-tooltip>
                            <a-button type="text" danger @click="deleteSslRecord(record)">
                                <template #icon>
                                    <DeleteOutlined/>
                                </template>
                            </a-button>
                        </a-space>
                    </template>
                </template>
            </a-table>
        </div>
    </div>

    <!-- 批量添加域名弹层 -->
    <a-modal
        v-model:open="batchAddVisible"
        title="批量添加监控域名"
        @ok="handleBatchAdd"
        :confirmLoading="batchAddLoading"
        width="500px"
    >
        <a-form layout="vertical">
            <a-form-item label="域名列表（每行一个，最多20个），支持非绑定域名">
                <a-textarea
                    v-model:value="batchDomains"
                    :rows="10"
                    placeholder="请输入要监控的域名，每行一个
例如：
example.com
sub.example.com"
                />
            </a-form-item>
        </a-form>
    </a-modal>
</template>

<style scoped lang="scss">
.monitor-container {
    height: 100vh;
    display: flex;
    flex-direction: column;
    width: calc(100vw - var(--menu-width, 49px));

    :global(.content-expanded) & {
        --menu-width: 130px;
    }

    .header {
        height: 60px;
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 0 16px;

        .title {
            font-size: 20px;
            font-weight: 500;
        }

        .desc {
            font-size: 12px;
        }

        border-bottom: 1px solid v-bind('token.colorBorderSecondary');

        :deep(.ant-input-affix-wrapper) {
            border-radius: 4px;
        }
    }

    .content {
        flex: 1;
        overflow: hidden;
    }
}

.editable-cell {
    position: relative;

    .editable-cell-input-wrapper,
    .editable-cell-text-wrapper {
        padding-right: 24px;
    }

    .editable-cell-text-wrapper {
        padding: 5px 24px 5px 5px;
    }

    .editable-cell-icon {
        width: 40px;
        cursor: pointer;
    }

    .editable-cell-icon {
        margin-top: 4px;
        display: none;
    }

    .editable-cell-icon:hover {
        color: #108ee9;
    }

    .editable-add-btn {
        margin-bottom: 8px;
    }
}

.editable-cell:hover .editable-cell-icon {
    display: inline-block;
}
</style>