console.log("preload.js loaded")

// zTools exposes its uTools-compatible API as `ztools`. Normalize the global
// before any preload initialization reads `utools`.
if (!globalThis.utools && globalThis.ztools) {
    globalThis.utools = globalThis.ztools;
}

const otpCode = require('./otp_code');
const webdavBackup = require('./webdav_backup');
const { createAutoBackupManager } = require('./auto_backup');
const fs = require('fs');
const path = require('path');
const { escapeRemark, unescapeRemark } = require('./remark_codec');

const DB_KEY_OTP_ITEMS = 'otp_items';
const DB_KEY_DELETED_ITEMS = 'deleted_otp_items';
const DB_KEY_WEBDAV_BACKUP_CONFIG = 'webdav_backup_config';
const db = utools.dbCryptoStorage || utools.dbStorage;

let webdavJobChain = Promise.resolve();
function enqueueWebdavJob(jobFn) {
    const next = webdavJobChain.then(jobFn);
    webdavJobChain = next.catch(() => {});
    return next;
}

const autoBackup = createAutoBackupManager({
    getConfig: getWebdavConfig,
    enqueueJob: enqueueWebdavJob,
    createBackup: (config, payload) => webdavBackup.createBackup(config, payload),
    getPayload: () => ({
        otpItems: getOtpItems(),
        deletedItems: getDeletedItems(),
    }),
    delayMs: 1000,
});

const getAutoBackupStatus = autoBackup.getStatus;
const onAutoBackupStatusChange = autoBackup.onStatusChange;
function scheduleAutoBackup(reason) {
    autoBackup.schedule(reason);
}





window.api = {

    otp: {
        generateTOTP: otpCode.generateTOTP,
        generateNextTOTP: otpCode.generateNextTOTP,
        getOtpItems,
        saveOtpItem,
        deleteOtpItem,
        updateOtpItem,
        copyToClipboard,
        parseOtpUri,
        importOtpUri,
        importOtpTextFile,
        importOtpFromFile,
        selectQrImage,
        exportOtpToFile,
        generateOtpUri,
        getDeletedItems,
        restoreDeletedItem,
        permanentDeleteItem
    },

    backup: {
        getWebdavConfig,
        setWebdavConfig,
        getAutoBackupStatus,
        onAutoBackupStatusChange,
        testWebdavConnection,
        createWebdavBackup,
        listWebdavBackups,
        restoreWebdavBackup
    }
}




// 获取所有OTP项目
function getOtpItems() {
    if(db === utools.dbCryptoStorage){
        const data = utools.dbStorage.getItem(DB_KEY_OTP_ITEMS)
        if(data && data.length > 0){
            db.setItem(DB_KEY_OTP_ITEMS, data)
            utools.dbStorage.removeItem(DB_KEY_OTP_ITEMS)
            return data
        }
    }
    const otpItems = db.getItem(DB_KEY_OTP_ITEMS) || [];
    return otpItems;
}

// 保存OTP项目
function saveOtpItem(item) {
    if (!item.id) {
        item.id = crypto.randomUUID().toString();
    }
    
    const otpItems = getOtpItems();
    otpItems.push(item);
    db.setItem(DB_KEY_OTP_ITEMS, otpItems);
    scheduleAutoBackup('saveOtpItem');
    return item;
}

// 更新OTP项目
function updateOtpItem(item) {
    const otpItems = getOtpItems();
    const index = otpItems.findIndex(i => i.id === item.id);
    if (index !== -1) {
        otpItems[index] = item;
        db.setItem(DB_KEY_OTP_ITEMS, otpItems);
        scheduleAutoBackup('updateOtpItem');
        return true;
    }
    return false;
}

// 删除OTP项目（移动到已删除列表）
function deleteOtpItem(id) {
    const otpItems = getOtpItems();
    const index = otpItems.findIndex(i => i.id === id);
    if (index !== -1) {
        // 获取要删除的项目
        const deletedItem = { ...otpItems[index], deletedAt: new Date().toISOString() };
        
        // 从活跃列表中移除
        otpItems.splice(index, 1);
        db.setItem(DB_KEY_OTP_ITEMS, otpItems);
        
        // 添加到已删除列表
        const deletedItems = getDeletedItems();
        deletedItems.push(deletedItem);
        db.setItem(DB_KEY_DELETED_ITEMS, deletedItems);
        scheduleAutoBackup('deleteOtpItem');
        
        return true;
    }
    return false;
}

