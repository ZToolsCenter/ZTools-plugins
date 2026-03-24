const fs = require('fs');
const path = require('path');

// 1. 配置文件路径（存放在插件同级目录）
const getCsvPath = () => path.join(__dirname, 'data.csv');

// 2. 监听插件进入
window.ztools.onPluginEnter(({ code, type, payload }) => {
    console.log('KeeHoo FastReply 启动:', code, type, payload);
    
    // 如果是通过特定指令进入，可以做一些初始化动作
    if (code === 'fast_reply') {
        // 可以在这里执行静默初始化
    }
});

// 3. 核心服务注入 (供 index.html 调用)
window.services = {
    // 读取数据逻辑
    readCsv: () => {
        const p = getCsvPath();
        if (!fs.existsSync(p)) {
            // 初始化带 BOM 的 UTF-8 CSV，确保 Excel 打开不乱码
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

    // 保存数据逻辑
    saveCsv: (list) => {
        const header = '\ufeff分类,标题,内容,简拼,图片路径\n';
        const body = list.map(i => `${i.group},${i.title},${i.content},${i.shortcut},${i.image}`).join('\n');
        fs.writeFileSync(getCsvPath(), header + body, 'utf-8');
    },

    // 执行发送：图文混发 + 模拟按键
    executePaste: (text, imagePath, autoEnter) => {
        // 使用 window.onblur 捕捉“切换到聊天窗口”的动作
        window.onblur = () => {
            setTimeout(() => {
                // 处理图片：先复制图片并粘贴
                if (imagePath && fs.existsSync(imagePath)) {
                    window.ztools.copyImage(imagePath);
                    window.ztools.simulateKeyboardTap('v', 'control');
                    
                    // 给图片上传留一点缓冲时间（600ms），然后再发文字
                    setTimeout(() => {
                        if (text) {
                            window.ztools.copyText(text);
                            window.ztools.simulateKeyboardTap('v', 'control');
                        }
                        if (autoEnter) {
                            setTimeout(() => window.ztools.simulateKeyboardTap('enter'), 100);
                        }
                    }, 600);
                } else {
                    // 纯文字模式
                    if (text) {
                        window.ztools.copyText(text);
                        window.ztools.simulateKeyboardTap('v', 'control');
                        if (autoEnter) {
                            setTimeout(() => window.ztools.simulateKeyboardTap('enter'), 100);
                        }
                    }
                }
            }, 300); // 300ms 延迟确保用户已经点进了目标窗口
            window.onblur = null;
        };
        // 提示用户
        window.ztools.showNotification('🚀 话术就绪，请点击聊天输入框');
    },

    // 选取文件与目录
    selectImage: () => {
        const paths = window.ztools.showOpenDialog({
            title: '选择配图',
            filters: [{ name: 'Images', extensions: ['jpg', 'png', 'gif', 'jpeg'] }],
            properties: ['openFile']
        });
        return (paths && paths.length > 0) ? paths[0] : '';
    },

    openInExcel: () => {
        const p = getCsvPath();
        window.ztools.shellOpenPath(p);
    }
};