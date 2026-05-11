<script setup>
import {ref, reactive, getCurrentInstance} from "vue";
import {getAllAccount, getItem, getValidCloudData, saveDomain} from "@/utils/tool";
import {message, notification} from "ant-design-vue";
import {getDnsService} from "@/service/DnsService";
import router from "@/router";

const open = ref(false);
const confirmLoading = ref(false);

const {proxy} = getCurrentInstance();

const handleOk = async () => {
    confirmLoading.value = true;
    
    if (!form.domain) {
        message.error("请输入域名");
        confirmLoading.value = false;
        return;
    }
    if (!form.account_key) {
        message.error("请选择云平台账号");
        confirmLoading.value = false;
        return;
    }

    // 处理输入的域名，按行分割并过滤空行
    const domains = form.domain.split('\n')
        .map(d => d.trim())
        .filter(d => d)
        .slice(0, 20); // 限制最多20个域名

    if (domains.length === 0) {
        message.error("请输入有效的域名");
        confirmLoading.value = false;
        return;
    }

    const cloudData = getItem(form.account_key);
    const dns = getDnsService(form.account_key, form.cloud, cloudData.tokens);
    
    const results = {
        success: [],
        failed: []
    };

    // 批量处理域名
    await Promise.all(domains.map(async (domain) => {
        try {
            const r = await dns.checkDomain(domain);
            saveDomain(domain, form.cloud, {
                account_key: form.account_key,
                ...r
            });
            results.success.push(domain);
        } catch (e) {
            results.failed.push({
                domain,
                error: e.toString()
            });
        }
    }));

    confirmLoading.value = false;
    open.value = false;

    // 显示处理结果
    if (results.success.length > 0) {
        message.success(`成功添加 ${results.success.length} 个域名`);
    }
    if (results.failed.length > 0) {
        notification.error({
            message: '部分域名添加失败',
            description: results.failed.map(f => `${f.domain}: ${f.error}`).join('\n'),
            duration: 10
        });
    }

    // 通知刷新数据
    proxy.$eventBus.emit("refresh-domain-list");
};
const validCloud = ref([])
validCloud.value = getValidCloudData()
const openModal = () => {
    confirmLoading.value = false;
    validCloud.value = getAllAccount()
    // // 初始化form
    form.domain = ""
    form.cloud = undefined
    form.account_key = undefined
    // 判断 是否有可用的云解析平台
    if (validCloud.value.length === 0) {
        message.error("请先添加云服务商账号");
        // 页面跳转
        router.push({name: 'AccountManage'});
        return;
    }
    open.value = true;
}
defineExpose({
    openModal
})
const labelCol = {style: {width: '50px'}, span: 5};
const form = reactive({
    domain: "",
    cloud: undefined,
    account_key: undefined,
})

const selectAccount = (id) => {
    form.account_key = id
    form.cloud = validCloud.value.find(i => i._id === id).cloud_key
}
</script>

<template>
    <a-modal v-model:open="open" title="手动添加域名" :confirm-loading="confirmLoading" @ok="handleOk" width="500px">
        <div style="height: 20px;"></div>
        <a-form :label-col="labelCol" :model="form">
            <a-form-item label="主域名">
                <a-textarea 
                    v-model:value="form.domain" 
                    placeholder="请输入域名，每行一个，最多20个域名&#10;例：&#10;baidu.com&#10;google.com"
                    :rows="6"
                    :maxlength="1000"
                ></a-textarea>
            </a-form-item>
            <a-form-item label="云平台">
                <a-select placeholder="请选择云平台账号" @change="selectAccount" v-model:value="form.account_key">
                    <a-select-option  v-for="i in validCloud" :key="i._id">
                        <a-space>
                            <a-image :preview="false" height="18px" :src="i.cloud_info.icon"></a-image>
                            {{ i.cloud_info.title }}-{{ i.tag }}
                        </a-space>
                    </a-select-option>
                </a-select>
            </a-form-item>
        </a-form>
    </a-modal>
</template>

<style scoped lang="scss">

</style>