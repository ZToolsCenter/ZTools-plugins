<script setup>
import {message, Modal, theme, notification} from "ant-design-vue";
import {computed, h, onMounted, onBeforeUnmount, reactive, ref, getCurrentInstance, watch} from "vue";
import {
    DownloadOutlined,
    SyncOutlined,
    DeleteOutlined,
    KeyOutlined,
    CopyOutlined,
    ExclamationCircleOutlined,
    CloudUploadOutlined,
    HistoryOutlined,
    RetweetOutlined,
    VerifiedOutlined,
    InfoCircleOutlined
} from "@ant-design/icons-vue";
import {
    getAllDomains,
    getAllSslInfo,
    xcopyText,
    exportSSL,
    getSomeSsl
    , getItem, getRootDomain, parseCertificate
} from "@/utils/tool";
import {debounce} from 'lodash-es';
import {useRouter, useRoute} from 'vue-router';
import {SSL_STATUS, getStatusText, getStatusColor, getAllDoingSslRecord} from '@/utils/sslStatus'
import {getDnsService} from "@/service/DnsService";

const {useToken} = theme;
const {token} = useToken()
const allDomains = ref([{domain: ""}]);
const allSslInfo = ref([])

const allDoingSsl = ref([])

const emit = defineEmits(['refresh-domain', 'init-domain', 'close-domain', 'openapi']);
const count = ref(0)
const loading = ref(false)
const refreshRecords = () => {
    loading.value = true
    allSslInfo.value = getAllSslInfo()
    allDomains.value = getAllDomains()
    allDoingSsl.value = getAllDoingSslRecord()
    setTimeout(() => {
        count.value = allSslInfo.value.length
        loading.value = false
    }, 500)
}

const clearExpired = () => {
    const list = getSomeSsl(0)
    if (list.length === 0) {
        message.info("暂无过期证书")
        return false
    }
    // 弹窗确认
    Modal.confirm({
        title: '清理过期证书',
        icon: h(ExclamationCircleOutlined),
        content: h('div', null, [
            h('div', null, '确认清理以下证书么？'),
            list.map(item => {
                return h('div', {style: {}}, item.subdomain)
            })
            , h('div', {style: {marginTop: '10px', color: '#f03e3e'}}, '清理后无法恢复，请谨慎操作')],
        ),
        okText: '确认',
        cancelText: '取消',
        onOk: () => {
            list.forEach(item => {
                utools.dbStorage.removeItem(item._id)
            })
            refreshRecords()
            message.success("清理成功")
        },
    });
}
onMounted(() => {
    refreshRecords()
})

const deleteNowRecord = reactive({
    subdomain: "",
    _id: ""
})

const deleteRecordDo = () => {
    utools.dbStorage.removeItem(deleteNowRecord._id)
    refreshRecords()
    message.success("删除成功")
}
const deleteRecord = (record) => {
    deleteNowRecord.subdomain = record.subdomain
    deleteNowRecord._id = record._id
    Modal.confirm({
        title: '删除证书',
        icon: h(ExclamationCircleOutlined),
        content: h('div', null, [
            h('span', null, '确认删除证书'),
            h('span', {style: {color: '#f03e3e', marginLeft: '10px'}}, record.subdomain),
            h('span', null, ' 吗？')
            , h('div', {style: {marginTop: '10px', color: '#f03e3e'}}, '删除后无法恢复，请谨慎操作')],
        ),
        okText: '确认',
        cancelText: '取消',
        onOk: deleteRecordDo,
    });
}


const searchForm = reactive({
    domain: null,
    keyword: ""
})

const calcRecords = computed(() => {
    return (allSslInfo.value || []).filter(item => {
        const domainMatch = !searchForm.domain || item.domain === searchForm.domain;
        const keywordMatch = !searchForm.keyword || item.subdomain.toLowerCase().includes(searchForm.keyword.toLowerCase());
        return domainMatch && keywordMatch;
    })
})

const calcDoingRecords = computed(() => {
    return allDoingSsl.value || []
})
defineExpose({
    refreshRecords
})


