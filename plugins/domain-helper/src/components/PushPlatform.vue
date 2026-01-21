<script setup>
import {DeleteOutlined, FileAddOutlined, DownOutlined} from "@ant-design/icons-vue";
import {computed, getCurrentInstance, h, ref, reactive} from "vue";
import {Modal, message, notification, theme} from 'ant-design-vue';
import {
    getAllDomains, getAllPushplatform,
    openDoc, savePushPlatform,
} from "@/utils/tool";
import {PushServiceFactory} from "@/service/PushPlatform/PushService.js";
import {platformTypes} from "@/utils/data";

const {useToken} = theme;
const {token} = useToken();

const searchKey = ref("");
const allPushplatform = ref(getAllPushplatform());
const keySwitch = ref(false);
const isEdit = ref(false);

 // 深度拷贝
const platform_types = JSON.parse(JSON.stringify(platformTypes));

// 添加阿里云 OSS 地域数据
const ossRegions = [
    {
        "value": "cn-hangzhou",
        "label": "华东1（杭州）"
    },
    {
        "value": "cn-shanghai",
        "label": "华东2（上海）"
    },
    {
        "value": "cn-nanjing",
        "label": "华东5（南京-本地地域）"
    },
    {
        "value": "cn-fuzhou",
        "label": "华东6（福州-本地地域）"
    },
    {
        "value": "cn-wuhan",
        "label": "华中1（武汉-本地地域）"
    },
    {
        "value": "cn-qingdao",
        "label": "华北1（青岛）"
    },
    {
        "value": "cn-beijing",
        "label": "华北2（北京）"
    },
    {
        "value": "cn-zhangjiakou",
        "label": "华北3（张家口）"
    },
    {
        "value": "cn-huhehaote",
        "label": "华北5（呼和浩特）"
    },
    {
        "value": "cn-wulanchabu",
        "label": "华北6（乌兰察布）"
    },
    {
        "value": "cn-shenzhen",
        "label": "华南1（深圳）"
    },
    {
        "value": "cn-heyuan",
        "label": "华南2（河源）"
    },
    {
        "value": "cn-guangzhou",
        "label": "华南3（广州）"
    },
    {
        "value": "cn-chengdu",
        "label": "西南1（成都）"
    },
    {
        "value": "cn-hongkong",
        "label": "中国（香港）"
    },
    {
        "value": "us-west-1",
        "label": "美国（硅谷）"
    },
    {
        "value": "us-east-1",
        "label": "美国（弗吉尼亚）"
    },
    {
        "value": "ap-northeast-1",
        "label": "日本（东京）"
    },
    {
        "value": "ap-northeast-2",
        "label": "韩国（首尔）"
    },
    {
        "value": "ap-southeast-1",
        "label": "新加坡"
    },
    {
        "value": "ap-southeast-2",
        "label": "澳大利亚（悉尼）"
    },
    {
        "value": "ap-southeast-3",
        "label": "马来西亚（吉隆坡）"
    },
    {
        "value": "ap-southeast-5",
        "label": "印度尼西亚（雅加达）"
    },
    {
        "value": "ap-southeast-6",
        "label": "菲律宾（马尼拉）"
    },
    {
        "value": "ap-southeast-7",
        "label": "泰国（曼谷）"
    },
    {
        "value": "ap-south-1",
        "label": "印度（孟买）"
    },
    {
        "value": "eu-central-1",
        "label": "德国（法兰克福）"
    },
    {
        "value": "eu-west-1",
        "label": "英国（伦敦）"
    },
    {
        "value": "me-east-1",
        "label": "阿联酋（迪拜）"
    },
    {
        "value": "rg-china-mainland",
        "label": "无地域属性（中国内地）"
    }
];

const form = reactive({
    _id: null,
    tag: "",
    platform_type: "ssh",
    config: platform_types.ssh.config,
});

const refreshPushplatform = () => {
    allPushplatform.value = getAllPushplatform();
};

