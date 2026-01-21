<script setup>
import {
    MenuFoldOutlined,
    AppstoreOutlined,
    BarsOutlined, MenuUnfoldOutlined, QuestionCircleOutlined
} from "@ant-design/icons-vue";
import {computed, ref, watch} from "vue";
import {useThemeStore} from '@/stroes/themeStore';
import {theme} from 'ant-design-vue';
import {message} from 'ant-design-vue';
import {validateNotification} from '@/utils/notificationChan';
import {goUrl} from "@/utils/tool";

const {useToken} = theme;
const {token} = useToken();

const themeColors = [
    "#1677FF",
    "#FF6700",
    "#ED1C24",
    "#000000",
    "#1EA366",
    "#415FFF",
    "#EB0029",
    "#1428A0",
    "#008CFF",
    "#5C92FA",
    "#C70851",
    "#ff6b81",
    "#FFD700",
    "#4834d4",
    "#34e7e4",
];

const store = useThemeStore();
const colorPrimary = ref(store.themeColor);
const showMode = ref(store.showMode);
const config = store.config;

// 确保 config.ssl 存在并初始化
// if (!config.ssl) {
//     store.updateConfig({
//         ssl: {
//             dns_verify: 'one',
//             auto_acme: false
//         }
//     });
// }

const menuExpand = computed(() => store.config.menuExpand);

const userEmail = ref('');

userEmail.value = utools.dbStorage.getItem("user_email")

const saveUserEmail = () => {
    if (!userEmail.value || userEmail.value.trim() === '') {
        message.error('邮箱不能为空');
        return;
    }
    utools.dbStorage.setItem("user_email", userEmail.value);
    message.success('邮箱保存成功');
};

watch(() => config.ssl?.dns_verify, (newVal) => {
    if (newVal) {
        store.updateConfig({
            ssl: {
                ...config.ssl,
                dns_verify: newVal
            }
        });
    }
}, {immediate: true});

// 添加对证书厂商的监听
watch(() => config.ca?.default_ca, (newVal) => {
    if (newVal) {
        store.updateConfig({
            ca: {
                ...config.ca,
                default_ca: newVal
            }
        });
    }
}, {immediate: true});

watch(colorPrimary, (newVal) => {
    store.setThemeColor(newVal)
})
watch(showMode, (newVal) => {
    store.setShowMode(newVal)
})

const setColor = (color) => {
    colorPrimary.value = color
}

const updateConfig = (key, value) => {
    store.updateConfig({[key]: value});
};

const activeKey = ref('1');
const loadingStates = ref({
    wechat: false,
    dingtalk: false,
    serverChan: false,
    anPush: false,
    custom: false,
    feishu: false,
});

const validateAndSave = async (type) => {
    const urlMap = config.notifications || {};
    const url = urlMap[type];

    if (!url || url.trim() === '') {
        store.updateConfig({
            notifications: {
                ...urlMap,
                [type]: ''
            }
        });
        message.success('已清空并保存');
        return;
    }

    loadingStates.value[type] = true;
    try {
        await validateNotification(type, url);
        store.updateConfig({
            notifications: {
                ...urlMap,
                [type]: url
            }
        });
        message.success('验证成功并已保存');
    } catch (error) {
        message.error(error.message || '验证失败');
    } finally {
        loadingStates.value[type] = false;
    }
};

const getButtonText = (type) => {
    const url = config.notifications?.[type];
    return (!url || url.trim() === '') ? '保存' : '验证并保存';
};
</script>