const columns = [
    {
        title: '域名',
        dataIndex: 'subdomain',
        key: 'subdomain',
        fixed: "left",
    },
    {
        title: '生效时间',
        dataIndex: 'validFrom',
        key: 'validFrom',
        width: 160,
    },
    {
        title: '截止时间',
        dataIndex: 'validTo',
        key: 'validTo',
        width: 160,
    },
    {
        title: '操作',
        key: 'operation',
        fixed: 'right',
        width: 120,
    }
];


const doingColumns = [
    {
        title: '域名',
        dataIndex: 'subdomain',
        key: 'subdomain',
        fixed: "left",
    },
    {
        title: '状态',
        dataIndex: 'status',
        key: 'status',
        width: 120,
    },
    {
        title: '截止时间',
        dataIndex: 'expires',
        key: 'expires',
    },
    {
        title: '操作',
        key: 'operation',
        fixed: 'right',
        width: 160,
    }
];

// 使用计算属性 获取body的高度
const xbody = ref(null)
const height = ref(0);
let resizeObserver = null;
const updateHeight = debounce(() => {
    if (xbody.value) {
        height.value = xbody.value.clientHeight - 56;
    }
}, 100);
const {proxy} = getCurrentInstance();
onMounted(() => {
    resizeObserver = new ResizeObserver(updateHeight);
    if (xbody.value) {
        resizeObserver.observe(xbody.value);
        updateHeight(); // 初始化时获取一次高度
    }
    proxy.$eventBus.on("refresh-ssl-list", refreshRecords)
});
onBeforeUnmount(() => {
    if (resizeObserver && xbody.value) {
        resizeObserver.unobserve(xbody.value);
    }
    proxy.$eventBus.off("refresh-ssl-list", refreshRecords)
});

const backCards = () => {
    emit("openapi", "list")
}
const timestamp2Date = (timestamp) => {
    return new Date(timestamp).toLocaleString().replaceAll("/", "-")
}

const getValidaDays = (timestamp) => {
    return Math.floor((timestamp - Date.now()) / 1000 / 60 / 60 / 24)
}


const fixTargetDomains = (record) => {
    // 获取全部根域名
    // 获取全部根域名
    let RootDomains = [...new Set(record.subdomain.split(",").map(i => getRootDomain(i)))];

    let targetDomainsCloud = {}

    for (let rdomain of RootDomains) {
        const clouds = allDomains.value.filter(i => i.domain === rdomain);
        if (clouds.length > 1) {
            Modal.warning({
                title: '续签证书',
                content: h('div', null, [
                    h('div', null, '检测到多个云平台绑定了该域名'),
                    h('div', {style: {color: '#f03e3e', fontSize: '16px'}}, rdomain),
                    h('div', null, ' 请先清除无效的绑定')
                ]),
                okText: '知道了',
            });
            return false;
        }
        if (clouds.length === 0) {
            Modal.warning({
                title: '续签证书',
                content: h('div', null, [
                    h('div', null, '域名已被删除'),
                    h('div', {style: {color: '#f03e3e', fontSize: '16px'}}, rdomain),
                    h('div', null, ' 请先绑定域名')
                ]),
                okText: '知道了',
            });
            return false;
        }
        targetDomainsCloud[rdomain] = clouds[0].cloud
    }

    return record.subdomain.split(",").map(i => {
        const rdomain = getRootDomain(i)
        return {
            sub: i === rdomain ? "@" : i.replace(`.${rdomain}`, ""),
            domain: rdomain,
            cloud: targetDomainsCloud[rdomain]
        }
    })
}
const handleMenuClick = (key, record) => {
    if (key === 'pushSSL') {
        proxy.$eventBus.emit("open-ssl-push", record)
    } else if (key === 'copyCert') {
        xcopyText(record.cert, '证书复制成功')
    } else if (key === 'copyKey') {
        xcopyText(record.key, '私钥复制成功')
    } else if (key === 'deleteSSL') {
        deleteRecord(record)
    } else if (key === 'renew') {
        // 根据域名， 获取云平台， 要判断是否有多个平台绑定了同一个域名，如果有，需要提示，清楚无效的
        const targetDomains = fixTargetDomains(record)
        if (!targetDomains) {
            return
        }
        // 拼装 domains {sub， domain, cloud}
        proxy.$eventBus.emit("open-ssl-renew", {
            targetDomains,
            key: record.key,
            csr: record.csr
        })
    } else if (key === 'new') {
        const targetDomains = fixTargetDomains(record)
        if (!targetDomains) {
            return
        }
        // 拼装 domains {sub， domain, cloud}
        proxy.$eventBus.emit("open-ssl-renew", {
            targetDomains,
        })
    } else if (key === 'xdetail') {
        const certInfo = parseCertificate(record.cert);
        proxy.$eventBus.emit("open-ssl-detail", certInfo);
    }
}