// 获取已删除的OTP项目
function getDeletedItems() {
    const deletedItems = db.getItem(DB_KEY_DELETED_ITEMS) || [];
    return deletedItems;
}

// 恢复已删除的OTP项目
function restoreDeletedItem(id) {
    const deletedItems = getDeletedItems();
    const index = deletedItems.findIndex(i => i.id === id);
    if (index !== -1) {
        // 获取要恢复的项目
        const restoredItem = { ...deletedItems[index] };
        delete restoredItem.deletedAt; // 移除删除时间戳
        
        // 从已删除列表中移除
        deletedItems.splice(index, 1);
        db.setItem(DB_KEY_DELETED_ITEMS, deletedItems);
        
        // 添加回活跃列表
        const otpItems = getOtpItems();
        otpItems.push(restoredItem);
        db.setItem(DB_KEY_OTP_ITEMS, otpItems);
        scheduleAutoBackup('restoreDeletedItem');
        
        return true;
    }
    return false;
}

// 永久删除OTP项目
function permanentDeleteItem(id) {
    const deletedItems = getDeletedItems();
    const index = deletedItems.findIndex(i => i.id === id);
    if (index !== -1) {
        deletedItems.splice(index, 1);
        db.setItem(DB_KEY_DELETED_ITEMS, deletedItems);
        scheduleAutoBackup('permanentDeleteItem');
        return true;
    }
    return false;
}



// 复制文本到剪贴板
function copyToClipboard(text) {
    utools.copyText(text);
}

// 解析OTP URI (otpauth://...)
function parseOtpUri(uri) {
    try {
        if (!uri.startsWith('otpauth://')) {
            throw new Error('不是有效的OTP URI');
        }
        
        // 安全地解析 URI
        // 首先提取基本部分：协议、路径和查询部分
        const uriMatch = uri.match(/^(otpauth:\/\/[^\/]+)\/([^?]+)(\?.+)?$/);
        if (!uriMatch) {
            throw new Error('URI 格式不正确');
        }
        
        const [, protocolPart, pathPart, queryPart = ''] = uriMatch;
        
        // 解析类型 (totp/hotp)
        const type = protocolPart.replace('otpauth://', '');
        if (type !== 'totp' && type !== 'hotp') {
            throw new Error('不支持的 OTP 类型');
        }
        
        // 解析账户信息 (手动解码路径部分)
        const decodedPath = decodeURIComponent(pathPart);
        const segments = decodedPath.split(':');
        
        let issuer = '';
        let name = decodedPath;
        
        if (segments.length > 1) {
            issuer = segments[0].trim();
            name = segments[1].trim();
        }
        
        // 手动解析查询参数，避免 URL 对象在处理特殊查询参数时的问题
        const params = new Map();
        if (queryPart) {
            // 移除开头的 ?
            const query = queryPart.substring(1);
            // 分割参数对
            const pairs = query.split('&');
            
            for (const pair of pairs) {
                // 处理空参数
                if (!pair) continue;
                
                const idx = pair.indexOf('=');
                // 如果没有 = 号，则值为空字符串
                if (idx === -1) {
                    params.set(decodeURIComponent(pair), '');
                } else {
                    const key = decodeURIComponent(pair.substring(0, idx));
                    const value = decodeURIComponent(pair.substring(idx + 1));
                    params.set(key, value);
                }
            }
        }
        
        // 获取必要参数
        const secret = params.get('secret');
        if (!secret) {
            throw new Error('缺少必要的 secret 参数');
        }
        
        // 如果查询参数中有 issuer，优先使用它
        if (params.has('issuer')) {
            issuer = params.get('issuer');
        }
        
        // 获取其他 OTP 参数，使用默认值
        const digits = parseInt(params.get('digits') || '6', 10);
        const period = parseInt(params.get('period') || '30', 10);
        const algorithm = (params.get('algorithm') || 'SHA1').toUpperCase();
        const counter = type === 'hotp' ? parseInt(params.get('counter') || '0', 10) : 0;
        const remark = unescapeRemark(params.get('remark') || '');
        
        // 忽略非标准参数，如 codeDisplay
        
        return {
            type,
            name,
            issuer,
            secret,
            digits,
            period,
            algorithm,
            counter,
            remark
        };
    } catch (error) {
        console.error('解析 OTP URI 失败:', error);
        throw new Error('无效的 OTP URI: ' + error.message);
    }
}

