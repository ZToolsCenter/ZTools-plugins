<script setup>
import {
    deleteDomainDb,
    getAllDomains,
    xcopyText,
    setDomainExpireTime,
    getFullDomainByItem
} from "@/utils/tool";
import {getCurrentInstance, onBeforeUnmount, onMounted, ref, h, computed, reactive} from "vue";
import {
    BarsOutlined,
    TableOutlined,
    AppstoreOutlined,
    MonitorOutlined,
    SettingOutlined,
    CopyOutlined,
    VerifiedOutlined,
    HistoryOutlined,
    DeleteOutlined,
    PlusOutlined,
} from "@ant-design/icons-vue";
import {message, theme, Modal} from 'ant-design-vue';
import AddDomain from "@/components/AddDomain.vue";
import DomainRecords from "@/components/DomainRecords.vue";
import dayjs from 'dayjs';
import 'dayjs/locale/zh-cn';

dayjs.locale('zh-cn');
import {useThemeStore} from '@/stroes/themeStore.js';
import {getDnsService} from "@/service/DnsService";
import {batchAddSslMonitorLogic} from "@/utils/sslMonitor";

const themeStore = useThemeStore();
const config = computed(() => themeStore.config);
const allDomains = ref([]);

const viewMode = computed(() => config.value.domainListView);
const {useToken} = theme;
const {token} = useToken();
const refreshDomain = () => {
    allDomains.value = getAllDomains();
}

const chooseDomain = (item) => {
    currentDomain.value = item;
    recordsDrawerVisible.value = true;
}

const handleDrawerClose = () => {
    recordsDrawerVisible.value = false;
    refreshDomain();
}

const deleteDomain = (item) => {
    Modal.confirm({
        title: '删除域名',
        content: h('div', {}, [
            '确定删除 ', h('span', {style: {color: token.value.colorPrimary}}, item.domain), ' 吗？',
            h('p', {}, '从插件上删除，不影响其它内容')
        ]),
        onOk: () => {
            deleteDomainDb(item.cloud, item.domain)
            refreshDomain()
            message.success("操作成功")
        },
        cancelText: '取消',
        okText: '确定'
    })
}

const {proxy} = getCurrentInstance();

onMounted(() => {
    refreshDomain()
    proxy.$eventBus.on("refresh-domain-list", refreshDomain)
})

onBeforeUnmount(() => {
    proxy.$eventBus.off("refresh-domain-list", refreshDomain)
})

const addDomainModal = ref(null)
const openAddDomain = () => {
    if (addDomainModal.value) {
        addDomainModal.value.openModal()
    }
}

const sslApply = (item) => {
    proxy.$eventBus.emit("open-ssl-apply", {
        domain: item.domain,
        sub: "*",
        cloud: item.cloud,
        account_key: item.account_key
    })
}

const monitorDomain = (item) => {
    Modal.confirm({
        title: 'SSL监控',
        content: h('div', {}, [
            h('p', {}, '自动获取该域名下的所有解析'),
            h('p', {}, '为可监控的地址增加SSL证书监控'),
        ]),
        okText: '一键监控',
        cancelText: '点错了',
        onOk: async () => {
            const hide = message.loading('正在获取解析记录', 0);
            const dns = getDnsService(item.account_key, item.cloud, item.account_info.tokens);
            dns.listRecords(item.domain).then(r => {
                r = r.list.filter(r => ['A', 'CNAME', 'AAAA'].includes(r.Type));
                if (r.length === 0) {
                    message.error('未获取到可监控的解析记录');
                    return;
                }
                batchAddSslMonitorLogic(r.map(record => {
                    return {
                        uri: getFullDomainByItem(record),
                        type: record.Type,
                        address: record.Value,
                        domain: record.Domain,
                        remark: record.Remark,
                        cloud: item.cloud,
                        account_key: item.account_key
                    }
                }))
            }).catch(e => {
                message.error('获取解析记录失败');
                console.error(e);
            }).finally(() => {
                hide();
            })
        }
    })
}

// 切换视图模式
const toggleViewMode = () => {
    const newMode = viewMode.value === 'card' ? 'table' : 'card';
    themeStore.updateConfig({
        domainListView: newMode
    });
};

