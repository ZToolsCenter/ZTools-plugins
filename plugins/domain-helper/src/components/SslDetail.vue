<script setup>
import {ref, onMounted, onBeforeUnmount, getCurrentInstance, watch} from 'vue';
import {theme, Divider} from 'ant-design-vue';
import {
    KeyOutlined,
    SafetyCertificateOutlined,
    UserOutlined,
    GlobalOutlined,
    CheckCircleOutlined,
    TagOutlined,
} from '@ant-design/icons-vue';
import {xcopyText} from '@/utils/tool';
import {debounce} from 'lodash-es';
import {message, Modal} from "ant-design-vue";

const emit = defineEmits(['update:open', 'close']);

const {useToken} = theme;
const {token} = useToken();

const open = ref(false);
const certInfo = ref({});

// 关闭弹窗
const handleClose = () => {
    open.value = false;
    emit('update:open', false);
    emit('close');
};

// 注册事件监听
const {proxy} = getCurrentInstance();
const openSslDetail = (info) => {
    certInfo.value = info;
    open.value = true;
}
onMounted(() => {
    proxy.$eventBus.on("open-ssl-detail", openSslDetail);
});

onBeforeUnmount(() => {
    proxy.$eventBus.off("open-ssl-detail");
});

// 复制文本
const copyText = (text, message) => {
    xcopyText(text, message);
};

// 获取证书类型的标签颜色
const getCertTypeColor = (type) => {
    switch (type) {
        case 'DV':
            return 'green';
        case 'OV':
            return 'blue';
        case 'EV':
            return 'purple';
        default:
            return 'default';
    }
};

// 获取标签图标
const getTagIcon = (type) => {
    if (type === 'DV' || type === 'OV' || type === 'EV') {
        return CheckCircleOutlined;
    }
    return TagOutlined;
};
</script>

