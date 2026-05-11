import {containsAnySubstring, getDnsServer} from "@/utils/tool";

const crypto = preload.crypto;
import {httpsRequest} from '@/utils/http';


/**通用list列表
 *
 * Type 解析类型
 * Name 主机记录
 * Value 记录值
 * TTL TTL
 * Weight 权重
 * MX
 * Status 状态
 * UpdatedOn 更新时间
 *
 */
// 文档 https://eop.ctyun.cn/ebp/ctapiDocument/search?sid=122&api=11264&data=181&isNormal=1

class TianyiyunDnsService {
    constructor(secretId, secretKey) {
        this.secretId = secretId;
        this.secretKey = secretKey;
    }

    async listDomains() {

    }

    async listRecords(domain) {

    }

    async addRecord(domain, record) {

    }

    async updateRecord(domain, record) {
        // Implement method
    }

    async deleteRecord(domain, recordId) {

    }
}

export default TianyiyunDnsService;