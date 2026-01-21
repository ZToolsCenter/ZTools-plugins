<script setup>
import {computed, ref, reactive, getCurrentInstance, onMounted, h, onBeforeUnmount} from "vue";
import {message, notification} from "ant-design-vue";
import confetti from 'canvas-confetti';
import {
    DownloadOutlined,
    QuestionCircleOutlined,
} from "@ant-design/icons-vue";
import {useThemeStore} from '@/stroes/themeStore.js';
import {SettingOutlined} from '@ant-design/icons-vue';
import {getAllPushplatform, getAllSslInfo, getAvailableSSL} from "@/utils/tool";
import router from "@/router";
import {PushServiceFactory} from "@/service/PushPlatform/PushService";
import {updateOneDomainMonitor} from "@/utils/sslMonitor.js";

const open = ref(false);
const successModal = ref(false);
const confirmLoading = ref(false);
const {proxy} = getCurrentInstance();

const form = reactive({
    platform: undefined,
    platforms: [],
    ssl: undefined,
})
import {platformTypes} from "@/utils/data";

const getPushplatformInfo = (type, key = null) => {
    return key ? platformTypes[type][key] : platformTypes[type];
};
const paltformInfo = reactive({
    _id: '',
    platform_type: "",
    tag: "",
    config: undefined
});
const selectedPlatforms = ref([]);
const sslInfo = ref(null);

const isDoing = ref(false);
const steps = ref([]);

const themeStore = useThemeStore();
const colorPrimary = computed(() => themeStore.themeColor);

const allPlatform = ref([]);
const allSSL = ref([])
const refreshPushplatform = () => {
    allPlatform.value = getAllPushplatform()
    console.log('allPlatform:', allPlatform.value)
}

const refreshAllSSL = () => {
    allSSL.value = getAvailableSSL();
}

onMounted(() => {
    proxy.$eventBus.on("open-ssl-push", openModal)
})

onBeforeUnmount(() => {
    proxy.$eventBus.off("open-ssl-push", openModal)
})

const pushResults = ref([]);

function randomInRange(min, max) {
    return Math.random() * (max - min) + min;
}

const flowers = () => {
    let times = 0;
    let timer = setInterval(() => {
        confetti({
            zIndex: 8898989,
            angle: randomInRange(55, 125),
            spread: randomInRange(50, 70),
            particleCount: randomInRange(50, 100),
            origin: {y: 0.6},
            colors: [
                "#ff1744", "#d500f9", "#651fff", "#3d5afe",
                "#00e5ff", "#2196f3", "#00e676", "#ffea00",
                "#ff9100", "#ff3d00",
            ],
            shapes: ['square', 'circle', 'star']
        });
        times++;
        if (times >= 6) {
            clearInterval(timer)
            timer = null
        }
    }, 300)
}

const updateSelectedPlatforms = () => {
    selectedPlatforms.value = [];
    if (form.platform) {
        const platform = allPlatform.value.find(item => item._id === form.platform);
        if (platform) {
            selectedPlatforms.value.push({
                _id: platform._id,
                platform_type: platform.platform_type,
                tag: platform.tag,
                config: platform.config
            });
        }
    } else if (form.platforms && form.platforms.length > 0) {
        form.platforms.forEach(platformId => {
            const platform = allPlatform.value.find(item => item._id === platformId);
            if (platform) {
                selectedPlatforms.value.push({
                    _id: platform._id,
                    platform_type: platform.platform_type,
                    tag: platform.tag,
                    config: platform.config
                });
            }
        });
    }
}

const pushToOnePlatform = async (platform, index) => {
    steps.value.push(`[${index + 1}/${selectedPlatforms.value.length}] 推送证书到 ${platform.tag}`);

    try {
        if (platform.platform_type === 'ssh' && (!platform.config.certPath || !platform.config.keyPath)) {
            steps.value.push(`❌ ${platform.tag}: 未配置证书路径`);
            return {success: false, platform: platform, msg: "未配置证书路径"};
        }

        const pushService = PushServiceFactory.getService(platform.platform_type);
        const result = await pushService.push(platform.config, {
            cert: sslInfo.value.cert,
            key: sslInfo.value.key,
            domain: sslInfo.value.domain,
        }, (type, extData) => {
            let stepMsg = `[${platform.tag}] `;
            switch (type) {
                case "error":
                    stepMsg += `❌ ${extData.msg}`;
                    break;
                case "success":
                    stepMsg += `✅ ${extData.msg}`;
                    break;
                case "connected":
                case "beforePush":
                case "afterPush":
                case "beforeCommand":
                case "afterCommand":
                    stepMsg += extData.msg;
                    break;
                default:
                    stepMsg += extData.msg;
                    break;
            }
            steps.value.push(stepMsg);
        });

        steps.value.push(`✅ ${platform.tag}: 证书推送成功`);
        return {success: true, platform: platform, ...result};
    } catch (e) {
        steps.value.push(`❌ ${platform.tag}: 证书推送失败 - ${e.toString()}`);
        return {success: false, platform: platform, error: e.toString()};
    }
}