const router = useRouter();

// 修改申请证书跳转
const handleApply = () => {
    proxy.$eventBus.emit("open-ssl-apply", [])
}

// 修改返回处理
const handleBack = () => {
    router.push({name: 'DomainList'});
}

const verifyDns = async (record) => {
    proxy.$eventBus.emit("verifyDNS", {
        sslId: record._id,
        isOld: true,
        callback: () => {
            setTimeout(() => {
                showMode.value = "success";
                refreshRecords();
            }, 1000)
        }
    });
};

const verifyChallenge = async (record) => {
    proxy.$eventBus.emit("verifyACME", {
        sslId: record._id,
        isOld: true,
        callback: () => {
            setTimeout(() => {
                showMode.value = "success";
                refreshRecords();
            }, 1000)
        }
    });
};

const reApply = async (record) => {
    // 删除旧的申请记录
    utools.dbStorage.removeItem(record._id);

    // 重新打开申请窗口，使用原记录的信息
    proxy.$eventBus.emit("open-ssl-apply", {
        domain: record.formDomains[0].domain,
        sub: record.formDomains[0].sub,
        cloud: record.formDomains[0].cloud,
        account_key: record.formDomains[0].account_key
    });
};

const showMode = ref("success")

// 添加路由参数监听
const route = useRoute();
watch(() => route.query.mode, (newMode) => {
    if (newMode === 'doing' || newMode === 'success') {
        showMode.value = newMode;
    }
}, {immediate: true});


watch(() => route.query.ssl, (sslId) => {
    if (sslId) {
        refreshRecords();
        const ssl = allSslInfo.value.find(i => i._id === sslId);
        const t = fixTargetDomains(ssl)
        proxy.$eventBus.emit("open-ssl-renew", {
            targetDomains: t,
            key: ssl.key,
            csr: ssl.csr
        })
    }
}, {immediate: true});


// 监听显示模式变化
watch(() => showMode.value, (newMode) => {
    refreshRecords()
}, {immediate: true});

const deleteApplyRecord = async (record) => {
    Modal.confirm({
        title: '删除申请记录',
        icon: h(ExclamationCircleOutlined),
        content: h('div', null, [
            h('div', null, '确认删除以下域名的申请记录吗？'),
            record.domains.map(item => {
                return h('div', {style: {color: '#f03e3e'}}, item)
            })
            , h('div', {style: {marginTop: '10px', color: '#f03e3e'}}, '删除后无法恢复，请谨慎操作')],
        ),
        okText: '确认',
        cancelText: '取消',
        onOk: async () => {
            try {
                loading.value = true;
                // 删除 DNS 记录
                for (const domain of record.formDomains) {

                    const account_key = record.domainCloud[domain.domain];
                    const dnsServiceInfo = getItem(account_key);
                    const dns = getDnsService(account_key, domain.cloud, dnsServiceInfo.tokens);
                    for (const challenge of record.challenges) {
                        if (challenge.domain.endsWith(`.${domain.domain}`)) {
                            await dns.deleteAcmeRecord(domain.domain, challenge.domain);
                        }
                    }
                }
                // 删除申请记录
                utools.dbStorage.removeItem(record._id);
                refreshRecords();
                message.success("删除成功");
            } catch (error) {
                notification.error({
                    message: "删除失败",
                    description: error.toString(),
                    duration: 10
                });
            } finally {
                loading.value = false;
            }
        },
    });
}
</script>

