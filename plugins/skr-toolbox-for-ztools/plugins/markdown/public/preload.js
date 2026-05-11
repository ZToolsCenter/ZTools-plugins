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

window.ztools.saveMarkdownImage = async (fileName, buffer) => {
    const documentsPath = path.join(os.homedir(), 'Documents');
    const saveDir = path.join(documentsPath, 'markdown-note');

    if (!fs.existsSync(saveDir)) {
        fs.mkdirSync(saveDir, { recursive: true });
    }

    const ext = path.extname(fileName);
    const newFileName = `${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`;
    const filePath = path.join(saveDir, newFileName);
    fs.writeFileSync(filePath, Buffer.from(buffer));

    return `file://${filePath}`;
}

window.ztools.exportMarkdown = async (filename, content) => {
    console.log("exportMarkdown", filename, content);
    const result = await window.ztools.showSaveDialog({
        defaultPath: path.join(os.homedir(), 'Downloads')
    });
    console.log("exportMarkdown result", result);

    if (!result) {
        return false;
    }

    const exportDir = result;
    const newFilename = path.basename(exportDir);

    if (!fs.existsSync(exportDir)) {
        fs.mkdirSync(exportDir, { recursive: true });
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