const handleOk = async () => {
    if (!form.platform && (!form.platforms || form.platforms.length === 0)) {
        message.error("请选择至少一个推送平台");
        return;
    }

    updateSelectedPlatforms();

    if (selectedPlatforms.value.length === 0) {
        message.error("请选择至少一个推送平台");
        return;
    }

    if (!sslInfo.value) {
        throw new Error('证书信息不存在');
    }

    confirmLoading.value = true;
    isDoing.value = true;
    steps.value = [`开始推送证书到 ${selectedPlatforms.value.length} 个平台`];
    pushResults.value = [];

    try {
        for (let i = 0; i < selectedPlatforms.value.length; i++) {
            const platform = selectedPlatforms.value[i];
            const result = await pushToOnePlatform(platform, i);
            pushResults.value.push(result);
        }

        const successCount = pushResults.value.filter(r => r.success).length;
        const failCount = pushResults.value.length - successCount;

        if (successCount > 0) {
            steps.value.push(`证书推送完成: ${successCount}个成功, ${failCount}个失败 🎉`);
            open.value = false;
            flowers();
            successModal.value = true;
            setTimeout(() => {
                updateOneDomainMonitor(sslInfo.value.subdomain);
            }, 3000);
        } else {
            notification.error({
                message: '证书推送失败',
                description: '所有平台推送均失败，请检查配置',
                duration: 10
            });
        }
    } catch (e) {
        notification.error({
            message: '证书推送过程中出错',
            description: e.toString(),
            duration: 10
        });
    } finally {
        confirmLoading.value = false;
    }
};

const openModal = (ssl) => {
    init();
    if (allPlatform.value.length === 0) {
        message.error("请先添加推送平台");
        return router.push({name: 'PushPlatform'});
    }
    if (ssl) {
        form.ssl = ssl._id;
        sslInfo.value = ssl;
    }
    open.value = true;
}

const indicator = h(SettingOutlined, {
    style: {
        fontSize: '30px',
    },
    spin: true,
});

const setPaltform = () => {
    const platform = allPlatform.value.find(item => item._id === form.platform);
    if (platform) {
        paltformInfo._id = platform._id;
        paltformInfo.platform_type = platform.platform_type;
        paltformInfo.tag = platform.tag;
        paltformInfo.config = platform.config;
    }
}

const togglePushMode = (checked) => {
    if (!checked) { // 单平台模式
        form.platforms = [];
        form.platform = allPlatform.value.length > 0 ? allPlatform.value[0]._id : undefined;
        setPaltform();
    } else { // 多平台模式
        form.platform = undefined;
        form.platforms = [];
    }
}

const init = () => {
    refreshAllSSL()
    refreshPushplatform()
    paltformInfo._id = '';
    form.platform = undefined;
    form.platforms = [];
    form.ssl = undefined;
    sslInfo.value = null;
    successModal.value = false;
    confirmLoading.value = false;
    isDoing.value = false;
    steps.value = [];
    pushResults.value = [];
    togglePushMode(false); // 默认为单平台模式
}

</script>