const filterPushplatform = computed(() => {
    return allPushplatform.value.filter(item => {
        let key = searchKey.value.toString().toLowerCase();
        return item.tag.toLowerCase().includes(key);
    });
});

const getPushplatformInfo = (type, key = null) => {
    return key ? platform_types[type][key] : platform_types[type];
};

const changeCloud = (type) => {
    form.platform_type = type;
    form.config = platform_types[type].config;
};

const editPushplatform = (item) => {
    isEdit.value = true;
    form._id = item._id;
    form.tag = item.tag;
    form.platform_type = item.platform_type;
    form.config = item.config;

    // 设置正确的认证方式
    if (item.config.privateKey) {
        authType.value = 'key';
    } else {
        authType.value = 'password';
    }

    keySwitch.value = true;
};

const duplicatePushPlatform = (item) => {
    isEdit.value = false;
    form._id = "";
    form._rev = "";
    form.tag = `${item.tag} (副本)`;
    form.platform_type = item.platform_type;
    form.config = JSON.parse(JSON.stringify(item.config));

    // 设置正确的认证方式
    if (item.config.privateKey) {
        authType.value = 'key';
        form.config.password = ''; // 清空密码
    } else {
        authType.value = 'password';
        form.config.privateKey = ''; // 清空私钥
    }

    keySwitch.value = true;
};

const importPlatformId = ref(undefined);

const addPushplatform = () => {
    isEdit.value = false;
    form._id = "";
    form._rev = "";
    form.tag = "";
    form.platform_type = "ssh";
    form.config = {
        host: "",
        port: 22,
        username: "",
        password: "",
        privateKey: "",
        certPath: "",
        keyPath: "",
        restartCommand: "",
        beforePushCommand: "",
    };
    importPlatformId.value = undefined;
    keySwitch.value = true;
};

const hideKey = (str) => {
    if (!str) return "未设置";
    if (str.length <= 3) return str;
    return str.slice(0, 4) + "********" + str.slice(-4);
};

const copyText = (text, msg) => {
    if (text) {
        utools.copyText(text);
        message.success(msg || "复制成功");
    }
};

const {proxy} = getCurrentInstance();

const saveLoading = ref(false);

const saveSetting = async () => {
    const tag = form.tag.toString().trim();
    if (!tag) {
        message.error("请填写平台标签");
        return;
    }

    // 根据不同平台类型验证
    if (form.platform_type === 'ssh') {
        if (!form.config.host || !form.config.username ||
            (!form.config.password && !form.config.privateKey)) {
            message.error("请填写完整的SSH连接信息");
            return;
        }
    } else if (form.platform_type === 'qiniu') {
        if (!form.config.accessKey || !form.config.secretKey) {
            message.error("请填写七牛云的 AccessKey 和 SecretKey");
            return;
        }
    } else if (form.platform_type === 'ali') {
        if (!form.config.accessKey || !form.config.secretKey) {
            message.error("请填写阿里云的 AccessKey ID 和 AccessKey Secret");
            return;
        }
        if (!form.config.type) {
            message.error("请选择推送渠道");
            return;
        }
        // 必须勾选推送渠道
        if (form.config.type === 'CDN' && !form.config.cdn_domain) {
            message.error("请填写CDN域名");
            return;
        }
        if (form.config.type === 'OSS' && (!form.config.oss_bucket || !form.config.oss_domain || !form.config.oss_region)) {
            message.error("请填写OSS Bucket名称、域名、地域");
            return;
        }
    }

    saveLoading.value = true;
    try {
        const pushService = PushServiceFactory.getService(form.platform_type);
        await pushService.validate(form.config);

        let data = {
            platform_type: form.platform_type,
            tag: form.tag,
            config: form.config
        };
        savePushPlatform(data, isEdit.value ? form._id : null);
        keySwitch.value = false;
        message.success(`保存成功`);
    } catch (error) {
        message.error(error.message);
    } finally {
        refreshPushplatform();
        saveLoading.value = false;
    }
};

