const fs = require('fs');
const path = require('path');

const getCsvPath = () => path.join(__dirname, 'data.csv');

window.services = {
    readCsv: () => {
        const p = getCsvPath();
        if (!fs.existsSync(p)) {
            const header = '\ufeff分类,标题,内容,简拼,图片路径\n默认,欢迎语,你好{{{姓名}}}！,hy,';
            fs.writeFileSync(p, header, 'utf-8');
        }
        const content = fs.readFileSync(p, 'utf-8').replace(/^\ufeff/, '');
        return content.split('\n').filter(l => l.trim()).slice(1).map(l => {
            const v = l.split(',');
            return { 
                group: v[0] || '默认', 
                title: v[1] || '', 
                content: v[2] || '', 
                shortcut: v[3] || '',
                image: v[4] ? v[4].trim() : '' 
            };
        });
    },

    appendCsv: (item) => {
        const p = getCsvPath();
        const line = `\n${item.group},${item.title},${item.content},${item.shortcut},${item.image}`;
        fs.appendFileSync(p, line, 'utf-8');
    },

    // 恢复图片+文字混合发送逻辑
    executePaste: (text, imagePath, autoEnter) => {
        // 1. 内容上膛
        if (imagePath && fs.existsSync(imagePath)) {
            window.ztools.copyImage(imagePath);
            window.ztools.showNotification('图片就绪，请点击聊天窗口');
        } else if (text) {
            window.ztools.copyText(text);
            window.ztools.showNotification('话术就绪，请点击聊天窗口');
        }

        // 2. 监听失焦执行
        window.onblur = () => {
            setTimeout(() => {
                if (imagePath && fs.existsSync(imagePath)) {
                    // 粘贴图片
                    window.ztools.simulateKeyboardTap('v', 'control');
                    // 如果还有配套文字，延迟500ms再发文字
                    if (text) {
                        setTimeout(() => {
                            window.ztools.copyText(text);
                            window.ztools.simulateKeyboardTap('v', 'control');
                            if (autoEnter) window.ztools.simulateKeyboardTap('enter');
                        }, 600);
                    } else if (autoEnter) {
                        // 纯图片自动回车
                        setTimeout(() => window.ztools.simulateKeyboardTap('enter'), 200);
                    }
                } else if (text) {
                    // 纯文字模式
                    window.ztools.simulateKeyboardTap('v', 'control');
                    if (autoEnter) window.ztools.simulateKeyboardTap('enter');
                }
            }, 250);
            window.onblur = null;
        };
    },

    // 选择图片文件的接口
    selectImageFile: () => {
        const paths = window.ztools.showOpenDialog({
            title: '选择图片',
            filters: [{ name: 'Images', extensions: ['jpg', 'png', 'gif', 'jpeg'] }],
            properties: ['openFile']
        });
        return (paths && paths.length > 0) ? paths[0] : '';
    },

    openInExcel: () => window.ztools.shellOpenPath(getCsvPath())
};