// 表格列定义
const columns = [
    {
        title: '云服务商',
        key: 'cloud',
        width: 100,
        dataIndex: 'cloud'
    },
    {
        title: '账号',
        dataIndex: ['account_info', 'tag'],
        key: 'account',
        width: 120,
    },
    {
        title: '域名',
        dataIndex: 'domain',
        key: 'domain',
        ellipsis: true
    },
    {
        title: '过期时间',
        key: 'expire_time',
        align: 'center',
        width: 150,
    },
    {
        title: '操作',
        align: 'center',
        key: 'action',
        width: 120,
    }
];
const openLink = (link) => {
    utools.shellOpenExternal(link);
}

// 添加表格容器引用
const tableContainer = ref(null);

// 监听菜单折叠状态变化
onMounted(() => {
    refreshDomain();
    proxy.$eventBus.on("refresh-domain-list", refreshDomain);
});

onBeforeUnmount(() => {
    proxy.$eventBus.off("refresh-domain-list", refreshDomain);
});

// 添加 breakpoint 处理
const onBreakpoint = (broken) => {
    // 延迟执行以确保 DOM 更新完成
    setTimeout(updateTableLayout, 100);
};

const expireTimeModalVisible = ref(false);
const currentDomain = ref(null);
const expireDate = ref(null);
const renewLink = ref('');

const showExpireTimeModal = (record) => {
    currentDomain.value = record;
    expireDate.value = record.expire_time ? dayjs(record.expire_time) : null;
    renewLink.value = record.renew_link || '';
    expireTimeModalVisible.value = true;
};

const handleExpireTimeSubmit = () => {
    if (!currentDomain.value) return;

    if (!expireDate.value) {
        message.error('请设置过期时间');
        return;
    }

    // 如果续期链接为空，则不保存续期链接
    if (!renewLink.value) {
        renewLink.value = '';
    }
    // 如果存在续费连接 则判断是否为有效连接
    if (renewLink.value) {
        // 使用正则判断是否为有效连接 支持 http https 两种协议
        if (!/^(https?:\/\/)?(([a-zA-Z0-9-]+\.)+[a-zA-Z]{2,})(:\d+)?(\/\S*)?$/.test(renewLink.value)) {
            return message.error('续期链接无效');
        }
    }

    // 保存过期时间
    if (expireDate.value) {
        setDomainExpireTime(`${currentDomain.value.cloud}/${currentDomain.value.domain}`, expireDate.value.format('YYYY-MM-DD'), renewLink.value);
    }

    refreshDomain();
    message.success('设置成功');
    expireTimeModalVisible.value = false;
};

// 添加计算剩余天数的函数
const calculateRemainingDays = (expireTime) => {
    if (!expireTime) return null;
    const today = dayjs();
    const expireDate = dayjs(expireTime);
    return expireDate.diff(today, 'day');
};

// 获取过期时间显示文本
const getExpireTimeDisplay = (expireTime) => {
    const days = calculateRemainingDays(expireTime);
    if (days === null) return '未设置';
    // 如果剩余天数小于等于0 则显示已过期
    if (days <= 0) return `已过期 ${Math.abs(days)} 天`;
    return `${days} 天`;
};

// 获取过期时间的样式
const getExpireTimeStyle = (expireTime) => {
    const days = calculateRemainingDays(expireTime);
    if (days === null) return {};
    return {
        color: days <= 30 ? '#ff4d4f' : token.value.colorTextLabel
    };
};

const recordsDrawerVisible = ref(false);

// 抽屉显示状态变化后的回
const afterDrawerVisibleChange = (visible) => {
    if (!visible) {
        // 抽屉关闭后可能需要刷新域名列表
        refreshDomain();
    }
}

// 添加筛选表单数据
const searchForm = reactive({
    domain: '',
    account: undefined
});

// 获取所有账号列表（去重）
const accountList = computed(() => {
    const accounts = allDomains.value.map(item => ({
        value: item.account_info.tag,
        label: `${item.cloud_info.title}-${item.account_info.tag}`
    }));
    return [...new Map(accounts.map(item => [item.value, item])).values()];
});