<template>
    <a-drawer
        v-model:open="open"
        :title="certInfo.subject?.commonName || '证书详情'"
        :width="800"
        :bodyStyle="{ padding: '0' }"
        @close="handleClose"
        destroyOnClose
        :closable="true"
        placement="right"
    >
        <div class="ssl-detail-container">
            <div class="ssl-detail-header" :style="{ backgroundColor: token.colorPrimary }">
                <div class="ssl-detail-header-icon">
                    <SafetyCertificateOutlined/>
                </div>
                <div class="ssl-detail-header-content">
                    <h2>{{ certInfo.subject?.commonName || '证书详情' }}</h2>
                    <div class="ssl-detail-header-tags">
                        <a-tag :color="getCertTypeColor(certInfo.info?.cert_belong)" class="ssl-tag">
                            <template #icon>
                                <component :is="getTagIcon(certInfo.info?.cert_belong)"/>
                            </template>
                            {{ certInfo.info?.cert_belong || '-' }}
                        </a-tag>
                        <a-tag color="gold" class="ssl-tag">
                            <template #icon>
                                <KeyOutlined/>
                            </template>
                            {{ certInfo.info?.certType || '-' }}
                        </a-tag>
                        <a-tag
                            v-for="(purpose, index) in certInfo.info?.purposes"
                            :key="index"
                            class="ssl-tag"
                            :color="index % 2 === 0 ? 'cyan' : 'geekblue'"
                        >
                            <template #icon>
                                <TagOutlined/>
                            </template>
                            {{ purpose }}
                        </a-tag>
                    </div>
                </div>
            </div>

            <div class="ssl-detail-content" ref="xbody">
                <a-tabs default-active-key="1">
                    <a-tab-pane key="1" tab="主题信息">
                        <div class="ssl-detail-section">
                            <div class="ssl-detail-section-header">
                                <UserOutlined/>
                                <span>主题信息</span>
                            </div>
                            <div class="ssl-detail-grid">
                                <div class="ssl-detail-label">通用名称(CN):</div>
                                <div class="ssl-detail-value highlight">{{ certInfo.subject?.commonName || '-' }}</div>

                                <div class="ssl-detail-label">国家(C):</div>
                                <div class="ssl-detail-value">{{ certInfo.subject?.country || '-' }}</div>

                                <div class="ssl-detail-label">省份(S):</div>
                                <div class="ssl-detail-value">{{ certInfo.subject?.state || '-' }}</div>

                                <div class="ssl-detail-label">城市(L):</div>
                                <div class="ssl-detail-value">{{ certInfo.subject?.locality || '-' }}</div>

                                <div class="ssl-detail-label">组织(O):</div>
                                <div class="ssl-detail-value">{{ certInfo.subject?.organization || '-' }}</div>

                                <div class="ssl-detail-label">部门(OU):</div>
                                <div class="ssl-detail-value">{{ certInfo.subject?.organizationalUnit || '-' }}</div>
                            </div>
                        </div>

                        <Divider/>

                        <div class="ssl-detail-section">
                            <div class="ssl-detail-section-header">
                                <GlobalOutlined/>
                                <span>签发者信息</span>
                            </div>
                            <div class="ssl-detail-grid">
                                <div class="ssl-detail-label">通用名称(CN):</div>
                                <div class="ssl-detail-value highlight">{{ certInfo.issuer?.commonName || '-' }}</div>

                                <div class="ssl-detail-label">国家(C):</div>
                                <div class="ssl-detail-value">{{ certInfo.issuer?.country || '-' }}</div>

                                <div class="ssl-detail-label">组织(O):</div>
                                <div class="ssl-detail-value">{{ certInfo.issuer?.organization || '-' }}</div>
                            </div>
                        </div>
                    </a-tab-pane>

                    <a-tab-pane key="2" tab="证书信息">
                        <div class="ssl-detail-section">
                            <div class="ssl-detail-section-header">
                                <KeyOutlined/>
                                <span>证书信息</span>
                            </div>
                            <div class="ssl-detail-grid">
                                <div class="ssl-detail-label">序列号:</div>
                                <div class="ssl-detail-value copyable"
                                     @click="copyText(certInfo.info?.serialNumber, '序列号已复制')">
                                    {{ certInfo.info?.serialNumber || '-' }}
                                </div>

                                <div class="ssl-detail-label">类别归档:</div>
                                <div class="ssl-detail-value">
                                    <a-tag :color="getCertTypeColor(certInfo.info?.cert_belong)">
                                        {{ certInfo.info?.cert_belong || '-' }}
                                    </a-tag>
                                </div>

                                <div class="ssl-detail-label">证书类型:</div>
                                <div class="ssl-detail-value">{{ certInfo.info?.certType || '-' }}</div>

                                <div class="ssl-detail-label">用途:</div>
                                <div class="ssl-detail-value">
                                    <a-tag v-for="(purpose, index) in certInfo.info?.purposes" :key="index"
                                           style="margin: 2px">
                                        {{ purpose }}
                                    </a-tag>
                                </div>

                                <div class="ssl-detail-label">密钥类型:</div>
                                <div class="ssl-detail-value">{{ certInfo.info?.public_key || '-' }}</div>

                                <div class="ssl-detail-label">密钥强度:</div>
                                <div class="ssl-detail-value">{{ certInfo.info?.public_key_size || '-' }}</div>

                                <div class="ssl-detail-label">签名算法:</div>
                                <div class="ssl-detail-value">{{ certInfo.info?.signatureAlgorithm || '-' }}</div>

                                <div class="ssl-detail-label">颁发时间:</div>
                                <div class="ssl-detail-value">{{ certInfo.info?.notBefore || '-' }}</div>

                                <div class="ssl-detail-label">过期时间:</div>
                                <div class="ssl-detail-value">{{ certInfo.info?.notAfter || '-' }}</div>

                                <div class="ssl-detail-label">有效期:</div>
                                <div class="ssl-detail-value">
                                    {{ certInfo.info?.validity ? `${certInfo.info.validity} 天` : '-' }}
                                </div>

                                <div class="ssl-detail-label">SHA1指纹:</div>
                                <div class="ssl-detail-value copyable"
                                     @click="copyText(certInfo.info?.sha1Fingerprint, 'SHA1指纹已复制')">
                                    {{ certInfo.info?.sha1Fingerprint || '-' }}
                                </div>

                                <div class="ssl-detail-label">SHA2指纹:</div>
                                <div class="ssl-detail-value copyable"
                                     @click="copyText(certInfo.info?.sha2Fingerprint, 'SHA2指纹已复制')">
                                    {{ certInfo.info?.sha2Fingerprint || '-' }}
                                </div>

                                <div class="ssl-detail-label">签名信息:</div>
                                <div class="ssl-detail-value copyable"
                                     @click="copyText(certInfo.info?.cer_signture, '签名信息已复制')">
                                    {{ certInfo.info?.cer_signture || '-' }}
                                </div>
                            </div>
                        </div>
                    </a-tab-pane>

                    <a-tab-pane key="3" tab="备用名">
                        <div class="ssl-detail-section">
                            <div class="ssl-detail-section-header">
                                <GlobalOutlined/>
                                <span>备用名</span>
                            </div>
                            <div class="ssl-detail-alt-names">
                                <a-tag
                                    v-for="(name, index) in certInfo.info?.altNames"
                                    :key="index"
                                    color="blue"
                                    class="alt-name-tag"
                                    @click="copyText(name, '域名已复制')"
                                >
                                    <template #icon>
                                        <GlobalOutlined/>
                                    </template>
                                    {{ name }}
                                </a-tag>
                                <div v-if="!certInfo.info?.altNames || certInfo.info.altNames.length === 0"
                                     class="empty-data">
                                    暂无备用名
                                </div>
                            </div>
                        </div>

                        <Divider/>

                        <div class="ssl-detail-section">
                            <div class="ssl-detail-section-header">
                                <GlobalOutlined/>
                                <span>CA 信息</span>
                            </div>
                            <div class="ssl-detail-grid">
                                <div class="ssl-detail-label">CA URL:</div>
                                <div class="ssl-detail-value copyable"
                                     @click="copyText(certInfo.info?.caUrl, 'CA URL已复制')">
                                    {{ certInfo.info?.caUrl || '-' }}
                                </div>

                                <div class="ssl-detail-label">OCSP URL:</div>
                                <div class="ssl-detail-value copyable"
                                     @click="copyText(certInfo.info?.ocsp, 'OCSP URL已复制')">
                                    {{ certInfo.info?.ocsp || '-' }}
                                </div>
                            </div>
                        </div>
                    </a-tab-pane>
                </a-tabs>
            </div>
        </div>

        <template #footer>
            <div class="ssl-detail-footer">
                <a-button type="primary" @click="handleClose">关闭</a-button>
            </div>
        </template>
    </a-drawer>