// 导入OTP URI
function importOtpUri(uri) {
    try {
        const parsed = parseOtpUri(uri);
        const item = {
            id: crypto.randomUUID().toString(),
            ...parsed
        };
        
        const otpItems = getOtpItems();
        otpItems.push(item);
        db.setItem(DB_KEY_OTP_ITEMS, otpItems);
        scheduleAutoBackup('importOtpUri');
        
        return item;
    } catch (error) {
        console.error('导入OTP URI失败:', error);
        throw error;
    }
}

// 导入文本文件，每行一个OTP URI
function importOtpTextFile(text) {
    if (!text || typeof text !== 'string') {
        throw new Error('文本内容无效');
    }
    
    // 移除UTF-8 BOM（如果存在）
    let cleanText = text;
    // 检查字符串形式的BOM (\uFEFF) 或 Buffer形式的BOM
    if (text.charCodeAt(0) === 0xFEFF) {
        cleanText = text.slice(1);
    } else if (text.startsWith('\uFEFF')) {
        cleanText = text.slice(1);
    }
    
    // 按行分割文本，过滤空行和注释行
    const lines = cleanText.split(/\r?\n/)
        .map(line => line.trim())
        .filter(line => line && !line.startsWith('#'));
    
    if (lines.length === 0) {
        throw new Error('文件中没有有效的OTP URI');
    }
    
    const results = {
        success: 0,
        failed: 0,
        errors: []
    };
    
    // 获取现有OTP项目
    const otpItems = getOtpItems();
    
    // 处理每一行
    for (const line of lines) {
        try {
            const trimmedLine = line.trim();
            if (!trimmedLine) continue;
            
            // 尝试解析并导入
            const parsed = parseOtpUri(trimmedLine);
            const item = {
                id: crypto.randomUUID().toString(),
                ...parsed
            };
            
            // 添加到列表
            otpItems.push(item);
            results.success++;
        } catch (error) {
            results.failed++;
            results.errors.push(`行 "${line.substring(0, 20)}${line.length > 20 ? '...' : ''}" 导入失败: ${error.message}`);
        }
    }
    
    // 只有成功导入至少一个才保存
    if (results.success > 0) {
        db.setItem(DB_KEY_OTP_ITEMS, otpItems);
        scheduleAutoBackup('importOtpTextFile');
    }
    
    return results;
}

// 从文件导入OTP
function importOtpFromFile(filePath) {
    try {
        if (!filePath || !fs.existsSync(filePath)) {
            throw new Error('文件不存在');
        }
        
        // 读取文件内容
        const fileContent = fs.readFileSync(filePath, 'utf-8');
        
        // 使用importOtpTextFile函数处理文件内容
        return importOtpTextFile(fileContent);
    } catch (error) {
        console.error('从文件导入OTP失败:', error);
        throw error;
    }
}

// 选择二维码图片，并转换为渲染层可直接解析的 Data URL
function selectQrImage() {
    try {
        const files = utools.showOpenDialog({
            title: '选择 OTP 二维码图片',
            filters: [
                { name: '图片文件', extensions: ['png', 'jpg', 'jpeg', 'webp', 'bmp', 'gif'] }
            ],
            properties: ['openFile']
        });

        if (!files || files.length === 0) {
            return null;
        }

        const filePath = files[0];
        if (!fs.existsSync(filePath)) {
            throw new Error('图片文件不存在');
        }

        const stat = fs.statSync(filePath);
        if (!stat.isFile()) {
            throw new Error('请选择图片文件');
        }
        if (stat.size > 10 * 1024 * 1024) {
            throw new Error('图片不能超过 10 MB');
        }

        const extension = path.extname(filePath).slice(1).toLowerCase();
        const mimeTypes = {
            png: 'image/png',
            jpg: 'image/jpeg',
            jpeg: 'image/jpeg',
            webp: 'image/webp',
            bmp: 'image/bmp',
            gif: 'image/gif'
        };
        const mimeType = mimeTypes[extension];
        if (!mimeType) {
            throw new Error('不支持的图片格式');
        }

        const data = fs.readFileSync(filePath).toString('base64');
        return {
            name: path.basename(filePath),
            dataUrl: `data:${mimeType};base64,${data}`
        };
    } catch (error) {
        console.error('选择二维码图片失败:', error);
        throw new Error(error?.message || '选择二维码图片失败');
    }
}