// 筛选后的域名列表
const filteredDomains = computed(() => {
    return allDomains.value.filter(item => {
        const domainMatch = item.domain.toLowerCase().includes(searchForm.domain.toLowerCase());
        const accountMatch = !searchForm.account || item.account_info.tag === searchForm.account;
        return domainMatch && accountMatch;
    });
});
</script>

<template>
    <div class="box">
        <div class="header" :style="{ backgroundColor: token.colorBgElevated }">
            <a-space>
                <div class="title" :style="{ color: token.colorText }">
                    域名列表
                </div>
                <div class="desc" :style="{ color: token.colorTextTertiary }">
                    <!--                    多平台多账号多域名一站式解析管理及ssl证书申请工具-->
                </div>
            </a-space>
            <a-space>
                <!-- 添加筛选控件 -->
                <a-input-search
                    v-model:value="searchForm.domain"
                    placeholder="搜索域名"
                    style="width: 180px"
                    allow-clear
                />
                <a-select
                    v-model:value="searchForm.account"
                    style="width: 160px"
                    placeholder="选择账号"
                    allow-clear
                >
                    <a-select-option v-for="item in accountList" :key="item.value" :value="item.value">
                        {{ item.label }}
                    </a-select-option>
                </a-select>
                <a-divider type="vertical"/>
                <a-button type="default" @click="toggleViewMode">
                    <template #icon>
                        <TableOutlined v-if="viewMode === 'card'"/>
                        <AppstoreOutlined v-else/>
                    </template>
                </a-button>
                <a-tooltip title="绑定新域名">
                    <a-button type="primary" class="addBtn" @click="openAddDomain" :icon="h(PlusOutlined)"></a-button>
                </a-tooltip>
            </a-space>
        </div>
        <template v-if="filteredDomains.length">
            <!-- 卡片视图 -->
            <div v-if="viewMode === 'card'" class="cards_box">
                <a-card v-for="(i, index) in filteredDomains" :key="index" size="small" hoverable :bordered="true"
                        @click="chooseDomain(i)">
                    <template #title>
                        <a-flex align="center" justify="space-between" style="padding: 10px 0;height: 50px;" gap="10">
                            <a-space>
                                <img :src="i.cloud_info.icon" alt="" style="height: 17px;">
                                <a-typography-text v-if="i.cloud_info.name">{{ i.cloud_info.name }}</a-typography-text>
                            </a-space>
                            <span class="account-tag">
                                {{ i.account_info.tag }}
                            </span>
                        </a-flex>
                    </template>
                    <div class="domainBox">
                        <div class="info-row">
                            <div class="domain-wrapper">
                                <span class="domain_title">{{ i.domain }}</span>
                                <CopyOutlined @click.stop="xcopyText(i.domain)" class="copy-btn"/>
                            </div>
                        </div>
                        <div class="info-row" style="height: 30px;">
                            <div @click.stop="showExpireTimeModal(i)">
                                <span class="label">有效期</span>
                                <a-tooltip :title="i.expire_time ? `过期时间：${i.expire_time}` : '未设置过期时间'">
                                    <!-- <a-button type="ghost" size="small" @click.stop="showExpireTimeModal(i)"
                                        :style="getExpireTimeStyle(i.expire_time)" class="expire-btn">
                                        {{ getExpireTimeDisplay(i.expire_time) }}
                                        <SettingOutlined v-if="!i.expire_time" />
                                    </a-button> -->
                                    <a-space :size="2" style="margin-left: 10px;">
                                        <span class="label" :style="getExpireTimeStyle(i.expire_time)">{{
                                                getExpireTimeDisplay(i.expire_time)
                                            }}</span>
                                        <SettingOutlined :style="{ color: token.colorTextLabel }" v-if="!i.expire_time"
                                                         style="font-size: 12px;"/>
                                    </a-space>
                                </a-tooltip>
                            </div>
                            <a-button class="hover_show" v-if="i.renew_link" type="link" size="small"
                                      @click.stop="openLink(i.renew_link)">
                                域名续期
                            </a-button>
                        </div>
                    </div>
                    <template #actions>
                        <DeleteOutlined @click.stop="deleteDomain(i)" key="setting"/>
                        <a-tooltip title="证书申请">
                            <VerifiedOutlined @click.stop="sslApply(i)" key="edit"/>
                        </a-tooltip>
                        <a-tooltip title="监控SSL证书">
                            <MonitorOutlined @click.stop="monitorDomain(i)" key="edit"/>
                        </a-tooltip>
                        <a-tooltip title="解析记录">
                            <BarsOutlined key="ellipsis"/>
                        </a-tooltip>
                    </template>
                </a-card>
            </div>

            <!-- 表格视图 -->
            <div class="table_box" v-if="viewMode === 'table'">
                <a-table :columns="columns" :data-source="filteredDomains" :pagination="false"
                         :row-key="record => record.id"
                         :scroll="{ y: 'calc(100vh - 118px)' }" :sticky="{ offsetHeader: 0 }" @row-click="chooseDomain">
                    <template #bodyCell="{ column, record }">
                        <template v-if="column.key === 'cloud'">
                            <div style="text-align: center">
                                <img :src="record.cloud_info.icon" alt="" style="height: 17px;">
                            </div>
                        </template>
                        <template v-else-if="column.key === 'expire_time'">
                            <a-tooltip
                                :title="record.expire_time ? `过期时间：${record.expire_time}` : '请设置过期时间，便于提醒'">
                                <a-button type="ghost" @click.stop="showExpireTimeModal(record)"
                                          :style="getExpireTimeStyle(record.expire_time)">
                                    {{ getExpireTimeDisplay(record.expire_time) }}
                                    <SettingOutlined v-if="!record.expire_time"/>
                                </a-button>
                            </a-tooltip>
                        </template>
                        <template v-else-if="column.key === 'domain'">
                            <a-space>
                                <span class="domain-text" @click.stop="xcopyText(record.domain)">{{
                                        record.domain
                                    }}</span>
                            </a-space>
                        </template>
                        <template v-else-if="column.key === 'action'">
                            <a-dropdown-button @click.stop="chooseDomain(record)">
                                <a-space size="small" style="font-size: 14px;">
                                    <BarsOutlined/>
                                </a-space>
                                <template #overlay>
                                    <a-menu>
                                        <a-menu-item key="ssl" @click.stop="sslApply(record)">
                                            <a-space size="small">
                                                <VerifiedOutlined/>
                                                申请证书
                                            </a-space>
                                        </a-menu-item>
                                        <a-menu-item key="monitor" @click.stop="monitorDomain(record)">
                                            <a-space size="small">
                                                <MonitorOutlined/>
                                                监控SSL
                                            </a-space>
                                        </a-menu-item>
                                        <a-menu-item v-if="record.renew_link" key="renew"
                                                     @click.stop="openLink(record.renew_link)">
                                            <a-space size="small">
                                                <HistoryOutlined/>
                                                域名续期
                                            </a-space>
                                        </a-menu-item>
                                        <a-menu-divider/>
                                        <a-menu-item key="delete" danger @click.stop="deleteDomain(record)">
                                            <a-space size="small">
                                                <DeleteOutlined/>
                                                删除域名
                                            </a-space>
                                        </a-menu-item>
                                    </a-menu>
                                </template>
                            </a-dropdown-button>
                        </template>
                    </template>
                </a-table>
            </div>
        </template>

        <a-empty style="margin-top: 20vh;" v-else>
            <template #description>
                <p :style="{ color: token.colorTextTertiary }">
                    {{ allDomains.length ? '未找到匹配的域名' : '暂未绑定域名' }}
                </p>
                <a-button type="primary" @click="openAddDomain">绑定新域名</a-button>
            </template>
        </a-empty>

        <add-domain ref="addDomainModal"></add-domain>

        <a-modal v-model:open="expireTimeModalVisible" title="设置域名过期时间" @ok="handleExpireTimeSubmit"
                 :maskClosable="false" destroyOnClose width="400px" cancel-text="取消" ok-text="保存">
            <div style="padding: 20px 0;">
                <a-form layout="horizontal">
                    <a-form-item label="当前域名">
                        <span :style="{ color: token.colorPrimary }">{{ currentDomain?.domain }}</span>
                    </a-form-item>
                    <a-form-item label="过期时间">
                        <a-date-picker lang="zh" v-model:value="expireDate" style="width: 100%"
                                       :placeholder="'请选择过期时间'"
                                       format="YYYY-MM-DD"/>
                    </a-form-item>
                    <a-form-item label="续期链接">
                        <a-input v-model:value="renewLink" placeholder="请输入域名续期链接"/>
                    </a-form-item>
                </a-form>
            </div>
        </a-modal>

        <!-- 域名记录抽屉 -->
        <a-drawer v-model:open="recordsDrawerVisible" :closable="false" :width="'100vw'" placement="right"
                  @afterOpenChange="afterDrawerVisibleChange" :destroyOnClose="true" :bodyStyle="{ padding: 0 }">
            <domain-records v-if="recordsDrawerVisible" :domain-info="currentDomain" @refresh="refreshDomain"
                            @close="handleDrawerClose" @choose-domain="chooseDomain"/>
        </a-drawer>
    </div>
