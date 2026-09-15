const os = require('os');
const dns = require('dns');
const net = require('net');
const tls = require('tls');
const http = require('http');
const https = require('https');
const { URL } = require('url');
const { execFile } = require('child_process');

const SITES = [
    { id: 'baidu', name: '百度搜索', region: '境内网站', url: 'https://www.baidu.com', probe: 'https://www.baidu.com/favicon.ico' },
    { id: 'netease', name: '网易云', region: '境内网站', url: 'https://music.163.com', probe: 'https://music.163.com/favicon.ico' },
    { id: 'github', name: 'GitHub', region: '境外网站', url: 'https://github.com', probe: 'https://github.com/favicon.ico' },
    { id: 'google', name: 'Google', region: '境外网站', url: 'https://www.google.com', probe: 'https://www.google.com/generate_204' },
    { id: 'aliyun', name: '阿里云', region: '境内网站', url: 'https://www.aliyun.com', probe: 'https://www.aliyun.com/favicon.ico' },
    { id: 'tencent', name: '腾讯云', region: '境内网站', url: 'https://cloud.tencent.com', probe: 'https://cloud.tencent.com/favicon.ico' },
    { id: 'chatgpt', name: 'ChatGPT', region: '境外网站', url: 'https://chatgpt.com', probe: 'https://chatgpt.com/favicon.ico' },
    { id: 'cursor', name: 'Cursor', region: '境外网站', url: 'https://cursor.com', probe: 'https://cursor.com/favicon.ico' }
];

const UA = 'e-de-ip/1.0.4 (ztools plugin; +https://github.com/DoneVirtue)';

const HK_DISTRICTS = [
    ['Central and Western', '中西区'],
    ['Wan Chai', '湾仔区'],
    ['Eastern', '东区'],
    ['Southern', '南区'],
    ['Yau Tsim Mong', '油尖旺区'],
    ['Sham Shui Po', '深水埗区'],
    ['Kowloon City', '九龙城区'],
    ['Wong Tai Sin', '黄大仙区'],
    ['Kwun Tong', '观塘区'],
    ['Kwai Tsing', '葵青区'],
    ['Tsuen Wan', '荃湾区'],
    ['Tuen Mun', '屯门区'],
    ['Yuen Long', '元朗区'],
    ['North', '北区'],
    ['Tai Po', '大埔区'],
    ['Sai Kung', '西贡区'],
    ['Sha Tin', '沙田区'],
    ['Islands', '离岛区']
];

const TRAD_MAP = {
    '區': '区',
    '圍': '围',
    '園': '园',
    '國': '国',
    '門': '门',
    '東': '东',
    '灣': '湾',
    '島': '岛',
    '觀': '观',
    '樂': '乐',
    '麗': '丽',
    '處': '处',
    '場': '场',
    '遊': '游',
    '業': '业',
    '廣': '广',
    '臺': '台',
    '裡': '里',
    '裏': '里',
    '陽': '阳',
    '龍': '龙',
    '鄉': '乡',
    '鎮': '镇',
    '縣': '县',
    '學': '学',
    '館': '馆',
    '廟': '庙',
    '橋': '桥',
    '點': '点',
    '號': '号',
    '顯': '显',
    '與': '与',
    '餘': '余',
    '術': '术',
    '頭': '头',
    '徑': '径',
    '埗': '埗'
};

const PUBLIC_IP_URLS = [
    'https://my.ip.cn',
    'http://ip.3322.net/',
    'https://ip.3322.net/',
    'http://members.3322.org/dyndns/getip',
    'https://ddns.oray.com/checkip',
    'https://whois.pconline.com.cn/ipJson.jsp?json=true',
    'https://myip.ipip.net'
];

const OVERSEAS_IP_URLS = [
    'https://api.ipgeolocation.io/getip',
    'https://ipv4.icanhazip.com',
    'https://api4.ipify.org',
    'https://v4.ident.me',
    'https://ifconfig.me/ip'
];

const geoCache = new Map();
const listeners = new Set();
const copyTimers = {};
let state = emptyState();
let overseasProxy = null;
let workId = 0;
let geoFillTimer = null;
let overseasPending = 0;
let overseasAwaitProxy = false;

function stillCurrent(id) {
    return id === workId;
}

function emptyState() {
    return {
        interfaces: [],
        selectedIface: 'auto',
        autoCopy: false,
        proxyLabel: '',
        tun: false,
        copiedKey: '',
        lan: { ip: '', iface: '', label: '' },
        public: { ip: '', geo: '', loading: true },
        overseas: { ip: '', geo: '', loading: true, token: 0 },
        location: { text: '', loading: true },
        sites: SITES.map((s) => ({...s, ms: null, status: 'loading', needPage: true, token: 0 })),
        dns: [],
        dnsLoading: true,
        keys: { amap: '', qq: '', ipgeo: '' }
    };
}

function emit() {
    const snapshot = JSON.parse(JSON.stringify(state));
    listeners.forEach((fn) => {
        try { fn(snapshot); } catch (e) {}
    });
}

function getPref(key, fallback) {
    try {
        const value = ztools.dbStorage.getItem(key);
        return value == null ? fallback : value;
    } catch (e) {
        return fallback;
    }
}

function setPref(key, value) {
    try { ztools.dbStorage.setItem(key, value); } catch (e) {}
}

function loadKeys() {
    return {
        amap: String(getPref('keyAmap', '') || '').trim(),
        qq: String(getPref('keyQq', '') || '').trim(),
        ipgeo: String(getPref('keyIpgeo', '') || '').trim()
    };
}

function apiKeys() {
    return state.keys || loadKeys();
}

function listInterfaces() {
    const nets = os.networkInterfaces() || {};
    const list = [];
    Object.keys(nets).forEach((name) => {
        (nets[name] || []).forEach((net) => {
            const family = String(net.family);
            if (net.internal) return;
            if (family !== 'IPv4' && family !== '4') return;
            if (/^198\.1[89]\./.test(net.address)) return;
            if (/^(utun|tun|wg)\d*$/i.test(name) || /wintun|clash|meta|mihomo|sing-box/i.test(name)) return;
            list.push({ name, address: net.address });
        });
    });
    return list;
}

function pickLan(interfaces, selectedIface) {
    if (!interfaces.length) return { ip: '', iface: '', label: '未检测到内网地址' };
    let chosen = interfaces[0];
    if (selectedIface && selectedIface !== 'auto') {
        chosen = interfaces.find((item) => item.name === selectedIface) || chosen;
    } else {
        chosen = interfaces.find((item) => /^(en0|eth0|wlan0|Wi-Fi)$/i.test(item.name)) || chosen;
    }
    return {
        ip: chosen.address,
        iface: chosen.name,
        label: chosen.name + ' / ' + chosen.address
    };
}