// 生成OTP URI
function generateOtpUri(item, options = {}) {
    try {
        if (!item.secret) {
            throw new Error('缺少必要的 secret 参数');
        }
        
        // 构建基础URI
        const type = item.type || 'totp';
        let label = '';
        
        // 构建标签 (issuer:account 或者 name)
        if (item.issuer && item.account) {
            label = `${item.issuer}:${item.account}`;
        } else if (item.issuer && item.name) {
            label = `${item.issuer}:${item.name}`;
        } else if (item.name) {
            label = item.name;
        } else {
            label = 'Account';
        }
        
        // URL编码标签
        const encodedLabel = encodeURIComponent(label);
        
        // 构建查询参数
        const params = new URLSearchParams();
        params.set('secret', item.secret);
        
        if (item.issuer) {
            params.set('issuer', item.issuer);
        }
        
        if (item.digits && item.digits !== 6) {
            params.set('digits', item.digits.toString());
        }
        
        if (item.period && item.period !== 30) {
            params.set('period', item.period.toString());
        }
        
        if (item.algorithm && item.algorithm !== 'SHA1') {
            params.set('algorithm', item.algorithm);
        }
        
        if (type === 'hotp' && item.counter !== undefined) {
            params.set('counter', item.counter.toString());
        }

        if (options?.includeRemark !== false && item.remark) {
            params.set('remark', escapeRemark(item.remark));
        }
        
        // 构建完整URI
        const uri = `otpauth://${type}/${encodedLabel}?${params.toString()}`;
        
        return uri;
    } catch (error) {
        console.error('生成OTP URI失败:', error);
        throw new Error('生成OTP URI失败: ' + error.message);
    }
}

// 导出OTP到文件
function exportOtpToFile() {
    try {
        // 获取所有OTP项目
        const otpItems = getOtpItems();
        
        if (otpItems.length === 0) {
            throw new Error('没有可导出的验证器');
        }
        
        // 生成导出内容，每行一个OTP URI，并对中文字符进行解码
        const exportContent = otpItems.map(item => {
            const uri = generateOtpUri(item);
            // 解码URI中的中文字符（保留保留字符编码，避免破坏 query 结构）
            return decodeURI(uri);
        }).join('\n');
        
        // 添加文件头说明
        const fileHeader = [
            '# FastOtp 验证器导出文件',
            '# 此文件包含您的两步验证配置信息',
            '# 每行一个 otpauth:// URI，可被其他OTP应用程序导入',
            `# 导出时间: ${new Date().toLocaleString('zh-CN')}`,
            `# 共导出 ${otpItems.length} 个验证器`,
            '',
            ''
        ].join('\n');
        
        const fullContent = fileHeader + exportContent;
        
        // 使用uTools API显示保存对话框
        const currentDate = new Date().toISOString().slice(0, 10).replace(/-/g, '');
        const savePath = utools.showSaveDialog({
            title: '导出OTP验证器',
            defaultPath: `FastOtp_导出_${currentDate}.txt`,
            filters: [
                { name: '文本文件', extensions: ['txt'] }
            ]
        });
        
        if (!savePath) {
            // 用户取消了保存
            return { success: false, message: '用户取消了导出' };
        }
        
        // 写入文件 - 尝试多种编码方式确保中文正确显示
        try {
            // 方法1: 使用UTF-8 BOM + Buffer
            const utf8BOM = Buffer.from([0xEF, 0xBB, 0xBF]); // UTF-8 BOM
            const contentBuffer = Buffer.from(fullContent, 'utf8');
            const finalBuffer = Buffer.concat([utf8BOM, contentBuffer]);
            fs.writeFileSync(savePath, finalBuffer);
        } catch (error) {
            try {
                // 方法2: 直接使用utf8编码
                fs.writeFileSync(savePath, fullContent, { encoding: 'utf8' });
            } catch (error2) {
                // 方法3: 使用默认编码
                fs.writeFileSync(savePath, fullContent);
            }
        }
        
        return {
            success: true,
            message: `成功导出 ${otpItems.length} 个验证器到文件`,
            path: savePath,
            count: otpItems.length
        };
        
    } catch (error) {
        console.error('导出OTP失败:', error);
        return {
            success: false,
            message: '导出失败: ' + error.message
        };
    }
}