<template>
    <div class="box">
        <a-flex class="header" :style="{ backgroundColor: token.colorBgElevated }" justify="space-between">
            <a-flex align="center" gap="10">
                <a-radio-group button-style="outline" v-model:value="showMode">
                    <a-radio-button value="success">
                        已完成
                    </a-radio-button>
                    <a-radio-button value="doing">
                        申请中
                    </a-radio-button>
                </a-radio-group>
                <a-button type="primary" @click="handleApply">
                    <VerifiedOutlined/>
                    申请
                </a-button>

            </a-flex>
            <a-space v-if="showMode === 'success'">
                <a-input
                    v-model:value="searchForm.keyword"
                    placeholder="证书检索"
                    style="width: 120px;"
                    allow-clear
                />
                <a-select v-model:value="searchForm.domain" allow-clear placeholder="所属域名" style="width: 140px;">
                    <a-select-option v-for="(i, index) in allDomains" :key="index" :value="i.domain">{{
                            i.domain
                        }}
                    </a-select-option>
                </a-select>
                <a-button :icon="h(SyncOutlined)" @click="refreshRecords"></a-button>
                <a-tooltip title="清理过期证书">
                    <a-button danger :icon="h(DeleteOutlined)" @click="clearExpired"></a-button>
                </a-tooltip>
            </a-space>
            <a-space v-if="showMode === 'doing'">
                <a-button :icon="h(SyncOutlined)" @click="refreshRecords"></a-button>
            </a-space>
        </a-flex>
        <div class="body" ref="xbody">
            <a-table v-if="'success' === showMode" :locale="{ emptyText: '暂无申请记录' }" sticky
                     :style="`height: ${height + 56}px`"
                     :scroll="{ y: height }" :pagination="false" :row-key="record => record.RecordId" :loading="loading"
                     :columns="columns" :data-source="calcRecords">

                <template #headerCell="{ column }">
                    <template v-if="column.key === 'operation'">
                        <a-flex justify="center" align="center">操作</a-flex>
                    </template>
                </template>

                <template #bodyCell="{ column, record }">
                    <template v-if="column.key === 'subdomain'">
                        <div class="name">
                            <a-space direction="vertical" :gap="4">
                                <template
                                    v-for="(i, index) in record.subdomain.split(',')" :key="index">
                                    <a-tag @click.stop="xcopyText(i, '域名复制成功')" v-if="index === 0" color="green">主
                                        {{ i }}
                                    </a-tag>
                                    <a-tag @click.stop="xcopyText(i, '域名复制成功')" v-else color="blue">备 {{
                                            i
                                        }}
                                    </a-tag>
                                </template>
                            </a-space>
                        </div>
                    </template>
                    <template v-if="column.key === 'validFrom'">
                        <div class="x-width">
                            {{ timestamp2Date(record.validFrom) }}
                        </div>
                    </template>
                    <template v-if="column.key === 'validTo'">
                        <div class="x-width">
                            <a-space size="small" direction="vertical">
                                <span>{{ timestamp2Date(record.validTo) }}</span>
                                <template v-if="getValidaDays(record.validTo) > 10">
                                    <span class="validaDays">剩余 <span style="color: #2ecc71">{{
                                            getValidaDays(record.validTo)
                                        }}</span> 天</span>
                                </template>
                                <template
                                    v-else-if="getValidaDays(record.validTo) <= 10 && getValidaDays(record.validTo) >= 0">
                                    <span class="validaDays">剩余 <span style="color: #f03e3e">{{
                                            getValidaDays(record.validTo)
                                        }}</span> 天</span>
                                </template>
                                <template v-else>
                                    <span style="color: #f03e3e">已过期</span>
                                </template>
                            </a-space>
                        </div>
                    </template>
                    <template v-if="column.key === 'status'">
                        <a-tag :color="getStatusColor(record.status)">
                            {{ getStatusText(record.status) }}
                        </a-tag>
                    </template>
                    <template v-if="column.key === 'operation'">
                        <a-flex justify="center" align="center">
                            <a-dropdown-button @click.stop="exportSSL(record)">
                                <a-space size="small" style="font-size: 14px;">
                                    <DownloadOutlined/>
                                </a-space>
                                <template #overlay>
                                    <a-menu @click="({ key }) => handleMenuClick(key, record)">
                                        <a-menu-item key="pushSSL">
                                            <a-space size="small">
                                                <CloudUploadOutlined/>
                                                推送证书
                                            </a-space>
                                        </a-menu-item>
                                        <a-menu-item key="copyCert">
                                            <a-space size="small">
                                                <CopyOutlined/>
                                                复制证书
                                            </a-space>
                                        </a-menu-item>
                                        <a-menu-item key="copyKey">
                                            <a-space size="small">
                                                <KeyOutlined/>
                                                复制私钥
                                            </a-space>
                                        </a-menu-item>
                                        <a-menu-item key="new">
                                            <a-space size="small">
                                                <RetweetOutlined/>
                                                重新申请
                                            </a-space>
                                        </a-menu-item>
                                        <a-menu-item key="renew">
                                            <a-space size="small">
                                                <HistoryOutlined/>
                                                续签证书
                                            </a-space>
                                        </a-menu-item>
                                        <a-menu-item key="xdetail">
                                            <a-space size="small">
                                                <InfoCircleOutlined/>
                                                证书详情
                                            </a-space>
                                        </a-menu-item>
                                        <a-menu-item key="deleteSSL" danger>
                                            <a-space size="small">
                                                <DeleteOutlined/>
                                                删除证书
                                            </a-space>
                                        </a-menu-item>
                                    </a-menu>
                                </template>
                            </a-dropdown-button>
                        </a-flex>
                    </template>
                </template>
            </a-table>
            <a-table v-if="'doing' === showMode" :locale="{ emptyText: '暂无申请记录' }" sticky
                     :style="`height: ${height + 56}px`"
                     :scroll="{ y: height }" :pagination="false" :row-key="record => record.RecordId" :loading="loading"
                     :columns="doingColumns" :data-source="calcDoingRecords">

                <template #headerCell="{ column }">
                    <template v-if="column.key === 'operation'">
                        <a-flex justify="center" align="center">操作</a-flex>
                    </template>
                </template>

                <template #bodyCell="{ column, record }">
                    <template v-if="column.key === 'subdomain'">
                        <div>
                            <div v-for="i in record.domains" :key="i">{{ i }}</div>
                        </div>
                    </template>
                    <template v-if="column.key === 'validFrom'">
                        <div class="x-width">
                            {{ timestamp2Date(record.validFrom) }}
                        </div>
                    </template>
                    <template v-if="column.key === 'status'">
                        <a-tag :color="getStatusColor(record.status)">
                            {{ getStatusText(record.status) }}
                        </a-tag>
                    </template>
                    <template v-if="column.key === 'operation'">
                        <a-flex justify="center" align="center" :gap="8">
                            <template v-if="record.status === SSL_STATUS.DNS_PENDING">
                                <a-button type="dashed" :disabled="(new Date(record.expires)).getTime() < Date.now()"
                                          @click="verifyDns(record)">
                                    验证DNS
                                </a-button>
                            </template>

                            <template v-if="record.status === SSL_STATUS.DNS_VERIFIED">
                                <a-button type="dashed" :disabled="(new Date(record.expires)).getTime() < Date.now()"
                                          @click="verifyChallenge(record)">
                                    验证ACME
                                </a-button>
                            </template>
                            <template v-if="record.status === SSL_STATUS.FAILED">
                                <a-button type="dashed" :disabled="(new Date(record.expires)).getTime() < Date.now()"
                                          @click="reApply(record)">
                                    重新申请
                                </a-button>
                            </template>
                            <a-button type="text" danger @click="deleteApplyRecord(record)">
                                <DeleteOutlined/>
                            </a-button>
                        </a-flex>
                    </template>
                </template>
            </a-table>
        </div>
    </div>
</template>

<style scoped lang="scss">
.box {
    box-sizing: border-box;
    height: 100vh;
    overflow: auto;
    position: relative;
    width: calc(100vw - var(--menu-width, 49px));

    :global(.content-expanded) & {
        --menu-width: 130px;
    }

    .header {
        height: 60px;
        box-sizing: border-box;
        padding: 0 20px;
        position: sticky;
        top: 0;
        z-index: 99;
        border-bottom: 1px solid v-bind('token.colorBorderSecondary');
    }

    .body {
        box-sizing: border-box;
        height: calc(100vh - 60px);
    }
}

.name {
    max-width: 150px;
    cursor: pointer;
}

.x-width {
    max-width: 150px;
}
</style>