function parseProxyUrl(raw) {
    if (!raw) return null;
    try {
        const u = new URL(/:\/\//.test(raw) ? raw : 'http://' + raw);
        const proto = (u.protocol || 'http:').replace(':', '').toLowerCase();
        const type = proto.indexOf('socks') >= 0 ? 'socks' : 'http';
        const port = Number(u.port) || (type === 'socks' ? 1080 : 8080);
        if (!u.hostname || !port) return null;
        return { type, host: u.hostname, port };
    } catch (e) {
        return null;
    }
}

function parseScutilProxy(text) {
    const num = (key) => {
        const match = String(text || '').match(new RegExp(key + '\\s*:\\s*(\\d+)'));
        return match ? Number(match[1]) : 0;
    };
    const str = (key) => {
        const match = String(text || '').match(new RegExp(key + '\\s*:\\s*(\\S+)'));
        return match ? match[1] : '';
    };
    if (num('HTTPSEnable')) return { type: 'http', host: str('HTTPSProxy'), port: num('HTTPSPort') };
    if (num('HTTPEnable')) return { type: 'http', host: str('HTTPProxy'), port: num('HTTPPort') };
    if (num('SOCKSEnable')) return { type: 'socks', host: str('SOCKSProxy'), port: num('SOCKSPort') };
    return null;
}

function parseWinProxy(text) {
    if (!/ProxyEnable\s+REG_DWORD\s+0x1/i.test(text)) return null;
    const match = text.match(/ProxyServer\s+REG_SZ\s+(\S+)/i);
    if (!match) return null;
    const raw = match[1].replace(/^https?=/, '');
    if (raw.indexOf('=') >= 0) {
        const http = raw.match(/https?=([^;]+)/i);
        return parseProxyUrl(http ? http[1] : raw);
    }
    return parseProxyUrl(raw);
}

function proxyKey(proxy) {
    return proxy.type + '://' + proxy.host + ':' + proxy.port;
}

function formatCurlProxy(proxy) {
    if (!proxy) return '';
    return (proxy.type === 'socks' ? 'socks5h://' : 'http://') + proxy.host + ':' + proxy.port;
}

async function detectSystemProxy() {
    const envProxy = parseProxyUrl(
        process.env.ALL_PROXY || process.env.all_proxy ||
        process.env.HTTPS_PROXY || process.env.https_proxy ||
        process.env.HTTP_PROXY || process.env.http_proxy
    );
    if (process.platform === 'darwin') {
        return parseScutilProxy(await runCmd('scutil', ['--proxy'])) || envProxy;
    }
    if (process.platform === 'win32') {
        return parseWinProxy(await runCmd('reg', ['query', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings'])) || envProxy;
    }
    return envProxy;
}

async function detectTun() {
    if (process.platform === 'darwin') {
        const out = await runCmd('route', ['-n', 'get', '1.1.1.1']);
        const iface = (out.match(/interface:\s+(\S+)/i) || [])[1] || '';
        if (/^utun\d+$/i.test(iface)) return iface;
    } else if (process.platform === 'win32') {
        const out = await runCmd('powershell', [
            '-NoProfile', '-Command',
            '(Get-NetRoute -DestinationPrefix 0.0.0.0/0 | Sort-Object RouteMetric | Select-Object -First 1).InterfaceAlias'
        ]);
        const name = String(out || '').trim();
        if (name && /clash|meta|mihomo|wintun|tun|sing-box|tap|wireguard/i.test(name)) return name;
    } else {
        const out = await runCmd('ip', ['-4', 'route', 'get', '1.1.1.1']);
        const iface = (out.match(/\bdev\s+(\S+)/i) || [])[1] || '';
        if (iface && /^(tun|wg|meta|clash)/i.test(iface)) return iface;
    }
    const nets = os.networkInterfaces() || {};
    const names = Object.keys(nets);
    for (let i = 0; i < names.length; i++) {
        const addrs = nets[names[i]] || [];
        for (let j = 0; j < addrs.length; j++) {
            if (/^198\.1[89]\./.test(addrs[j].address || '')) return names[i];
        }
    }
    return '';
}

function overseasEmptyHint() {
    if (state.tun) return 'TUN';
    if (state.proxyLabel) return '';
    return '未走代理';
}

async function detectProxyCandidates() {
    const list = [];
    const seen = new Set();
    const add = (proxy) => {
        if (!proxy || !proxy.host || !proxy.port) return;
        const key = proxyKey(proxy);
        if (seen.has(key)) return;
        seen.add(key);
        list.push(proxy);
    };
    add(await detectSystemProxy());
    return list;
}

function curlRequest(url, options = {}) {
    const timeout = options.timeout || 7000;
    const method = options.method || 'GET';
    const args = [
        '-sS', '-L', '--max-redirs', '3', '--no-keepalive',
        '--connect-timeout', String(Math.max(2, Math.min(8, Math.ceil(timeout / 1500)))),
        '-m', String(Math.max(2, Math.ceil(timeout / 1000))),
        '-A', UA, '-o', options.discardBody ? (process.platform === 'win32' ? 'NUL' : '/dev/null') : '-',
        '-w', '\n__STAT__%{http_code} %{' + (options.ttfb ? 'time_starttransfer' : 'time_total') + '}',
        '-H', 'Accept: */*',
        '-H', 'Cache-Control: no-cache',
        '-H', 'Pragma: no-cache'
    ];
    if (options.forceIpv4 !== false) args.splice(args.indexOf('-A'), 0, '--ipv4');
    if (method === 'HEAD') args.push('-I');
    else if (method !== 'GET') args.push('-X', method);
    if (options.proxy) args.push('-x', formatCurlProxy(options.proxy));
    args.push(url);
    return new Promise((resolve, reject) => {
        execFile('curl', args, { timeout: timeout + 800, maxBuffer: 512 * 1024 }, (err, stdout) => {
            const text = String(stdout || '');
            const idx = text.lastIndexOf('\n__STAT__');
            const body = idx >= 0 ? text.slice(0, idx) : text;
            const meta = idx >= 0 ? text.slice(idx + 8).trim().split(/\s+/) : ['0', '0'];
            const status = parseInt(meta[0], 10) || 0;
            const sec = parseFloat(meta[1]) || 0;
            if (status === 0) {
                reject(err || new Error('unreachable'));
                return;
            }
            resolve({
                status,
                buffer: Buffer.from(body),
                body,
                ms: Math.max(1, Math.round(sec * 1000))
            });
        });
    });
}

function collectSocketResponse(stream, started, maxBytes) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        let size = 0;
        const finish = () => {
            const buf = Buffer.concat(chunks);
            const split = buf.indexOf('\r\n\r\n');
            const head = split >= 0 ? buf.slice(0, split).toString('latin1') : '';
            const body = split >= 0 ? buf.slice(split + 4) : buf;
            const status = parseInt((head.split(' ')[1] || '0'), 10) || 0;
            const headers = {};
            head.split('\r\n').slice(1).forEach((line) => {
                const i = line.indexOf(':');
                if (i > 0) headers[line.slice(0, i).toLowerCase()] = line.slice(i + 1).trim();
            });
            resolve({
                status,
                headers,
                buffer: body,
                body: body.toString('utf8'),
                ms: Date.now() - started
            });
        };
        stream.on('data', (c) => {
            chunks.push(c);
            size += c.length;
            if (size > (maxBytes || 512 * 1024)) stream.destroy();
        });
        stream.on('end', finish);
        stream.on('error', reject);
        stream.on('timeout', () => {
            stream.destroy();
            reject(new Error('timeout'));
        });
    });
}

function socksConnect(proxy, hostname, port, timeout) {
    return new Promise((resolve, reject) => {
        const sock = net.connect({ host: proxy.host, port: proxy.port, timeout });
        let step = 0;
        let buf = Buffer.alloc(0);
        const fail = (err) => {
            sock.destroy();
            reject(err);
        };
        sock.on('connect', () => sock.write(Buffer.from([0x05, 0x01, 0x00])));
        sock.on('data', (chunk) => {
            buf = Buffer.concat([buf, chunk]);
            if (step === 0) {
                if (buf.length < 2) return;
                if (buf[0] !== 5 || buf[1] !== 0) return fail(new Error('socks auth'));
                buf = buf.slice(2);
                step = 1;
                const hostBuf = Buffer.from(hostname);
                const req = Buffer.alloc(7 + hostBuf.length);
                req[0] = 5; req[1] = 1; req[2] = 0; req[3] = 3; req[4] = hostBuf.length;
                hostBuf.copy(req, 5);
                req.writeUInt16BE(port, 5 + hostBuf.length);
                sock.write(req);
                return;
            }
            if (buf.length < 5) return;
            if (buf[1] !== 0) return fail(new Error('socks fail'));
            const atyp = buf[3];
            const need = atyp === 1 ? 10 : atyp === 4 ? 22 : atyp === 3 ? 7 + buf[4] : 0;
            if (!need || buf.length < need) return;
            sock.removeAllListeners('data');
            resolve(sock);
        });
        sock.on('error', reject);
        sock.on('timeout', () => fail(new Error('timeout')));
    });
}

function httpConnect(proxy, hostname, port, timeout) {
    return new Promise((resolve, reject) => {
        const req = http.request({
            host: proxy.host,
            port: proxy.port,
            method: 'CONNECT',
            path: hostname + ':' + port,
            timeout,
            headers: { Host: hostname + ':' + port }
        });
        req.on('connect', (res, socket) => {
            if (res.statusCode !== 200) {
                socket.destroy();
                reject(new Error('proxy connect ' + res.statusCode));
                return;
            }
            resolve(socket);
        });
        req.on('timeout', () => {
            req.destroy();
            reject(new Error('timeout'));
        });
        req.on('error', reject);
        req.end();
    });
}

function writeHttp(socket, parsed, method, options) {
    const lines = [
        method + ' ' + (parsed.pathname + parsed.search || '/') + ' HTTP/1.1',
        'Host: ' + parsed.hostname,
        'User-Agent: ' + UA,
        'Accept: */*',
        'Cache-Control: no-cache',
        'Pragma: no-cache',
        'Connection: close',
        '',
        ''
    ];
    socket.write(lines.join('\r\n'));
}

function requestViaNodeProxy(url, options, hops) {
    const timeout = options.timeout || 7000;
    const method = options.method || 'GET';
    const proxy = options.proxy;
    const parsed = new URL(url);
    const started = Date.now();
    const port = Number(parsed.port) || (parsed.protocol === 'https:' ? 443 : 80);
    const isHttps = parsed.protocol === 'https:';

    const send = async (socket) => {
        const stream = isHttps
            ? tls.connect({ socket, servername: parsed.hostname, timeout })
            : socket;
        if (stream.setTimeout) stream.setTimeout(timeout);
        if (isHttps) await new Promise((resolve, reject) => {
            stream.once('secureConnect', resolve);
            stream.once('error', reject);
        });
        writeHttp(stream, parsed, method, options);
        const res = await collectSocketResponse(stream, started);
        if (res.status >= 300 && res.status < 400 && res.headers.location && hops < 5) {
            stream.destroy();
            return request(new URL(res.headers.location, url).toString(), options, hops + 1);
        }
        return res;
    };

    if (!isHttps && proxy.type !== 'socks') {
        return new Promise((resolve, reject) => {
            const req = http.request({
                host: proxy.host,
                port: proxy.port,
                method,
                path: url,
                timeout,
                headers: Object.assign({
                    Host: parsed.host,
                    'User-Agent': UA,
                    Accept: '*/*',
                    'Cache-Control': 'no-cache',
                    'Pragma': 'no-cache',
                    'Proxy-Connection': 'close'
                }, options.headers || {})
            }, (res) => {
                if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && hops < 5) {
                    res.resume();
                    request(new URL(res.headers.location, url).toString(), options, hops + 1).then(resolve, reject);
                    return;
                }
                const chunks = [];
                res.on('data', (c) => chunks.push(c));
                res.on('end', () => {
                    const buf = Buffer.concat(chunks);
                    resolve({ status: res.statusCode || 0, buffer: buf, body: buf.toString('utf8'), ms: Date.now() - started });
                });
            });
            req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
            req.on('error', reject);
            req.end();
        });
    }

    const opener = proxy.type === 'socks'
        ? socksConnect(proxy, parsed.hostname, port, timeout)
        : httpConnect(proxy, parsed.hostname, port, timeout);
    return opener.then(send);
}