<template>
    <div class="settings-container">
        <div class="content">
            <a-tabs v-model:activeKey="activeKey">
                <a-tab-pane key="1" tab="外观设置">
                    <a-form layout="vertical">
                        <a-form-item>
                            <template #label>
                                <span class="form-label">主题颜色</span>
                            </template>
                            <a-space size="middle" style="width: 100%">
                                <a-input type="color" v-model:value="colorPrimary" style="width: 100px;"/>
                                <div class="colors-grid" style="display: flex;">
                                    <div
                                        v-for="(color, index) in themeColors"
                                        :key="index"
                                        class="color-item"
                                        :style="{ backgroundColor: color }"
                                        @click="setColor(color)"
                                    ></div>
                                </div>
                            </a-space>
                        </a-form-item>

                        <a-form-item>
                            <template #label>
                                <span class="form-label">显示模式</span>
                            </template>
                            <a-radio-group v-model:value="showMode">
                                <a-radio value="auto">跟随系统</a-radio>
                                <a-radio value="light">浅色</a-radio>
                                <a-radio value="dark">深色</a-radio>
                            </a-radio-group>
                        </a-form-item>

                        <a-form-item>
                            <template #label>
                                <span class="form-label">菜单展开</span>
                            </template>
                            <a-switch
                                :checked="menuExpand"
                                @change="(checked) => updateConfig('menuExpand', checked)"
                            >
                                <template #checkedChildren>
                                    <MenuFoldOutlined/>
                                </template>
                                <template #unCheckedChildren>
                                    <MenuUnfoldOutlined/>
                                </template>
                            </a-switch>
                        </a-form-item>

                        <a-form-item>
                            <template #label>
                                <span class="form-label">域名列表视图</span>
                            </template>
                            <a-radio-group
                                v-model:value="config.domainListView"
                                @change="(e) => updateConfig('domainListView', e.target.value)"
                                button-style="solid"
                            >
                                <a-radio-button value="card">
                                    <a-space>
                                        <AppstoreOutlined/>
                                        卡片视图
                                    </a-space>
                                </a-radio-button>
                                <a-radio-button value="table">
                                    <a-space>
                                        <BarsOutlined/>
                                        列表视图
                                    </a-space>
                                </a-radio-button>
                            </a-radio-group>
                        </a-form-item>
                    </a-form>
                </a-tab-pane>
                <a-tab-pane key="2" tab="通知设置" force-render>
                    <a-form layout="vertical">
                        <a-form-item label="企业微信机器人">
                            <a-input-group compact>
                                <a-input
                                    v-model:value="config.notifications.wechat"
                                    placeholder="请输入企业微信机器人 Webhook URL"
                                    style="width: calc(100% - 110px)"
                                    allow-clear
                                />
                                <a-button
                                    type="primary"
                                    :loading="loadingStates.wechat"
                                    @click="validateAndSave('wechat')"
                                    style="width: 110px"
                                >{{ getButtonText('wechat') }}
                                </a-button>
                            </a-input-group>
                        </a-form-item>
                        <a-form-item label="飞书机器人">
                            <a-input-group compact>
                                <a-input
                                    v-model:value="config.notifications.feishu"
                                    placeholder="请输入飞书机器人 Webhook URL"
                                    style="width: calc(100% - 110px)"
                                    allow-clear
                                />
                                <a-button
                                    type="primary"
                                    :loading="loadingStates.feishu"
                                    @click="validateAndSave('feishu')"
                                    style="width: 110px"
                                >{{ getButtonText('feishu') }}
                                </a-button>
                            </a-input-group>
                        </a-form-item>

                        <a-form-item label="钉钉机器人">
                            <a-input-group compact>
                                <a-input
                                    v-model:value="config.notifications.dingtalk"
                                    placeholder="关键词验证，域名助手, 钉钉机器人 Webhook URL"
                                    style="width: calc(100% - 110px)"
                                    allow-clear
                                />
                                <a-button
                                    type="primary"
                                    :loading="loadingStates.dingtalk"
                                    @click="validateAndSave('dingtalk')"
                                    style="width: 110px"
                                >{{ getButtonText('dingtalk') }}
                                </a-button>
                            </a-input-group>
                        </a-form-item>

                        <a-form-item label="Server酱">
                            <a-input-group compact>
                                <a-input
                                    v-model:value="config.notifications.serverChan"
                                    placeholder="请输入 Server酱 SendKey"
                                    style="width: calc(100% - 110px)"
                                    allow-clear
                                />
                                <a-button
                                    type="primary"
                                    :loading="loadingStates.serverChan"
                                    @click="validateAndSave('serverChan')"
                                    style="width: 110px"
                                >{{ getButtonText('serverChan') }}
                                </a-button>
                            </a-input-group>
                        </a-form-item>

                        <!--                        <a-form-item label="AnPush">-->
                        <!--                            <a-input-group compact>-->
                        <!--                                <a-input-->
                        <!--                                    v-model:value="config.notifications.anPush"-->
                        <!--                                    placeholder="请输入 AnPush 推送 URL"-->
                        <!--                                    style="width: calc(100% - 110px)"-->
                        <!--                                    allow-clear-->
                        <!--                                />-->
                        <!--                                <a-button -->
                        <!--                                    type="primary" -->
                        <!--                                    :loading="loadingStates.anPush"-->
                        <!--                                    @click="validateAndSave('anPush')"-->
                        <!--                                    style="width: 110px"-->
                        <!--                                >{{ getButtonText('anPush') }}</a-button>-->
                        <!--                            </a-input-group>-->
                        <!--                        </a-form-item>-->

                        <a-form-item label="自定义 URL">
                            <a-input-group compact>
                                <a-input
                                    v-model:value="config.notifications.custom"
                                    placeholder="请输入自定义推送 URL, json格式推送，title,content, 验证请放在URL中"
                                    style="width: calc(100% - 110px)"
                                    allow-clear
                                />
                                <a-button
                                    type="primary"
                                    :loading="loadingStates.custom"
                                    @click="validateAndSave('custom')"
                                    style="width: 110px"
                                >{{ getButtonText('custom') }}
                                </a-button>
                            </a-input-group>
                        </a-form-item>
                    </a-form>
                </a-tab-pane>
                <a-tab-pane key="3" tab="SSL相关设置">
                    <a-form layout="vertical">
                        <a-form-item>
                            <template #label>
                                <span class="form-label">ACME 联系邮箱</span>
                            </template>
                            <a-input-group compact>
                                <a-input
                                    v-model:value="userEmail"
                                    placeholder="请输入 ACME 账号邮箱"
                                    style="width: calc(60% - 110px)"
                                    allow-clear
                                />
                                <a-button
                                    type="primary"
                                    @click="saveUserEmail"
                                    style="width: 110px"
                                >保存
                                </a-button>
                            </a-input-group>
                        </a-form-item>
                        <a-form-item>
                            <template #label>
                                <a-space>


                                    <span class="form-label">TXT 记录验证途径</span>
                                    <a-popover title="途径说明" trigger="hover">
                                        <template #content>
                                            <a-space direction="vertical">
                                                <div @click="goUrl('https://tcp.mk')">
                                                    推荐使用  <a>tcp.mk</a> 网络验证
                                                </div>
                                                <div>
                                                    遇到问题请使用本地查询
                                                </div>
                                                <div>
                                                    本地查询需要关闭代理
                                                </div>
                                            </a-space>
                                        </template>
                                        <QuestionCircleOutlined/>
                                    </a-popover>
                                </a-space>
                            </template>
                            <a-radio-group
                                v-model:value="config.ssl.dns_verify"
                                @change="(e) => updateConfig('ssl', { ...config.ssl, dns_verify: e.target.value })"
                            >
                                <a-radio value="tcpmk">tcp.mk</a-radio>
                                <a-radio value="one">1.1.1.1</a-radio>
                                <a-radio value="local">本地查询(请关闭代理)</a-radio>
                            </a-radio-group>
                        </a-form-item>
                        <a-form-item>
                            <template #label>
                                <a-space>
                                    <span class="form-label">自动 ACME 验证</span>
                                    <a-popover placement="right" title="使用说明" trigger="hover">
                                        <template #content>
                                            <a-space direction="vertical" size="small">
                                                <div :style="{color: colorPrimary}">
                                                    自动模式：
                                                </div>
                                                <div>
                                                    创建DNS记录后立即开始ACME验证，
                                                </div>
                                                <div>
                                                    适用于DNS记录传播速度快的优秀云服务商（如阿里云）。
                                                </div>
                                            </a-space>
                                            <div style="height: 20px;"></div>
                                            <a-space direction="vertical" size="small">
                                                <div :style="{color: colorPrimary}">
                                                    手动模式：
                                                </div>
                                                <div>
                                                    创建DNS记录后需等待用户手动触发ACME验证，
                                                </div>
                                                <div>
                                                    适用于传播速度较慢的服务商，以避免验证失败;
                                                </div>
                                                <div>
                                                    单次申请的域名较多，建议使用手动模式，以避免验证失败；
                                                </div>
                                                <div>
                                                    手动模式下，建议等待 1 - 3个小时再触发验证;
                                                </div>
                                                <div>
                                                    点名 <span style="color: #0080E3;font-weight: 500;">西部数据</span>
                                                    ，太拉了，自动模式就没有成功过。
                                                </div>
                                            </a-space>
                                        </template>
                                        <QuestionCircleOutlined/>
                                    </a-popover>
                                </a-space>
                            </template>
                            <a-switch
                                checked-children="自动" un-checked-children="手动"
                                :checked="config.ssl.auto_acme"
                                @change="(checked) => updateConfig('ssl', { ...config.ssl, auto_acme: checked })"
                            />
                        </a-form-item>
                        <a-form-item>
                            <template #label>
                                <a-space>
                                    <span class="form-label">证书厂商</span>
                                    <a-popover placement="right" title="证书厂商" trigger="hover">
                                        <template #content>
                                            <a-space direction="vertical" size="small">
                                                <div>
                                                    Google： 需要配置科学代理，需要绑定外部账号
                                                </div>
                                                <div>
                                                    ZeroSSL：需要绑定外部账号
                                                </div>
                                            </a-space>
                                        </template>
                                        <QuestionCircleOutlined/>
                                    </a-popover>
                                </a-space>
                            </template>
                            <a-radio-group v-model:value="config.ca.default_ca">
                                <a-radio value="letsencrypt">Let's Encrypt</a-radio>
                                <a-radio value="google">Google</a-radio>
                                <a-radio value="zerossl">ZeroSSL</a-radio>
                            </a-radio-group>
                        </a-form-item>

                        <!-- Google 配置项 -->
                        <template v-if="config.ca.default_ca === 'google'">
                            <a-form-item label="EAB KID">
                                <a-input
                                    v-model:value="config.ca.google_kid"
                                    placeholder="请输入 Google EAB KID"
                                    style="width: 60%"
                                    @change="(e) => updateConfig('ca', { ...config.ca, google_kid: e.target.value })"
                                    allow-clear
                                />
                            </a-form-item>
                            <a-form-item label="EAB HMAC Key">
                                <a-input
                                    v-model:value="config.ca.google_hmacKey"
                                    placeholder="请输入 Google EAB HMAC Key"
                                    style="width: 60%"
                                    @change="(e) => updateConfig('ca', { ...config.ca, google_hmacKey: e.target.value })"
                                    allow-clear
                                />
                            </a-form-item>
                            <a-form-item label="HTTP 代理">
                                <a-input
                                    v-model:value="config.ca.google_proxy"
                                    style="width: 60%"
                                    addon-before="http://"
                                    placeholder="例如：127.0.0.1:10809"
                                    @change="(e) => updateConfig('ca', { ...config.ca, google_proxy: e.target.value })"
                                    allow-clear
                                />
                            </a-form-item>
                        </template>

                        <!-- ZeroSSL 配置项 -->
                        <template v-if="config.ca.default_ca === 'zerossl'">
                            <a-form-item label="EAB KID">
                                <a-input
                                    v-model:value="config.ca.zerossl_kid"
                                    placeholder="请输入 ZeroSSL EAB KID"
                                    style="width: 60%"
                                    @change="(e) => updateConfig('ca', { ...config.ca, zerossl_kid: e.target.value })"
                                    allow-clear
                                />
                            </a-form-item>
                            <a-form-item label="EAB HMAC Key">
                                <a-input
                                    v-model:value="config.ca.zerossl_hmacKey"
                                    placeholder="请输入 ZeroSSL EAB HMAC Key"
                                    style="width: 60%"
                                    @change="(e) => updateConfig('ca', { ...config.ca, zerossl_hmacKey: e.target.value })"
                                    allow-clear
                                />
                            </a-form-item>
                        </template>
                    </a-form>
                </a-tab-pane>
                <a-tab-pane key="4" tab="服务端设置">服务端设置(coding...) 先画个🥧🥧🥧🥧</a-tab-pane>
            </a-tabs>

        </div>
    </div>
</template>

<style scoped lang="scss">
.settings-container {
    height: 100vh;
    display: flex;
    flex-direction: column;
    overflow: hidden;

    .header {
        height: 60px;
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 0 16px;
        border-bottom: 1px dashed v-bind('token.colorBorderSecondary');

        .title {
            font-size: 20px;
            font-weight: 500;
        }

        .desc {
            font-size: 12px;
        }
    }

    .content {
        padding: 0 20px;
        overflow: auto;
    }
}

.colors-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, 32px);
    gap: 8px;

    .color-item {
        width: 20px;
        height: 20px;
        border-radius: 4px;
        cursor: pointer;
        transition: transform 0.2s;

        &:hover {
            transform: scale(1.1);
        }
    }
}

.form-label {
    font-weight: 500;
    font-size: 14px;
}

.ant-form-item {
    margin-bottom: 24px;
}
</style>