const clearSetting = () => {
    form.tag = "";
    form.config = platformTypes[form.platform_type].config;
    importPlatformId.value = undefined;
};

const deletePushPlatform = (item) => {
    Modal.confirm({
        title: '删除推送平台',
        content: h('div', null, [
            h('div', {style: {margin: '10px 0'}}, [
                '确定删除 ',
                h('span', {style: {color: token.colorPrimary}}, `${getPushplatformInfo(item.platform_type, "name")}-${item.tag}`),
                ' 吗?'
            ]),
            h('div', {style: {color: token.colorTextSecondary}}, '删除前请确保没有域名使用此推送平台')
        ]),
        okText: '确定',
        okType: 'danger',
        cancelText: '取消',
        onOk() {
            deletePushPlatformDo(item);
        }
    });
};

const deletePushPlatformDo = (item) => {
    // 检查是否有域名在使用此推送平台
    let bindDomains = getAllDomains().filter(f => f.push_platform_id === item._id);
    if (bindDomains.length > 0) {
        let vnodes = [];
        bindDomains.forEach(domain => {
            vnodes.push(h('div', {style: {color: token.colorError}}, domain.domain));
        });

        Modal.error({
            title: '无法删除',
            content: h('div', null, [
                h('div', {style: {marginBottom: '10px'}}, '以下域名正在使用此推送平台，请先解除绑定：'),
                h('div', {
                    style: {
                        maxHeight: '200px',
                        overflow: 'auto',
                        padding: '8px',
                        backgroundColor: token.colorBgContainerDisabled
                    }
                }, vnodes)
            ]),
        });
        return;
    }

    try {
        utools.dbStorage.removeItem(item._id);
        message.success(`${getPushplatformInfo(item.platform_type, "name")}-${item.tag} 删除成功`);
        refreshPushplatform();
    } catch (error) {
        message.error('删除失败：' + error.message);
    }
};

const authType = ref('password');

const handleAuthTypeChange = (e) => {
    if (e.target.value === 'password') {
        form.config.privateKey = '';
    } else {
        form.config.password = '';
    }
};

const handleImportChange = (value) => {
    importPlatformId.value = value;
    if (!value) {
        clearSetting();
        return;
    }
    const sourceItem = allPushplatform.value.find(item => item._id === value);
    if (sourceItem) {
        form.tag = `${sourceItem.tag} (副本)`;
        form.platform_type = sourceItem.platform_type;
        form.config = JSON.parse(JSON.stringify(sourceItem.config));

        // 根据配置设置正确的认证方式
        if (form.config.privateKey) {
            authType.value = 'key';
            form.config.password = ''; // 清空密码
        } else {
            authType.value = 'password';
            form.config.privateKey = ''; // 清空私钥
        }
    }
};
</script>