function getWebdavConfig() {
    const raw = db.getItem(DB_KEY_WEBDAV_BACKUP_CONFIG);
    const cfg = raw && typeof raw === 'object' ? raw : {};
    return {
        dirUrl: typeof cfg.dirUrl === 'string' ? cfg.dirUrl : '',
        username: typeof cfg.username === 'string' ? cfg.username : '',
        password: typeof cfg.password === 'string' ? cfg.password : '',
        encryptPassword: typeof cfg.encryptPassword === 'string' ? cfg.encryptPassword : '',
        retentionDays: Number.isFinite(cfg.retentionDays) ? Number(cfg.retentionDays) : 0,
        autoBackup: typeof cfg.autoBackup === 'boolean' ? cfg.autoBackup : true,
        allowInsecure: typeof cfg.allowInsecure === 'boolean' ? cfg.allowInsecure : false,
    };
}

function setWebdavConfig(config) {
    if (!config || typeof config !== 'object') {
        throw new Error('配置无效');
    }
    const prev = getWebdavConfig();
    const next = {
        dirUrl: typeof config.dirUrl === 'string' ? config.dirUrl : prev.dirUrl,
        username: typeof config.username === 'string' ? config.username : prev.username,
        password: typeof config.password === 'string' ? config.password : prev.password,
        encryptPassword: typeof config.encryptPassword === 'string' ? config.encryptPassword : prev.encryptPassword,
        retentionDays: Number.isFinite(config.retentionDays)
            ? Number(config.retentionDays)
            : (Number.isFinite(prev.retentionDays) ? Number(prev.retentionDays) : 0),
        autoBackup:
            typeof config.autoBackup === 'boolean'
                ? config.autoBackup
                : (typeof prev.autoBackup === 'boolean' ? prev.autoBackup : true),
        allowInsecure: typeof config.allowInsecure === 'boolean' ? config.allowInsecure : !!prev.allowInsecure,
    };
    db.setItem(DB_KEY_WEBDAV_BACKUP_CONFIG, next);
    autoBackup.syncWithConfig();
    return true;
}

function resolveWebdavConfig(configOverride) {
    if (configOverride && typeof configOverride === 'object') {
        return { ...getWebdavConfig(), ...configOverride };
    }
    return getWebdavConfig();
}

async function testWebdavConnection(configOverride) {
    try {
        const config = resolveWebdavConfig(configOverride);
        return await webdavBackup.testConnection(config);
    } catch (error) {
        return { success: false, message: error?.message || '测试失败' };
    }
}

async function listWebdavBackups(configOverride) {
    const config = resolveWebdavConfig(configOverride);
    return await webdavBackup.listBackups(config);
}


async function createWebdavBackup(configOverride) {
    try {
        return await enqueueWebdavJob(async () => {
            const config = resolveWebdavConfig(configOverride);
            const otpItems = getOtpItems();
            const deletedItems = getDeletedItems();
            return await webdavBackup.createBackup(config, { otpItems, deletedItems });
        });
    } catch (error) {
        return { success: false, message: error?.message || '备份失败' };
    }
}

async function restoreWebdavBackup(filename, configOverride) {
    try {
        if (!filename) throw new Error('备份文件名不能为空');
        const config = resolveWebdavConfig(configOverride);
        const result = await webdavBackup.restoreBackup(config, filename);
        const data = result.data;

        db.setItem(DB_KEY_OTP_ITEMS, data.otpItems || []);
        db.setItem(DB_KEY_DELETED_ITEMS, data.deletedItems || []);
        scheduleAutoBackup('restoreWebdavBackup');

        return {
            success: true,
            message: '已从备份恢复本地数据',
            count: (data.otpItems || []).length,
        };
    } catch (error) {
        return { success: false, message: error?.message || '恢复失败' };
    }
}