</template>

<style scoped lang="scss">
.ssl-detail-container {
    display: flex;
    flex-direction: column;
    height: 100%;
    background-color: v-bind('token.colorBgContainer');
    overflow: hidden;
}

.ssl-detail-header {
    display: flex;
    align-items: center;
    padding: 20px;
    color: white;
    position: relative;
    overflow: hidden;
    background-image: linear-gradient(to right, rgba(0, 0, 0, 0.1), transparent);

    &::before {
        content: '';
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: linear-gradient(135deg, rgba(255, 255, 255, 0.15) 0%, rgba(255, 255, 255, 0) 100%);
        pointer-events: none;
    }

    &::after {
        content: '';
        position: absolute;
        bottom: 0;
        left: 0;
        right: 0;
        height: 1px;
        background: linear-gradient(to right, rgba(255, 255, 255, 0.3), transparent);
    }

    .ssl-detail-header-icon {
        font-size: 38px;
        margin-right: 16px;
        filter: drop-shadow(0 2px 4px rgba(0, 0, 0, 0.2));
        transition: transform 0.3s ease;

        &:hover {
            transform: scale(1.1);
        }
    }

    .ssl-detail-header-content {
        flex: 1;

        h2 {
            margin: 0;
            color: white;
            font-size: 20px;
            font-weight: 600;
            margin-bottom: 10px;
            word-break: break-all;
            text-shadow: 0 1px 2px rgba(0, 0, 0, 0.2);
            letter-spacing: 0.5px;
        }

        .ssl-detail-header-tags {
            display: flex;
            flex-wrap: wrap;
            gap: 8px;
            animation: fadeIn 0.5s ease-out;

            @keyframes fadeIn {
                from {
                    opacity: 0;
                    transform: translateY(5px);
                }
                to {
                    opacity: 1;
                    transform: translateY(0);
                }
            }

            .ssl-tag {
                border: none;
                font-size: 12px;
                font-weight: 500;
                padding: 1px 8px;
                height: auto;
                line-height: 20px;
                border-radius: 4px;
                box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
                transition: all 0.3s cubic-bezier(0.25, 0.8, 0.25, 1);
                margin-right: 0;

                :deep(.anticon) {
                    margin-right: 4px;
                    font-size: 12px;
                    vertical-align: -0.125em;
                }

                &:hover {
                    transform: translateY(-2px);
                    box-shadow: 0 4px 8px rgba(0, 0, 0, 0.15);
                }
            }
        }
    }
}

