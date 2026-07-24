const electron = require("electron");

async function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

window.ztools.onPluginEnter((param) => {
    console.log("clipboard plugin enter", param);
})

const fs = require('fs');
const path = require('path');
const os = require('os');
const { fileURLToPath } = require('url');

const IMAGE_CONTENT_TYPES = {
    '.apng': 'image/apng',
    '.avif': 'image/avif',
    '.gif': 'image/gif',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.svg': 'image/svg+xml',
    '.webp': 'image/webp',
    '.bmp': 'image/bmp',
    '.ico': 'image/x-icon'
};

function getContentType(filePath) {
    return IMAGE_CONTENT_TYPES[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
}

function normalizeFileUrl(fileUrl) {
    if (typeof fileUrl !== 'string') {
        return '';
    }
    if (fileUrl.startsWith('file://')) {
        return fileURLToPath(fileUrl);
    }
    return fileUrl;
}

window.ztools.readMarkdownLocalImage = async (fileUrl) => {
    try {
        const filePath = normalizeFileUrl(fileUrl);
        if (!filePath || !fs.existsSync(filePath)) {
            return { success: false, error: '文件不存在' };
        }

        const stat = fs.statSync(filePath);
        if (!stat.isFile()) {
            return { success: false, error: '不是文件' };
        }

        return {
            success: true,
            fileName: path.basename(filePath),
            contentType: getContentType(filePath),
            buffer: fs.readFileSync(filePath)
        };
    } catch (error) {
        return { success: false, error: error.message || '读取文件失败' };
    }
}

window.ztools.exportMarkdown = async (filename, content, attachments = []) => {
    console.log("exportMarkdown", filename, content);
    const result = await window.ztools.showSaveDialog({
        defaultPath: path.join(os.homedir(), 'Downloads')
    });
    console.log("exportMarkdown result", result);

    if (!result) {
        return false;
    }

    const exportDir = result;

    if (!fs.existsSync(exportDir)) {
        fs.mkdirSync(exportDir, { recursive: true });
    }

    for (const attachment of attachments) {
        if (!attachment || !attachment.fileName || !attachment.buffer) {
            continue;
        }
        const safeAttachmentName = path.basename(attachment.fileName).replace(/[\\/:*?"<>|]/g, '');
        if (!safeAttachmentName) {
            continue;
        }
        fs.writeFileSync(path.join(exportDir, safeAttachmentName), Buffer.from(attachment.buffer));
    }

    // Regex to find images: ![alt](file://path)
    const imageRegex = /!\[(.*?)\]\((file:\/\/[^\)]+)\)/g;
    let newContent = content;

    // First, find all matches to copy files
    const matches = [...content.matchAll(imageRegex)];

    for (const m of matches) {
        const fullMatch = m[0];
        const alt = m[1];
        const fileUrl = m[2];

        try {
            const srcPath = fileUrl.replace('file://', '');
            if (fs.existsSync(srcPath)) {
                const baseName = path.basename(srcPath);
                const destPath = path.join(exportDir, baseName);

                fs.copyFileSync(srcPath, destPath);

                // Replace in content
                newContent = newContent.split(fileUrl).join(baseName);
            }
        } catch (e) {
            console.error('Failed to copy image:', fileUrl, e);
        }
    }

    const safeFilename = filename.replace(/[\\/:*?"<>|]/g, '');
    const mdFilePath = path.join(exportDir, `${safeFilename}.md`);
    fs.writeFileSync(mdFilePath, newContent);

    return true;
}