<template>
    <div class="box">
        <div class="header" :style="{ backgroundColor: token.colorBgElevated }">
            <a-space>
                <div class="title" :style="{ color: token.colorText }">
                    推送平台
                </div>
                <div class="desc" :style="{ color: token.colorTextTertiary }">
                    将ssl证书推送至各平台
                </div>
            </a-space>
            <a-space>
                <a-tooltip title="推送平台说明文档">
                    <a-button type="link"
                              @click="openDoc('https://feedback.esion.xyz/#/plugin/1863098983146651648/faqs-more?id=1866663753376526336')">
                        说明文档
                    </a-button>
                </a-tooltip>
                <a-input v-model:value="searchKey" placeholder="输入关键字检索" style="width: 180px;"/>
                <a-button type="primary" @click="addPushplatform()">
                    添加平台
                </a-button>
            </a-space>
        </div>

        <div class="cards_box">
            <a-card v-for="(item, index) in filterPushplatform" :key="index" size="small" hoverable :bordered="true"
                    @click="editPushplatform(item)">
                <template #title>
                    <a-flex align="center" justify="space-between" gap="4">
                        <a-flex align="center" gap="8">
                            <a-tag :color="getPushplatformInfo(item.platform_type,'color')">
                                {{ getPushplatformInfo(item.platform_type, "name") }}
                                {{item.platform_type === 'ali' ? item.config.type : ''}}
                            </a-tag>
                            <span class="platform-tag">{{ item.tag }}</span>
                        </a-flex>
                        <a-space :size="10">
                            <a-tooltip title="复制添加">
                                <FileAddOutlined :style="{ cursor: 'pointer' }"
                                                 @click.stop="duplicatePushPlatform(item)"/>
                            </a-tooltip>
                            <DeleteOutlined :style="{ cursor: 'pointer', color: 'orangered' }"
                                            @click.stop="deletePushPlatform(item)"/>
                        </a-space>
                    </a-flex>
                </template>

                <a-space direction="vertical" style="width: 100%">
                    <!-- SSH类型显示连接信息 -->
                    <template v-if="item.platform_type === 'ssh'">
                        <a-space>
                            <div class="key">主机地址:</div>
                            <a-typography-text style="cursor: pointer"
                                               @click.stop="copyText(item.config.host, '主机地址复制成功')"
                                               class="value">
                                {{ hideKey(item.config.host) }}
                            </a-typography-text>
                        </a-space>
                        <a-space>
                            <div class="key">用户名:</div>
                            <a-typography-text class="value">{{ item.config.username }}</a-typography-text>
                        </a-space>
                        <a-space>
                            <div class="key">证书路径:</div>
                            <a-typography-text style="cursor: pointer; max-width: 180px"
                                               @click.stop="copyText(item.config.certPath, '证书路径复制成功')"
                                               :content="item.config.certPath"
                                               ellipsis
                                               class="value">
                                {{ item.config.certPath }}
                            </a-typography-text>
                        </a-space>
                        <a-space>
                            <div class="key">密钥路径:</div>
                            <a-typography-text style="cursor: pointer; max-width: 180px"
                                               @click.stop="copyText(item.config.keyPath, '密钥路径复制成功')"
                                               :content="item.config.keyPath"
                                               ellipsis
                                               class="value">
                                {{ item.config.keyPath }}
                            </a-typography-text>
                        </a-space>
                    </template>

                    <!-- 七牛云类型显示信息 -->
                    <template v-if="item.platform_type === 'qiniu'">
                        <a-space>
                            <div class="key">AccessKey:</div>
                            <a-typography-text class="value">{{ hideKey(item.config.accessKey) }}</a-typography-text>
                        </a-space>
                        <a-space>
                            <div class="key">SecretKey:</div>
                            <a-typography-text class="value">{{ hideKey(item.config.secretKey) }}</a-typography-text>
                        </a-space>
                        <a-space v-if="item.config.cdnDomain">
                            <div class="key">CDN域名:</div>
                            <a-typography-text class="value">{{ item.config.cdnDomain }}</a-typography-text>
                        </a-space>
                    </template>

                    <!-- 阿里云类型显示信息 -->
                    <template v-if="item.platform_type === 'ali'">
                        <a-space>
                            <div class="key">AccessKey ID:</div>
                            <a-typography-text class="value">{{ hideKey(item.config.accessKey) }}</a-typography-text>
                        </a-space>
                        <a-space>
                            <div class="key">AccessKey Secret:</div>
                            <a-typography-text class="value">{{ hideKey(item.config.secretKey) }}</a-typography-text>
                        </a-space>
                        <a-space v-if="item.config.type === 'CDN'">
                            <div class="key">CDN域名:</div>
                            <a-typography-text class="value">{{ item.config.cdn_domain }}</a-typography-text>
                        </a-space>
                        <a-space v-if="item.config.type === 'OSS'">
                            <div class="key">OSS域名:</div>
                            <a-typography-text class="value">{{ item.config.oss_domain }}</a-typography-text>
                        </a-space>
                    </template>
                </a-space>
            </a-card>

            <a-empty style="margin: 20vh auto 0;" v-if="filterPushplatform.length === 0">
                <template #description>
                    <p :style="{ color: token.colorTextLabel }">
                        暂无推送平台信息
                    </p>
                    <a-button type="primary" @click="addPushplatform">添加平台</a-button>
                </template>
            </a-empty>
        </div>

        <a-drawer placement="right" v-model:open="keySwitch" width="400px">
            <template #title>
                <a-flex justify="space-between" align="center">
                    <span style="font-size: 16px;">{{ isEdit ? `编辑平台` : '添加平台' }}</span>
                    <a @click="openDoc('https://feedback.esion.xyz/#/plugin/1863098983146651648/faqs-more?id=1866663753376526336')">说明文档</a>
                </a-flex>
            </template>
            <a-form layout="vertical">
                <a-form-item v-if="!isEdit && allPushplatform.length > 0" label="快速导入"
                             extra="选择一个现有平台来快速填充配置信息">
                    <a-select show-search v-model:value="importPlatformId" placeholder="从现有平台导入配置"
                              style="width: 100%"
                              @change="handleImportChange" allowClear>
                        <a-select-option v-for="item in allPushplatform" :key="item._id" :value="item._id">
                            {{ getPushplatformInfo(item.platform_type, "name") }} - {{ item.tag }}
                        </a-select-option>
                    </a-select>
                </a-form-item>
                <a-form-item label="选择类型">
                    <a-select v-model:value="form.platform_type" @change="changeCloud" style="width: 100%">
                        <a-select-option :value="i.key" v-for="i of platform_types" :key="i.key">
                            <a-space>
                                {{ i.title }}
                            </a-space>
                        </a-select-option>
                    </a-select>
                </a-form-item>
                <a-form-item label="平台标签">
                    <a-input v-model:value="form.tag" :maxlength="20"
                             placeholder="平台标签 例如 个人博客、测试服务器等"/>
                </a-form-item>

                <!-- SSH 配置表单项 -->
                <template v-if="form.platform_type === 'ssh'">
                    <a-form-item label="主机地址">
                        <a-input v-model:value="form.config.host" placeholder="服务器IP或域名"/>
                    </a-form-item>
                    <a-form-item label="SSH端口">
                        <a-input-number v-model:value="form.config.port" :min="1" :max="65535" style="width: 100%"/>
                    </a-form-item>
                    <a-form-item label="用户名">
                        <a-input v-model:value="form.config.username" placeholder="SSH用户名"/>
                    </a-form-item>
                    <a-form-item label="认证方式">
                        <a-radio-group v-model:value="authType" @change="handleAuthTypeChange">
                            <a-radio value="password">密码认证</a-radio>
                            <a-radio value="key">密钥认证</a-radio>
                        </a-radio-group>
                    </a-form-item>
                    <a-form-item v-if="authType === 'password'" label="密码">
                        <a-input-password v-model:value="form.config.password" placeholder="SSH密码"/>
                    </a-form-item>
                    <a-form-item v-if="authType === 'key'" label="私钥">
                        <a-textarea v-model:value="form.config.privateKey" :rows="4" placeholder="SSH私钥内容"/>
                    </a-form-item>
                    <a-form-item label="证书路径">
                        <a-input v-model:value="form.config.certPath" placeholder="服务器上的证书存放路径，包含文件名"/>
                    </a-form-item>
                    <a-form-item label="密钥路径">
                        <a-input v-model:value="form.config.keyPath" placeholder="服务器上的密钥存放路径，包含文件名"/>
                    </a-form-item>
                    <a-form-item label="前置命令">
                        <a-textarea v-model:value="form.config.beforePushCommand"
                                    placeholder="更新证书前的操作， 如 通过sudo授予目录权限"/>
                    </a-form-item>
                    <a-form-item label="后置命令">
                        <a-textarea v-model:value="form.config.restartCommand"
                                    placeholder="更新证书后的操作， 例 nginx -s reload"/>
                    </a-form-item>
                </template>

                <!-- 七牛云配置表单 -->
                <template v-if="form.platform_type === 'qiniu'">
                    <a-form-item label="AccessKey">
                        <a-input v-model:value="form.config.accessKey" placeholder="七牛云 AccessKey"/>
                    </a-form-item>
                    <a-form-item label="SecretKey">
                        <a-input-password v-model:value="form.config.secretKey" placeholder="七牛云 SecretKey"/>
                    </a-form-item>
                    <a-form-item label="CDN域名"
                                 extra="如果填写了CDN域名，证书会自动绑定到该域名，否则只会上传到证书管理">
                        <a-input extra="" v-model:value="form.config.cdnDomain"
                                 placeholder="可选，如需自动绑定CDN域名请填写"/>
                    </a-form-item>
                </template>

                <!-- 阿里云配置表单 -->
                <template v-if="form.platform_type === 'ali'">
                    <a-form-item label="AccessKey ID">
                        <a-input v-model:value="form.config.accessKey" placeholder="阿里云 AccessKey ID"/>
                    </a-form-item>
                    <a-form-item label="AccessKey Secret">
                        <a-input v-model:value="form.config.secretKey" placeholder="阿里云 AccessKey Secret"/>
                    </a-form-item>
                    <a-form-item label="推送渠道">
                        <a-segmented block v-model:value="form.config.type" :options="['SSL', 'CDN', 'OSS']"/>
                    </a-form-item>
                    <a-form-item label="CDN域名" v-if="form.config.type === 'CDN'">
                        <a-input v-model:value="form.config.cdn_domain" placeholder="CDN绑定的自定义域名"/>
                    </a-form-item>
                    <template v-if="form.config.type === 'OSS'">
                        <a-form-item label="Bucket名称">
                            <a-input v-model:value="form.config.oss_bucket" placeholder="Bucket名称"/>
                        </a-form-item>
                        <a-form-item label="Bucket域名">
                            <a-input v-model:value="form.config.oss_domain" placeholder="Bucket绑定的自定义域名"/>
                        </a-form-item>
                         <a-form-item label="Bucket地域">
                            <a-select v-model:value="form.config.oss_region" show-search placeholder="请选择Bucket所在地域" style="width: 100%">
                                <a-select-option v-for="region in ossRegions" :key="region.value" :value="region.value">
                                    {{ region.label }}
                                </a-select-option>
                            </a-select>
                        </a-form-item>
                    </template>
                </template>

                <a-form-item>
                    <a-space>
                        <a-button type="primary" @click="saveSetting" :loading="saveLoading">
                            {{ isEdit ? '保存' : '添加' }}
                        </a-button>
                        <a-button @click="clearSetting">清空</a-button>
                    </a-space>
                </a-form-item>
            </a-form>
        </a-drawer>
    </div>
</template>

<style scoped lang="scss">
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
        border-bottom: 1px dashed v-bind('token.colorBorder');

        .title {
            font-size: 20px;
            font-weight: 500;
        }

        .desc {
            font-size: 12px;
        }
    }

    .cards_box {
        padding: 16px;
        height: calc(100vh - 60px);
        display: grid;
        overflow: auto;
        grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
        grid-auto-rows: min-content;
        gap: 16px;
        max-width: 100%;
        justify-content: center;

        :deep(.ant-card) {
            height: fit-content;
        }

        @media screen and (max-width: 1000px) {
            grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
        }

        :global(.content-expanded) & {
            grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
        }

        // 当只有一个卡片时限制宽和高度
        &:has(> :only-child) {
            display: flex;
            justify-content: flex-start;
            align-items: flex-start;

            :deep(.ant-card) {
                width: 45%;
                flex-shrink: 0;
            }
        }
    }
}

.key {
    color: v-bind('token.colorTextSecondary');
    min-width: 60px;
}

.value {
    color: v-bind('token.colorText');
}

.platform-tag {
    max-width: 160px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    display: inline-block;
}
</style>