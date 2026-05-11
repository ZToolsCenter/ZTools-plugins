import {httpsRequest} from '@/utils/http';
import dayjs from "dayjs";
import {containsAnySubstring} from "@/utils/tool";

const renewLink = "https://www.spaceship.com/zh/application/domain-list-application/"


class SpaceshipDnsService {


    constructor(apiKey, apiSecret) {
        this.apiKey = apiKey;
        this.apiSecret = apiSecret;
        this.apiBase = 'spaceship.dev';
        this.dnsServer = ["spaceship"]
        this.type2ValueNameMap = {
            "A": "address",
            "AAAA": "address",
            "TXT": "value",
            "CNAME": "cname",
            "NS": "nameserver",
        }
    }

    async listDomains() {
        let pageSize = 100, offset = 0;
        let domains = [];
        while (true) {
            let action = `api/v1/domains?take=${pageSize}&skip=${offset}`;
            const {total, items} = await this._spaceshopRest(action, 'GET');
            if (total === 0) {
                break;
            }
            domains = domains.concat(items);
            if (total < (pageSize + offset)) {
                break;
            }
            offset += pageSize;
        }
        const now = new Date().getTime();
        return domains.filter(r => {
            const expTime = new Date(r.expirationDate).getTime()
            return now < expTime && containsAnySubstring(this.dnsServer, r?.nameservers?.hosts?.[0])
        }).map(item => {
            return {
                domain: item.unicodeName,
                cloud: "spaceship",
                expire_time: item.expirationDate ? dayjs(item.expirationDate).format('YYYY-MM-DD HH:mm:ss') : '',
                renew_link: item.expirationDate ? renewLink : ""
            }
        });
    }

    async listRecords(domain) {
        let pageSize = 500, offset = 0;
        let records = [];
        while (true) {
            const action = `api/v1/dns/records/${domain}?take=${pageSize}&skip=${offset}`;
            const res = await this._spaceshopRest(action, 'GET');
            const {total, items} = res;
            if (total === 0) {
                break;
            }
            records = records.concat(items);
            if (total < (pageSize + offset)) {
                break;
            }
            offset += pageSize;
        }
        return {
            count: records.length,
            list: records.map(item => {
                return {
                    RecordId: `${item.type}##${item.name}`,
                    Name: item.name,
                    Type: item.type,
                    TTL: item.ttl,
                    Value: item[this.type2ValueNameMap[item.type]]
                }
            })
        }
    }

    async addRecord(domain, record) {
        const action = `api/v1/dns/records/${domain}`;
        const item = {
            type: record.type,
            name: record.name,
            ttl: record.ttl
        }
        item[this.type2ValueNameMap[record.type]] = record.value;


        const payload = JSON.stringify({
            force: true,
            items: [item]
        });
        const {detail, data} = await this._spaceshopRest(action, 'PUT', payload);
        if (detail) {
            throw new Error(data[0]?.details || detail);
        }
    }

    async deleteRecord(domain, RecordId, record = null) {

        // 遗留问题，没想到删除的操作还有不用id的 是我见识短浅了

        if (null === record) {
           record = (await this.listRecords(domain)).list.find(item => item.RecordId === RecordId);
        }

        const action = `api/v1/dns/records/${domain}`;
        const item = {
            type: record.Type,
            name: record.Name,
        }
        item[this.type2ValueNameMap[record.Type]] = record.Value;
        const payload = JSON.stringify([item]);
        const {detail, data} = await this._spaceshopRest(action, "DELETE", payload);
        if (detail) {
            throw new Error(data[0]?.details || detail);
        }
    }

    _spaceshopRest(action, method, payload = null) {
        const options = {
            hostname: this.apiBase,
            path: `/${action}`,
            method: method,
            headers: {
                'X-Api-Secret': this.apiSecret,
                'X-Api-Key': this.apiKey,
                'Content-Type': 'application/json'
            }
        };
        return httpsRequest(options, payload, true);
    }
}

export default SpaceshipDnsService;