function request(url, options = {}, hops = 0) {
    if (options.proxy) {
        return curlRequest(url, options).catch(() => requestViaNodeProxy(url, options, hops));
    }
    const timeout = options.timeout || 7000;
    const method = options.method || 'GET';
    return new Promise((resolve, reject) => {
        const go = (target) => {
            let parsed;
            try { parsed = new URL(target); } catch (e) {
                reject(e);
                return;
            }
            const lib = parsed.protocol === 'https:' ? https : http;
            const started = Date.now();
            const reqOpts = {
                protocol: parsed.protocol,
                hostname: parsed.hostname,
                port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
                path: parsed.pathname + parsed.search,
                method,
                timeout,
                headers: Object.assign({
                    'User-Agent': UA,
                    'Accept': '*/*',
                    'Cache-Control': 'no-cache',
                    'Pragma': 'no-cache'
                }, options.headers || {})
            };
            if (options.family) reqOpts.family = options.family;
            const req = lib.request(reqOpts, (res) => {
                if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && hops < 5) {
                    hops += 1;
                    res.resume();
                    go(new URL(res.headers.location, target).toString());
                    return;
                }
                const chunks = [];
                res.on('data', (c) => {
                    chunks.push(c);
                    const size = chunks.reduce((n, b) => n + b.length, 0);
                    if (size > 512 * 1024) res.destroy();
                });
                res.on('end', () => {
                    const buf = Buffer.concat(chunks);
                    resolve({
                        status: res.statusCode || 0,
                        buffer: buf,
                        body: buf.toString('utf8'),
                        ms: Date.now() - started
                    });
                });
            });
            req.on('timeout', () => {
                req.destroy();
                reject(new Error('timeout'));
            });
            req.on('error', reject);
            req.end();
        };
        go(url);
    });
}

function parseJson(text) {
    try {
        return JSON.parse(text);
    } catch (e) {
        return null;
    }
}

function decodeText(buffer, charset) {
    try {
        return new TextDecoder(charset).decode(buffer);
    } catch (e) {
        return Buffer.from(buffer).toString('utf8');
    }
}

function extractIPv4(text) {
    const matches = String(text || '').match(/\b(\d{1,3}(?:\.\d{1,3}){3})\b/g) || [];
    for (let i = 0; i < matches.length; i++) {
        const parts = matches[i].split('.').map(Number);
        if (parts.some((n) => n > 255)) continue;
        if (parts[0] === 0 || parts[0] === 10 || parts[0] === 127) continue;
        if (parts[0] === 169 && parts[1] === 254) continue;
        if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) continue;
        if (parts[0] === 192 && parts[1] === 168) continue;
        return matches[i];
    }
    return '';
}

function extractPublicIPv4(text) {
    const raw = String(text || '').replace(/^\ufeff/, '').trim();
    const fromJson = (obj) => {
        if (!obj || typeof obj !== 'object') return '';
        const candidates = [
            obj.ip, obj.query, obj.cip, obj.origin, obj.address,
            obj.data && (obj.data.ip || obj.data.query)
        ];
        for (let i = 0; i < candidates.length; i++) {
            const ip = extractIPv4(String(candidates[i] || ''));
            if (ip) return ip;
        }
        return '';
    };
    try {
        const ip = fromJson(JSON.parse(raw));
        if (ip) return ip;
    } catch (e) {}
    const sohu = raw.match(/returnCitySN\s*=\s*(\{[\s\S]*?\})/);
    if (sohu) {
        try {
            const ip = fromJson(JSON.parse(sohu[1]));
            if (ip) return ip;
        } catch (e) {}
    }
    return extractIPv4(raw);
}

function extractIPv6(text) {
    const match = String(text || '').match(/\b((?:[0-9a-fA-F]{1,4}:){2,7}[0-9a-fA-F]{1,4})\b/);
    if (!match) return '';
    const ip = match[1];
    if (ip.indexOf('.') >= 0) return '';
    if (/^fe80:/i.test(ip) || /^::1$/.test(ip) || /^fc/i.test(ip) || /^fd/i.test(ip)) return '';
    return ip;
}

function isPrivateIp(ip) {
    const parts = String(ip || '').split('.').map(Number);
    if (parts.length !== 4 || parts.some((n) => Number.isNaN(n))) {
        return /^fe80:/i.test(ip) || /^fc/i.test(ip) || /^fd/i.test(ip) || ip === '::1';
    }
    if (parts[0] === 10 || parts[0] === 127) return true;
    if (parts[0] === 169 && parts[1] === 254) return true;
    if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
    if (parts[0] === 192 && parts[1] === 168) return true;
    return false;
}

async function fetchIPv4(urls, options = {}) {
    return new Promise((resolve) => {
        const list = urls || [];
        if (!list.length) {
            resolve('');
            return;
        }
        let left = list.length;
        let settled = false;
        const finish = (ip) => {
            if (settled) return;
            if (ip) {
                settled = true;
                resolve(ip);
            } else if (left <= 0) {
                settled = true;
                resolve('');
            }
        };
        list.forEach((url) => {
            request(url, {
                timeout: options.timeout || 4000,
                family: options.family || 4,
                proxy: options.proxy
            }).then((res) => {
                left -= 1;
                finish(extractPublicIPv4(res.body));
            }).catch(() => {
                left -= 1;
                finish('');
            });
        });
    });
}

async function fetchIPv6(urls) {
    return new Promise((resolve) => {
        const list = urls || [];
        if (!list.length) {
            resolve('');
            return;
        }
        let left = list.length;
        let settled = false;
        const finish = (ip) => {
            if (settled) return;
            if (ip) {
                settled = true;
                resolve(ip);
            } else if (left <= 0) {
                settled = true;
                resolve('');
            }
        };
        list.forEach((url) => {
            request(url, { timeout: 4000 }).then((res) => {
                left -= 1;
                finish(extractIPv6(res.body));
            }).catch(() => {
                left -= 1;
                finish('');
            });
        });
    });
}

function formatCnAdminLine(text) {
    const tokens = String(text || '').trim().split(/\s+/).filter(Boolean);
    if (!tokens.length) return '';
    if (/移动|联通|电信|广电|铁通|鹏博士/.test(tokens[tokens.length - 1])) tokens.pop();
    return tokens.map((part, idx) => {
        if (/香港|澳门|台湾|特别行政区/.test(part) || /[省市县]$/.test(part)) return part;
        if (idx === 0 && /^(中国|China)$/i.test(part)) return '中国';
        if (idx === tokens.length - 1 && part.length <= 4 && !/[区市州]$/.test(part)) return part + '区';
        return addShi(part);
    }).join(' ');
}

async function fetchMyIpCn() {
    const res = await request('https://my.ip.cn', { timeout: 5000, family: 4 });
    const text = String(res.body || '').replace(/\s+/g, ' ').trim();
    const match = text.match(/ip[：:]\s*(\S+)\s*归属地[：:]\s*(.+)$/i) || text.match(/ip[：:]\s*(\S+)/i);
    const rawIp = match ? match[1] : '';
    const addr = match && match[2] ? match[2].trim() : '';
    return {
        ip: extractPublicIPv4(rawIp || text) || extractIPv6(rawIp || text),
        cnLine: formatCnAdminLine(addr),
        addr
    };
}

