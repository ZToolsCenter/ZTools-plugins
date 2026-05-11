import {message, Modal, notification} from "ant-design-vue";
import {createVNode, h} from "vue";
import {ExclamationCircleOutlined} from "@ant-design/icons-vue";
import {getDnsService} from "./DnsService";
import {saveDomain} from "@/utils/tool";
export function afterCommon(editObj, ok, fail = null) {
    Modal.confirm({
        title: `是否自动拉取域名`,
        icon: createVNode(ExclamationCircleOutlined),
        content: `自动获取该账号下域名列表？`,
        okText: '确定',
        cancelText: '不了',
        onOk() {
            const hide = message.loading('正在自动拉取域名...', 0);
            const dnsService = getDnsService(editObj.account_key, editObj.cloud_key, editObj.tokens, true)
            dnsService.listDomains().then(res => {
                if (res.length === 0) {
                    notification.warn({
                        message: '操作提示',
                        description: h('div', null, [
                            h('p', null, '未获取到任何有效域名'),
                            h('div', null, [
                                '请检查域名',
                                h('span', {style: {color: "#f03e3e"}}, " DNS服务器 "),
                                `是否为`,
                                h('span', {style: {color: `${editObj.cloud_info.color}` || "#f03e3e"}}, ` ${editObj.cloud_info.title}`)
                            ]),
                        ]),
                        duration: 10
                    });
                } else {
                    let successMsg = [];
                    res.forEach(item => {
                        const extra = {...item, account_key: editObj.account_key}
                        console.log("extra", extra)
                        saveDomain(item.domain, item.cloud, extra)
                        successMsg.push(item.domain)
                    })
                    notification.success({
                        message: '操作成功',
                        description: h('div', null, [
                            h('p', null, `成功绑定 ${successMsg.length} 个域名`),
                            h('div', null, successMsg.map(item => {
                                return h('div', {style: {color: `${editObj.cloud_info.color}` || "#f03e3e"}}, item)
                            }))
                        ]),
                        duration: 4
                    });
                }
                if (ok !== null) {
                    ok()
                }
            }).catch((e) => {
                console.error(e)
                notification.error({
                    message: '操作失败',
                    description: e.toString(),
                    duration: 10
                });
            }).finally(() => {
                hide()
            })
        },
        onCancel() {
            if (fail) {
                fail()
            }
        },
    });
}