</template>

<style scoped lang="less">
.domainBox {
    display: flex;
    flex-direction: column;
    justify-content: space-evenly;
    // height: 80px;
    padding: 0 10px;
    width: 100%;

    .info-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        width: 100%;


        .label {
            font-size: 12px;
            color: v-bind('token.colorTextLabel');
            // width: 50px;
            flex-shrink: 0;
            // margin-right: 4px;
        }

        .domain-wrapper {
            display: flex;
            align-items: center;
            justify-content: space-between;
            flex: 1;
            width: 100%;
            gap: 8px;

            .domain_title {
                font-size: 16px;
                font-weight: 500;
                color: v-bind('token.colorText');
                overflow: hidden;
                text-overflow: ellipsis;
                white-space: nowrap;
                flex: 1;
                min-width: 0;
            }

            .copy-btn {
                color: v-bind('token.colorTextSecondary');
                width: 24px;
                height: 24px;
                display: flex;
                align-items: center;
                justify-content: center;
                font-size: 13px !important;
                cursor: pointer;
                transition: color 0.3s;
                flex-shrink: 0;

                &:hover {
                    color: v-bind('token.colorPrimary');
                }
            }
        }

        .hover_show {
            display: none;
            font-size: 12px;
        }

        .expire-btn {
            padding: 0;
            height: 22px;
            font-size: 13px;
        }
    }
}