async function lookupAmapRegeo(lon, lat) {
    if (lon == null || lat == null) return null;
    const res = await request(
        'https://www.amap.com/service/regeo?longitude=' + encodeURIComponent(lon) + '&latitude=' + encodeURIComponent(lat),
        { timeout: 5000, headers: { Referer: 'https://www.amap.com/' } }
    );
    const json = parseJson(res.body);
    const data = json && (json.data || json);
    if (!data || (data.code !== '1' && data.result !== 'true' && !data.province)) return null;
    const out = {
        country: data.country || '',
        province: data.province || '',
        city: data.city || '',
        district: data.district || '',
        township: data.township || '',
        pos: data.pos || '',
        desc: data.desc || '',
        formatted: compactJoin(String(data.desc || '').split(/[,，]/))
    };
    if (!out.province && !out.city && !out.district && !out.desc && !out.pos) return null;
    return out;
}

function randomId(len) {
    const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
    let out = '';
    for (let i = 0; i < len; i++) out += chars.charAt(Math.floor(Math.random() * chars.length));
    return out;
}

function looksGarbled(text) {
    if (!text) return true;
    if (/[\uFFFD]/.test(text)) return true;
    const cjk = (String(text).match(/[\u4e00-\u9fff]/g) || []).length;
    if (cjk >= 2) return false;
    return /[ÃÅÄÆÉÊÌÍÎÏÐÑÒÓÕÖØÙÚÛÜÝ]/.test(text);
}

function toSimplified(text) {
    return String(text || '').replace(/[區圍園國門東灣島觀樂麗處場遊業廣臺裡裏陽龍鄉鎮縣學館廟橋點號顯與餘術頭徑]/g, (ch) => TRAD_MAP[ch] || ch);
}

function flagEmoji(code) {
    const cc = String(code || '').toUpperCase();
    if (!/^[A-Z]{2}$/.test(cc)) return '';
    return String.fromCodePoint(...[...cc].map((ch) => 0x1F1E6 + ch.charCodeAt(0) - 65));
}

function addShi(name) {
    const text = String(name || '').trim();
    if (!text || /[市区县]$/.test(text) || /香港|澳门|台湾/.test(text)) return text;
    if (/^(北京|天津|上海|重庆)$/.test(text)) return text + '市';
    return text;
}

function shortIsp(info) {
    if (!info) return '';
    const as = String(info.as || '');
    const m = as.match(/^AS\d+\s+(.+)/);
    if (m) return m[1].replace(/\s+Mass Internet$/i, '').trim();
    const org = String(info.org || '').replace(/\s+Mass Internet$/i, '').trim();
    if (org && org.length < 48) return org;
    const isp = String(info.ispEn || info.isp || '').replace(/\s+Mass Internet$/i, '').trim();
    if (/HKT/i.test(isp)) return 'HKT Limited';
    if (/China Mobile/i.test(isp)) return 'China Mobile';
    if (/Google/i.test(isp)) return 'Google';
    return isp;
}

function hkDistrict(info) {
    if (!isHongKong(info)) return '';
    const blob = [info && info.region, info && info.regionEn, info && info.city, info && info.cityEn, info && info.district].join(' ');
    for (let i = 0; i < HK_DISTRICTS.length; i++) {
        if (new RegExp(HK_DISTRICTS[i][0], 'i').test(blob)) return HK_DISTRICTS[i][1];
    }
    const raw = toSimplified(info && (info.district || '') || '');
    if (/区$/.test(raw)) return raw;
    if (raw && !/[A-Za-z]/.test(raw) && !/[省市州县]$/.test(raw)) return raw + '区';
    return '';
}

function isHongKong(info) {
    if (!info) return false;
    const cc = String(info.countryCode || '').toUpperCase();
    return cc === 'HK' || /香港|Hong Kong/i.test(info.country || '');
}

function uniqJoin(parts, sep) {
    const seen = new Set();
    const out = [];
    parts.forEach((part) => {
        const text = String(part || '').replace(/\s+/g, ' ').trim();
        if (!text || seen.has(text)) return;
        seen.add(text);
        out.push(text);
    });
    return out.join(sep == null ? ' ' : sep);
}

function photonName(text) {
    const s = toSimplified(String(text || '').trim());
    if (!s) return '';
    const pair = s.match(/[\u4e00-\u9fff][\u4e00-\u9fff0-9\-·]*[\u4e00-\u9fff0-9]/);
    if (pair && pair[0].length >= 2) return pair[0];
    const start = s.match(/^[\u4e00-\u9fff]+/);
    if (start && start[0].length >= 2) return start[0];
    return s;
}

function preferLocalName(a, b) {
    const x = photonName(a);
    const y = photonName(b);
    const xc = /[\u4e00-\u9fff]/.test(x);
    const yc = /[\u4e00-\u9fff]/.test(y);
    if (xc && !yc) return x;
    if (yc && !xc) return y;
    if (x.length >= y.length) return x || y;
    return y || x;
}

function compactJoin(parts) {
    const tokens = [];
    (parts || []).forEach((raw) => {
        const text = photonName(raw);
        if (!text) return;
        if (tokens.some((item) => item === text)) return;
        if (tokens.some((item) => item.indexOf(text) >= 0 && item.length > text.length)) return;
        for (let i = tokens.length - 1; i >= 0; i--) {
            if (text.indexOf(tokens[i]) >= 0 && text.length > tokens[i].length) tokens.splice(i, 1);
        }
        tokens.push(text);
    });
    let out = '';
    tokens.forEach((text) => {
        if (!out) {
            out = text;
            return;
        }
        const bothCjk = /[\u4e00-\u9fff]$/.test(out) && /^[\u4e00-\u9fff]/.test(text);
        out += bothCjk ? text : ' ' + text;
    });
    return out;
}

function formatGeo(info, style) {
    if (!info) return '';
    if (style === 'dns') {
        if (info.dnsGeo) return info.dnsGeo;
        const country = info.countryEn || info.country || '';
        const city = info.cityEn || info.city || info.regionEn || info.region || '';
        const isp = shortIsp(info) || info.isp || '';
        return [country, city, isp].filter(Boolean).join(' ');
    }
    if (style === 'overseas') {
        const flag = flagEmoji(info.countryCode);
        const line = uniqJoin([
            info.countryEn || info.country,
            info.regionEn || info.region,
            info.cityEn || info.city,
            info.districtEn,
            shortIsp(info)
        ]);
        return (flag + line).trim();
    }
    if (style === 'public') {
        if (info.cnLine) return info.cnLine;
        return uniqJoin([
            info.country || '中国',
            addShi(info.region),
            addShi(info.city),
            info.district
        ]);
    }
    if (info.addr && /[\u4e00-\u9fff]/.test(info.addr) && !looksGarbled(info.addr)) {
        return info.addr.replace(/\s+/g, ' ').trim();
    }
    return uniqJoin([info.country, info.region, info.city, info.district]);
}

function formatLocation(info) {
    if (!info) return '';
    if (info.locationText) return info.locationText;
    if (isHongKong(info)) {
        const district = hkDistrict(info);
        const poi = toSimplified(info.landmark || '').replace(/市$/g, '');
        return compactJoin(['香港特别行政区', district, poi]);
    }
    return compactJoin([
        info.country,
        info.region,
        info.city,
        info.district,
        info.landmark
    ]);
}

function runCmd(cmd, args) {
    return new Promise((resolve) => {
        execFile(cmd, args, { timeout: 4000, maxBuffer: 1024 * 1024 }, (err, stdout) => {
            resolve(err ? '' : String(stdout || ''));
        });
    });
}

function pushIp(list, ip) {
    if (!ip) return;
    const cleaned = String(ip).replace(/^\[|\]$/g, '').trim();
    if (!cleaned) return;
    if (cleaned === '127.0.0.1' || cleaned === '::1' || cleaned === '0.0.0.0') return;
    if (cleaned.indexOf('224.') === 0 || cleaned.indexOf('255.') === 0) return;
    if (/^fe80:/i.test(cleaned) || /^ff/i.test(cleaned)) return;
    const isV4 = /^\d{1,3}(\.\d{1,3}){3}$/.test(cleaned);
    const isV6 = cleaned.indexOf(':') >= 0;
    if (!isV4 && !isV6) return;
    list.push(cleaned);
}

function emptyInfo() {
    return {
        country: '',
        countryEn: '',
        countryCode: '',
        region: '',
        regionEn: '',
        city: '',
        cityEn: '',
        district: '',
        districtEn: '',
        isp: '',
        ispEn: '',
        org: '',
        as: '',
        lat: null,
        lon: null,
        addr: '',
        cnLine: '',
        landmark: '',
        locationText: '',
        dnsGeo: ''
    };
}

