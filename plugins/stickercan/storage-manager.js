class StorageManager {
    // 带超时的 fetch 请求
    async fetchWithTimeout(url, options = {}, timeout = 30000) {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeout);
        
        try {
            const response = await fetch(url, {
                ...options,
                signal: controller.signal
            });
            clearTimeout(timeoutId);
            return response;
        } catch (error) {
            clearTimeout(timeoutId);
            if (error.name === 'AbortError') {
                throw new Error('请求超时，请检查网络连接');
            }
            throw error;
        }
    }

    // Node.js HTTP请求（绕过CORS）
    async nodeFetch(url, options = {}) {
        if (window.emotionCan && typeof window.emotionCan.nodeFetch === 'function') {
            try {
                return await window.emotionCan.nodeFetch(url, options);
            } catch (error) {
                console.warn('Node.js请求失败，尝试浏览器fetch:', error);
                return null;
            }
        }
        return null;
    }

    // 下载图片（优先使用Node.js）
    async downloadImage(imageUrl) {
        // 尝试Node.js方式
        if (window.emotionCan && typeof window.emotionCan.downloadImage === 'function') {
            try {
                return await window.emotionCan.downloadImage(imageUrl);
            } catch (error) {
                console.warn('Node.js下载失败，尝试浏览器fetch:', error);
            }
        }
        
        // 回退到浏览器fetch
        const response = await this.fetchWithTimeout(imageUrl);
        if (!response.ok) {
            throw new Error('下载图片失败');
        }
        
        const blob = await response.blob();
        const contentType = blob.type || 'image/png';
        const reader = new FileReader();
        
        return new Promise((resolve, reject) => {
            reader.onload = () => {
                resolve({
                    dataUrl: reader.result,
                    buffer: null,
                    contentType: contentType
                });
            };
            reader.onerror = reject;
            reader.readAsDataURL(blob);
        });
    }

    constructor(emotionManager) {
        this.emotionManager = emotionManager;
        this.selectedStorage = 'local';
    }

    updateStorageHint() {
        const hint = document.getElementById('storageHint');
        const configHint = this.getConfigHint();
        if (configHint) {
            hint.innerHTML = '<i class="mdi mdi-alert"></i> ' + configHint;
            hint.style.color = '#ff6b6b';
        } else {
            if (this.selectedStorage === 'local') {
                hint.innerHTML = '<i class="mdi mdi-information"></i> 本地存储不会同步到其他设备';
            } else {
                hint.innerHTML = '<i class="mdi mdi-information"></i> 云端存储会同步到其他设备';
            }
            hint.style.color = '';
        }
    }

    checkLocalConfig() {
        const settings = this.emotionManager.dataManager.settings;
        return settings && settings.localPath && settings.localPath.trim() !== '';
    }

    checkCloudConfig() {
        const settings = this.emotionManager.dataManager.settings;
        if (!settings) return false;
        
        const provider = settings.cloudProvider;
        if (!provider) return false;
        
        if (provider === 'imgbb') {
            return settings.cloudConfig && settings.cloudConfig.imgbbApiKey && settings.cloudConfig.imgbbApiKey.trim() !== '';
        } else if (provider === 's3') {
            return settings.cloudConfig && 
                   settings.cloudConfig.s3Endpoint && 
                   settings.cloudConfig.s3AccessKey && 
                   settings.cloudConfig.s3SecretKey && 
                   settings.cloudConfig.s3Bucket;
        } else if (provider === 'tucang') {
            return settings.cloudConfig && settings.cloudConfig.tucangToken && settings.cloudConfig.tucangToken.trim() !== '';
        }
        return false;
    }

    getConfigHint() {
        if (this.selectedStorage === 'local') {
            if (!this.checkLocalConfig()) {
                return '请先在设置中配置本地存储路径';
            }
            return null;
        } else {
            if (!this.checkCloudConfig()) {
                return '请先在设置中配置云存储';
            }
            return null;
        }
    }

    getLocalConfigHint() {
        if (!this.checkLocalConfig()) {
            return '请先在设置中配置本地存储路径';
        }
        return null;
    }

    getCloudConfigHint() {
        if (!this.checkCloudConfig()) {
            return '请先在设置中配置云存储';
        }
        return null;
    }

    async selectLocalFolder() {
        try {
            if (window.ztools && window.ztools.showOpenDialog) {
                try {
                    const result = await window.ztools.showOpenDialog({
                        properties: ['openDirectory', 'createDirectory']
                    });
                    if (Array.isArray(result) && result.length > 0) {
                        const folderPath = result[0];
                        document.getElementById('localPath').value = folderPath;
                        this.emotionManager.dataManager.settings.localPath = folderPath;
                        this.emotionManager.showMessage('本地存储路径已选择，请点击保存设置', 'info');
                        return;
                    }
                } catch (apiError) {
                    console.log('ZTools showOpenDialog 调用失败:', apiError);
                }
            }
            
            if (window.emotionCan && typeof window.emotionCan.selectFolder === 'function') {
                const folderPath = await window.emotionCan.selectFolder();
                if (folderPath) {
                    document.getElementById('localPath').value = folderPath;
                    this.emotionManager.dataManager.settings.localPath = folderPath;
                    this.emotionManager.showMessage('本地存储路径已设置，请点击保存设置', 'info');
                    return;
                }
            }
            
            if (window.emotionCan && typeof window.emotionCan.getDefaultDir === 'function') {
                const defaultDir = window.emotionCan.getDefaultDir();
                document.getElementById('localPath').value = defaultDir;
                this.emotionManager.dataManager.settings.localPath = defaultDir;
                this.emotionManager.showMessage('已使用默认存储路径，请点击保存设置', 'info');
            } else {
                this.emotionManager.showMessage('请在输入框中手动输入本地存储路径', 'info');
            }
        } catch (error) {
            console.error('选择文件夹失败:', error);
            try {
                if (window.emotionCan && window.emotionCan.getDefaultDir) {
                    const defaultDir = window.emotionCan.getDefaultDir();
                    document.getElementById('localPath').value = defaultDir;
                    this.emotionManager.dataManager.settings.localPath = defaultDir;
                }
            } catch (e) {
                console.log('设置默认路径失败');
            }
            this.emotionManager.showMessage('选择文件夹功能暂时不可用，请手动输入路径', 'info');
        }
    }

    async saveToLocal(file) {
        const settings = this.emotionManager.dataManager.settings;
        if (!settings.localPath) {
            throw new Error('请先在设置中配置本地存储路径');
        }
        
        const fileName = `${Date.now()}_${file.name.replace(/[^a-zA-Z0-9.]/g, '_')}`;
        const fullPath = `${settings.localPath}/${fileName}`;
        
        if (window.emotionCan && typeof window.emotionCan.saveFile === 'function') {
            try {
                const base64 = await this.fileToBase64(file);
                const savedPath = await window.emotionCan.saveFile(base64, fullPath);
                const fileUrl = `file://${savedPath.replace(/\\/g, '/')}`;
                return fileUrl;
            } catch (error) {
                console.error('保存到本地失败:', error);
                throw new Error('保存文件到本地失败: ' + error.message);
            }
        } else {
            return URL.createObjectURL(file);
        }
    }

    async uploadToCloud(file) {
        const provider = this.emotionManager.dataManager.settings.cloudProvider;
        
        if (provider === 'imgbb') {
            return await this.uploadToImgbb(file);
        } else if (provider === 's3') {
            return await this.uploadToS3(file);
        } else if (provider === 'tucang') {
            return await this.uploadToTucang(file);
        } else {
            throw new Error('请先配置云存储');
        }
    }

    async uploadToImgbb(file) {
        const apiKey = this.emotionManager.dataManager.settings.cloudConfig.imgbbApiKey;
        if (!apiKey) {
            throw new Error('请先配置ImgBB API Key');
        }
        
        const formData = new FormData();
        formData.append('image', file);
        
        const response = await this.fetchWithTimeout(`https://api.imgbb.com/1/upload?key=${apiKey}`, {
            method: 'POST',
            body: formData
        });
        
        const data = await response.json();
        
        if (data.success) {
            return data.data.url;
        } else {
            throw new Error(data.error?.message || '上传失败');
        }
    }

    async uploadToTucang(file) {
        const token = this.emotionManager.dataManager.settings.cloudConfig.tucangToken;
        if (!token) {
            throw new Error('请先配置图仓Token');
        }

        const formData = new FormData();
        formData.append('token', token);
        formData.append('file', file);

        const folderId = this.emotionManager.dataManager.settings.cloudConfig.tucangFolderId;
        if (folderId && folderId > 0) {
            formData.append('folderId', folderId);
        }

        const response = await this.fetchWithTimeout('https://api.tucang.cc/api/v1/upload', {
            method: 'POST',
            body: formData
        });

        const data = await response.json();

        if (data.success && data.code === '200') {
            return data.data.url;
        } else {
            throw new Error(data.msg || '图仓上传失败');
        }
    }

    async uploadToS3(file) {
        const config = this.emotionManager.dataManager.settings.cloudConfig;
        if (!config.s3Endpoint || !config.s3AccessKey || !config.s3SecretKey || !config.s3Bucket) {
            throw new Error('请先完整配置S3存储信息');
        }
        
        const fileName = `emotions/${Date.now()}_${Math.random().toString(36).substr(2, 9)}_${file.name}`;
        let fileData;
        
        if (file instanceof ArrayBuffer || file instanceof Uint8Array) {
            fileData = new Uint8Array(file);
        } else {
            const base64Data = await this.fileToBase64(file);
            const binaryData = atob(base64Data.split(',')[1]);
            fileData = new Uint8Array(binaryData.length);
            for (let i = 0; i < binaryData.length; i++) {
                fileData[i] = binaryData.charCodeAt(i);
            }
        }
        
        if (window.emotionCan && typeof window.emotionCan.uploadToS3Node === 'function') {
            const s3Config = {
                s3Endpoint: config.s3Endpoint,
                customHeaders: {
                    'Authorization': await this.generateAuthHeader(config, fileName, fileData, file.type || 'image/png'),
                    'Content-Type': file.type || 'image/png',
                    'x-amz-content-sha256': await this.hash256(fileData),
                    'x-amz-date': this.getAmzDate()
                }
            };
            
            const result = await window.emotionCan.uploadToS3Node(
                s3Config,
                fileName,
                fileData,
                file.type || 'image/png'
            );
            return result;
        } else {
            throw new Error('Node.js环境不可用，无法上传到S3。请确保在ZTools环境中运行此插件。');
        }
    }

    // 生成S3认证头
    async generateAuthHeader(config, fileName, fileData, contentType) {
        const host = config.s3Endpoint.replace(/^https?:\/\//, '');
        const region = config.s3Region || 'us-east-1';
        
        const date = new Date().toISOString().replace(/[:-]|\.\d{3}/g, '');
        const dateStamp = date.substr(0, 8);
        const amzDate = date.substr(0, 8) + 'T' + date.substr(9, 6) + 'Z';
        
        const payloadHash = await this.hash256(fileData);
        
        const canonicalUri = '/' + fileName;
        const canonicalQuerystring = '';
        const canonicalHeaders = `host:${host}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${amzDate}\n`;
        const signedHeaders = 'host;x-amz-content-sha256;x-amz-date';
        
        const canonicalRequest = [
            'PUT',
            canonicalUri,
            canonicalQuerystring,
            canonicalHeaders,
            signedHeaders,
            payloadHash
        ].join('\n');
        
        const algorithm = 'AWS4-HMAC-SHA256';
        const credentialScope = `${dateStamp}/${region}/s3/aws4_request`;
        const stringToSign = [
            algorithm,
            amzDate,
            credentialScope,
            await this.hash256(canonicalRequest)
        ].join('\n');
        
        const signingKey = await this.getSignatureKey(
            config.s3SecretKey,
            dateStamp,
            region,
            's3'
        );
        const signature = await this.hmacSha256(signingKey, stringToSign);
        
        return `${algorithm} Credential=${config.s3AccessKey}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
    }

    // 获取AWS日期
    getAmzDate() {
        const date = new Date().toISOString().replace(/[:-]|\.\d{3}/g, '');
        return date.substr(0, 8) + 'T' + date.substr(9, 6) + 'Z';
    }

    async hash256(message) {
        let msgBuffer;
        if (typeof message === 'string') {
            msgBuffer = new TextEncoder().encode(message);
        } else {
            msgBuffer = message;
        }
        const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    }

    async hmacSha256(key, message) {
        const cryptoKey = await crypto.subtle.importKey(
            'raw',
            new TextEncoder().encode(key),
            { name: 'HMAC', hash: 'SHA-256' },
            false,
            ['sign']
        );
        const signature = await crypto.subtle.sign(
            'HMAC',
            cryptoKey,
            new TextEncoder().encode(message)
        );
        return Array.from(new Uint8Array(signature))
            .map(b => b.toString(16).padStart(2, '0'))
            .join('');
    }

    async getSignatureKey(key, dateStamp, region, service) {
        const kDate = await this.hmacSha256('AWS4' + key, dateStamp);
        const kRegion = await this.hmacSha256(kDate, region);
        const kService = await this.hmacSha256(kRegion, service);
        const kSigning = await this.hmacSha256(kService, 'aws4_request');
        return kSigning;
    }

    async uploadUrlToCloud(imageUrl) {
        const provider = this.emotionManager.dataManager.settings.cloudProvider;
        
        try {
            const imageData = await this.downloadImage(imageUrl);
            
            const mimeType = imageData.contentType || 'image/png';
            const extension = this.getExtensionFromMimeType(mimeType);
            const fileName = `emotion_${Date.now()}_${Math.random().toString(36).substr(2, 9)}.${extension}`;
            
            let file;
            if (imageData.buffer) {
                file = new File([imageData.buffer], fileName, { type: mimeType });
            } else {
                const response = await this.fetchWithTimeout(imageUrl);
                const blob = await response.blob();
                file = new File([blob], fileName, { type: mimeType });
            }
            
            if (provider === 'imgbb') {
                return await this.uploadToImgbb(file);
            } else if (provider === 's3') {
                return await this.uploadToS3(file);
            } else if (provider === 'tucang') {
                return await this.uploadToTucang(file);
            } else {
                throw new Error('请先配置云存储');
            }
        } catch (error) {
            console.error('上传URL图片到云端失败:', error);
            throw new Error('上传图片到云端失败: ' + error.message);
        }
    }

    async downloadAndSaveToLocal(imageUrl) {
        const settings = this.emotionManager.dataManager.settings;
        if (!settings.localPath) {
            throw new Error('请先在设置中配置本地存储路径');
        }
        
        try {
            // 使用新的downloadImage方法（优先Node.js，绕过CORS）
            const imageData = await this.downloadImage(imageUrl);
            
            const mimeType = imageData.contentType || 'image/png';
            const extension = this.getExtensionFromMimeType(mimeType);
            
            const fileName = `${Date.now()}_${Math.random().toString(36).substr(2, 9)}.${extension}`;
            const fullPath = `${settings.localPath}/${fileName}`;
            
            if (window.emotionCan && typeof window.emotionCan.saveFile === 'function') {
                const base64 = imageData.dataUrl;
                const savedPath = await window.emotionCan.saveFile(base64, fullPath);
                const fileUrl = `file://${savedPath.replace(/\\/g, '/')}`;
                return fileUrl;
            } else {
                // 回退：创建Blob URL
                const blob = await (await this.fetchWithTimeout(imageUrl)).blob();
                return URL.createObjectURL(blob);
            }
        } catch (error) {
            console.error('下载并保存到本地失败:', error);
            throw new Error('下载并保存图片失败: ' + error.message);
        }
    }
    
    getExtensionFromMimeType(mimeType) {
        const mimeToExt = {
            'image/png': 'png',
            'image/jpeg': 'jpg',
            'image/jpg': 'jpg',
            'image/gif': 'gif',
            'image/webp': 'webp',
            'image/bmp': 'bmp',
            'image/svg+xml': 'svg'
        };
        return mimeToExt[mimeType] || 'png';
    }

    blobToBase64(blob) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = reject;
            reader.readAsDataURL(blob);
        });
    }

    fileToBase64(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = reject;
            reader.readAsDataURL(file);
        });
    }

    getImageSrc(emotion) {
        return emotion.url;
    }

    async getFileFromLocal(emotion) {
        try {
            // 尝试使用 Node.js 方式读取本地文件
            if (window.emotionCan && typeof window.emotionCan.readFile === 'function') {
                const filePath = emotion.url.replace('file://', '').replace(/\//g, '\\');
                const result = await window.emotionCan.readFile(filePath);
                if (result && result.base64 && result.fileName) {
                    const mimeType = this.getMimeTypeFromFileName(result.fileName);
                    const binaryString = atob(result.base64);
                    const bytes = new Uint8Array(binaryString.length);
                    for (let i = 0; i < binaryString.length; i++) {
                        bytes[i] = binaryString.charCodeAt(i);
                    }
                    const blob = new Blob([bytes], { type: mimeType });
                    return new File([blob], result.fileName, { type: mimeType });
                }
            }
            
            // 回退到浏览器方式
            const response = await this.fetchWithTimeout(emotion.url);
            if (!response.ok) {
                throw new Error('无法读取本地文件');
            }
            const blob = await response.blob();
            const fileName = emotion.metadata?.originalName || 'emotion_' + Date.now() + '.' + this.getExtensionFromMimeType(blob.type);
            return new File([blob], fileName, { type: blob.type });
        } catch (error) {
            console.error('读取本地文件失败:', error);
            throw new Error('读取本地文件失败: ' + error.message);
        }
    }

    getMimeTypeFromFileName(fileName) {
        const ext = fileName.split('.').pop().toLowerCase();
        const mimeMap = {
            'png': 'image/png',
            'jpg': 'image/jpeg',
            'jpeg': 'image/jpeg',
            'gif': 'image/gif',
            'webp': 'image/webp',
            'bmp': 'image/bmp',
            'svg': 'image/svg+xml'
        };
        return mimeMap[ext] || 'image/png';
    }
}
