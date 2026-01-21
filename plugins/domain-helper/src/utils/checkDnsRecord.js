import {httpGet} from "@/utils/http";
import {TcpmkDnsTool} from "@/utils/TcpmkDnsTool";

const dns = preload.dns.promises

const WAY_MAP = {
    google: "https://dns.google/resolve", // 需代理
    cloudflare: "https://cloudflare-dns.com/dns-query", // 需代理
    one: "https://1.1.1.1/dns-query",
}

export async function checkDnsRecord(domain, expectedValue, timeout = 60, interval = 5, way = "one", callback = null) {
    timeout *= 1000
    interval *= 1000
    const originalDomain = domain;
    // 如果是泛域名 干掉泛域名前缀
    if (domain.indexOf('*') !== -1) {
        domain = domain.replace('*.', '');
    }
    domain = `_acme-challenge.${domain}`;

    const endTime = Date.now() + timeout;
    let times = 0;
    let lastError = null;
    let flag = false;
    while (Date.now() < endTime) {
        times++;
        callback && callback('checkDnsRecord', {
            msg: `${originalDomain} 第${times}次检查 DNS 记录...`,
            times,
            domain: domain
        });
        try {
            if (way === "local") {
                flag = await checkDnsRecordByLocal(domain, expectedValue);
            } else if (way === "tcpmk") {
                flag = await TcpmkDnsTool.checkDnsRecord(domain, "TXT", expectedValue);
            } else {
                flag = await checkDnsRecordByNet(domain, expectedValue, way);
            }
        } catch (e) {
            lastError = e.message;
        }
        if (flag) {
            callback && callback('checkDnsRecord_success', {
                msg: `${originalDomain} DNS记录已生效 🎉`,
                times,
                domain: domain
            });
            return flag;
        }
        await new Promise(resolve => setTimeout(resolve, interval));
    }
    throw new Error(`域名 ${originalDomain} DNS记录验证失败: ${lastError}。\n已尝试${times}次，您可以：\n1. 检查DNS记录是否正确添加\n2. 等待1-2分钟后重试\n3. 如果问题持续，请检查域名DNS服务器是否正常`);
}


export async function checkDnsRecordByLocal(domain, expectedValue) {
    try {
        const records = await dns.resolveTxt(domain);
        const flatRecords = records.flat();
        return !!flatRecords.includes(expectedValue);
    } catch (err) {
        return false;
    }
}

export async function checkDnsRecordByNet(domain, expectedValue, way) {
    const {
        Status,
        Answer
    } = await httpGet(`${WAY_MAP[way]}?name=${domain}&type=TXT`, {"Accept": "application/dns-json"})
    if (Status !== 0) {
        return false;
    }
    // 检查是否有记录
    if (!Answer || Answer.length === 0) {
        return false;
    }
    // 检查记录是否正确
    return Answer.some(item => {
        return item.name === domain && (item.data === expectedValue || item.data === `"${expectedValue}"`);
    });
}