function mergeInfo(base, extra) {
    const out = Object.assign(emptyInfo(), base || {});
    if (!extra) return out;
    Object.keys(extra).forEach((key) => {
        const val = extra[key];
        if (val == null || val === '') return;
        if ((key === 'lat' || key === 'lon') && out[key] == null) out[key] = val;
        else if (!out[key]) out[key] = val;
    });
    return out;
}

async function lookupIpApi(ip, lang) {
    const fields = 'status,country,countryCode,regionName,city,district,isp,org,as,asname,lat,lon,query';
    const res = await request(
        'http://ip-api.com/json/' + encodeURIComponent(ip) + '?lang=' + encodeURIComponent(lang || 'zh-CN') + '&fields=' + fields, { timeout: 5000 }
    );
    const json = parseJson(res.body);
    if (!json || json.status !== 'success') return null;
    const info = emptyInfo();
    info.countryCode = json.countryCode || '';
    info.as = json.as || '';
    info.org = json.org || '';
    info.lat = typeof json.lat === 'number' ? json.lat : null;
    info.lon = typeof json.lon === 'number' ? json.lon : null;
    if (lang === 'en') {
        info.countryEn = json.country || '';
        info.regionEn = json.regionName || '';
        info.cityEn = json.city || '';
        info.districtEn = json.district || '';
        info.ispEn = json.isp || '';
    } else {
        info.country = json.country || '';
        info.region = json.regionName || '';
        info.city = json.city || '';
        info.district = json.district || '';
        info.isp = json.isp || '';
        info.addr = [json.country, json.regionName, json.city].filter(Boolean).join(' ');
    }
    return info;
}

async function lookupCz88(ip) {
    const res = await request('https://www.cz88.net/api/cz88/ip/base?ip=' + encodeURIComponent(ip), { timeout: 5000 });
    const json = JSON.parse(res.body);
    const data = json && json.data;
    if (!data) return null;
    const info = emptyInfo();
    info.country = data.country || '';
    info.countryCode = data.countryCode || '';
    info.region = data.province || '';
    info.city = data.city || '';
    info.district = data.districts && data.districts !== '未知' ? data.districts : '';
    info.isp = data.isp || '';
    info.org = data.company || data.asn || '';
    if (data.locations && data.locations[0]) {
        info.lat = Number(data.locations[0].latitude);
        info.lon = Number(data.locations[0].longitude);
    }
    const country = info.country || '中国';
    const prov = addShi(info.region);
    const city = addShi(info.city);
    const dist = info.district;
    info.cnLine = uniqJoin([country, prov, city, dist]);
    return info;
}

async function lookupPconline(ip) {
    const res = await request('https://whois.pconline.com.cn/ipJson.jsp?json=true&ip=' + encodeURIComponent(ip), { timeout: 5000 });
    const raw = decodeText(res.buffer, 'gbk').replace(/^\ufeff/, '');
    const json = JSON.parse(raw);
    if (!json || (!json.addr && !json.ip)) return null;
    const info = emptyInfo();
    info.country = json.pro || '中国';
    info.region = json.city || '';
    info.city = json.region || json.city || '';
    info.isp = json.addr || '';
    info.addr = json.addr || '';
    return info;
}

function photonFeatureName(feature) {
    const props = feature && feature.properties;
    return photonName(props && (props.name || props.street));
}

function photonDistance(feature, lat, lon) {
    const coords = feature && feature.geometry && feature.geometry.coordinates;
    if (!coords) return 99;
    return Math.hypot(Number(coords[1]) - lat, Number(coords[0]) - lon);
}

async function lookupPhotonReverse(lat, lon) {
    if (lat == null || lon == null) return null;
    const res = await request(
        'https://photon.komoot.io/reverse?lat=' + encodeURIComponent(lat) + '&lon=' + encodeURIComponent(lon),
        { timeout: 5000 }
    );
    const json = parseJson(res.body);
    const props = json && json.features && json.features[0] && json.features[0].properties;
    if (!props) return null;
    return {
        name: photonName(props.name),
        street: photonName(props.street),
        housenumber: props.housenumber ? String(props.housenumber) : '',
        locality: photonName(props.locality),
        district: photonName(props.district),
        city: photonName(props.city),
        county: photonName(props.county),
        state: photonName(props.state),
        country: photonName(props.country)
    };
}

async function findNearbyLandmark(lat, lon, city) {
    if (lat == null || lon == null) return '';
    const cityName = photonName(String(city || '').replace(/市$/, ''));
    if (cityName && /[\u4e00-\u9fff]/.test(cityName)) {
        const q = cityName.replace(/特别行政区$/, '') + '公园';
        try {
            const url = 'https://photon.komoot.io/api/?q=' + encodeURIComponent(q) +
                '&lat=' + encodeURIComponent(lat) + '&lon=' + encodeURIComponent(lon) + '&limit=5';
            const res = await request(url, { timeout: 5000 });
            const list = (JSON.parse(res.body) || {}).features || [];
            let best = '';
            let bestD = 0.03;
            list.forEach((item) => {
                const d = photonDistance(item, lat, lon);
                const name = photonFeatureName(item);
                if (name && /公园|公園|Park/i.test(name) && d < bestD) {
                    bestD = d;
                    best = name;
                }
            });
            if (best) return toSimplified(best);
        } catch (e) {}
    }
    return '';
}

function amapText(value) {
    if (value == null) return '';
    if (Array.isArray(value)) return value.filter(Boolean).join('');
    return String(value).trim();
}

async function lookupAmapIp(ip) {
    const key = apiKeys().amap;
    if (!key || !ip) return null;
    const type = String(ip).indexOf(':') >= 0 ? '6' : '4';
    const res = await request(
        'https://restapi.amap.com/v5/ip/location?key=' + encodeURIComponent(key) + '&type=' + type + '&ip=' + encodeURIComponent(ip),
        { timeout: 5000 }
    );
    const json = JSON.parse(res.body);
    if (!json || String(json.status) !== '1') return null;
    const info = emptyInfo();
    info.country = amapText(json.country);
    info.region = amapText(json.province);
    info.city = amapText(json.city) || info.region;
    info.district = amapText(json.district);
    info.isp = amapText(json.isp);
    const loc = amapText(json.location).split(',');
    if (loc.length === 2) {
        info.lon = Number(loc[0]);
        info.lat = Number(loc[1]);
    }
    info.cnLine = uniqJoin([info.country, addShi(info.region), addShi(info.city), info.district]);
    return info;
}

async function lookupAmapRegeoKey(lon, lat) {
    const key = apiKeys().amap;
    if (!key || lon == null || lat == null) return null;
    const res = await request(
        'https://restapi.amap.com/v3/geocode/regeo?key=' + encodeURIComponent(key) +
        '&location=' + encodeURIComponent(lon + ',' + lat) + '&extensions=all&radius=500',
        { timeout: 5000 }
    );
    const json = JSON.parse(res.body);
    if (!json || String(json.status) !== '1' || !json.regeocode) return null;
    const ac = json.regeocode.addressComponent || {};
    const pois = json.regeocode.pois || [];
    const park = pois.find((p) => /公园|公園|Park/i.test((p && (p.name || p.type)) || '')) || pois[0] || {};
    return {
        country: amapText(ac.country),
        province: amapText(ac.province),
        city: amapText(ac.city),
        district: amapText(ac.district),
        township: amapText(ac.township),
        formatted: amapText(json.regeocode.formatted_address),
        poi: amapText(park.name)
    };
}

async function lookupQqIp(ip) {
    const key = apiKeys().qq;
    if (!key || !ip) return null;
    const res = await request(
        'https://apis.map.qq.com/ws/location/v1/ip?ip=' + encodeURIComponent(ip) + '&key=' + encodeURIComponent(key),
        { timeout: 5000 }
    );
    const json = JSON.parse(res.body);
    if (!json || json.status !== 0 || !json.result) return null;
    const ad = json.result.ad_info || {};
    const loc = json.result.location || {};
    const info = emptyInfo();
    info.country = ad.nation || '';
    info.region = ad.province || '';
    info.city = ad.city || ad.province || '';
    info.district = ad.district || '';
    info.lat = typeof loc.lat === 'number' ? loc.lat : null;
    info.lon = typeof loc.lng === 'number' ? loc.lng : null;
    info.cnLine = uniqJoin([info.country, addShi(info.region), addShi(info.city), info.district]);
    return info;
}