.ssl-detail-content {
    flex: 1;
    padding: 16px;
    overflow-y: auto;
    background-color: v-bind('token.colorBgContainer');
    color: v-bind('token.colorText');

    :deep(.ant-tabs-nav) {
        margin-bottom: 12px;
    }
}

.ssl-detail-section {
    margin-bottom: 20px;

    .ssl-detail-section-header {
        display: flex;
        align-items: center;
        font-size: 15px;
        font-weight: 500;
        margin-bottom: 12px;
        color: v-bind('token.colorTextHeading');

        .anticon {
            margin-right: 8px;
            font-size: 16px;
        }
    }
}

.ssl-detail-grid {
    display: grid;
    grid-template-columns: 110px 1fr;
    row-gap: 10px;
    column-gap: 12px;
}

.ssl-detail-label {
    color: v-bind('token.colorTextSecondary');
    font-size: 13px;
    line-height: 20px;
}

.ssl-detail-value {
    font-size: 13px;
    line-height: 20px;
    word-break: break-all;
    color: v-bind('token.colorText');

    &.highlight {
        font-weight: 500;
        color: v-bind('token.colorTextHeading');
    }

    &.copyable {
        cursor: pointer;
        color: v-bind('token.colorPrimary');
        transition: opacity 0.2s;

        &:hover {
            opacity: 0.8;
        }
    }
}

.ssl-detail-alt-names {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    padding: 6px 0;

    .alt-name-tag {
        cursor: pointer;
        transition: all 0.2s;
        border: none;
        font-size: 12px;
        font-weight: 500;
        padding: 1px 8px;
        height: auto;
        line-height: 20px;

        :deep(.anticon) {
            margin-right: 4px;
            font-size: 12px;
            vertical-align: -0.125em;
        }

        &:hover {
            transform: translateY(-2px);
            box-shadow: 0 2px 6px rgba(0, 0, 0, 0.1);
        }
    }

    .empty-data {
        color: v-bind('token.colorTextSecondary');
        font-size: 13px;
        padding: 12px 0;
        text-align: center;
        width: 100%;
    }
}

.ssl-detail-footer {
    display: flex;
    justify-content: flex-end;
    padding: 12px 16px;
    background-color: v-bind('token.colorBgContainer');
}
</style> 