.box {
    height: 100vh;
    box-sizing: border-box;
    display: flex;
    flex-direction: column;
    overflow: hidden;

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

        border-bottom: 1px dashed v-bind('token.colorBorder');

        :deep(.ant-input-search) {
            .ant-input {
                background-color: v-bind('token.colorBgContainer');
            }
        }

        :deep(.ant-select) {
            .ant-select-selector {
                background-color: v-bind('token.colorBgContainer');
            }
        }
    }

    .cards_box {
        padding: 16px;
        height: calc(100vh - 60px);
        display: grid;
        overflow: auto;
        grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
        grid-auto-rows: 182px;
        gap: 16px;
        max-width: 100%;
        justify-content: center;

        // 当只有一个卡片时限制宽度和高度
        &:has(> :only-child) {
            display: flex;
            justify-content: flex-start;
            align-items: flex-start;

            :deep(.ant-card) {
                width: 45%;
                height: 182px;
                flex-shrink: 0;
            }
        }

        // 屏幕较小时自动适应
        @media screen and (max-width: 1000px) {
            grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
        }

        // 当菜单展开时自适应列数和宽度
        :global(.content-expanded) & {
            grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
        }

        .bottom_btn {
            font-size: 12px;
        }
    }

    .table_box {
        flex: 1;
        position: relative;
        overflow: hidden;
        box-sizing: border-box;
        width: calc(100vw - var(--menu-width, 48px));

        .domain-text {
            cursor: pointer;
            transition: color 0.3s;

            &:hover {
                color: v-bind('token.colorPrimary');
            }
        }

        :global(.content-expanded) & {
            --menu-width: 130px;
        }
    }
}

:deep(.ant-card) {
    &:hover {
        .hover_show {
            display: block;
        }
    }
}

.account-tag {
    font-size: 12px;
    padding: 1px 8px;
    border-radius: 4px;
    border: 1px solid v-bind('token.colorBorder');
    color: v-bind('token.colorTextSecondary');
    background: v-bind('token.colorBgContainer');
    transition: all 0.3s;

    &:hover {
        color: v-bind('token.colorPrimary');
        border-color: v-bind('token.colorBorderSecondary');
    }
}
</style>