async function lookupQqRegeo(lat, lon) {
    const key = apiKeys().qq;
    if (!key || lat == null || lon == null) return null;
    const res = await request(
        'https://apis.map.qq.com/ws/geocoder/v1/?location=' + encodeURIComponent(lat + ',' + lon) +
        '&key=' + encodeURIComponent(key) + '&get_poi=1',
        { timeout: 5000 }
    );
    const json = JSON.parse(res.body);
    if (!json || json.status !== 0 || !json.result) return null;
    const ac = json.result.address_component || {};
    const pois = json.result.pois || [];
    const park = pois.find((p) => /公园|公園|Park/i.test((p && (p.title || p.category)) || '')) || pois[0] || {};
    const rec = json.result.formatted_addresses && json.result.formatted_addresses.recommend;
    return {
        province: ac.province || ac.nation || '',
        city: ac.city || '',
        district: ac.district || '',
        formatted: rec || json.result.address || '',
        poi: park.title || ''
    };
}

async function lookupIpGeoIo(ip) {
    const key = apiKeys().ipgeo;
    if (!key || !ip) return null;
    const res = await request(
        'https://api.ipgeolocation.io/ipgeo?apiKey=' + encodeURIComponent(key) + '&ip=' + encodeURIComponent(ip),
        { timeout: 5000 }
    );
    const json = JSON.parse(res.body);
    if (!json || json.message || !json.country_name) return null;
    const info = emptyInfo();
    info.countryEn = json.country_name || '';
    info.countryCode = json.country_code2 || json.country_code || '';
    info.regionEn = json.state_prov || '';
    info.cityEn = json.city || '';
    info.districtEn = json.district || '';
    info.ispEn = json.isp || '';
    info.org = json.organization || json.isp || '';
    info.lat = json.latitude != null ? Number(json.latitude) : null;
    info.lon = json.longitude != null ? Number(json.longitude) : null;
    if (json.country_name && /China|中国/i.test(json.country_name)) {
        info.country = '中国';
    }
    return info;
}

function pickLonger() {
    let best = '';
    let bestKey = '';
    for (let i = 0; i < arguments.length; i++) {
        const raw = String(arguments[i] || '').replace(/[,，]/g, ' ').replace(/\s+/g, ' ').trim();
        const key = raw.replace(/\s+/g, '');
        if (key.length > bestKey.length) {
            bestKey = key;
            best = raw;
        }
    }
    return best;
}

function buildLocationText(amap, qq, photon, info, landmark) {
    const country = preferLocalName((amap && amap.country) || (info && info.country), photon && photon.country);
    const province = preferLocalName(
        (amap && amap.province) || (qq && qq.province) || (info && info.region),
        photon && photon.state
    );
    const city = preferLocalName(
        (amap && amap.city) || (qq && qq.city) || (info && info.city),
        photon && photon.city
    );
    const hk = /香港/.test(province || '') || isHongKong(info);
    const district = preferLocalName(
        (amap && amap.district) || (qq && qq.district) || (hk ? hkDistrict(info) : '') || (info && info.district),
        photon && photon.district
    );
    const township = preferLocalName(amap && amap.township, photon && photon.locality);
    const street = (photon && photon.street) || '';
    const house = photon && photon.housenumber
        ? photon.housenumber + (/[号號]$/.test(photon.housenumber) ? '' : '号')
        : '';
    const poi = toSimplified((amap && amap.poi) || (qq && qq.poi) || landmark || (photon && photon.name) || '').replace(/市$/g, '');
    const formatted = pickLonger(
        amap && amap.formatted,
        qq && qq.formatted,
        compactJoin(String((amap && amap.desc) || '').split(/[,，]/))
    );
    const built = compactJoin([
        hk || (province && country && province.indexOf(country) >= 0) ? '' : country,
        hk && !/特别行政区/.test(province || '') ? '香港特别行政区' : province,
        city,
        district,
        township,
        street,
        house,
        poi
    ]);
    return pickLonger(built, formatted) || built;
}

async function fillReverseGeo(info) {
    if (!info || info.lat == null || info.lon == null) return info;
    const [landmark, amapWeb, amapKey, qqKey, photon] = await Promise.all([
        findNearbyLandmark(info.lat, info.lon, info.city || info.district || info.cityEn).catch(() => ''),
        lookupAmapRegeo(info.lon, info.lat).catch(() => null),
        lookupAmapRegeoKey(info.lon, info.lat).catch(() => null),
        lookupQqRegeo(info.lat, info.lon).catch(() => null),
        lookupPhotonReverse(info.lat, info.lon).catch(() => null)
    ]);
    info.landmark = (amapKey && amapKey.poi) || (qqKey && qqKey.poi) || landmark || (photon && (photon.name || photon.street)) || '';
    const amap = amapKey || (amapWeb ? {
        country: amapWeb.country || '',
        province: amapWeb.province,
        city: amapWeb.city,
        district: amapWeb.district,
        township: amapWeb.township || '',
        formatted: amapWeb.formatted || '',
        desc: amapWeb.desc || '',
        poi: info.landmark
    } : null);
    info.locationText = buildLocationText(amap, qqKey, photon, info, info.landmark);
    return info;
}

async function lookupGeo(ip, options) {
    if (!ip) return null;
    const opts = options || {};
    const cacheKey = ip + ':' + (opts.rich ? 'rich' : 'basic') + ':' + apiKeys().amap + apiKeys().qq + apiKeys().ipgeo;
    if (geoCache.has(cacheKey)) return geoCache.get(cacheKey);
    const pending = (async() => {
        const rich = !!opts.rich;
        const zhPromise = lookupIpApi(ip, 'zh-CN').catch(() => null);
        const extraPromise = Promise.all([
            rich ? lookupIpApi(ip, 'en').catch(() => null) : Promise.resolve(null),
            rich ? lookupCz88(ip).catch(() => null) : Promise.resolve(null),
            lookupPconline(ip).catch(() => null),
            rich ? lookupAmapIp(ip).catch(() => null) : Promise.resolve(null),
            rich ? lookupQqIp(ip).catch(() => null) : Promise.resolve(null),
            rich ? lookupIpGeoIo(ip).catch(() => null) : Promise.resolve(null)
        ]);
        const zh = await zhPromise;
        const reversePromise = (rich && zh && zh.lat != null && zh.lon != null)
            ? fillReverseGeo(Object.assign(emptyInfo(), zh)).catch(() => zh)
            : Promise.resolve(null);
        const [en, cz, pc, amapIp, qqIp, ipgeo] = await extraPromise;
        let info = mergeInfo(mergeInfo(amapIp, qqIp), zh);
        info = mergeInfo(info, cz);
        info = mergeInfo(info, pc);
        info = mergeInfo(info, ipgeo);
        info = mergeInfo(info, en);
        if (!info.country && !info.countryEn) return null;
        const reversed = await reversePromise;
        if (reversed && reversed.locationText) {
            info.landmark = reversed.landmark || info.landmark;
            info.locationText = reversed.locationText;
        } else if (rich && info.lat != null && info.lon != null) {
            info = await fillReverseGeo(info);
        }
        return info;
    })();
    geoCache.set(cacheKey, pending);
    return pending;
}

async function collectSystemDns() {
    const found = [];
    (dns.getServers() || []).forEach((ip) => pushIp(found, ip));
    if (process.platform === 'darwin') {
        const scutil = await runCmd('scutil', ['--dns']);
        scutil.split('\n').forEach((line) => {
            const match = line.match(/nameserver\[\d+\]\s*:\s*(\S+)/i);
            if (match) pushIp(found, match[1]);
        });
        const ifaces = listInterfaces();
        for (let i = 0; i < ifaces.length; i++) {
            const packet = await runCmd('ipconfig', ['getpacket', ifaces[i].name]);
            const match = packet.match(/domain_name_server[^\n]*\{([^}]+)\}/i);
            if (match) {
                match[1].split(/[\s,]+/).forEach((ip) => pushIp(found, ip));
            }
        }
    } else if (process.platform === 'win32') {
        const out = await runCmd('ipconfig', ['/all']);
        let inDns = false;
        out.split(/\r?\n/).forEach((line) => {
            if (/DNS Servers/i.test(line)) inDns = true;
            else if (inDns && /^\s+\S/.test(line) === false && line.trim()) inDns = /DNS/i.test(line);
            if (inDns) {
                const match = line.match(/(\d{1,3}(?:\.\d{1,3}){3}|[0-9a-fA-F:]+)/);
                if (match) pushIp(found, match[1]);
            }
        });
    } else {
        try {
            const fs = require('fs');
            const text = fs.readFileSync('/etc/resolv.conf', 'utf8');
            text.split('\n').forEach((line) => {
                const match = line.match(/^nameserver\s+(\S+)/);
                if (match) pushIp(found, match[1]);
            });
        } catch (e) {}
    }
    return found;
}