<template>
    <div class="push-container">
        <a-modal v-model:open="open" title="SSL证书推送" :cancel-button-props="{ disabled: confirmLoading }"
                 ok-text="开始推送"
                 cancel-text="取消" :confirm-loading="confirmLoading" @ok="handleOk" width="500px">
            <div style="height: 20px;"></div>
            <a-form :model="form" v-if="!isDoing">
                <a-form-item label="选择证书">
                    <a-select v-model:value="form.ssl" show-search>
                        <a-select-option v-for="item in allSSL" :key="item._id" :value="item._id">
                            {{ item.subdomain }}
                        </a-select-option>
                    </a-select>
                </a-form-item>

                <a-form-item label="多平台推送">
                    <a-switch @change="togglePushMode" :checked="form.platform === undefined"/>
                    <span style="margin-left: 8px;font-size: 12px;">单平台可修改推送参数，多平台不可修改</span>
                </a-form-item>

                <a-form-item label="推送平台" v-if="form.platform !== undefined">
                    <a-select v-model:value="form.platform" show-search @change="setPaltform">
                        <a-select-option v-for="item in allPlatform" :key="item._id" :value="item._id">
                            {{ getPushplatformInfo(item.platform_type, 'name') }} - {{ item.tag }}
                        </a-select-option>
                    </a-select>
                </a-form-item>

                <template v-if="form.platform !== undefined">
                    <template v-if="paltformInfo.platform_type === 'ssh'">
                        <a-form-item label="主机地址">
                            <a-input disabled :value="`${paltformInfo.config.host}:${paltformInfo.config.port}`"
                                     placeholder="请输入主机IP或域名"/>
                        </a-form-item>
                        <a-form-item label="证书路径">
                            <a-input v-model:value="paltformInfo.config.certPath"
                                     placeholder="证书存放路径，具体到文件"/>
                        </a-form-item>
                        <a-form-item label="私钥路径">
                            <a-input v-model:value="paltformInfo.config.keyPath" placeholder="私钥存放路径，具体到文件"/>
                        </a-form-item>
                        <a-form-item label="前置命令">
                            <a-input v-model:value="paltformInfo.config.beforePushCommand" placeholder="更新证书前的操作， 如 通过sudo授予目录权限"/>
                        </a-form-item>
                         <a-form-item label="后置命令">
                            <a-input v-model:value="paltformInfo.config.restartCommand" placeholder="更新证书后的操作， 例 nginx -s reload"/>
                        </a-form-item>
                    </template>
                    <template v-if="paltformInfo.platform_type === 'qiniu'">
                        <a-form-item label="CDN域名" extra="如果设置了该值，会尝试将证书直接绑定到该域名上">
                            <a-input v-model:value="paltformInfo.config.cdnDomain" placeholder="[选填] CDN域名"/>
                        </a-form-item>
                    </template>
                </template>

                <a-form-item label="推送平台" v-else>
                    <a-select
                        v-model:value="form.platforms"
                        mode="multiple"
                        show-search
                        placeholder="请选择多个推送平台"
                        style="width: 100%"
                    >
                        <a-select-option v-for="item in allPlatform" :key="item._id" :value="item._id">
                            {{ getPushplatformInfo(item.platform_type, 'name') }} - {{ item.tag }}
                        </a-select-option>
                    </a-select>
                </a-form-item>
            </a-form>

            <div v-else>
                <p v-for="(i, index) in steps" :key="index" v-html="i"></p>
                <div style="width: 100%;text-align: center;padding-top: 20px;" v-if="confirmLoading">
                    <a-spin :indicator="indicator" tip="正在推送中，请勿退出程序"/>
                </div>
            </div>
        </a-modal>

        <a-modal v-model:open="successModal" :footer="false" width="500px">
            <template #title>
                <a-flex justify="center">
                    <a-typography-title :level="5">
                        🎉🎉证书推送成功🎉🎉
                    </a-typography-title>
                </a-flex>
            </template>

            <a-space direction="vertical" style="width: 100%">
                <div>证书已成功推送到 <span
                    :style="{ color: colorPrimary }">{{ pushResults.filter(r => r.success).length }}</span> 个平台
                </div>

                <a-collapse v-if="pushResults.length > 0">
                    <a-collapse-panel v-for="(result, index) in pushResults" :key="index"
                                      :header="result.platform.tag + (result.success ? ' ✅' : ' ❌')">
                        <template v-if="result.success">
                            <div v-if="result.msg" v-html="result.msg"></div>
                            <template v-if="result.platform.platform_type === 'ssh'">
                                <a-typography-text>证书文件路径: {{
                                        result.platform.config?.certPath
                                    }}
                                </a-typography-text>
                                <br/>
                                <a-typography-text>私钥文件路径: {{
                                        result.platform.config?.keyPath
                                    }}
                                </a-typography-text>
                            </template>
                        </template>
                        <template v-else>
                            <a-typography-text type="danger">{{ result.error || '推送失败' }}</a-typography-text>
                        </template>
                    </a-collapse-panel>
                </a-collapse>
            </a-space>
        </a-modal>
    </div>
</template>

<style scoped lang="scss">
</style>