async function fetchOneEdns() {
    const host = randomId(32);
    const res = await request('https://' + host + '.edns.ip-api.com/json', { timeout: 5000 });
    let json = null;
    try { json = JSON.parse(res.body); } catch (e) {}
    if (!json || !json.dns) {
        const href = String(res.body || '').match(/https?:\/\/[a-z0-9]+\.edns\.ip-api\.com\/json/i);
        if (!href) return null;
        json = JSON.parse((await request(href[0], { timeout: 5000 })).body);
    }
    if (!json || !json.dns || !json.dns.ip) return null;
    return { ip: json.dns.ip, geo: json.dns.geo || '' };
}

async function collectEdnsDns() {
    const part = await Promise.all(Array.from({ length: 4 }, () => fetchOneEdns().catch(() => null)));
    return part.filter(Boolean);
}

async function fetchSurfsharkDns() {
    const res = await request('https://' + randomId(12) + '.ipv4.surfsharkdns.com', { timeout: 5000 });
    const json = JSON.parse(res.body);
    const rows = [];
    Object.keys(json || {}).forEach((key) => {
        const row = json[key];
        if (!row) return;
        const ip = row.IP || key;
        const geo = [row.Country, row.City, row.ISP].filter(Boolean).join(' ');
        rows.push({ ip, geo });
    });
    return rows;
}

async function collectSurfsharkDns() {
    const part = await Promise.all(Array.from({ length: 4 }, () => fetchSurfsharkDns().catch(() => [])));
    const rows = [];
    part.forEach((arr) => arr.forEach((row) => rows.push(row)));
    return rows;
}

function dnsLookup(host, timeout) {
    return new Promise((resolve) => {
        let done = false;
        const finish = () => {
            if (done) return;
            done = true;
            resolve();
        };
        const timer = setTimeout(finish, timeout || 4000);
        dns.resolve4(host, () => {
            clearTimeout(timer);
            finish();
        });
    });
}

async function collectBashDnsLeak() {
    const idRes = await request('https://bash.ws/id', { timeout: 5000 });
    const id = String(idRes.body || '').trim();
    if (!id || /[^a-z0-9]/i.test(id)) return [];
    await Promise.all(Array.from({ length: 12 }, (_, i) => {
        const host = (i + 1) + '.' + id + '.bash.ws';
        return Promise.race([
            request('https://' + host + '/', { timeout: 4000 }).catch(() => null),
            dnsLookup(host, 4000)
        ]);
    }));
    const test = await request('https://bash.ws/dnsleak/test/' + encodeURIComponent(id) + '?json', { timeout: 8000 });
    let arr = [];
    try { arr = JSON.parse(test.body); } catch (e) { return []; }
    if (!Array.isArray(arr)) return [];
    return arr.filter((row) => row && row.type === 'dns' && row.ip).map((row) => ({
        ip: row.ip,
        geo: [row.country_name, row.asn].filter(Boolean).join(' ')
    }));
}

async function collectDnsServers() {
    const [edns, surfshark, system] = await Promise.all([
        collectEdnsDns().catch(() => []),
        collectSurfsharkDns().catch(() => []),
        collectSystemDns().catch(() => [])
    ]);
    const rows = [];
    const seen = new Set();
    const add = (ip, geo) => {
        if (!ip || seen.has(ip) || isPrivateIp(ip)) return;
        seen.add(ip);
        rows.push({ ip, geo: geo || '' });
    };
    edns.forEach((row) => add(row.ip, row.geo));
    surfshark.forEach((row) => add(row.ip, row.geo));
    if (!rows.length) {
        const leak = await collectBashDnsLeak().catch(() => []);
        leak.forEach((row) => add(row.ip, row.geo));
    }
    if (!rows.length) {
        system.forEach((ip) => add(ip, ''));
    }
    return rows.slice(0, 40);
}

function siteReachable(res) {
    return res && res.status > 0 && res.ms > 0;
}

function siteProbes(site) {
    const list = [];
    const add = (url) => {
        if (url && list.indexOf(url) < 0) list.push(url);
    };
    (site.probes || []).forEach(add);
    add(site.probe);
    if (site.id === 'google') {
        add('https://www.google.com/generate_204');
        add('https://www.gstatic.com/generate_204');
    }
    return list;
}

async function curlProbe(url, timeout, proxy) {
    const res = await curlRequest(url, {
        method: 'GET',
        timeout,
        proxy,
        forceIpv4: false,
        discardBody: true,
        ttfb: true
    });
    if (!siteReachable(res)) throw new Error('unreachable');
    return res.ms;
}

async function measureSite(site) {
    const proxy = site.region === '境外网站' ? overseasProxy : undefined;
    const timeout = site.region === '境外网站' ? 8000 : 5000;
    const probes = siteProbes(site);
    const hops = proxy ? [proxy, undefined] : [undefined];
    for (let i = 0; i < probes.length; i++) {
        for (let j = 0; j < hops.length; j++) {
            try {
                return await curlProbe(probes[i], timeout, hops[j]);
            } catch (e) {}
        }
    }
    return null;
}

function copyText(text) {
    if (!text) return false;
    try {
        if (typeof ztools.copyText === 'function') {
            ztools.copyText(String(text));
            return true;
        }
    } catch (e) {}
    try {
        ztools.clipboard.writeContent({ type: 'text', content: String(text) }, false);
        return true;
    } catch (e) {
        return false;
    }
}

function markCopied(key) {
    state.copiedKey = key;
    emit();
    if (copyTimers[key]) clearTimeout(copyTimers[key]);
    copyTimers[key] = setTimeout(() => {
        if (state.copiedKey === key) {
            state.copiedKey = '';
            emit();
        }
    }, 1800);
}

function applyLan() {
    state.lan = pickLan(state.interfaces, state.selectedIface);
}

function scheduleFillGeo(id) {
    if (geoFillTimer) clearTimeout(geoFillTimer);
    geoFillTimer = setTimeout(() => {
        geoFillTimer = null;
        fillNetworkGeo(null, '', id).catch(() => {
            if (!stillCurrent(id)) return;
            state.location.loading = false;
            emit();
        });
    }, 80);
}

function applyOverseasIp(ip, proxy, id) {
    if (!stillCurrent(id) || !ip || isPrivateIp(ip)) return false;
    const domestic = state.public.ip;
    const current = state.overseas.ip;
    const currentDistinct = current && (!domestic || current !== domestic);
    const incomingDistinct = !domestic || ip !== domestic;
    if (currentDistinct && incomingDistinct && current === ip) {
        if (proxy) overseasProxy = proxy;
        return false;
    }
    if (currentDistinct && !incomingDistinct) return false;
    const upgraded = current && !currentDistinct && incomingDistinct;
    if (!current || upgraded) {
        state.overseas.ip = ip;
        if (proxy) overseasProxy = proxy;
        if (upgraded) {
            state.overseas.geo = '';
            state.location.loading = true;
            state.location.text = '';
        }
        emit();
        if (domestic && incomingDistinct) scheduleFillGeo(id);
        return true;
    }
    return false;
}

function finishOverseasLookups(id) {
    if (!stillCurrent(id)) return;
    if (overseasAwaitProxy || overseasPending > 0) return;
    if (!state.overseas.ip && state.public.ip) state.overseas.ip = state.public.ip;
    state.overseas.loading = false;
    if (!state.overseas.ip || state.overseas.ip === state.public.ip) {
        if (!state.overseas.geo) state.overseas.geo = overseasEmptyHint();
    }
    emit();
    scheduleFillGeo(id);
}

function startOverseasLookups(proxies, id) {
    const hops = (proxies && proxies.length) ? proxies.slice() : [null];
    const n = hops.length * OVERSEAS_IP_URLS.length;
    if (!n) {
        finishOverseasLookups(id);
        return;
    }
    overseasPending += n;
    hops.forEach((proxy) => {
        OVERSEAS_IP_URLS.forEach((url) => {
            request(url, {
                timeout: 3500,
                family: 4,
                proxy: proxy || undefined
            }).then((res) => {
                const ip = extractPublicIPv4(res.body);
                if (ip) applyOverseasIp(ip, proxy, id);
            }).catch(() => {}).then(() => {
                overseasPending -= 1;
                finishOverseasLookups(id);
            });
        });
    });
}

async function fillNetworkGeo(myIp, ipv6, id) {
    if (myIp && myIp.cnLine) state.public.geo = myIp.cnLine;
    if (ipv6 && state.public.ip && ipv6 !== state.public.ip && String(state.public.ip).indexOf(':') < 0) {
        if (state.public.geo.indexOf('IPv6 ') < 0) {
            state.public.geo = (state.public.geo ? state.public.geo + ' · ' : '') + 'IPv6 ' + ipv6;
        }
    }
    const overIp = state.overseas.ip;
    const hasOverseas = overIp && overIp !== state.public.ip;
    if (!hasOverseas) {
        if (state.overseas.loading) {
            emit();
            return;
        }
        state.overseas.geo = overseasEmptyHint();
        if (!state.public.ip) {
            state.location.text = '';
            state.location.loading = false;
            emit();
            return;
        }
        const publicGeo = await lookupGeo(state.public.ip, { rich: true }).catch(() => null);
        if (!stillCurrent(id)) return;
        if (state.overseas.ip && state.overseas.ip !== state.public.ip) {
            return fillNetworkGeo(myIp, ipv6, id);
        }
        if (myIp && myIp.cnLine) state.public.geo = myIp.cnLine;
        else if (!state.public.geo) state.public.geo = formatGeo(publicGeo, 'public') || '';
        const publicLine = state.public.geo && state.public.geo.indexOf('IPv6') < 0 ? state.public.geo : '';
        state.location.text = formatLocation(publicGeo) || (myIp && myIp.cnLine) || publicLine || '';
        state.location.loading = false;
        emit();
        return;
    }
    const [publicGeo, overseasGeo] = await Promise.all([
        state.public.geo ? Promise.resolve(null) : lookupGeo(state.public.ip, { rich: false }).catch(() => null),
        lookupGeo(overIp, { rich: true }).catch(() => null)
    ]);
    if (!stillCurrent(id)) return;
    if (!(state.overseas.ip && state.overseas.ip !== state.public.ip)) {
        return fillNetworkGeo(myIp, ipv6, id);
    }
    if (!state.public.geo) state.public.geo = formatGeo(publicGeo, 'public') || '';
    if (myIp && myIp.cnLine) state.public.geo = myIp.cnLine;
    state.overseas.geo = formatGeo(overseasGeo, 'overseas') || '';
    if (!state.overseas.geo) state.overseas.geo = overseasEmptyHint();
    state.location.text = formatLocation(overseasGeo) || '';
    state.location.loading = false;
    emit();
}

async function loadNetwork(id) {
    const myIpPromise = fetchMyIpCn().catch(() => null);
    const publicPromise = fetchIPv4(PUBLIC_IP_URLS, { family: 4, timeout: 4000 });
    const ipv6Promise = fetchIPv6([
        'https://myip.ipip.net',
        'https://6.ipw.cn/',
        'https://api64.ipify.org'
    ]);
    startOverseasLookups([], id);

    myIpPromise.then((info) => {
        if (!stillCurrent(id) || !info || !info.ip || state.public.ip) return;
        state.public.ip = info.ip;
        state.public.loading = false;
        if (info.cnLine) state.public.geo = info.cnLine;
        emit();
        if (state.overseas.ip && state.overseas.ip !== info.ip) scheduleFillGeo(id);
    }).catch(() => {});

    publicPromise.then((ip) => {
        if (!stillCurrent(id) || !ip || state.public.ip) return;
        state.public.ip = ip;
        state.public.loading = false;
        emit();
        if (state.overseas.ip && state.overseas.ip !== ip) scheduleFillGeo(id);
    }).catch(() => {});

    const myIp = await myIpPromise;
    if (!stillCurrent(id)) return;
    if (!state.public.ip) {
        const publicIp = await publicPromise.catch(() => '');
        if (!stillCurrent(id)) return;
        state.public.ip = publicIp || '';
        state.public.loading = false;
        emit();
    } else {
        state.public.loading = false;
        if (myIp && myIp.cnLine && !state.public.geo) state.public.geo = myIp.cnLine;
        emit();
    }

    if (state.overseas.ip && state.public.ip && state.overseas.ip === state.public.ip) {
        if (!state.overseas.geo) state.overseas.geo = overseasEmptyHint();
    }
    if (!state.overseas.ip && !state.overseas.loading && state.public.ip) {
        state.overseas.ip = state.public.ip;
        state.overseas.geo = overseasEmptyHint();
        emit();
    }

    const ipv6 = await ipv6Promise.catch(() => '');
    fillNetworkGeo(myIp, ipv6, id).catch(() => {
        if (!stillCurrent(id)) return;
        state.location.loading = false;
        emit();
    });
}

function applySiteResult(id, ms, work) {
    const row = state.sites.find((site) => site.id === id);
    if (!row || row.status === 'ok') return false;
    if (work != null && row.token !== work) return false;
    row.needPage = false;
    row.ms = ms;
    row.status = ms == null ? 'timeout' : 'ok';
    emit();
    return true;
}

function loadSites() {
    SITES.forEach((_, index) => {
        state.sites[index].status = 'loading';
        state.sites[index].ms = null;
        state.sites[index].needPage = true;
        state.sites[index].token = workId;
    });
    emit();
}

async function loadDns(id) {
    state.dnsLoading = true;
    emit();
    const servers = await collectDnsServers();
    if (!stillCurrent(id)) return;
    const rows = await Promise.all(servers.map(async(row) => {
        if (row.geo) return { ip: row.ip, geo: row.geo };
        const geo = await lookupGeo(row.ip);
        return { ip: row.ip, geo: formatGeo(geo, 'dns') || '未知' };
    }));
    if (!stillCurrent(id)) return;
    state.dns = rows;
    state.dnsLoading = false;
    emit();
}

async function refresh(full) {
    state.interfaces = listInterfaces();
    applyLan();
    emit();
    if (state.autoCopy && state.lan.ip) {
        if (copyText(state.lan.ip)) markCopied('lan');
    }
    if (full === false) return;
    const id = ++workId;
    geoCache.clear();
    overseasPending = 0;
    overseasAwaitProxy = true;
    state.public.loading = true;
    state.public.ip = '';
    state.public.geo = '';
    state.overseas.loading = true;
    state.overseas.ip = '';
    state.overseas.geo = '';
    state.overseas.token = id;
    state.location.text = '';
    state.location.loading = true;
    loadSites();
    const netPromise = loadNetwork(id);
    const [proxies, tun] = await Promise.all([detectProxyCandidates(), detectTun().catch(() => '')]);
    if (!stillCurrent(id)) return;
    state.tun = !!tun;
    overseasProxy = proxies[0] || null;
    state.proxyLabel = overseasProxy ? (overseasProxy.host + ':' + overseasProxy.port) : (tun ? 'TUN' : '');
    emit();
    if (overseasProxy) startOverseasLookups([overseasProxy], id);
    overseasAwaitProxy = false;
    finishOverseasLookups(id);
    await Promise.all([netPromise, loadDns(id)]);
}

window.ipConfig = {
    onUpdate(fn) {
        listeners.add(fn);
        fn(JSON.parse(JSON.stringify(state)));
        return () => listeners.delete(fn);
    },
    getState() {
        return JSON.parse(JSON.stringify(state));
    },
    start() {
        state.selectedIface = getPref('iface', 'auto') || 'auto';
        state.autoCopy = getPref('autoCopyOn', false) === true;
        state.keys = loadKeys();
        return refresh(true);
    },
    refresh() {
        return refresh(true);
    },
    setInterface(name) {
        state.selectedIface = name || 'auto';
        setPref('iface', state.selectedIface);
        applyLan();
        emit();
        if (state.autoCopy && state.lan.ip) {
            if (copyText(state.lan.ip)) markCopied('lan');
        }
    },
    setAutoCopy(enabled) {
        state.autoCopy = !!enabled;
        setPref('autoCopyOn', state.autoCopy);
        emit();
        if (state.autoCopy && state.lan.ip) {
            if (copyText(state.lan.ip)) markCopied('lan');
        }
    },
    setKeys(keys) {
        const next = {
            amap: String((keys && keys.amap) || '').trim(),
            qq: String((keys && keys.qq) || '').trim(),
            ipgeo: String((keys && keys.ipgeo) || '').trim()
        };
        state.keys = next;
        setPref('keyAmap', next.amap);
        setPref('keyQq', next.qq);
        setPref('keyIpgeo', next.ipgeo);
        geoCache.clear();
        emit();
        return refresh(true);
    },
    copy(text, key) {
        const ok = copyText(text);
        if (ok) markCopied(key || text);
        return ok;
    },
    reportOverseas(ip, token) {
        if (token != null && state.overseas.token !== token) return false;
        const cleaned = extractPublicIPv4(String(ip || ''));
        if (!cleaned) return false;
        return applyOverseasIp(cleaned, null, token != null ? token : workId);
    },
    reportSite(id, ms, token) {
        return applySiteResult(id, ms, token);
    },
    probeSite(id, token) {
        const site = SITES.find((item) => item.id === id);
        const row = state.sites.find((item) => item.id === id);
        if (!site || !row || row.status === 'ok') return false;
        if (token != null && row.token !== token) return false;
        row.needPage = false;
        const work = row.token;
        measureSite(site).then((ms) => applySiteResult(id, ms, work)).catch(() => applySiteResult(id, null, work));
        return true;
    }
};